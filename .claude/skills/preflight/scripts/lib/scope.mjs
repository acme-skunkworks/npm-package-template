#!/usr/bin/env node
/**
 * Branch-scoped file classification for the preflight skill (originally A-282).
 * Shared by preflight.mjs, lint-fix.mjs, and classify-lint.mjs.
 *
 * Repo-specific configuration (linted workspaces + base branch) is auto-detected
 * rather than hardcoded (A-305, delivered under A-344): workspaces come from
 * `pnpm-workspace.yaml` + each package's `lint` script, and the base branch from
 * `origin/HEAD`. A `preflight.config.json` at the repo root overrides both. This
 * keeps the preflight skill portable — a consuming repo edits at most one small
 * file, and usually none.
 */
import { detectBaseBranch as detectBaseBranchVendored } from "./vendor/base-branch.mjs";
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";

const ROOT = process.cwd();

const LINTABLE_CODE = /\.(ts|tsx|js|jsx|mjs|cjs)$/i;
const CODE_CONFIG =
  /(^|\/)(eslint\.config\.[^/]+|tsconfig\.eslint\.json|vite\.config\.[^/]+|package\.json|pnpm-lock\.yaml)$/;
const ESLINT_RUNNABLE =
  /(^|\/)(eslint\.config\.[^/]+|tsconfig\.eslint\.json|vite\.config\.[^/]+)$/;
const ROOT_ESLINT_CONFIG = /^eslint\.config\.[^/]+$/;
const MARKDOWN = /\.(md|mdx)$/i;
const WORKFLOW = /^\.github\/workflows\/.*\.ya?ml$/i;
const ACTIONLINT_CONFIG = /^\.github\/actionlint\.yaml$/i;
// Excludes build output plus installed skill bundles (`.agents/skills/`,
// `.claude/skills/`): a consumer's vendored skills are third-party content, not
// the branch's own markdown, so re-linting them would surface noise the author
// can't fix.
const MD_IGNORE =
  /(?:^|\/)(?:node_modules|dist|\.astro|\.turbo|\.cache)(?:\/|$)|(?:^|\/)\.agents\/skills\/|(?:^|\/)\.claude\/skills\//;

const DEFAULT_BASE_BRANCH = "main";

/**
 * Minimal reader for the `packages:` block-sequence in `pnpm-workspace.yaml`.
 * Hand-rolled (no YAML dependency, per A-303) so the scripts travel without
 * node_modules. Uses plain string operations rather than a backtracking regex.
 * @param {string} root
 * @returns {string[]}
 */
