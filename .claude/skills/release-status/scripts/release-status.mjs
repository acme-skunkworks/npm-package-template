#!/usr/bin/env node
// Release-pipeline diagnosis helper for the release-status skill.
//
// Read-only. Gathers four signals about the release-please pipeline via `gh`
// and `git` (never writes), then prints a structured human report or `--json`:
//
//   1. Version preview  — the bump the Conventional-Commit subjects on commits
//                         since the last tag on origin/<mainBranch> imply
//                         (feat→minor, fix/perf/revert→patch, !/BREAKING→major;
//                         docs/chore/ci/refactor/test/build/style→none) and the
//                         version that would cut. Merge commits are excluded so
//                         a merge subject's body (often the PR title) is not
//                         double-counted with the branch commits release-please
//                         also walks (A-824).
//   2. Release PR        — the open `release-please--branches--main` PR (if any)
//                         and its required-check (`GO/NO GO`) status.
//   3. Stale autorelease — the recurring stall: the last MERGED release PR still
//                         carries an `autorelease: pending` label, so
//                         release-please aborts and releases stop firing.
//   4. Tag parity        — does a `v<package.json version>` tag already exist
//                         (clean no-op) or is the version untagged (publish
//                         pending) — the release.yml version-vs-tag gate.
//
// This is a SIBLING of `send-it`, NOT invoked by it: send-it stops at In Review
// (pre-merge); this inspects post-merge `main`. It is advisory — it surfaces
// each signal and its remediation, and changes nothing.
//
// The network layer (gh/git) is kept separate from the pure transforms so the
// transforms are unit-tested by `--self-test` with NO network / `gh` access.
//
// Usage:
//   node release-status.mjs                 # human-readable report to stdout
//   node release-status.mjs --json          # machine-readable JSON to stdout
//   node release-status.mjs --repo owner/n  # set repo explicitly
//   node release-status.mjs --self-test     # run built-in offline fixtures
//   node release-status.mjs --help          # show usage (alias: -h)

import { execFileSync } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";

// Defaults mirror config.json; overridden by the consuming repo's copy.
const DEFAULTS = {
  mainBranch: "main",
  releaseBranch: "release-please--branches--main",
  requiredCheck: "GO/NO GO",
  stalePendingLabel: "autorelease: pending",
};

// ---- pure transforms (no network) ---------------------------------------

const BREAKING_SUBJECT = /^[a-z]+(\([^)]+\))?!:/;
const FEAT_SUBJECT = /^feat(\([^)]+\))?:/;
const PATCH_SUBJECT = /^(fix|perf|revert)(\([^)]+\))?:/;

// release-please ranks bumps: a single breaking subject wins, else any feat,
// else any fix/perf/revert. docs/chore/ci/refactor/test/build/style cut no
// release. Matches release-please 17.9.0 under multi-commit history (A-824):
// strongest type across commits; reverts do NOT cancel an earlier feat.
const BUMP_RANK = { major: 3, minor: 2, none: 0, patch: 1 };

// Separators for `git log --format` parsing (unit between fields, record
// between commits). Match send-it's encoding so both skills agree.
const UNIT_SEP = "\u001F";
const RECORD_SEP = "\u001E";

/**
 * Classify one Conventional-Commit subject (+ optional body) into the bump it
 * implies on its own: major | minor | patch | none. Mirrors the rules in
 * CLAUDE.md and send-it's derive-bump.mjs (re-implemented, not imported —
 * bundles are standalone).
 */
export function classifyTitle(subject, body = "") {
  const text = String(subject ?? "");
  if (BREAKING_SUBJECT.test(text) || /BREAKING CHANGE:/.test(String(body))) {
    return "major";
  }

  if (FEAT_SUBJECT.test(text)) {
    return "minor";
  }

  if (PATCH_SUBJECT.test(text)) {
    return "patch";
  }

  return "none";
}

