// Detects skill bundles whose content changed on this branch without a matching
// version bump, so the send-it ship flow can offer to bump them in lockstep.
// Zero dependencies — Node built-ins only, no build step, no tsx.
// Run: node skills/send-it/scripts/check-skill-bumps.mjs
//
// Why this exists: `validate-skills` (CI) enforces that a skill's package.json
// `version` EQUALS its SKILL.md `metadata.version` (parity), but nothing
// enforces that the version was BUMPED when the skill's content changed. So a
// skill can be edited and shipped while its version label stays stale — CI
// stays green and consumers' runtime introspection sees the old version. This
// helper closes that gap for multi-artefact repos (ADR-0002).
//
// Config-gated: only runs when send-it's config.json carries a
// `bundleVersioning` block. Single-package consumer repos have no skill
// bundles, leave it unset, and get a clean no-op:
//   { "configured": false, "unbumped": [], "bumped": [] }
//
// Fields printed as JSON to stdout:
//   configured : whether bundleVersioning is set (false → no-op)
//   unbumped   : [{ name, currentVersion, suggestedBump, suggestedVersion,
//                   manifestPath, skillPath }] — changed bundles still at their
//                   base version
//   bumped     : [name] — changed bundles whose version already moved
//
// The pure functions (collectTouchedSkills, incrementVersion, classifyBundles)
// keep no git/fs state, so they're exported for vitest. main() does the I/O.

import { deriveBump } from "./derive-bump.mjs";
import { readGitCommits, resolveBaseRef } from "./lib/git.mjs";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";

const CONFIG_PATH = new URL("../config.json", import.meta.url);

/**
 * Skill directory names with at least one changed file under `<root>/<name>/`.
 * `changedFiles` are repo-relative paths (forward slashes); `root` is the
 * bundle parent (e.g. "skills"). Deduplicated, sorted for stable output.
 */
export function collectTouchedSkills(changedFiles, root) {
  const prefix = `${root.replace(/\/+$/, "")}/`;
  const names = new Set();
  for (const file of changedFiles) {
    if (!file.startsWith(prefix)) {
      continue;
    }

    const rest = file.slice(prefix.length);
    const slash = rest.indexOf("/");
    // Need a file INSIDE a bundle dir (`skills/foo/…`), not a loose
    // `skills/foo` with no nested path.
    if (slash > 0) {
      names.add(rest.slice(0, slash));
    }
  }

  return [...names].toSorted();
}

/**
 * Next semver from a bump level. Drops any pre-release/build metadata — a bump
 * always lands on a clean release version. Throws on a non-semver core so a
 * malformed manifest surfaces loudly rather than producing `NaN.NaN.NaN`.
 */
export function incrementVersion(version, bump) {
  const core = String(version).split(/[-+]/, 1)[0];
  const parts = core.split(".");
  if (parts.length !== 3 || parts.some((part) => !/^\d+$/.test(part))) {
    throw new Error(`not a semver version: ${JSON.stringify(version)}`);
  }

  const [major, minor, patch] = parts.map(Number);
  switch (bump) {
    case "major":
      return `${major + 1}.0.0`;
    case "minor":
      return `${major}.${minor + 1}.0`;
    case "patch":
      return `${major}.${minor}.${patch + 1}`;
    default:
      throw new Error(`unknown bump level: ${JSON.stringify(bump)}`);
  }
}

/**
 * Split touched skills into bumped vs unbumped given their base and current
 * versions. `versions` maps skill name → { base, current }; a null `base`
 * means the bundle is new on this branch (no manifest at the base ref) and is
 * treated as already-versioned — not flagged. `suggestedBump` is the
 * branch-level bump applied to each unbumped bundle.
 */
export function classifyBundles(touched, versions, suggestedBump, paths) {
  const unbumped = [];
  const bumped = [];
  for (const name of touched) {
    const entry = versions[name];
    if (!entry || entry.current === null) {
      continue; // not a versioned bundle (no manifest) — nothing to check
    }

    if (entry.base === null || entry.base !== entry.current) {
      bumped.push(name);
      continue;
    }

    unbumped.push({
      currentVersion: entry.current,
      manifestPath: paths(name).manifestPath,
      name,
      skillPath: paths(name).skillPath,
      suggestedBump,
      suggestedVersion: incrementVersion(entry.current, suggestedBump),
    });
  }

  return { bumped, unbumped };
}

function readConfig() {
  try {
    return JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
  } catch {
    return {};
  }
}

function changedFilesVsBase(base) {
  const out = execFileSync("git", ["diff", "--name-only", `${base}...HEAD`], {
    encoding: "utf8",
  });
  return out
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function versionFromManifestText(text) {
  try {
    const version = JSON.parse(text).version;
    return typeof version === "string" ? version : null;
  } catch {
    return null;
  }
}

function readVersionAtRef(ref, path) {
  try {
    return versionFromManifestText(
      execFileSync("git", ["show", `${ref}:${path}`], { encoding: "utf8" }),
    );
  } catch {
    return null; // path absent at that ref (new bundle)
  }
}

function readCurrentVersion(path) {
  return existsSync(path)
    ? versionFromManifestText(readFileSync(path, "utf8"))
    : null;
}

const USAGE = `check-skill-bumps — list skill bundles changed on this branch without a version bump

Usage:
  node check-skill-bumps.mjs       Print { configured, unbumped, bumped } as JSON to stdout (read-only)
  node check-skill-bumps.mjs --help  Show this message (alias: -h)

Config-gated: a no-op ({ configured: false }) unless send-it's config.json
carries a bundleVersioning block.`;

function main() {
  if (
    process.argv
      .slice(2)
      .some((argument) => argument === "--help" || argument === "-h")
  ) {
    console.log(USAGE);
    return;
  }

  const config = readConfig();
  const bv = config.bundleVersioning;
  if (!bv || typeof bv !== "object") {
    console.log(
      JSON.stringify({ bumped: [], configured: false, unbumped: [] }, null, 2),
    );
    return;
  }

  const root = bv.root ?? "skills";
  const manifest = bv.manifest ?? "package.json";
  const skillFile = bv.skillFile ?? "SKILL.md";
  function paths(name) {
    return {
      manifestPath: join(root, name, manifest),
      skillPath: join(root, name, skillFile),
    };
  }

  const base = resolveBaseRef();
  if (!base) {
    console.log(
      JSON.stringify({ bumped: [], configured: true, unbumped: [] }, null, 2),
    );
    return;
  }

  const touched = collectTouchedSkills(changedFilesVsBase(base), root);
  const suggestedBump = deriveBump(readGitCommits());

  const versions = {};
  for (const name of touched) {
    const manifestPath = paths(name).manifestPath;
    versions[name] = {
      base: readVersionAtRef(base, manifestPath),
      current: readCurrentVersion(manifestPath),
    };
  }

  const { bumped, unbumped } = classifyBundles(
    touched,
    versions,
    suggestedBump,
    paths,
  );
  console.log(JSON.stringify({ bumped, configured: true, unbumped }, null, 2));
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