function readWorkspaceGlobs(root) {
  const file = join(root, "pnpm-workspace.yaml");
  if (!existsSync(file)) {
    return [];
  }

  const lines = readFileSync(file, "utf8").split("\n");
  const globs = [];
  let inPackages = false;

  for (const raw of lines) {
    const line = raw.trimEnd();
    const trimmed = line.trim();

    if (trimmed === "packages:") {
      inPackages = true;
      continue;
    }

    if (!inPackages) {
      continue;
    }

    // A new top-level key (non-indented, non-list) ends the packages block.
    if (line.length > 0 && !line.startsWith(" ") && !line.startsWith("-")) {
      break;
    }

    if (trimmed.startsWith("-")) {
      const value = trimmed
        .slice(1)
        .trim()
        .replaceAll(/^['"]|['"]$/g, "");
      if (value) {
        globs.push(value);
      }
    }
  }

  return globs;
}

/**
 * Whether a directory entry resolves to a directory, following symlinks.
 * `Dirent.isDirectory()` is false for a symlink-to-directory, so a workspace
 * that is a symlink (monorepo linking tools, vendored packages) would otherwise
 * be silently skipped. Broken symlinks resolve to false.
 * @param {string} parentPath
 * @param {import('node:fs').Dirent} entry
 * @returns {boolean}
 */
function entryIsDirectory(parentPath, entry) {
  if (entry.isDirectory()) {
    return true;
  }

  if (entry.isSymbolicLink()) {
    try {
      return statSync(join(parentPath, entry.name)).isDirectory();
    } catch {
      return false;
    }
  }

  return false;
}

/**
 * Expand a workspace glob to existing directories. Supports the common
 * single-level trailing `*` (e.g. `apps/*`) and a literal directory path. Nested
 * `**` globs are not expanded — document a `preflight.config.json` override if a
 * repo needs them.
 * @param {string} root
 * @param {string} glob
 * @returns {string[]}
 */
function expandGlob(root, glob) {
  if (glob.endsWith("/*")) {
    const parent = glob.slice(0, -2);
    const parentPath = join(root, parent);
    if (!existsSync(parentPath)) {
      return [];
    }

    return readdirSync(parentPath, { withFileTypes: true })
      .filter((entry) => entryIsDirectory(parentPath, entry))
      .map((entry) => `${parent}/${entry.name}`);
  }

  // Skip more complex globs (e.g. nested `**`); only literal dirs fall through.
  if (glob.includes("*")) {
    return [];
  }

  return existsSync(join(root, glob)) ? [glob] : [];
}

/**
 * Auto-detect linted workspaces from `pnpm-workspace.yaml`. A workspace is
 * included only if its `package.json` declares a `lint` script — this naturally
 * excludes intentionally-unlinted workspaces and non-package dirs without a
 * hand-maintained omission list.
 * @param {string} [root]
 * @returns {Record<string, { filter: string; prefix: string }>}
 */
export function detectWorkspaces(root = ROOT) {
  const directories = readWorkspaceGlobs(root).flatMap((glob) =>
    expandGlob(root, glob),
  );
  /** @type {Record<string, { filter: string; prefix: string }>} */
  const workspaces = {};

  for (const directory of directories) {
    const pkgPath = join(root, directory, "package.json");
    if (!existsSync(pkgPath)) {
      continue;
    }

    let pkg;
    try {
      pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
    } catch {
      continue;
    }

    if (!pkg.name || !pkg.scripts || !pkg.scripts.lint) {
      continue;
    }

    // Key by basename for readable summary output. On the rare collision (two
    // workspaces sharing a basename across glob roots, e.g. apps/shared and
    // packages/shared) fall back to the full path so neither is silently dropped.
    let key = basename(directory);
    if (Object.prototype.hasOwnProperty.call(workspaces, key)) {
      console.warn(
        `preflight: workspace basename collision for "${key}" — keying "${directory}" by its full path`,
      );
      key = directory;
    }

    workspaces[key] = { filter: pkg.name, prefix: `${directory}/` };
  }

  return workspaces;
}

/**
 * Resolve the base branch to diff against. Delegates to the canonical, vendored
 * lib/base-branch.mjs (ADR-0004) — detects the default branch from `origin/HEAD`
 * (e.g. `main`, `master`, `develop`), falling back to `main` when the symbolic
 * ref is absent (common on fresh clones / shallow CI checkouts).
 * @param {string} [root]
 * @returns {string}
 */
export function detectBaseBranch(root = ROOT) {
  return detectBaseBranchVendored(root, DEFAULT_BASE_BRANCH);
}

/**
 * Validate a parsed `preflight.config.json` shape, dropping any malformed key
 * (with a warning) so it falls back to auto-detection rather than surfacing a
 * confusing downstream error. `baseBranch` must be a non-empty string;
 * `workspaces` must be an object of `{ filter, prefix }` string pairs;
 * `blockOnWarnings` must be a boolean.
 * @param {unknown} raw
 * @returns {{ baseBranch?: string; workspaces?: Record<string, { filter: string; prefix: string }>; blockOnWarnings?: boolean }}
 */
function validateOverride(raw) {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    console.warn(
      "preflight: ignoring preflight.config.json (expected a JSON object)",
    );
    return {};
  }

  /** @type {{ baseBranch?: string; workspaces?: Record<string, { filter: string; prefix: string }>; blockOnWarnings?: boolean }} */
  const override = {};

  if ("blockOnWarnings" in raw) {
    if (typeof raw.blockOnWarnings === "boolean") {
      override.blockOnWarnings = raw.blockOnWarnings;
    } else {
      console.warn(
        "preflight: ignoring preflight.config.json blockOnWarnings (expected a boolean)",
      );
    }
  }

  if ("baseBranch" in raw) {
    const baseBranch =
      typeof raw.baseBranch === "string" ? raw.baseBranch.trim() : "";
    if (baseBranch) {
      override.baseBranch = baseBranch;
    } else {
      console.warn(
        "preflight: ignoring preflight.config.json baseBranch (expected a non-empty string)",
      );
    }
  }

  if ("workspaces" in raw) {
    const ws = raw.workspaces;
    if (typeof ws !== "object" || ws === null || Array.isArray(ws)) {
      console.warn(
        "preflight: ignoring preflight.config.json workspaces (expected an object)",
      );
    } else {
      /** @type {Record<string, { filter: string; prefix: string }>} */
      const workspaces = {};
      for (const [key, value] of Object.entries(ws)) {
        const entry = typeof value === "object" && value !== null ? value : {};
        const filter =
          typeof entry.filter === "string" ? entry.filter.trim() : "";
        const prefix =
          typeof entry.prefix === "string" ? entry.prefix.trim() : "";

        // Reject empty filter/prefix and normalise prefix to a trailing slash:
        // `classifyChangedFiles` uses `file.startsWith(prefix)`, so an empty
        // prefix would bucket every file and a slash-less one would over-match
        // sibling directories (apps/web vs apps/website).
        if (filter && prefix) {
          workspaces[key] = {
            filter,
            prefix: prefix.endsWith("/") ? prefix : `${prefix}/`,
          };
        } else {
          console.warn(
            `preflight: ignoring preflight.config.json workspace "${key}" (expected non-empty { filter, prefix } strings)`,
          );
        }
      }

      // Only treat the override as authoritative when at least one entry
      // survived validation. An all-invalid block must NOT win over
      // auto-detection: `resolveConfig` uses `override.workspaces ??
      // detectWorkspaces(root)`, and an empty `{}` is truthy, so it would
      // otherwise silently run ESLint on zero workspaces.
      if (Object.keys(workspaces).length > 0) {
        override.workspaces = workspaces;
      } else {
        console.warn(
          "preflight: ignoring preflight.config.json workspaces (no valid entries; falling back to auto-detection)",
        );
      }
    }
  }

  return override;
}

/**
 * Load and validate an optional `preflight.config.json` override from the repo
 * root. Either key may be supplied independently.
 * @param {string} root
 * @returns {{ baseBranch?: string; workspaces?: Record<string, { filter: string; prefix: string }> }}
 */
function loadConfigOverride(root) {
  const file = join(root, "preflight.config.json");
  if (!existsSync(file)) {
    return {};
  }

  let parsed;
  try {
    parsed = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    console.warn(
      "preflight: ignoring malformed preflight.config.json (could not parse JSON)",
    );
    return {};
  }

  return validateOverride(parsed);
}

/** @type {{ baseBranch: string; workspaces: Record<string, { filter: string; prefix: string }>; blockOnWarnings: boolean } | null} */
let cachedConfig = null;

/**
 * Resolve preflight configuration: an explicit `preflight.config.json` wins,
 * otherwise auto-detect. Memoised for the default root.
 * @param {string} [root]
 * @returns {{ baseBranch: string; workspaces: Record<string, { filter: string; prefix: string }>; blockOnWarnings: boolean }}
 */
export function resolveConfig(root = ROOT) {
  if (root === ROOT && cachedConfig) {
    return cachedConfig;
  }

  const override = loadConfigOverride(root);
  const config = {
    baseBranch: override.baseBranch ?? detectBaseBranch(root),
    // Default off: introduced ESLint warnings are surfaced but don't gate the
    // ship, matching `pnpm lint` / CI (A-601). Opt in to block on them.
    blockOnWarnings: override.blockOnWarnings ?? false,
    workspaces: override.workspaces ?? detectWorkspaces(root),
  };

  if (root === ROOT) {
    cachedConfig = config;
  }

  return config;
}

/**
 * @returns {string}
 */
export function gitMergeBase() {
  const { baseBranch } = resolveConfig();
  const result = spawnSync(
    "git",
    ["merge-base", "HEAD", `origin/${baseBranch}`],
    { cwd: ROOT, encoding: "utf8" },
  );
  if (result.status !== 0) {
    throw new Error(
      `preflight: could not find merge base with origin/${baseBranch}. Run: git fetch origin ${baseBranch}`,
    );
  }

  return result.stdout.trim();
}

/**
 * Branch-changed files that still exist at HEAD. `--diff-filter=d` excludes
 * deletions: a file removed on the branch can't be linted and must not reach
 * ESLint/markdownlint (which error on a missing pattern), nor be classified for
 * violations.
 * @param {string} mergeBase
 * @returns {string[]}
 */
export function gitChangedFiles(mergeBase) {
  const result = spawnSync(
    "git",
    ["diff", "--name-only", "--diff-filter=d", `${mergeBase}...HEAD`],
    { cwd: ROOT, encoding: "utf8", maxBuffer: 10 * 1024 * 1024 },
  );
  if (result.error || result.status !== 0) {
    const detail =
      result.error?.message ||
      result.stderr?.trim() ||
      "unknown git diff error";
    throw new Error(`preflight: git diff failed: ${detail}`);
  }

  return result.stdout.split("\n").filter(Boolean);
}

/**
 * @param {string} file
 */
function isLintableCodePath(file) {
  return LINTABLE_CODE.test(file) || CODE_CONFIG.test(file);
}

/**
 * Paths ESLint can actually lint (excludes pnpm-lock.yaml and other non-runnable gates).
 * @param {string} file
 */
function isEslintRunnablePath(file) {
  return LINTABLE_CODE.test(file) || ESLINT_RUNNABLE.test(file);
}

/**
 * @param {boolean} workflowsChanged
 * @param {string[]} workflows
 */
function resolveActionlintTargets(workflowsChanged, workflows) {
  if (!workflowsChanged) {
    return [];
  }

  if (workflows.length > 0) {
    return [...workflows];
  }

  // actionlint config-only change: re-validate all tracked workflows (mirrors CI path trigger)
  const ls = spawnSync("git", ["ls-files", ".github/workflows"], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
  });
  if (ls.status !== 0) {
    return [];
  }

  return ls.stdout.split("\n").filter((file) => WORKFLOW.test(file));
}