/**
 * Reduce a list of commits (each `{ subject, body }`) to the strongest bump
 * they imply. Empty / all-none → "none" (no release would cut).
 *
 * Policy (A-824): match release-please — strongest Conventional type wins;
 * a `feat:` later `revert:`ed in the same window still implies **minor**
 * (no cancel/netting). Merge-commit subjects should already be excluded by
 * the git fetch (`--no-merges`).
 */
export function previewBump(commits) {
  let best = "none";
  for (const commit of commits ?? []) {
    const subject = commit.subject ?? "";
    const bump = classifyTitle(subject, commit.body);
    if (BUMP_RANK[bump] > BUMP_RANK[best]) {
      best = bump;
    }
  }

  return best;
}

/**
 * Parse `git log --format=%H%x1f%s%x1f%b%x1e` stdout into
 * `{ hash, subject, body }[]`. Pure — no git — so `--self-test` / vitest can
 * cover multi-commit fixtures without a repo.
 */
export function parseGitLog(raw) {
  return String(raw ?? "")
    .split(RECORD_SEP)
    .map((segment) => segment.trim())
    .filter(Boolean)
    .map((entry) => {
      const [hash, subject, body] = entry.split(UNIT_SEP);
      return {
        body: body ?? "",
        hash: hash ?? "",
        subject: subject ?? "",
      };
    });
}

/**
 * Parse a semver `MAJOR.MINOR.PATCH` (ignoring any pre-release/build suffix)
 * into a numeric triple; throws on a non-semver string.
 */
export function parseSemver(version) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec(String(version ?? ""));
  if (!match) {
    throw new Error(`not a semver version: ${JSON.stringify(version)}`);
  }

  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

/**
 * Apply a bump to a current version, returning the next version string. A
 * "none" bump returns the current version unchanged (no release).
 */
export function applyBump(current, bump) {
  const { major, minor, patch } = parseSemver(current);
  switch (bump) {
    case "major": {
      return `${major + 1}.0.0`;
    }

    case "minor": {
      return `${major}.${minor + 1}.0`;
    }

    case "patch": {
      return `${major}.${minor}.${patch + 1}`;
    }

    default: {
      return `${major}.${minor}.${patch}`;
    }
  }
}

/**
 * Decide tag-vs-version parity for the release.yml version-vs-tag gate. Given
 * the current package.json version and the set of existing tags, report whether
 * a `v<version>` tag already exists.
 *
 *   tagged    → clean no-op: this version is already published.
 *   untagged  → a publish is pending: the gate would run the publish path.
 */
export function tagParity(version, tags) {
  const wanted = `v${String(version).replace(/^v/, "")}`;
  const tagged = (tags ?? []).includes(wanted);
  return {
    state: tagged ? "tagged" : "untagged",
    tag: wanted,
    tagged,
    version: String(version),
  };
}

/**
 * Detect the stale `autorelease: pending` failure mode. Given the last MERGED
 * release PR (or null) and the label name, report whether the stall is present.
 * When a merged release PR still carries the pending label, release-please
 * aborts the next release and the pipeline silently stalls.
 */
export function detectStalePending(
  lastMergedReleasePr,
  label = DEFAULTS.stalePendingLabel,
) {
  if (!lastMergedReleasePr) {
    return {
      detected: false,
      label,
      pr: null,
      reason: "no merged release PR found",
    };
  }

  const labels = (lastMergedReleasePr.labels ?? []).map((entry) =>
    typeof entry === "string" ? entry : entry?.name,
  );
  const detected = labels.includes(label);
  return {
    detected,
    label,
    pr: lastMergedReleasePr.number ?? null,
    reason: detected
      ? `merged release PR #${lastMergedReleasePr.number} still carries "${label}" — release-please will abort the next release`
      : `last merged release PR #${lastMergedReleasePr.number} is clear of "${label}"`,
  };
}

/**
 * Reduce a `gh pr ... statusCheckRollup` to the required check's state.
 * Returns { found, state, conclusion } — `found:false` when the named check is
 * absent from the rollup (it may not have started yet).
 */
