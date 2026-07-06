#!/usr/bin/env node
// initialise-skills CLI (A-409).
//
// Scans a host repo and reconciles every installed skill's config.json with
// detected facts. Deterministic git/fs detection + a three-way merge live here
// and in lib/; the Linear facts the script can't derive (team name, workspace
// slug) and the confirmation gate are owned by the SKILL.md orchestration, which
// pipes those facts — and any per-key drift opt-ins — in as stdin JSON.
//
//   node scripts/initialise.mjs [--dry-run|--write|--review] [--json]
//                               [--set <skill>.<key>=<value>]...
//                               [--repo-root <path>] [--skills-dir <path>]
//   echo '{"facts":{"linearTeamName":"…"},"acceptDrift":{"changelog":["baseBranch"]}}' \
//     | node scripts/initialise.mjs --write --json
//
// `--set` pushes an arbitrary value a detector wouldn't produce into a named
// skill's config.json — validated against that skill's config.example.json key
// set, applied through the same merge/serialise path (dry-run first, --write to
// commit), so key order + formatting are preserved (A-704).
//
// Exit codes: 0 success; 2 usage/IO error.

import { createDetectors } from "./lib/detectors.mjs";
import {
  defaultSkillsDirectory,
  discoverSkills,
  isPreflightInstalled,
} from "./lib/discover.mjs";
import { reconcilePreflightIgnore } from "./lib/gitignore.mjs";
import { serialiseConfig } from "./lib/jsonio.mjs";
import { mergeConfig } from "./lib/merge.mjs";
import { resolveOverrides } from "./lib/overrides.mjs";
import { loadDetectableKeys } from "./lib/references.mjs";
import {
  buildReport,
  buildReviewReport,
  formatHuman,
  formatReview,
} from "./lib/report.mjs";
import { readInstalledVersions } from "./lib/skill-version.mjs";
import {
  buildLock,
  readLock,
  resolveRef,
  resolveSource,
  writeLock,
} from "./lib/skills-lock.mjs";
import { readFileSync, realpathSync, writeFileSync } from "node:fs";
import { relative } from "node:path";

/**
 * A value-taking flag needs a real value — fail clearly rather than letting
 * `undefined` (trailing flag) or the next option (`--repo-root --json`) flow into
 * the detectors as a path.
 */
function requireValue(flag, value) {
  if (value === undefined || value.startsWith("--")) {
    console.error(`initialise-skills: ${flag} requires a value`);
    process.exit(2);
  }

  return value;
}

export function parseArgs(argv) {
  const options = {
    json: false,
    repoRoot: process.cwd(),
    review: false,
    set: [],
    skillsDir: undefined,
    write: false,
  };
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (argument === "--write") {
      options.write = true;
    } else if (argument === "--dry-run") {
      options.write = false;
    } else if (argument === "--set") {
      // Repeatable: collect the raw `<skill>.<key>=<value>` string. The
      // structured parse + validation (skill installed, key known, type match)
      // happens in main(), where the discovered skills are available.
      options.set.push(requireValue(argument, argv[++index]));
    } else if (argument === "--review") {
      // Read-only: report each skill's full current config, never write. The
      // write path is force-disabled after the loop (below), so this stays
      // read-only regardless of flag order.
      options.review = true;
    } else if (argument === "--json") {
      options.json = true;
    } else if (argument === "--repo-root") {
      options.repoRoot = requireValue(argument, argv[++index]);
    } else if (argument === "--skills-dir") {
      options.skillsDir = requireValue(argument, argv[++index]);
    } else if (argument === "--help" || argument === "-h") {
      options.help = true;
    } else {
      console.error(`initialise-skills: unknown argument "${argument}"`);
      process.exit(2);
    }
  }

  // --review is strictly read-only: force the write path off no matter the flag
  // order, so neither `--write --review` nor `--review --write` can leave both
  // active (which would write config.json and then render a stale pre-write
  // snapshot).
  if (options.review) {
    options.write = false;
  }

  return options;
}

/**
 * Read `{ facts, acceptDrift }` from stdin when it is piped (not a TTY). Returns
 * empty defaults otherwise, so an interactive dry-run needs no input.
 */
function readStdinPayload() {
  if (process.stdin.isTTY) {
    return { acceptDrift: {}, facts: {} };
  }

  let raw = "";
  try {
    raw = readFileSync(0, "utf8");
  } catch {
    return { acceptDrift: {}, facts: {} };
  }

  if (!raw.trim()) {
    return { acceptDrift: {}, facts: {} };
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    console.error(
      `initialise-skills: could not parse stdin JSON: ${error.message}`,
    );
    process.exit(2);
  }

  return {
    acceptDrift:
      parsed.acceptDrift && typeof parsed.acceptDrift === "object"
        ? parsed.acceptDrift
        : {},
    facts: parsed.facts && typeof parsed.facts === "object" ? parsed.facts : {},
  };
}

/**
 * Coerce an acceptDrift entry to a list of key names, tolerating malformed input
 * (non-array, or array with non-string members) without throwing.
 */
export function asKeyList(value) {
  return Array.isArray(value)
    ? value.filter((key) => typeof key === "string")
    : [];
}

/**
 * Drift keys accepted for a given skill: keyed by skill name or its repo-relative
 * config path.
 */