/**
 * @param {string[]} changedFiles
 * @param {Record<string, { filter: string; prefix: string }>} [workspaces]
 */
export function classifyChangedFiles(
  changedFiles,
  workspaces = resolveConfig().workspaces,
) {
  let codeChanged = false;
  let markdownChanged = false;
  let workflowsChanged = false;

  /** @type {Record<string, string[]>} */
  const eslint = {
    root: [],
    scripts: [],
    ...Object.fromEntries(Object.keys(workspaces).map((key) => [key, []])),
  };
  const markdown = [];
  const workflows = [];

  for (const file of changedFiles) {
    if (WORKFLOW.test(file) || ACTIONLINT_CONFIG.test(file)) {
      workflowsChanged = true;
      if (WORKFLOW.test(file)) {
        workflows.push(file);
      }
    }

    if (MARKDOWN.test(file) && !MD_IGNORE.test(file)) {
      markdownChanged = true;
      markdown.push(file);
    }

    if (isLintableCodePath(file)) {
      codeChanged = true;
    }

    if (!isEslintRunnablePath(file)) {
      continue;
    }

    if (file.startsWith("scripts/")) {
      eslint.scripts.push(file);
    } else if (
      ROOT_ESLINT_CONFIG.test(file) ||
      file === "tsconfig.eslint.json"
    ) {
      eslint.root.push(file);
    } else {
      // A lintable file outside `scripts/` and the root config: route it to the
      // workspace(s) whose prefix it matches, else to the root bucket so it is
      // linted at the repo root with the root ESLint config. Without this
      // catch-all a top-level (or otherwise unclaimed) code file set
      // `codeChanged = true` but landed in no bucket — preflight then reported
      // ESLint "ran", skipped every empty group, and passed: a silent
      // false-pass in the gate, breaking any non-pnpm consumer or a repo with
      // linted code at the root outside `scripts/` (A-527).
      let matched = false;
      for (const [key, { prefix }] of Object.entries(workspaces)) {
        if (file.startsWith(prefix)) {
          eslint[key].push(file);
          matched = true;
        }
      }

      if (!matched) {
        eslint.root.push(file);
      }
    }
  }

  const actionlintTargets = resolveActionlintTargets(
    workflowsChanged,
    workflows,
  );

  return {
    actionlintTargets,
    changedFiles,
    codeChanged,
    eslint,
    markdown,
    markdownChanged,
    workflows,
    workflowsChanged,
  };
}

