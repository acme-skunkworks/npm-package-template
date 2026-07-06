#!/usr/bin/env node
// Detect which installed skills are behind a target ref of the source repo (A-616).
//
// Compares a consumer's `.claude/skills.lock` (written by initialise-skills) against
// the bundle versions in a checkout of the source agent-skills repo, and prints the
// per-skill bump list. Used two ways:
//   - locally ("is my repo behind?"): point --source at an up-to-date clone;
//   - by WS3's push fleet-update orchestrator (A-617): to populate update-PR bodies
//     and skip repos that are already current.
//
//   node scripts/check-updates.mjs --source <agent-skills-checkout> [--ref <ref>]
//                                  [--lock <path>] [--json]
//
// The consumer holds only OLD vendored copies, so the target versions must come
// from a source checkout. With --ref, each version is read at that ref via
// `git show <ref>:skills/<name>/SKILL.md` (mirroring send-it's check-skill-bumps);
// without it, the source working tree is read. Exit codes: 0 success; 2 usage/IO.
//
// The pure functions (compareVersions, diffLock) keep no git/fs state, so they're
// exported for vitest and exercised by --self-test. main() does the I/O.
// Zero dependencies — Node built-ins only, no build step, no tsx.

import {
  parseSkillVersion,
  readInstalledVersions,
} from "./lib/skill-version.mjs";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";

/**
 * Parse a version into its numeric `[major, minor, patch]` core, dropping any
 * pre-release/build metadata (a bump always lands on a clean release version).
 * Returns null for a non-string or non-semver-core value.
 * @param {unknown} version
 * @returns {[number, number, number] | null}
 */
function parseCore(version) {
  if (typeof version !== "string") {
    return null;
  }

  const core = version.split(/[-+]/, 1)[0];
  const parts = core.split(".");
  if (parts.length !== 3 || parts.some((part) => !/^\d+$/.test(part))) {
    return null;
  }

  return /** @type {[number, number, number]} */ (parts.map(Number));
}

/**
 * Classify the change from an installed version (`from`) to a target version
 * (`to`): the first differing semver component decides the bump. `to` newer →
 * `major`/`minor`/`patch`; `to` older (consumer ahead) → `downgrade`; equal →
 * `none`; either side unparseable/absent → `unknown`.
 * @param {unknown} from
 * @param {unknown} to
 * @returns {"major"|"minor"|"patch"|"none"|"downgrade"|"unknown"}
 */
export function compareVersions(from, to) {
  const a = parseCore(from);
  const b = parseCore(to);
  if (a === null || b === null) {
    return "unknown";
  }

  for (let index = 0; index < 3; index++) {
    if (b[index] > a[index]) {
      return index === 0 ? "major" : index === 1 ? "minor" : "patch";
    }

    if (b[index] < a[index]) {
      return "downgrade";
    }
  }

  return "none";
}

function byName(a, b) {
  return a.name.localeCompare(b.name);
}

/**
 * Diff a lock's installed versions against a target's versions.
 *   updates   : [{name, from, to, bump}] where the target is strictly newer
 *               (bump ∈ major|minor|patch) — the actionable upgrade list.
 *   downgrades: [{name, from, to}] where the consumer is ahead of the target.
 *   unknown   : [{name, from, to}] where a version couldn't be compared.
 *   added     : [{name, version}] present upstream, absent from the lock.
 *   removed   : [name] present in the lock, absent upstream.
 *   upToDate  : [name] already at the target version.
 * @param {Record<string, string | null>} lockSkills
 * @param {Record<string, string | null>} targetVersions
 */
