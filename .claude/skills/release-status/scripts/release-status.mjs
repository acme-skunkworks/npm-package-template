#!/usr/bin/env node
// Release-pipeline diagnosis helper for the release-status skill.
//
// Read-only. Gathers four signals about the release-please pipeline via `gh`
// and `git` (never writes), then prints a structured human report or `--json`:
//
//   1. Version preview  — the bump the merged Conventional-Commit PR titles
//                         since the last tag imply (feat→minor, fix/perf/revert→
//                         patch, !/BREAKING→major; docs/chore/ci/refactor/test/
//                         build/style→none) and the version that would cut.
//   2. Release PR        — the open `release-please--branches--main` PR (if any)
//                         and its required-check (`🔬 Build & Lint`) status.
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
  requiredCheck: "🔬 Build & Lint",
  stalePendingLabel: "autorelease: pending",
};

// ---- pure transforms (no network) ---------------------------------------

const BREAKING_SUBJECT = /^[a-z]+(\([^)]+\))?!:/;
const FEAT_SUBJECT = /^feat(\([^)]+\))?:/;
const PATCH_SUBJECT = /^(fix|perf|revert)(\([^)]+\))?:/;

// release-please ranks bumps: a single breaking title wins, else any feat, else
// any fix/perf/revert. docs/chore/ci/refactor/test/build/style cut no release.
const BUMP_RANK = { major: 3, minor: 2, none: 0, patch: 1 };

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
 * Reduce a list of merged PRs (each `{ title, body }`) to the strongest bump
 * they imply. Empty / all-none → "none" (no release would cut).
 */
export function previewBump(prs) {
  let best = "none";
  for (const pr of prs ?? []) {
    const bump = classifyTitle(pr.title, pr.body);
    if (BUMP_RANK[bump] > BUMP_RANK[best]) {
      best = bump;
    }
  }

  return best;
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

// Upper bound for the merged-PR window. This tool diagnoses a *stalled* pipeline —
// exactly when a large backlog may have merged since the last tag — so the old
// `--limit 100` could truncate the window, under-report `mergedPrCount`, and (since
// `gh pr list --search` isn't guaranteed merge-date sorted) drop the strongest-bump
// title and mis-classify the release. gh auto-paginates up to `--limit`, so a high
// bound simply pages until exhausted for any realistic backlog.
const MERGED_PR_LIMIT = 1000;

/**
 * List merged PRs since the last tag, newest first, as `{ title, body, mergedAt,
 * number }`. The window is anchored on the last tag's commit date so only
 * post-release titles count toward the next bump, and scoped to PRs merged into the
 * trunk (`--base <mainBranch>`) so a non-`main` trunk is honoured.
 *
 * `gh`'s `merged:>=<date>` filter only honours **day** precision, so it is used as
 * a coarse lower bound (the tag's UTC calendar day) and the results are re-filtered
 * against the tag's **full** ISO timestamp — otherwise a PR merged earlier on the
 * same calendar day as the tag slips past the day-only bound and is counted twice:
 * once in the release it already shipped in, and again toward the next bump.
 */
function fetchMergedPrsSinceLastTag(repo, mainBranch) {
  let sinceDate = null; // day-granularity lower bound for gh's `merged:` search
  let sinceTimestamp = null; // full ISO tag time for the precise post-filter
  try {
    const lastTag = run("git", ["describe", "--tags", "--abbrev=0"]).trim();
    if (lastTag) {
      // %cI = committer date, strict ISO-8601 (carries the offset).
      sinceTimestamp = run("git", [
        "log",
        "-1",
        "--format=%cI",
        lastTag,
      ]).trim();
      // gh reads a bare `merged:YYYY-MM-DD` as UTC midnight, so anchor the coarse
      // lower bound on the tag's UTC calendar day, not its local-offset day. A
      // positive-offset local day (e.g. 2026-07-06 for an instant that is
      // 2026-07-05T23:00Z) would start the search after the real tag instant and
      // miss PRs merged in the gap — and the post-filter below can only trim, not
      // recover them. The UTC day never excludes a valid same-day-after-tag PR.
      sinceDate = new Date(sinceTimestamp).toISOString().slice(0, 10);
    }
  } catch {
    sinceDate = null; // no tags yet → all merged PRs count.
    sinceTimestamp = null;
  }

  const search = sinceDate ? `merged:>=${sinceDate}` : "";
  const args = [
    "pr",
    "list",
    "--repo",
    repo,
    "--base",
    mainBranch,
    "--state",
    "merged",
    "--limit",
    String(MERGED_PR_LIMIT),
    "--json",
    "title,body,mergedAt,number",
  ];
  if (search) {
    args.push("--search", search);
  }

  const prs = parseJson(run("gh", args), "merged-PR list from gh");

  // If the window filled the cap, the diagnosis may be built on a truncated set —
  // warn (to stderr, so `--json` stdout stays clean) rather than silently under-report.
  if (prs.length >= MERGED_PR_LIMIT) {
    console.error(
      `release-status: merged-PR window hit the ${MERGED_PR_LIMIT}-PR cap — the bump ` +
        "preview may be based on a truncated set.",
    );
  }

  // gh's day-granularity `merged:>=` includes PRs merged earlier on the tag's own
  // day; drop everything merged at or before the precise tag timestamp so only
  // genuinely post-tag merges count toward the next bump.
  if (!sinceTimestamp) {
    return prs;
  }

  const cutoff = new Date(sinceTimestamp).getTime();
  return prs.filter(
    (pr) => !pr.mergedAt || new Date(pr.mergedAt).getTime() > cutoff,
  );
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

  const mergedPrs = fetchMergedPrsSinceLastTag(repo, config.mainBranch);
  const bump = previewBump(mergedPrs);
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
      current: version,
      mergedPrCount: mergedPrs.length,
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
  lines.push("Version preview (merged PR titles since last tag):");
  lines.push(`  current: ${vp.current}`);
  lines.push(
    `  bump:    ${vp.bump} (${vp.mergedPrCount} merged PR(s) considered)`,
  );
  if (vp.willRelease) {
    lines.push(`  next:    ${vp.next} — a release would cut`);
  } else {
    lines.push(
      "  next:    none — no release-triggering title since the last tag",
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

  // classifyTitle / previewBump
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
    previewBump([{ title: "fix: a" }, { title: "feat: b" }]) === "minor",
  );
  check(
    "previewBump major wins over feat",
    previewBump([{ title: "feat: a" }, { title: "refactor!: b" }]) === "major",
  );
  check("previewBump empty → none", previewBump([]) === "none");
  check(
    "previewBump all-chore → none",
    previewBump([{ title: "chore: a" }, { title: "docs: b" }]) === "none",
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
    requiredCheckState([{ conclusion: "SUCCESS", name: "🔬 Build & Lint" }])
      .state === "success",
  );
  check(
    "requiredCheckState reads a status-check state",
    requiredCheckState([{ name: "🔬 Build & Lint", state: "PENDING" }])
      .state === "pending",
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