/**
 * Strip a workspace prefix from repo-root-relative paths so they can be handed
 * to a workspace-scoped tool. `pnpm --filter <pkg> exec <tool>` runs with the
 * workspace directory as cwd, so a path like `apps/studio/src/x.ts` must become
 * `src/x.ts` for the tool to resolve it. Paths that don't start with `prefix`
 * (or when `prefix` is empty) are returned unchanged.
 * @param {string[]} files repo-root-relative paths
 * @param {string} prefix workspace prefix with a trailing slash (e.g. "apps/studio/")
 * @returns {string[]} paths relative to the workspace directory
 */
export function relativiseToWorkspace(files, prefix) {
  if (!prefix) {
    return [...files];
  }

  return files.map((file) =>
    file.startsWith(prefix) ? file.slice(prefix.length) : file,
  );
}

/**
 * @returns {{ mergeBase: string; workspaces: Record<string, { filter: string; prefix: string }>; codeChanged: boolean; markdownChanged: boolean; workflowsChanged: boolean; eslint: object; markdown: string[]; workflows: string[]; actionlintTargets: string[]; changedFiles: string[] }}
 */
export function getBranchScope() {
  const { workspaces } = resolveConfig();
  const mergeBase = gitMergeBase();
  const changedFiles = gitChangedFiles(mergeBase);
  const classified = classifyChangedFiles(changedFiles, workspaces);
  return { mergeBase, workspaces, ...classified };
}
