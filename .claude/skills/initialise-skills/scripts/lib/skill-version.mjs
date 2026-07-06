// Read each installed skill bundle's version, for the skills.lock inventory (A-616).
//
// The lock records the version of every installed bundle so a consumer (and WS3's
// push fleet-update orchestrator) can tell which skills are behind. The canonical
// version label is a bundle's SKILL.md `metadata.version` — the value consumers'
// runtime introspection reads — so that is what we read primary, falling back to
// the package.json `version` when SKILL.md carries none. The two are held equal by
// the CI parity guard (infrastructure/scripts/validate-skills.ts), so the fallback
// is faithful rather than a second source of truth.
//
// Zero-deps: a scoped frontmatter scan (no YAML dependency — the bundle travels
// without node_modules), not a full parser. We need exactly one scalar, so lifting
// the changelog bundle's ~420-line frontmatter reader would be dead weight and new
// vendor-sync surface.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Extract `metadata.version` from a SKILL.md's YAML frontmatter without a YAML
 * parser. Scopes to the leading `---`…`---` block, finds the top-level
 * `metadata:` mapping, then its indented `version:` child — stopping at the first
 * line that dedents back to column 0 (a new top-level key). Tolerates quoted
 * values. Returns null when there's no frontmatter, no `metadata:` block, or no
 * `version:` under it.
 * @param {string} skillMdText
 * @returns {string | null}
 */
export function parseSkillVersion(skillMdText) {
  const lines = skillMdText.split(/\r?\n/);
  // Frontmatter must open on the very first line with a `---` fence.
  if (lines[0]?.trim() !== "---") {
    return null;
  }

  let inMetadata = false;
  // The indent of `metadata:`'s DIRECT children, set by the first non-blank child.
  // We only accept `version:` at exactly that depth so a nested mapping's own
  // `version:` (e.g. a `build:`/`engines:` sub-block) can't be mistaken for
  // `metadata.version` and feed a wrong value into skills.lock.
  let childIndent = null;
  for (let index = 1; index < lines.length; index++) {
    const line = lines[index];
    const trimmed = line.trim();

    // Closing fence — end of frontmatter, give up.
    if (trimmed === "---") {
      return null;
    }

    const indented = /^\s/.test(line);
    if (!inMetadata) {
      // Look for the top-level `metadata:` key (no leading indent).
      if (!indented && /^metadata:\s*$/.test(trimmed)) {
        inMetadata = true;
      }

      continue;
    }

    // Inside the metadata block. A non-indented, non-empty line starts a new
    // top-level key — the block is over.
    if (!indented && trimmed !== "") {
      return null;
    }

    // A blank line neither ends the block nor establishes the child indent.
    if (trimmed === "") {
      continue;
    }

    const indent = line.length - line.trimStart().length;
    if (childIndent === null) {
      childIndent = indent;
    } else if (indent !== childIndent) {
      // A deeper (nested) or shallower line is not a direct child of metadata.
      continue;
    }

    // Anchor the capture on a non-space (`\S`) so `\s*` and the capture can't
    // both consume the same whitespace — avoids the ambiguous backtracking a
    // `\s*(.+)` pattern trips. `trimmed` has no trailing space, so `.*$` is exact.
    const match = /^version:\s*(\S.*)$/.exec(trimmed);
    if (match) {
      return unquote(match[1]);
    }
  }

  return null;
}

/**
 * Strip a single layer of matching single or double quotes from a scalar.
 * @param {string} value
 * @returns {string}
 */
function unquote(value) {
  const match = /^(['"])(.*)\1$/.exec(value);
  return match ? match[2] : value;
}

/**
 * Read a bundle's version: SKILL.md `metadata.version` primary, package.json
 * `version` fallback. Null when neither yields a version (or the dir is unreadable).
 * @param {string} bundleDirectory absolute path to a `skills/<name>/` bundle
 * @returns {string | null}
 */
export function readBundleVersion(bundleDirectory) {
  const skillPath = join(bundleDirectory, "SKILL.md");
  if (existsSync(skillPath)) {
    try {
      const version = parseSkillVersion(readFileSync(skillPath, "utf8"));
      if (version) {
        return version;
      }
    } catch {
      // Unreadable SKILL.md — fall through to package.json.
    }
  }

  const manifestPath = join(bundleDirectory, "package.json");
  if (existsSync(manifestPath)) {
    try {
      const version = JSON.parse(readFileSync(manifestPath, "utf8")).version;
      if (typeof version === "string") {
        return version;
      }
    } catch {
      // Malformed package.json — no version to report.
    }
  }

  return null;
}

/**
 * Inventory every installed bundle's version, keyed by directory name. A bundle
 * is any subdirectory of `skillsDirectory` that ships a SKILL.md — the same
 * marker `isPreflightInstalled` keys on. Unlike `discoverSkills()` (which filters
 * to config-bearing bundles), this is a FULL inventory: `initialise-skills` and
 * `preflight` are included, because the lock records what is installed, not what
 * gets a config reconciled. Keys are returned in sorted order for determinism.
 * @param {string} skillsDirectory
 * @returns {Record<string, string | null>}
 */
export function readInstalledVersions(skillsDirectory) {
  if (!existsSync(skillsDirectory)) {
    return {};
  }

  const names = readdirSync(skillsDirectory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => existsSync(join(skillsDirectory, name, "SKILL.md")))
    .toSorted((a, b) => a.localeCompare(b));

  /** @type {Record<string, string | null>} */
  const versions = {};
  for (const name of names) {
    versions[name] = readBundleVersion(join(skillsDirectory, name));
  }

  return versions;
}