export function diffLock(lockSkills, targetVersions) {
  const updates = [];
  const downgrades = [];
  const unknown = [];
  const added = [];
  const removed = [];
  const upToDate = [];

  for (const name of Object.keys(lockSkills)) {
    if (!(name in targetVersions)) {
      removed.push(name);
      continue;
    }

    const from = lockSkills[name];
    const to = targetVersions[name];
    const bump = compareVersions(from, to);
    if (bump === "none") {
      upToDate.push(name);
    } else if (bump === "downgrade") {
      downgrades.push({ from, name, to });
    } else if (bump === "unknown") {
      unknown.push({ from, name, to });
    } else {
      updates.push({ bump, from, name, to });
    }
  }

  for (const name of Object.keys(targetVersions)) {
    if (!(name in lockSkills)) {
      added.push({ name, version: targetVersions[name] });
    }
  }

  return {
    added: added.toSorted(byName),
    downgrades: downgrades.toSorted(byName),
    removed: removed.toSorted((a, b) => a.localeCompare(b)),
    unknown: unknown.toSorted(byName),
    updates: updates.toSorted(byName),
    upToDate: upToDate.toSorted((a, b) => a.localeCompare(b)),
  };
}

function parseArgs(argv) {
  const options = {
    json: false,
    lock: undefined,
    ref: undefined,
    selfTest: false,
    source: undefined,
  };
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (argument === "--json") {
      options.json = true;
    } else if (argument === "--self-test") {
      options.selfTest = true;
    } else if (argument === "--help" || argument === "-h") {
      options.help = true;
    } else if (argument === "--source") {
      options.source = requireValue(argument, argv[++index]);
    } else if (argument === "--ref") {
      options.ref = requireValue(argument, argv[++index]);
    } else if (argument === "--lock") {
      options.lock = requireValue(argument, argv[++index]);
    } else {
      fail(`unknown argument "${argument}"`);
    }
  }

  return options;
}

function requireValue(flag, value) {
  if (value === undefined || value.startsWith("--")) {
    fail(`${flag} requires a value`);
  }

  return value;
}

function fail(message) {
  console.error(`check-updates: ${message}`);
  process.exit(2);
}

/**
 * Read a path at a git ref from the source checkout, or null when it's absent at
 * that ref (a new/removed bundle). `git -C <dir> show <ref>:<path>` — the ref
 * never reaches a shell (execFileSync), so it's injection-safe.
 *
 * A genuinely-absent path is the expected null — git exits non-zero and says so on
 * stderr ("does not exist" / "exists on disk, but not in"). Any *other* failure
 * (`git` off PATH → ENOENT, a corrupt object, permissions) would otherwise be
 * misread as "absent" — silently degrading the version diff — so it is warned about
 * (still returning null) rather than swallowed. stderr is piped (not inherited) so
 * git's own fatal line doesn't leak to the terminal on the expected-absent path.
 */
