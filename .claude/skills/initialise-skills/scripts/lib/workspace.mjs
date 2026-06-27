// Workspace-layout detection for host-repo facts (A-409).
//
// `parseWorkspaceGlobs` mirrors the `pnpm-workspace.yaml` `packages:` reader in
// the preflight bundle (skills/preflight/scripts/lib/scope.mjs) — hand-rolled, no
// YAML dependency, so the bundle travels without node_modules. Duplicated rather
// than imported because vendored bundles are independent. The pure parsers take
// strings/objects as arguments for unit-testing; only `detect*` touch disk.

import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Generic fallback when no workspace layout is detectable.
 */
export const DEFAULT_PACKAGE_ROOTS = ["apps", "packages", "services"];

/**
 * Read the block-sequence under `packages:` in a pnpm-workspace.yaml string.
 * @param {string} yaml
 * @returns {string[]}
 */
export function parseWorkspaceGlobs(yaml) {
  const lines = yaml.split("\n");
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

    // A new top-level key (non-indented, non-list) ends the packages block. A
    // tab-indented list item also begins with neither a space nor a dash, so
    // guard against tabs too or it would end the block prematurely.
    if (
      line.length > 0 &&
      !line.startsWith(" ") &&
      !line.startsWith("\t") &&
      !line.startsWith("-")
    ) {
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
 * Reduce a list of workspace globs to their distinct top-level directory roots.
 * `apps/*` → `apps`; `packages/ui` → `packages`; a bare `.` or `*` is ignored.
 * Order-preserving, de-duplicated.
 * @param {string[]} globs
 * @returns {string[]}
 */
export function rootsFromGlobs(globs) {
  const roots = [];
  for (const glob of globs) {
    // Skip pnpm exclude patterns (`!packages/private/*`) — a negated glob removes
    // packages, it doesn't define a root, so it must not leak in as `!packages`.
    if (glob.startsWith("!")) {
      continue;
    }

    const top = glob.split("/")[0].trim();
    if (!top || top === "." || top === "*" || top === "**") {
      continue;
    }

    if (!roots.includes(top)) {
      roots.push(top);
    }
  }

  return roots;
}

/**
 * Normalise an npm `workspaces` field (array, or `{ packages: [...] }`) to globs.
 * @param {unknown} workspaces
 * @returns {string[]}
 */
export function globsFromWorkspacesField(workspaces) {
  if (Array.isArray(workspaces)) {
    return workspaces.filter((workspace) => typeof workspace === "string");
  }

  if (
    workspaces &&
    typeof workspaces === "object" &&
    Array.isArray(workspaces.packages)
  ) {
    return workspaces.packages.filter(
      (workspace) => typeof workspace === "string",
    );
  }

  return [];
}

/**
 * Detect monorepo package roots for a host repo: pnpm-workspace.yaml wins
 * (authoritatively, even when it declares no roots), else the root package.json
 * `workspaces` field, else the generic default filtered to the candidates that
 * actually exist on disk.
 *
 * The fallback is a *guess*, not a declaration, so it must not invent roots: a
 * repo with no workspace manifest and none of the default dirs returns `[]`, and
 * the caller (detectors.mjs) maps that to "couldn't detect" rather than writing
 * fabricated directories into a config. Declared globs, by contrast, are
 * authoritative and returned verbatim even if currently empty on disk.
 * @param {string} root
 * @returns {string[]}
 */
export function detectPackageRoots(root) {
  // A present pnpm-workspace.yaml is authoritative: derive the package roots from
  // its `packages:` globs and return them verbatim — even when empty. A file with
  // no parseable `packages:` block (e.g. a `catalogs:`-only file on pnpm ≥9.5, or
  // `packages: []`) declares a pnpm workspace with no package-dir roots, so the
  // answer is `[]` ("declared, none"). It must NOT fall through to the
  // package.json / default-dir guess, which would fabricate roots from whichever
  // apps/packages/services directories happen to exist — exactly the invented-root
  // drift A-460 removed. The caller maps `[]` to couldn't-detect (keep existing
  // config / flag for manual input).
  const pnpmFile = join(root, "pnpm-workspace.yaml");
  if (existsSync(pnpmFile)) {
    return rootsFromGlobs(parseWorkspaceGlobs(readFileSync(pnpmFile, "utf8")));
  }

  const pkgFile = join(root, "package.json");
  if (existsSync(pkgFile)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgFile, "utf8"));
      const roots = rootsFromGlobs(globsFromWorkspacesField(pkg.workspaces));
      if (roots.length > 0) {
        return roots;
      }
    } catch {
      // Malformed root package.json — fall through to the default.
    }
  }

  // Strictly directory-backed: a regular file or symlink named apps/packages/
  // services must not leak in as a package root. Mirrors the changelog detector's
  // statSync guard in detectors.mjs.
  return DEFAULT_PACKAGE_ROOTS.filter(
    (directory) =>
      statSync(join(root, directory), {
        throwIfNoEntry: false,
      })?.isDirectory() ?? false,
  );
}