export function requiredCheckState(
  checks,
  requiredCheck = DEFAULTS.requiredCheck,
) {
  const match = (checks ?? []).find((check) => check.name === requiredCheck);
  if (!match) {
    return { conclusion: null, found: false, state: null };
  }

  // gh exposes either `state`/`bucket` (status checks) or `conclusion`
  // (Actions). Normalise to a single lower-cased token.
  const raw = match.state ?? match.conclusion ?? match.bucket ?? null;
  return {
    conclusion: match.conclusion ?? null,
    found: true,
    state: raw ? String(raw).toLowerCase() : null,
  };
}

// ---- argument parsing ----------------------------------------------------

/**
 * Parse argv into `{ json, repo }`; throws on an unknown flag or a `--repo`
 * missing/malformed value.
 */
export function parseArgs(argv) {
  const options = { json: false, repo: null };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--json") {
      options.json = true;
    } else if (argument === "--repo") {
      const value = argv[++index];
      if (!value || value.startsWith("--")) {
        throw new Error("--repo requires an owner/name value");
      }

      if (!/^[^/\s]+\/[^/\s]+$/.test(value)) {
        throw new Error("--repo must be exactly owner/name");
      }

      options.repo = value;
    } else {
      throw new Error(`unknown option: ${argument}`);
    }
  }

  return options;
}

// ---- config --------------------------------------------------------------

/**
 * Read config.json beside this script, falling back to DEFAULTS for any missing
 * key. A missing/unreadable config.json is non-fatal — the defaults stand.
 */
function loadConfig() {
  try {
    const here = import.meta.dirname;
    const raw = readFileSync(join(here, "..", "config.json"), "utf8");
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULTS };
  }
}

// ---- network layer (gh / git) -------------------------------------------

/**
 * Run a command and return stdout; 30s timeout so a stalled call can't hang.
 */
function run(command, args) {
  return execFileSync(command, args, {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    timeout: 30_000,
  });
}

/**
 * Parse JSON from a subprocess or file, turning an opaque `SyntaxError` into a
 * diagnosed error that names what failed. `gh` can emit a warning line, an auth
 * prompt, or empty output where JSON was expected — so the raw parser error alone
 * ("Unexpected token…") gives the caller nothing to act on.
 */
export function parseJson(raw, context) {
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`could not parse ${context}: ${error?.message ?? error}`, {
      cause: error,
    });
  }
}

/**
 * Return the current repository as `owner/name`.
 */
function detectRepo() {
  return run("gh", [
    "repo",
    "view",
    "--json",
    "nameWithOwner",
    "-q",
    ".nameWithOwner",
  ]).trim();
}

/**
 * Read the root package.json version (the version-vs-tag gate's left-hand side).
 */
function readPackageVersion() {
  // Resolve the repo root from the git toplevel so the helper works from any cwd.
  const top = run("git", ["rev-parse", "--show-toplevel"]).trim();
  const pkg = parseJson(
    readFileSync(join(top, "package.json"), "utf8"),
    "root package.json",
  );
  return String(pkg.version);
}

/**
 * Return every tag in the repo (for the parity check).
 */
