// Pure helpers for release-time version stamping: set `version` on an entry
// that doesn't have one, and read the version from package.json.
//
// Library module (no CLI): the release-time orchestrator finalise-changelog.ts
// composes these. Kept pure so they're trivially unit-testable.

import matter from "gray-matter";

/**
 * True when a value is unset (null/undefined/"").
 */
function blank(value: unknown): boolean {
  return value === null || value === undefined || value === "";
}

/**
 * Stamp `version` onto an entry if it has none. Returns the rewritten markdown,
 * or null when the entry already has a version (no write needed).
 */
export function stampVersion(raw: string, version: string): null | string {
  const parsed = matter(raw);
  const fm = { ...parsed.data } as Record<string, unknown>;
  if (!blank(fm.version)) {
    return null;
  }

  fm.version = version;
  return matter.stringify(parsed.content, fm);
}

/**
 * Read the `version` field from a package.json string.
 */
export function readPackageVersion(packageJsonRaw: string): string {
  const pkg = JSON.parse(packageJsonRaw) as { version?: unknown };
  if (typeof pkg.version !== "string" || pkg.version.length === 0) {
    throw new Error("package.json is missing a string `version`");
  }

  return pkg.version;
}
