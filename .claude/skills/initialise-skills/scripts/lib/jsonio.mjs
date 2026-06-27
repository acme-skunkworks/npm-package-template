// Order-preserving read/serialise for a skill's config.json (A-409).
//
// The reconcile must be idempotent: a second run with no new facts has to leave
// every config.json byte-for-byte identical, or `git status` would churn and the
// "never clobber" promise would ring hollow. So writes mutate only the keys that
// changed, keep the consumer's existing key ORDER, append any newly-inferred keys
// at the end, and preserve the file's indentation and trailing newline.
//
// Zero-deps: plain JSON + string work, no formatter dependency.

import { readFileSync } from "node:fs";

/**
 * A parsed config.json plus the formatting facts needed to round-trip it without
 * reflowing untouched keys.
 * @typedef {{
 *   exists: boolean,
 *   data: Record<string, unknown>,
 *   keyOrder: string[],
 *   indent: number | string,
 *   newline: string,
 *   trailingNewline: boolean,
 * }} ParsedConfig
 */

/**
 * Detect the line-ending style so a CRLF file round-trips as CRLF. `JSON.stringify`
 * always emits `\n`, so without this a Windows checkout would be rewritten with LF
 * on the first write, breaking the byte-identical promise.
 * @param {string} raw
 * @returns {string}
 */
function detectNewline(raw) {
  return raw.includes("\r\n") ? "\r\n" : "\n";
}

/**
 * Detect the indentation of the first indented line, as the value `JSON.stringify`
 * takes for its `space` argument: a space count, or `"\t"` for a tab indent.
 * Preserving tabs keeps a tab-indented config byte-identical on a no-op write
 * (the idempotency promise) instead of silently converting it to spaces. Defaults
 * to 2 — the repo convention — when the object is empty or single-line.
 * @param {string} raw
 * @returns {number | string}
 */
function detectIndent(raw) {
  const match = raw.match(/\n([ \t]+)\S/);
  if (!match) {
    return 2;
  }

  const ws = match[1];
  return ws.startsWith("\t") ? "\t" : ws.length;
}

/**
 * Parse a config.json string, capturing key order + formatting. A malformed or
 * non-object body throws — callers decide whether to skip the file.
 * @param {string} raw
 * @returns {ParsedConfig}
 */
export function parseConfig(raw) {
  const data = JSON.parse(raw);
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("config.json must contain a JSON object");
  }

  return {
    data,
    exists: true,
    indent: detectIndent(raw),
    keyOrder: Object.keys(data),
    newline: detectNewline(raw),
    trailingNewline: raw.endsWith("\n"),
  };
}

/**
 * Read a config.json from disk. A missing file yields an empty, writable shape so
 * the merge can treat "no config yet" uniformly with "config present".
 * @param {string} path
 * @returns {ParsedConfig}
 */
export function readConfig(path) {
  let raw;
  try {
    raw = readFileSync(path, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") {
      return {
        data: {},
        exists: false,
        indent: 2,
        keyOrder: [],
        newline: "\n",
        trailingNewline: true,
      };
    }

    throw error;
  }

  return parseConfig(raw);
}

/**
 * Serialise an updated config, preserving the original key order and appending
 * any keys not seen before (in the order given by `appendOrder`, else insertion
 * order of `data`). Indentation and trailing newline match `parsed`.
 * @param {ParsedConfig} parsed the original parsed config (for order + formatting)
 * @param {Record<string, unknown>} data the full key/value set to write
 * @param {string[]} [appendOrder] preferred order for keys new to the file
 * @returns {string}
 */
export function serialiseConfig(parsed, data, appendOrder = []) {
  const seen = new Set(parsed.keyOrder);
  const ordered = {};

  // 1. Existing keys, in their original order, that survive in `data`.
  for (const key of parsed.keyOrder) {
    if (key in data) {
      ordered[key] = data[key];
    }
  }

  // 2. New keys, preferring `appendOrder`, then any remaining insertion order.
  const newKeys = Object.keys(data).filter((key) => !seen.has(key));
  const orderedNew = [
    ...appendOrder.filter((key) => newKeys.includes(key)),
    ...newKeys.filter((key) => !appendOrder.includes(key)),
  ];
  for (const key of orderedNew) {
    ordered[key] = data[key];
  }

  let body = JSON.stringify(ordered, null, parsed.indent);
  // JSON.stringify always emits LF; reapply the source line-ending so a CRLF file
  // stays CRLF (and the trailing newline matches too).
  if (parsed.newline !== "\n") {
    body = body.replaceAll("\n", parsed.newline);
  }

  return parsed.trailingNewline ? `${body}${parsed.newline}` : body;
}
