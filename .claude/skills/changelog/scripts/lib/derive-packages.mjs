// Map a set of changed repo-relative paths to the workspace packages they touch.
//
// Used by the merge-time path (set-affected-packages.mjs, computed from the
// branch diff). Kept as one implementation so the `affected_packages` value
// can't drift if a post-merge counterpart reuses the same rule.
//
// The rule (a conventional monorepo path→package mapping, all config-driven):
//   <root>/<x>/...    -> <x>   for each root in `packageRoots`
//   everything else   -> `fallbackPackage`
// The changelog directory itself is skipped — it's touched by every entry and
// would otherwise pin `fallbackPackage` onto every package list.

// Mirror config.mjs's DEFAULTS so this function works standalone (e.g. in unit
// tests) without loading config; keep the two in sync if the defaults change.
const DEFAULT_PACKAGE_ROOTS = ["apps", "packages", "services"];
const DEFAULT_FALLBACK_PACKAGE = "infrastructure";
const DEFAULT_CHANGELOG_DIR = "changelog";

function escapeRegex(source) {
  return source.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * @param {string[]} paths repo-relative changed paths
 * @param {object} [options]
 * @param {string[]} [options.packageRoots] dir prefixes mapping `<root>/<x>/…`→`<x>`
 * @param {string} [options.fallbackPackage] package name for unmatched paths
 * @param {string} [options.changelogDir] changelog dir to skip
 * @returns {string[]} sorted, de-duplicated package names
 */
export function derivePackagesFromPaths(paths, options = {}) {
  const {
    changelogDir: changelogDirectory = DEFAULT_CHANGELOG_DIR,
    fallbackPackage = DEFAULT_FALLBACK_PACKAGE,
    packageRoots = DEFAULT_PACKAGE_ROOTS,
  } = options;

  // `<root>/<x>/` → captures `<x>`, for any configured root.
  const rootRe =
    packageRoots.length > 0
      ? new RegExp(`^(?:${packageRoots.map(escapeRegex).join("|")})/([^/]+)/`)
      : null;
  // Normalise a trailing slash so `changelogDir: "changelog/"` still skips.
  const skipPrefix = `${changelogDirectory.replace(/\/+$/, "")}/`;

  const out = new Set();
  for (const changedPath of paths) {
    const path = changedPath.trim();
    if (!path) {
      continue;
    }

    if (path.startsWith(skipPrefix)) {
      continue;
    }

    const match = rootRe ? rootRe.exec(path) : null;
    out.add(match ? match[1] : fallbackPackage);
  }

  return [...out].toSorted();
}
