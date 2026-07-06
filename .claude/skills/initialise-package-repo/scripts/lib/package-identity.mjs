// Rewrite the identity block of a spawned repo's package.json (A-663).
//
// Only the identity fields are touched — name, description, keywords, repository,
// homepage, bugs — never the dependency/script/tooling shell (that is the same
// for every package and must not drift). `applyIdentity` is a pure object→object
// transform returning `{ data, changed }`; the fs wrapper round-trips the file
// with `json.mjs` so an unchanged package.json re-serialises byte-identically.

import { parseJson, serialiseJson } from "./json.mjs";
import { PLACEHOLDER_NAME } from "./repo-facts.mjs";
import { readFileSync, writeFileSync } from "node:fs";

/**
 * Whether package.json still carries the template's placeholder name — i.e. this
 * repo has not been renamed yet. Used as the idempotency signal: once renamed, the
 * identity op is a no-op so a re-run never clobbers a customised name.
 * @param {unknown} name
 * @returns {boolean}
 */
export function isPlaceholderName(name) {
  return name === PLACEHOLDER_NAME;
}

/**
 * Apply the derived identity onto a parsed package.json object, returning a new
 * object plus whether anything changed. `keywords` is only overwritten when the
 * caller supplies a non-empty array — leaving the template defaults in place (to
 * be flagged for manual input) is preferable to inventing keywords.
 * @param {Record<string, unknown>} pkg
 * @param {{ name: string, description: string, keywords?: string[],
 *   homepage: string, bugsUrl: string, repositoryUrl: string }} identity
 * @returns {{ data: Record<string, unknown>, changed: boolean }}
 */
export function applyIdentity(pkg, identity) {
  const next = { ...pkg };
  next.name = identity.name;
  next.description = identity.description;
  if (Array.isArray(identity.keywords) && identity.keywords.length > 0) {
    next.keywords = identity.keywords;
  }

  next.homepage = identity.homepage;
  next.bugs = {
    ...(isPlainObject(pkg.bugs) ? pkg.bugs : {}),
    url: identity.bugsUrl,
  };
  next.repository = {
    ...(isPlainObject(pkg.repository) ? pkg.repository : {}),
    type:
      isPlainObject(pkg.repository) && typeof pkg.repository.type === "string"
        ? pkg.repository.type
        : "git",
    url: identity.repositoryUrl,
  };

  return { changed: JSON.stringify(pkg) !== JSON.stringify(next), data: next };
}

/**
 * fs wrapper: read package.json, apply the identity, and (when `write`) persist.
 * Skips entirely when the name is no longer the placeholder — the repo is already
 * customised — reporting `unchanged` so the op is a safe no-op on re-run.
 * @param {{ packageJsonPath: string, identity: object, write?: boolean }} opts
 * @returns {{ status: "changed" | "would-change" | "unchanged" | "already-customised",
 *   name: string }}
 */
export function reconcilePackageIdentity({
  identity,
  packageJsonPath,
  write = false,
}) {
  const parsed = parseJson(readFileSync(packageJsonPath, "utf8"));
  const pkg = parsed.data;

  if (!isPlaceholderName(pkg.name)) {
    return { name: String(pkg.name), status: "already-customised" };
  }

  const { changed, data } = applyIdentity(pkg, identity);
  if (!changed) {
    return { name: String(pkg.name), status: "unchanged" };
  }

  if (write) {
    writeFileSync(packageJsonPath, serialiseJson(parsed, data));
  }

  return { name: identity.name, status: write ? "changed" : "would-change" };
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
