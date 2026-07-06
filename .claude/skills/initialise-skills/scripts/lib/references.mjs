// Parse references/detectable-keys.md into a per-key description map, so the
// read-only `--review` report can annotate each config key with what it is and
// where its value comes from (A-702).
//
// The reference doc is a single GFM pipe table whose columns are fixed:
//   | Key | Used by | Detection source | Fallback / when undetectable |
// We key on the first cell (a backticked config-key name) and keep the other
// three cells as human descriptions. Everything outside the table — the intro
// prose and the `## Notes` section — is ignored.

import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The bundled reference file: two `dirname` hops from scripts/lib/ reach the
 * bundle root, then references/detectable-keys.md.
 * @returns {string}
 */
export function defaultReferencePath() {
  const here = import.meta.dirname; // scripts/lib
  return join(here, "..", "..", "references", "detectable-keys.md");
}

/**
 * Split one GFM table row into trimmed cell strings, tolerating the optional
 * leading/trailing pipe. Escaped pipes (`\|`) inside a cell are unlikely in this
 * doc, but preserve them by only splitting on unescaped `|`.
 * @param {string} row
 * @returns {string[]}
 */
function splitRow(row) {
  const cells = row
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split(/(?<!\\)\|/)
    .map((cell) => cell.replaceAll("\\|", "|").trim());
  return cells;
}

/**
 * A row is a real key row only when its first cell is a single backticked token
 * (e.g. `` `baseBranch` ``). This skips the header, the `| --- |` separator, and
 * any stray prose that happens to contain a pipe.
 * @param {string} firstCell
 * @returns {string | null} the unwrapped key name, or null if not a key row
 */
function keyFromCell(firstCell) {
  const match = /^`([^`]+)`$/.exec(firstCell.trim());
  return match ? match[1] : null;
}

/**
 * Parse the detectable-keys markdown into a map of key → description fields.
 * @param {string} markdown
 * @returns {Map<string, { usedBy: string, detectionSource: string, fallback: string }>}
 */
export function parseDetectableKeys(markdown) {
  const map = new Map();
  if (typeof markdown !== "string") {
    return map;
  }

  for (const line of markdown.split("\n")) {
    if (!line.includes("|")) {
      continue;
    }

    const cells = splitRow(line);
    if (cells.length < 4) {
      continue;
    }

    const key = keyFromCell(cells[0]);
    if (!key) {
      continue;
    }

    map.set(key, {
      detectionSource: cells[2],
      fallback: cells[3],
      usedBy: cells[1],
    });
  }

  return map;
}

/**
 * Read and parse the bundled reference doc. Never throws into the CLI: a
 * missing or unreadable file yields an empty map, so `--review` still runs and
 * simply omits descriptions.
 * @param {string} [referencePath]
 * @returns {ReturnType<typeof parseDetectableKeys>}
 */
export function loadDetectableKeys(referencePath = defaultReferencePath()) {
  let markdown;
  try {
    markdown = readFileSync(referencePath, "utf8");
  } catch {
    return new Map();
  }

  return parseDetectableKeys(markdown);
}
