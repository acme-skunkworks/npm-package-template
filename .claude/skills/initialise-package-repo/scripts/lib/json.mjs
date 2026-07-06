// Format-preserving JSON read/serialise for the small config files this skill
// edits (package.json, .release-please-manifest.json).
//
// The reconcile must be idempotent: a re-run with nothing to change has to leave
// the file byte-for-byte identical, or `git status` churns. So we capture the
// source indentation, line-ending and trailing newline and reapply them, rather
// than letting `JSON.stringify` reflow the whole file to its own defaults.
//
// Zero-deps: plain JSON + string work, no formatter dependency. This is a
// deliberately separate copy from the initialise-skills bundle's jsonio.mjs —
// each skill bundle is independently vendored, so they must not import one
// another's internals.

/**
 * @typedef {{
 *   data: unknown,
 *   indent: number | string,
 *   newline: string,
 *   trailingNewline: boolean,
 * }} ParsedJson
 */

/**
 * Detect the line-ending style so a CRLF file round-trips as CRLF (JSON.stringify
 * always emits `\n`).
 * @param {string} raw
 * @returns {string}
 */
function detectNewline(raw) {
  return raw.includes("\r\n") ? "\r\n" : "\n";
}

/**
 * Detect the indentation of the first indented line, in the form `JSON.stringify`
 * takes for its `space` argument: a space count, or `"\t"` for tab indent.
 * Defaults to 2 (the repo convention) for an empty or single-line object.
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
 * Parse a JSON string, capturing the formatting facts needed to round-trip it.
 * @param {string} raw
 * @returns {ParsedJson}
 */
export function parseJson(raw) {
  return {
    data: JSON.parse(raw),
    indent: detectIndent(raw),
    newline: detectNewline(raw),
    trailingNewline: raw.endsWith("\n"),
  };
}

/**
 * Serialise `data` using the formatting captured from `parsed`, so an unchanged
 * document re-serialises to the same bytes.
 * @param {ParsedJson} parsed
 * @param {unknown} data
 * @returns {string}
 */
export function serialiseJson(parsed, data) {
  let body = JSON.stringify(data, null, parsed.indent);
  if (parsed.newline !== "\n") {
    body = body.replaceAll("\n", parsed.newline);
  }

  return parsed.trailingNewline ? `${body}${parsed.newline}` : body;
}
