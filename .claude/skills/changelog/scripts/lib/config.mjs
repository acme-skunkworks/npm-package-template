// Load the bundle's config.json (issue-ID prefixes, Linear workspace slug, base
// branch, changelog directory, monorepo package mapping). Resolved relative to
// THIS module — `config.json` sits at the bundle root, two levels up from
// scripts/lib/ — not relative to cwd, which is the consumer repo root where the
// `changelog/` directory lives.
//
// Zero-deps: a plain JSON read. Identity values (`issueKeys`,
// `linearWorkspaceSlug`) have NO default — a foreign repo that silently inherited
// ACME's keys/slug would emit wrong issue links and detection, so a missing
// config or a missing identity key FAILS LOUDLY. Structural conventions
// (`baseBranch`, `changelogDir`, `packageRoots`, `fallbackPackage`) keep generic,
// non-ACME defaults a consumer can override; a present-but-mistyped one also fails
// loudly rather than surfacing as a non-actionable crash downstream.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const CONFIG_URL = new URL("../../config.json", import.meta.url);
// fileURLToPath, not CONFIG_URL.pathname: pathname stays percent-encoded and
// carries a leading slash on Windows, so it is wrong for display and for paths.
const CONFIG_PATH = fileURLToPath(CONFIG_URL);

// Generic, non-ACME structural defaults. Applied only when the key is absent;
// every one is overridable in config.json. Mirrored in derive-packages.mjs so
// that function can run standalone — keep the two in sync.
const DEFAULTS = {
  // `affected_packages` only earns its keep in a genuine monorepo. Default it
  // off so single-package repos get clean entries; monorepo consumers (and
  // initialise-skills, when it detects a workspace config) flip it on.
  affectedPackages: false,
  baseBranch: "main",
  changelogDir: "changelog",
  fallbackPackage: "infrastructure",
  packageRoots: ["apps", "packages", "services"],
};

let cached;

function fail(message, source) {
  throw new Error(
    `changelog config: ${message} Set it in ${source} (copy config.example.json and fill it in).`,
  );
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isStringArray(value) {
  return Array.isArray(value) && value.every(isNonEmptyString);
}

/**
 * Validate a raw config JSON string and merge it over the structural defaults.
 * Exported so the fail-loud contract is unit-testable without filesystem setup.
 * @param {string} raw config.json contents
 * @param {string} [source] path shown in error messages
 * @returns {{
 *   issueKeys: string[],
 *   linearWorkspaceSlug: string,
 *   baseBranch: string,
 *   changelogDir: string,
 *   packageRoots: string[],
 *   fallbackPackage: string,
 *   affectedPackages: boolean,
 * }}
 */
export function parseConfig(raw, source = CONFIG_PATH) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    console.error(`Invalid JSON in ${source}: ${error.message}`);
    throw error;
  }

  // JSON.parse can return null/array/primitive; the field checks below would then
  // throw a raw TypeError instead of the actionable config error this surfaces.
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    fail("config.json must contain a JSON object.", source);
  }

  // Required identity values — no default; fail loudly so a consuming repo can't
  // silently ship ACME's issue keys or workspace slug.
  if (
    !Array.isArray(parsed.issueKeys) ||
    parsed.issueKeys.length === 0 ||
    !parsed.issueKeys.every(isNonEmptyString)
  ) {
    fail("`issueKeys` must be a non-empty array of strings.", source);
  }

  if (!isNonEmptyString(parsed.linearWorkspaceSlug)) {
    fail("`linearWorkspaceSlug` must be a non-empty string.", source);
  }

  // Structural keys are optional, but a present value of the wrong type would
  // otherwise crash later (e.g. `packageRoots.map`) with a non-actionable error.
  if ("baseBranch" in parsed && !isNonEmptyString(parsed.baseBranch)) {
    fail("`baseBranch`, when set, must be a non-empty string.", source);
  }

  if ("changelogDir" in parsed && !isNonEmptyString(parsed.changelogDir)) {
    fail("`changelogDir`, when set, must be a non-empty string.", source);
  }

  if ("packageRoots" in parsed && !isStringArray(parsed.packageRoots)) {
    fail("`packageRoots`, when set, must be an array of strings.", source);
  }

  if (
    "fallbackPackage" in parsed &&
    !isNonEmptyString(parsed.fallbackPackage)
  ) {
    fail("`fallbackPackage`, when set, must be a non-empty string.", source);
  }

  if (
    "affectedPackages" in parsed &&
    typeof parsed.affectedPackages !== "boolean"
  ) {
    fail("`affectedPackages`, when set, must be a boolean.", source);
  }

  return { ...DEFAULTS, ...parsed };
}

/**
 * @returns {ReturnType<typeof parseConfig>}
 */
export function loadConfig() {
  if (cached) {
    return cached;
  }

  let raw;
  try {
    raw = readFileSync(CONFIG_URL, "utf8");
  } catch (error) {
    // A missing config.json used to fall back to ACME defaults silently. The
    // identity keys have no safe default, so a foreign repo must be told to
    // create one rather than inherit ACME's values.
    if (error.code === "ENOENT") {
      fail("config.json not found.", CONFIG_PATH);
    }

    throw error;
  }

  cached = parseConfig(raw, CONFIG_PATH);
  return cached;
}
