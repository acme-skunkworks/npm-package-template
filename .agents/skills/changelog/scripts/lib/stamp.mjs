// Pure helpers for release-time version stamping: set `version` on an entry
// that doesn't have one, and read the version from package.json.
//
// Library module (no CLI): the release-time orchestrator finalise-changelog.mjs
// composes these. Kept pure so they're trivially unit-testable. Zero-dep — uses
// the bundle's vendored frontmatter parser instead of gray-matter.

import { parseFrontmatter, stringifyFrontmatter } from "./frontmatter.mjs";

/**
 * True when a value is unset (null/undefined/"").
 * @param {unknown} value
 */
function blank(value) {
  return value === null || value === undefined || value === "";
}

/**
 * Stamp `version` onto an entry if it has none. Returns the rewritten markdown,
 * or null when the entry already has a version (no write needed).
 * @param {string} raw entry markdown
 * @param {string} version version to stamp
 * @returns {null | string}
 */
export function stampVersion(raw, version) {
  const parsed = parseFrontmatter(raw);
  const fm = { ...parsed.data };
  if (!blank(fm.version)) {
    return null;
  }

  fm.version = version;
  return stringifyFrontmatter(parsed.content, fm);
}

/**
 * Read the `version` field from a package.json string.
 * @param {string} packageJsonRaw
 * @returns {string}
 */
export function readPackageVersion(packageJsonRaw) {
  const pkg = JSON.parse(packageJsonRaw);
  if (typeof pkg.version !== "string" || pkg.version.length === 0) {
    throw new Error("package.json is missing a string `version`");
  }

  return pkg.version;
}