function gitShow(sourceDirectory, ref, path) {
  try {
    return execFileSync(
      "git",
      ["-C", sourceDirectory, "show", `${ref}:${path}`],
      {
        encoding: "utf8",
        maxBuffer: 10 * 1024 * 1024,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
  } catch (error) {
    const stderr = typeof error?.stderr === "string" ? error.stderr : "";
    const isAbsent = /does not exist|exists on disk, but not in/.test(stderr);
    if (!isAbsent) {
      console.warn(
        `check-updates: could not read ${path} at ${ref} — ${
          error?.message ?? error
        }${stderr ? `\n${stderr.trim()}` : ""}`,
      );
    }

    return null;
  }
}

/**
 * The bundle directory names under `skills/` at a git ref.
 */
function listBundlesAtRef(sourceDirectory, ref) {
  let out;
  try {
    out = execFileSync(
      "git",
      ["-C", sourceDirectory, "ls-tree", "-d", "--name-only", `${ref}:skills`],
      { encoding: "utf8", maxBuffer: 10 * 1024 * 1024 },
    );
  } catch {
    fail(`could not list skills/ at ref "${ref}" in ${sourceDirectory}`);
  }

  return (
    out
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      // `ls-tree <ref>:skills` prints paths relative to skills/, i.e. bare names.
      .map((path) => path.replace(/^skills\//, ""))
  );
}

/**
 * Read the version of one bundle at a ref: SKILL.md metadata.version primary,
 * package.json version fallback (mirrors readBundleVersion, but over git-show text).
 */
function bundleVersionAtRef(sourceDirectory, ref, name) {
  const skillText = gitShow(sourceDirectory, ref, `skills/${name}/SKILL.md`);
  if (skillText !== null) {
    const version = parseSkillVersion(skillText);
    if (version) {
      return version;
    }
  }

  const manifestText = gitShow(
    sourceDirectory,
    ref,
    `skills/${name}/package.json`,
  );
  if (manifestText !== null) {
    try {
      const version = JSON.parse(manifestText).version;
      if (typeof version === "string") {
        return version;
      }
    } catch {
      // Malformed manifest at that ref — no version.
    }
  }

  return null;
}

/**
 * The target versions to diff against: the source working tree when no ref is
 * given, else each bundle's version at that ref.
 */
function readTargetVersions(sourceDirectory, ref) {
  if (!ref) {
    return readInstalledVersions(join(sourceDirectory, "skills"));
  }

  const versions = {};
  for (const name of listBundlesAtRef(sourceDirectory, ref)) {
    versions[name] = bundleVersionAtRef(sourceDirectory, ref, name);
  }

  return versions;
}

const USAGE = `check-updates — list installed skills behind a target ref of the source repo

Usage:
  node check-updates.mjs --source <checkout> [--ref <ref>] [--lock <path>] [--json]
  node check-updates.mjs --self-test    Run the offline smoke test
  node check-updates.mjs --help         Show this message (alias: -h)

Flags:
  --source <path>  A checkout of the source agent-skills repo (required).
  --ref <ref>      Read target versions at this git ref; default: the source's
                   working tree.
  --lock <path>    The consumer lock to diff; default: <cwd>/.claude/skills.lock.
  --json           Emit the machine-readable report; human text otherwise.`;

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(USAGE);
    return;
  }

  if (options.selfTest) {
    selfTest();
    return;
  }

  if (!options.source) {
    fail("--source <agent-skills-checkout> is required");
  }

  if (!existsSync(options.source)) {
    fail(`--source path does not exist: ${options.source}`);
  }

  if (options.ref) {
    try {
      execFileSync(
        "git",
        [
          "-C",
          options.source,
          "rev-parse",
          "--verify",
          "--quiet",
          `${options.ref}^{commit}`,
        ],
        { stdio: "ignore" },
      );
    } catch {
      fail(`ref "${options.ref}" not found in ${options.source}`);
    }
  }

  // Working-tree mode (no --ref) diffs against <source>/skills. If that directory
  // is missing — a mistyped --source, or a checkout without the bundles — the target
  // set comes back empty, every locked skill is misreported as "removed", yet the
  // summary still claims "up to date" (updatesAvailable keys off updates.length,
  // not removed). Fail loudly instead of silently reporting a false clean bill.
  if (!options.ref && !existsSync(join(options.source, "skills"))) {
    fail(
      `no skills/ directory in ${options.source} — is --source a full agent-skills checkout?`,
    );
  }

  const lockPathResolved =
    options.lock ?? join(process.cwd(), ".claude", "skills.lock");
  if (!existsSync(lockPathResolved)) {
    fail(
      `no lock at ${lockPathResolved} — run initialise-skills first (it writes .claude/skills.lock)`,
    );
  }

  let lock;
  try {
    lock = JSON.parse(readFileSync(lockPathResolved, "utf8"));
  } catch (error) {
    fail(`could not parse ${lockPathResolved}: ${error.message}`);
  }

  const lockSkills =
    lock && typeof lock.skills === "object" && lock.skills ? lock.skills : {};
  const targetVersions = readTargetVersions(options.source, options.ref);
  const diff = diffLock(lockSkills, targetVersions);

  const report = {
    // `ref` is the target we diffed against (null → the source working tree);
    // `lockRef` is where the consumer originally installed from — kept distinct so
    // the header reflects the actual comparison rather than the lock's provenance.
    lock: lockPathResolved,
    lockRef: lock?.ref ?? null,
    ref: options.ref ?? null,
    source: options.source,
    ...diff,
    updatesAvailable: diff.updates.length > 0,
  };

  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(formatHuman(report));
  }
}

function formatHuman(report) {
  const lines = [];
  const target = report.ref ? `ref ${report.ref}` : "working tree";
  lines.push(
    `check-updates — ${report.lock} vs ${report.source} (${target})`,
    "",
  );

  if (report.updates.length) {
    lines.push(`${report.updates.length} update(s) available:`);
    for (const update of report.updates) {
      lines.push(
        `  ${update.name.padEnd(22)} ${update.from} → ${update.to}  (${update.bump})`,
      );
    }

    lines.push("");
  } else {
    lines.push("All installed skills are up to date.", "");
  }

  if (report.added.length) {
    lines.push(
      `${report.added.length} new upstream skill(s) not installed: ${report.added
        .map((a) => `${a.name}@${a.version}`)
        .join(", ")}`,
    );
  }

  if (report.removed.length) {
    lines.push(
      `${report.removed.length} installed skill(s) absent upstream: ${report.removed.join(", ")}`,
    );
  }

  if (report.downgrades.length) {
    lines.push(
      `${report.downgrades.length} skill(s) ahead of the target (downgrade): ${report.downgrades
        .map((entry) => `${entry.name} ${entry.from} → ${entry.to}`)
        .join(", ")}`,
    );
  }

  if (report.unknown.length) {
    lines.push(
      `${report.unknown.length} skill(s) with an uncomparable version: ${report.unknown
        .map((entry) => entry.name)
        .join(", ")}`,
    );
  }

  return lines.join("\n").replace(/\n+$/, "\n");
}

/**
 * Offline smoke test of the pure transforms (compareVersions, diffLock). The
 * exhaustive coverage is in tests/skills/initialise-skills/check-updates.test.ts;
 * this guards the CLI-discovered path so `pnpm test:self` gates it too.
 */
function selfTest() {
  const diff = diffLock(
    { ahead: "2.0.0", gone: "1.0.0", missing: "0.1.0", stale: "1.0.0" },
    { ahead: "1.9.0", fresh: "0.5.0", missing: "0.1.0", stale: "1.4.0" },
  );
  const cases = [
    { name: "patch bump", ok: compareVersions("1.0.0", "1.0.1") === "patch" },
    { name: "minor bump", ok: compareVersions("1.0.0", "1.2.0") === "minor" },
    { name: "major bump", ok: compareVersions("1.0.0", "2.0.0") === "major" },
    { name: "equal is none", ok: compareVersions("1.2.3", "1.2.3") === "none" },
    {
      name: "prerelease compares on core",
      ok: compareVersions("1.0.0-rc.1", "1.0.0") === "none",
    },
    {
      name: "older target is downgrade",
      ok: compareVersions("2.0.0", "1.0.0") === "downgrade",
    },
    {
      name: "null is unknown",
      ok: compareVersions(null, "1.0.0") === "unknown",
    },
    {
      name: "diff finds the stale update",
      ok:
        diff.updates.length === 1 &&
        diff.updates[0].name === "stale" &&
        diff.updates[0].bump === "minor",
    },
    {
      name: "diff finds the up-to-date skill",
      ok: diff.upToDate.includes("missing"),
    },
    {
      name: "diff finds the added upstream skill",
      ok: diff.added.length === 1 && diff.added[0].name === "fresh",
    },
    { name: "diff finds the removed skill", ok: diff.removed.includes("gone") },
    {
      name: "diff finds the downgrade",
      ok: diff.downgrades.length === 1 && diff.downgrades[0].name === "ahead",
    },
  ];

  let failed = 0;
  for (const { name, ok } of cases) {
    if (ok) {
      console.log(`  ok    ${name}`);
    } else {
      failed += 1;
      console.log(`  FAIL  ${name}`);
    }
  }

  console.log(`\n${cases.length - failed}/${cases.length} passed`);
  process.exit(failed === 0 ? 0 : 1);
}

// Run main() only when invoked directly as a CLI, not when imported. Compare
// realpath'd paths so symlinks (macOS /var→/private/var, pnpm's store) don't
// cause a false negative.
function isCliEntry() {
  if (!process.argv[1]) {
    return false;
  }

  try {
    return realpathSync(import.meta.filename) === realpathSync(process.argv[1]);
  } catch {
    return false;
  }
}

if (isCliEntry()) {
  main();
}