function readTags() {
  return run("git", ["tag", "--list"])
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

/**
 * Commits on the configured trunk (`origin/<mainBranch>`) since the last tag,
 * newest first, as `{ hash, subject, body }`. Merge commits are excluded
 * (`--no-merges`) so the preview matches release-please's per-commit bump under
 * multi-commit history without double-counting a merge subject's body (often the
 * PR title) against the branch commits that also landed (A-824).
 *
 * Evaluating against `origin/<mainBranch>` (not `HEAD`) keeps the preview aligned
 * with what release-please would compute on the trunk even when the helper is run
 * from a feature branch or a stale local checkout.
 *
 * When there is no tag yet, every non-merge commit reachable from the trunk counts
 * (bootstrap / never-released repos).
 */
function fetchCommitsSinceLastTag(mainBranch) {
  const trunk = `origin/${mainBranch}`;
  try {
    run("git", ["rev-parse", "--verify", trunk]);
  } catch {
    throw new Error(
      `missing local ref ${trunk} — run \`git fetch origin ${mainBranch}\` so the version preview can match the trunk`,
    );
  }

  let range = trunk;
  try {
    const lastTag = run("git", [
      "describe",
      "--tags",
      "--abbrev=0",
      trunk,
    ]).trim();
    if (lastTag) {
      range = `${lastTag}..${trunk}`;
    }
  } catch {
    // no tags yet → whole trunk history
  }

  const raw = run("git", [
    "log",
    range,
    "--no-merges",
    `--format=%H${UNIT_SEP}%s${UNIT_SEP}%b${RECORD_SEP}`,
  ]);
  return parseGitLog(raw);
}

/**
 * Find the open release PR on the release branch (or null). Includes its
 * required-check rollup so the caller can read the gate state in one call.
 */
function fetchOpenReleasePr(repo, releaseBranch, mainBranch) {
  const list = parseJson(
    run("gh", [
      "pr",
      "list",
      "--repo",
      repo,
      "--base",
      mainBranch,
      "--state",
      "open",
      "--head",
      releaseBranch,
      "--json",
      "number,title,url,statusCheckRollup",
      "--limit",
      "1",
    ]),
    "open release PR from gh",
  );
  return list[0] ?? null;
}

/**
 * Find the most recently merged release PR on the release branch (or null), with
 * its labels — the input to the stale-pending detector.
 */
function fetchLastMergedReleasePr(repo, releaseBranch, mainBranch) {
  const list = parseJson(
    run("gh", [
      "pr",
      "list",
      "--repo",
      repo,
      "--base",
      mainBranch,
      "--state",
      "merged",
      "--head",
      releaseBranch,
      "--json",
      "number,title,url,labels,mergedAt",
      "--limit",
      "1",
    ]),
    "last merged release PR from gh",
  );
  return list[0] ?? null;
}

/**
 * Gather every signal from GitHub/git and assemble the report object.
 */
function gather(options, config) {
  const repo = options.repo ?? detectRepo();

  const version = readPackageVersion();
  const tags = readTags();
  const parity = tagParity(version, tags);

  const commits = fetchCommitsSinceLastTag(config.mainBranch);
  const bump = previewBump(commits);
  const nextVersion = applyBump(version, bump);

  const openReleasePr = fetchOpenReleasePr(
    repo,
    config.releaseBranch,
    config.mainBranch,
  );
  const requiredCheck = openReleasePr
    ? requiredCheckState(openReleasePr.statusCheckRollup, config.requiredCheck)
    : { conclusion: null, found: false, state: null };

  const lastMergedReleasePr = fetchLastMergedReleasePr(
    repo,
    config.releaseBranch,
    config.mainBranch,
  );
  const stalePending = detectStalePending(
    lastMergedReleasePr,
    config.stalePendingLabel,
  );

  return {
    parity,
    releasePr: openReleasePr
      ? {
          number: openReleasePr.number,
          requiredCheck: { name: config.requiredCheck, ...requiredCheck },
          title: openReleasePr.title,
          url: openReleasePr.url,
        }
      : null,
    repo,
    stalePending,
    versionPreview: {
      bump,
      commitCount: commits.length,
      current: version,
      next: nextVersion,
      willRelease: bump !== "none",
    },
  };
}

// ---- reporting -----------------------------------------------------------

/**
 * Render the gathered report as a human-readable block.
 */
function renderHuman(report, config) {
  const lines = [];
  lines.push(`Release status — ${report.repo}`);
  lines.push("");

  const vp = report.versionPreview;
  lines.push(
    "Version preview (commits since last tag, merge commits excluded):",
  );
  lines.push(`  current: ${vp.current}`);
  lines.push(`  bump:    ${vp.bump} (${vp.commitCount} commit(s) considered)`);
  if (vp.willRelease) {
    lines.push(`  next:    ${vp.next} — a release would cut`);
  } else {
    lines.push(
      "  next:    none — no release-triggering commit since the last tag",
    );
  }

  lines.push("");
  lines.push(`Release PR (${config.releaseBranch}):`);
  if (report.releasePr) {
    const rc = report.releasePr.requiredCheck;
    lines.push(`  #${report.releasePr.number} — ${report.releasePr.title}`);
    lines.push(`  ${report.releasePr.url}`);
    lines.push(
      rc.found
        ? `  required check "${config.requiredCheck}": ${rc.state ?? "pending"}`
        : `  required check "${config.requiredCheck}": not yet reported`,
    );
  } else {
    lines.push("  none open — no release PR awaiting merge.");
  }

  lines.push("");
  lines.push("Stale autorelease: pending check:");
  if (report.stalePending.detected) {
    lines.push(`  STALL DETECTED — ${report.stalePending.reason}`);
    lines.push(
      `  Remediation: remove the "${report.stalePending.label}" label from merged release PR ` +
        `#${report.stalePending.pr} (gh pr edit ${report.stalePending.pr} --remove-label "${report.stalePending.label}"), ` +
        "then re-run the orchestrator (or wait for its next cron tick).",
    );
  } else {
    lines.push(`  clear — ${report.stalePending.reason}`);
  }

  lines.push("");
  lines.push("Tag-vs-version parity (release.yml gate):");
  if (report.parity.tagged) {
    lines.push(
      `  ${report.parity.tag} exists — clean no-op; this version is published.`,
    );
  } else {
    lines.push(
      `  ${report.parity.tag} missing — a publish is pending for ${report.parity.version}.`,
    );
  }

  return lines.join("\n");
}

// ---- self-test -----------------------------------------------------------

/**
 * Run the built-in fixtures (no network) and exit non-zero on any failure.
 */
function selfTest() {
  const cases = [];
  function check(name, ok) {
    cases.push({ name, ok });
  }

  // classifyTitle / previewBump (A-824: per-commit strongest type)
  check("feat → minor", classifyTitle("feat(x): add") === "minor");
  check("fix → patch", classifyTitle("fix: bug") === "patch");
  check("perf → patch", classifyTitle("perf: faster") === "patch");
  check("revert → patch", classifyTitle("revert: oops") === "patch");
  check("feat! → major", classifyTitle("feat(x)!: drop") === "major");
  check(
    "BREAKING CHANGE body → major",
    classifyTitle("fix: x", "BREAKING CHANGE: y") === "major",
  );
  check("chore → none", classifyTitle("chore: deps") === "none");
  check("docs → none", classifyTitle("docs: readme") === "none");
  check(
    "previewBump picks the strongest (feat beats fix)",
    previewBump([{ subject: "fix: a" }, { subject: "feat: b" }]) === "minor",
  );
  check(
    "previewBump major wins over feat",
    previewBump([{ subject: "feat: a" }, { subject: "refactor!: b" }]) ===
      "major",
  );
  check("previewBump empty → none", previewBump([]) === "none");
  check(
    "previewBump all-chore → none",
    previewBump([{ subject: "chore: a" }, { subject: "docs: b" }]) === "none",
  );
  check(
    "previewBump feat+revert still minor (no cancel/netting, A-824)",
    previewBump([
      { subject: "feat: add x" },
      { subject: "revert: feat: add x" },
    ]) === "minor",
  );
  check(
    "previewBump ignores merge-commit-like subjects as none",
    previewBump([
      { subject: "Merge pull request #12 from acme/feature" },
      { subject: "fix: real" },
    ]) === "patch",
  );
  check(
    "parseGitLog splits unit/record separators",
    (() => {
      const parsed = parseGitLog(
        `abc${UNIT_SEP}feat: one${UNIT_SEP}body1${RECORD_SEP}def${UNIT_SEP}fix: two${UNIT_SEP}${RECORD_SEP}`,
      );
      return (
        parsed.length === 2 &&
        parsed[0].subject === "feat: one" &&
        parsed[0].body === "body1" &&
        parsed[1].subject === "fix: two"
      );
    })(),
  );

  // applyBump
  check("applyBump minor", applyBump("1.2.3", "minor") === "1.3.0");
  check("applyBump major", applyBump("1.2.3", "major") === "2.0.0");
  check("applyBump patch", applyBump("1.2.3", "patch") === "1.2.4");
  check("applyBump none is identity", applyBump("1.2.3", "none") === "1.2.3");
  check("applyBump strips v prefix", applyBump("v0.1.0", "minor") === "0.2.0");

  // tagParity
  check(
    "tagParity tagged → clean no-op",
    tagParity("1.2.0", ["v1.1.0", "v1.2.0"]).state === "tagged",
  );
  check(
    "tagParity untagged → publish pending",
    tagParity("1.3.0", ["v1.1.0", "v1.2.0"]).state === "untagged",
  );
  check(
    "tagParity normalises a v-prefixed version",
    tagParity("v1.2.0", ["v1.2.0"]).tagged === true,
  );

  // detectStalePending
  check(
    "stale pending detected on merged release PR carrying the label",
    detectStalePending({
      labels: [{ name: "autorelease: pending" }],
      number: 42,
    }).detected === true,
  );
  check(
    "no stall when the label is absent",
    detectStalePending({
      labels: [{ name: "autorelease: tagged" }],
      number: 42,
    }).detected === false,
  );
  check(
    "stale detector handles string labels",
    detectStalePending({ labels: ["autorelease: pending"], number: 7 })
      .detected === true,
  );
  check(
    "no merged release PR → not detected",
    detectStalePending(null).detected === false,
  );

  // requiredCheckState
  check(
    "requiredCheckState reads a matching check (success)",
    requiredCheckState([{ conclusion: "SUCCESS", name: "GO/NO GO" }]).state ===
      "success",
  );
  check(
    "requiredCheckState reads a status-check state",
    requiredCheckState([{ name: "GO/NO GO", state: "PENDING" }]).state ===
      "pending",
  );
  check(
    "requiredCheckState reports not-found when absent",
    requiredCheckState([{ name: "other" }]).found === false,
  );

  // parseArgs
  check("parseArgs reads --json", parseArgs(["--json"]).json === true);
  check("parseArgs reads --repo", parseArgs(["--repo", "a/b"]).repo === "a/b");
  check(
    "parseArgs throws on unknown flag",
    (() => {
      try {
        parseArgs(["--nope"]);
        return false;
      } catch {
        return true;
      }
    })(),
  );
  check(
    "parseArgs throws on malformed --repo",
    (() => {
      try {
        parseArgs(["--repo", "a/b/c"]);
        return false;
      } catch {
        return true;
      }
    })(),
  );

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

// ---- main ----------------------------------------------------------------

const USAGE = `release-status — diagnose the release-please pipeline (read-only)

Usage:
  node release-status.mjs                 Human-readable report to stdout
  node release-status.mjs --json          Machine-readable JSON to stdout
  node release-status.mjs --repo owner/n  Set the repository explicitly
  node release-status.mjs --self-test     Run built-in offline fixtures (no network)
  node release-status.mjs --help          Show this message (alias: -h)

Read-only and advisory: it gathers signals and prints remediation, never writes.
A sibling of send-it, not invoked by it (send-it stops at In Review; this
inspects post-merge main).`;

/**
 * CLI entry: parse args, gather signals, and print the report.
 */
function main() {
  const argv = process.argv.slice(2);
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(USAGE);
    return;
  }

  if (argv.includes("--self-test")) {
    selfTest();
    return;
  }

  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    console.error(`release-status: ${error.message}`);
    process.exit(2);
  }

  const config = loadConfig();
  try {
    const report = gather(options, config);
    if (options.json) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      console.log(renderHuman(report, config));
    }
  } catch (error) {
    console.error(
      `release-status: failed to gather signals — ${error.message}`,
    );
    process.exit(1);
  }
}

// Detect "run directly as a CLI" vs "imported as a module". Normalise both
// sides through realpath (macOS /var→/private/var, pnpm's symlinked store, and
// `import.meta.url`'s percent-encoding) before comparing.
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
