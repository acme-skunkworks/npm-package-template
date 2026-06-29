#!/usr/bin/env node
// initialise-skills CLI (A-409).
//
// Scans a host repo and reconciles every installed skill's config.json with
// detected facts. Deterministic git/fs detection + a three-way merge live here
// and in lib/; the Linear facts the script can't derive (team name, workspace
// slug) and the confirmation gate are owned by the SKILL.md orchestration, which
// pipes those facts — and any per-key drift opt-ins — in as stdin JSON.
//
//   node scripts/initialise.mjs [--dry-run|--write] [--json]
//                               [--repo-root <path>] [--skills-dir <path>]
//   echo '{"facts":{"linearTeamName":"…"},"acceptDrift":{"changelog":["baseBranch"]}}' \
//     | node scripts/initialise.mjs --write --json
//
// Exit codes: 0 success; 2 usage/IO error.

import { createDetectors } from "./lib/detectors.mjs";
import { discoverSkills, isPreflightInstalled } from "./lib/discover.mjs";
import { reconcilePreflightIgnore } from "./lib/gitignore.mjs";
import { serialiseConfig } from "./lib/jsonio.mjs";
import { mergeConfig } from "./lib/merge.mjs";
import { buildReport, formatHuman } from "./lib/report.mjs";
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
    skillsDir: undefined,
    write: false,
  };
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (argument === "--write") {
      options.write = true;
    } else if (argument === "--dry-run") {
      options.write = false;
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
      "Usage: node scripts/initialise.mjs [--dry-run|--write] [--json] [--repo-root <p>] [--skills-dir <p>]",
    );
    return;
  }

  const { acceptDrift, facts } = readStdinPayload();
  const skills = discoverSkills(options.skillsDir);
  const { detect } = createDetectors({
    installedSkills: new Set(skills.map((skill) => skill.name)),
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
      configPath: relative(options.repoRoot, skill.configPath),
      malformed: false,
      name: skill.name,
      results,
    });
  }

  // One mutation outside config.json: ensure preflight's scratch output is
  // gitignored. Gated on preflight (the file's producer) being installed — its
  // bundle is skipped by discoverSkills, so check separately (A-569).
  let gitignore = null;
  if (isPreflightInstalled(options.skillsDir)) {
    const result = reconcilePreflightIgnore(options.repoRoot, {
      write: options.write,
    });
    gitignore = {
      path: relative(options.repoRoot, result.path),
      status: result.status,
    };
  }

  const report = buildReport(skillReports, options.write, gitignore);
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
