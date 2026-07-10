#!/usr/bin/env node
// initialise-package-repo CLI (A-663 / A-776).
//
// Drives a repo freshly created from npm-package-template to a releasable state in
// one idempotent pass. Deterministic file edits (including the shared-skills pull),
// plus the non-copied GitHub settings, live here and in lib/; the human-facing
// confirmation gates, the Linear-facts step, and the wrap of the initialise-skills
// skill are owned by SKILL.md.
//
//   node scripts/initialise-package-repo.mjs [--dry-run|--write] [--json]
//        [--repo-root <path>] [--files-only|--github-only]
//   echo '{"facts":{"name":"@acme-skunkworks/portcullis","description":"…",
//          "keywords":["a","b"]}}' \
//     | node scripts/initialise-package-repo.mjs --write --json
//
// Exit codes: 0 success; 2 usage/IO error; 3 preconditions not met (no gh / not a
// GitHub repo) so the SKILL.md layer can prompt for `gh auth login` distinctly.

import { resetChangelog } from "./lib/changelog-reset.mjs";
import { applyGithubSettings } from "./lib/github-settings.mjs";
import { reconcileManifest } from "./lib/manifest.mjs";
import { reconcilePackageIdentity } from "./lib/package-identity.mjs";
import { pullSharedSkills } from "./lib/pull-skills.mjs";
import { reconcileRepoConfig } from "./lib/repo-config.mjs";
import { deriveIdentity, fetchRepoView } from "./lib/repo-facts.mjs";
import { formatHuman, MANUAL_REMINDERS } from "./lib/report.mjs";
import { reconcileSkillConfigIgnore } from "./lib/skill-config-gitignore.mjs";
import { readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";

function requireValue(flag, value) {
  if (value === undefined || value.startsWith("--")) {
    console.error(`initialise-package-repo: ${flag} requires a value`);
    process.exit(2);
  }

  return value;
}

export function parseArgs(argv) {
  const options = {
    filesOnly: false,
    githubOnly: false,
    json: false,
    repoRoot: process.cwd(),
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
    } else if (argument === "--files-only") {
      options.filesOnly = true;
    } else if (argument === "--github-only") {
      options.githubOnly = true;
    } else if (argument === "--repo-root") {
      options.repoRoot = requireValue(argument, argv[++index]);
    } else if (argument === "--help" || argument === "-h") {
      options.help = true;
    } else {
      console.error(`initialise-package-repo: unknown argument "${argument}"`);
      process.exit(2);
    }
  }

  if (options.filesOnly && options.githubOnly) {
    console.error(
      "initialise-package-repo: --files-only and --github-only are mutually exclusive",
    );
    process.exit(2);
  }

  return options;
}

/**
 * Read `{ facts }` from stdin when piped (not a TTY); empty otherwise.
 */
function readStdinFacts() {
  if (process.stdin.isTTY) {
    return {};
  }

  let raw = "";
  try {
    raw = readFileSync(0, "utf8");
  } catch {
    return {};
  }

  if (!raw.trim()) {
    return {};
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    console.error(
      `initialise-package-repo: could not parse stdin JSON: ${error.message}`,
    );
    process.exit(2);
  }

  return parsed.facts && typeof parsed.facts === "object" ? parsed.facts : {};
}

/**
 * Phase 1 — the in-repo file edits, including the shared-skills pull (A-776).
 */
function runFileEdits(root, identity, write) {
  return {
    changelog: resetChangelog({ dir: join(root, "changelog"), write }),
    manifest: reconcileManifest({
      manifestPath: join(root, ".release-please-manifest.json"),
      packageJsonPath: join(root, "package.json"),
      write,
    }),
    packageIdentity: reconcilePackageIdentity({
      identity,
      packageJsonPath: join(root, "package.json"),
      write,
    }),
    repoConfig: reconcileRepoConfig({
      facts: {
        defaultBranch: identity.defaultBranch,
        npmScope: identity.scope,
      },
      path: join(root, "infrastructure", "repo-config.yaml"),
      write,
    }),
    // Refresh shared bundles from agent-skills before initialise-skills runs
    // (SKILL.md owns that wrap). Repo-local initialise-package-repo is not in
    // the pull set.
    skillsPull: pullSharedSkills({ repoRoot: root, write }),
    // Clear the template-seed skill-config gitignore so initialise-skills can
    // write trackable config.json files the consumer commits (A-812).
    skillConfigIgnore: reconcileSkillConfigIgnore({
      path: join(root, ".gitignore"),
      write,
    }),
  };
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(
      "Usage: node scripts/initialise-package-repo.mjs [--dry-run|--write] [--json] [--repo-root <p>] [--files-only|--github-only]",
    );
    return;
  }

  const facts = readStdinFacts();
  const view = fetchRepoView(options.repoRoot);
  if (!view) {
    console.error(
      "initialise-package-repo: could not read repo facts via `gh` — run `gh auth login` and ensure this is a GitHub repo.",
    );
    process.exit(3);
  }

  const identity = deriveIdentity(view, facts);
  const doFiles = !options.githubOnly;
  const doGithub = !options.filesOnly;
  const scope = options.filesOnly
    ? "files"
    : options.githubOnly
      ? "github"
      : "all";

  const ops = {};
  if (doFiles) {
    ops.files = runFileEdits(options.repoRoot, identity, options.write);
  }

  if (doGithub) {
    ops.github = applyGithubSettings(identity.slug, { write: options.write });
  }

  const report = {
    ops,
    reminders: MANUAL_REMINDERS,
    scope,
    slug: identity.slug,
    write: options.write,
  };
  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(formatHuman(report));
  }

  // A GitHub setting or skills pull whose write failed reports status "error";
  // exit non-zero so the operator gets a real signal instead of a clean-looking run.
  const githubFailed = (ops.github ?? []).some((op) => op.status === "error");
  const skillsFailed = ops.files?.skillsPull?.status === "error";
  if (githubFailed || skillsFailed) {
    process.exit(1);
  }
}

// Run main() only as a CLI, not when imported by tests. Compare realpath'd paths
// so symlinks (macOS /var→/private/var, pnpm's store) don't cause a false negative.
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
    console.error(`initialise-package-repo: ${error.message}`);
    process.exit(2);
  }
}