export function acceptedDriftFor(skill, acceptDrift, repoRoot) {
  // The acceptDrift contract uses POSIX-separated config paths (they come from
  // hand-written JSON / Linear facts). `relative()` emits backslashes on
  // Windows, so normalise to forward slashes before matching, or a path-keyed
  // entry would silently fail to match there.
  const rel = relative(repoRoot, skill.configPath).replaceAll("\\", "/");
  return [
    ...new Set([
      ...asKeyList(acceptDrift[skill.name]),
      ...asKeyList(acceptDrift[rel]),
    ]),
  ];
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(
      "Usage: node scripts/initialise.mjs [--dry-run|--write|--review] [--json] [--set <skill>.<key>=<value>]... [--repo-root <p>] [--skills-dir <p>]",
    );
    return;
  }

  // --set mutates config.json; --review is strictly read-only. Combining them is
  // a usage error rather than a silent no-op preview.
  if (options.review && options.set.length) {
    console.error(
      "initialise-skills: --set cannot be combined with --review (--review is read-only)",
    );
    process.exit(2);
  }

  const { acceptDrift, facts } = readStdinPayload();
  const skills = discoverSkills(options.skillsDir);

  // Resolve + validate --set overrides up front, before any write, so an unknown
  // skill/key or a type mismatch fails fast and touches nothing.
  const { errors: setErrors, overrides } = resolveOverrides(
    options.set,
    skills,
  );
  if (setErrors.length) {
    for (const message of setErrors) {
      console.error(`initialise-skills: ${message}`);
    }

    process.exit(2);
  }

  const { detect } = createDetectors({
    linearFacts: facts,
    repoRoot: options.repoRoot,
  });

  const skillReports = [];
  for (const skill of skills) {
    if (skill.malformed) {
      skillReports.push({
        configPath: relative(options.repoRoot, skill.configPath),
        malformed: true,
        name: skill.name,
        results: {},
      });
      continue;
    }

    const accepted = acceptedDriftFor(skill, acceptDrift, options.repoRoot);
    const { changed, data, results } = mergeConfig({
      acceptDrift: accepted,
      config: skill.config.data,
      detect,
      example: skill.example,
      set: overrides.get(skill.name) ?? {},
    });

    if (options.write && changed) {
      const text = serialiseConfig(
        skill.config,
        data,
        Object.keys(skill.example),
      );
      try {
        writeFileSync(skill.configPath, text);
      } catch (error) {
        console.error(
          `initialise-skills: could not write ${skill.configPath}: ${error.message}`,
        );
        process.exit(2);
      }
    }

    skillReports.push({
      config: skill.config.data,
      configPath: relative(options.repoRoot, skill.configPath),
      malformed: false,
      name: skill.name,
      results,
    });
  }

  // Read-only review: the merge above classified every key without writing (the
  // write branch is gated on --write). Render the full current config per skill,
  // skipping the .gitignore reconcile — a review mutates nothing.
  if (options.review) {
    const descriptions = loadDetectableKeys();
    const reviewReport = buildReviewReport(skillReports, descriptions);
    console.log(
      options.json
        ? JSON.stringify(reviewReport, null, 2)
        : formatReview(reviewReport),
    );
    return;
  }

  // One mutation outside config.json: ensure preflight's scratch output is
  // gitignored. Gated on preflight (the file's producer) being installed — its
  // bundle is skipped by discoverSkills, so check separately (A-569).
  let gitignore = null;
  if (isPreflightInstalled(options.skillsDir)) {
    try {
      const result = reconcilePreflightIgnore(options.repoRoot, {
        write: options.write,
      });
      gitignore = {
        path: relative(options.repoRoot, result.path),
        status: result.status,
      };
    } catch (error) {
      // The top-level main() catch already funnels this to exit(2); name the
      // .gitignore write specifically so the failure is diagnosable, mirroring
      // the per-skill config write handler above (A-583). The per-skill writes
      // are idempotent, so a re-run after fixing the I/O cause is safe.
      console.error(
        `initialise-skills: could not reconcile .gitignore: ${error.message}`,
      );
      process.exit(2);
    }
  }

  // Emit/refresh the consumer's .claude/skills.lock inventory (A-616). A full walk
  // of every installed bundle (not the config-filtered `skills` list), gated on at
  // least one bundle being present so a skill-less repo gets no spurious file. The
  // source/ref provenance is facts-only — supplied via stdin, preserved from any
  // existing lock, else written as null and flagged (needsFacts). Mirrors the
  // gitignore block: dry-run reports the pending action, write persists it, and an
  // IO error is named before funnelling to exit(2).
  let lock = null;
  const skillsDirectory = options.skillsDir ?? defaultSkillsDirectory();
  const installedVersions = readInstalledVersions(skillsDirectory);
  if (Object.keys(installedVersions).length > 0) {
    const existingLock = readLock(options.repoRoot);
    const source = resolveSource(existingLock, facts);
    const ref = resolveRef(existingLock, facts);
    try {
      const result = writeLock(
        options.repoRoot,
        buildLock({ installedVersions, ref, source }),
        { write: options.write },
      );
      lock = {
        needsFacts: source === null || ref === null,
        path: relative(options.repoRoot, result.path),
        status: result.status,
      };
    } catch (error) {
      console.error(
        `initialise-skills: could not write skills.lock: ${error.message}`,
      );
      process.exit(2);
    }
  }

  const report = buildReport(skillReports, options.write, gitignore, lock);
  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(formatHuman(report));
  }
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
  try {
    main();
  } catch (error) {
    // The CLI contract documents exit 2 for usage/IO errors — funnel any
    // unexpected throw (discovery, detection, write, output) into it instead of
    // a raw crash.
    console.error(`initialise-skills: ${error.message}`);
    process.exit(2);
  }
}
