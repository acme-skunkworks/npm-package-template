// Zero-deps YAML-frontmatter parser/serialiser for the changelog corpus.
//
// Carries no third-party npm import so it can be lifted wholesale into this
// skill bundle. It is NOT a general YAML implementation — it handles exactly the
// subset the changelog frontmatter uses:
//
//   - plain / single- / double-quoted string scalars
//   - integers, booleans, the `null` literal, and bare `key:` (-> null)
//   - one folded/literal block scalar (`>-` `>` `|` `|-`) for `release_note`
//   - inline arrays (`[]`, `["a", b]`) and block arrays (`- item`)
//   - one level of nested mapping (`stats:`)
//
// API mirrors gray-matter's so call sites change minimally:
//   parseFrontmatter(raw)            -> { data, content }
//   stringifyFrontmatter(content, d) -> "---\n<yaml>\n---\n<content>"

const FENCE = "---";

// --- parsing ---------------------------------------------------------------

function indentOf(line) {
  return line.length - line.trimStart().length;
}

// Parse a scalar token (the text after `key:` or an array item).
function parseScalar(token) {
  const text = token.trim();
  if (text === "" || text === "null" || text === "~") {
    return null;
  }

  if (text === "true") {
    return true;
  }

  if (text === "false") {
    return false;
  }

  if (/^-?\d+$/.test(text)) {
    return Number.parseInt(text, 10);
  }

  if (text.startsWith("'") && text.endsWith("'") && text.length >= 2) {
    return text.slice(1, -1).replaceAll("''", "'");
  }

  if (text.startsWith('"') && text.endsWith('"') && text.length >= 2) {
    // Unescape in a single left-to-right pass so an escaped backslash (`\\`)
    // can't have its trailing char re-consumed by a later rule (e.g. `\\n`
    // must become `\n`, not a newline).
    return text
      .slice(1, -1)
      .replaceAll(/\\(.)/g, (_, char) => (char === "n" ? "\n" : char));
  }

  return text;
}

// Split an inline-array body on top-level commas only — commas inside single-
// or double-quoted strings are preserved (e.g. `"Smith, Jr. <a@b>"` stays one
// item). Mirrors parseScalar's quoting: `''` is an escaped quote inside single
// quotes, `\` escapes inside double quotes.
function splitInlineItems(inner) {
  const items = [];
  let current = "";
  /** @type {"'"|'"'|null} */
  let quote = null;
  for (let index = 0; index < inner.length; index++) {
    const ch = inner[index];
    if (quote === '"') {
      current += ch;
      if (ch === "\\" && index + 1 < inner.length) {
        current += inner[++index];
      } else if (ch === '"') {
        quote = null;
      }
    } else if (quote === "'") {
      current += ch;
      if (ch === "'") {
        if (inner[index + 1] === "'") {
          current += inner[++index];
        } else {
          quote = null;
        }
      }
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
    } else if (ch === ",") {
      items.push(current);
      current = "";
    } else {
      current += ch;
    }
  }

  // A non-null `quote` here means the closing quote was never seen — the array
  // body ended mid-string. Pushing `current` would fold the dangling opening
  // quote into the parsed value; fail loudly instead.
  if (quote !== null) {
    throw new Error(`Unterminated quoted item in inline array: ${inner}`);
  }

  items.push(current);
  return items;
}

// Parse an inline array body (the text between the surrounding brackets).
function parseInlineArray(body) {
  const inner = body.trim();
  if (inner === "") {
    return [];
  }

  return splitInlineItems(inner).map((item) => parseScalar(item));
}

// Collect an indented block following a `key:` / block-scalar header, returning
// the consumed lines (those more indented than `parentIndent`) and the next index.
function collectBlock(lines, start, parentIndent) {
  const block = [];
  let index = start;
  while (index < lines.length) {
    const line = lines[index];
    if (line.trim() === "") {
      block.push(line);
      index++;
      continue;
    }

    if (indentOf(line) <= parentIndent) {
      break;
    }

    block.push(line);
    index++;
  }

  // Drop trailing blank lines that belong to the gap before the next key.
  while (block.length > 0 && block.at(-1).trim() === "") {
    block.pop();
  }

  return { block, next: index };
}

// Fold/keep a block scalar per its indicator (`>` folds newlines to spaces,
// `|` keeps them; a trailing `-` strips the final newline, which we always do
// here since the corpus only ever uses `>-`).
function parseBlockScalar(indicator, block) {
  // An empty block — or one whose lines are all whitespace — has no content to
  // dedent. `Math.min(...[])` is `Infinity`, which would slice every line down
  // to "" and silently collapse the block, so treat both cases as empty.
  const nonBlank = block.filter((line) => line.trim() !== "");
  if (nonBlank.length === 0) {
    return "";
  }

  const minIndent = Math.min(...nonBlank.map((line) => indentOf(line)));
  const dedented = block.map((line) => line.slice(minIndent));
  const folded = indicator.startsWith(">");
  return folded
    ? dedented.join(" ").replaceAll(/\s+/g, " ").trim()
    : dedented.join("\n");
}

function parseMapping(lines, startIndent) {
  const data = {};
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (line.trim() === "") {
      index++;
      continue;
    }

    const colon = line.indexOf(":");
    if (colon === -1) {
      // No `:` means malformed input (or a mis-routed block-array item). Fail
      // loudly: silently slicing on colon === -1 mangles the key/value and
      // produces a confusing downstream validation error instead.
      throw new Error(
        `Invalid frontmatter line (expected "key: value"): ${line}`,
      );
    }

    const key = line.slice(indentOf(line), colon).trim();
    const rest = line.slice(colon + 1).trim();
    index++;

    if (
      rest === "" ||
      rest === ">" ||
      rest === ">-" ||
      rest === "|" ||
      rest === "|-"
    ) {
      const { block, next } = collectBlock(lines, index, startIndent);
      index = next;
      if (rest === "") {
        // Could be a block array, a nested mapping, or a bare null.
        if (block.length === 0) {
          data[key] = null;
        } else {
          // Decide array-vs-mapping from the first *non-blank* line: collectBlock
          // preserves a blank line between `key:` and the first `- item`, so
          // keying off `block[0]` would misroute such a block into parseMapping()
          // and throw on the `- item` lines.
          const firstContent = block.find(
            (blockLine) => blockLine.trim() !== "",
          );
          if (
            firstContent?.trimStart().startsWith("- ") ||
            firstContent?.trim() === "-"
          ) {
            // Drop interior blank lines before mapping: a block array with blank
            // lines between items would otherwise yield spurious `null` entries
            // (each blank line parses as the empty scalar -> `null`).
            data[key] = block
              .filter((blockLine) => blockLine.trim() !== "")
              .map((blockLine) =>
                parseScalar(blockLine.trimStart().replace(/^-\s?/, "")),
              );
          } else {
            const childIndent = indentOf(firstContent ?? block[0]);
            data[key] = parseMapping(block, childIndent);
          }
        }
      } else {
        data[key] = parseBlockScalar(rest, block);
      }

      continue;
    }

    if (rest.startsWith("[") && rest.endsWith("]")) {
      data[key] = parseInlineArray(rest.slice(1, -1));
      continue;
    }

    // Inline empty mapping. The serialiser emits `{}` for an empty object (the
    // symmetric counterpart of `[]` for an empty array); a non-empty mapping is
    // always written in block form, so `{}` is the only inline object to parse.
    // Without this, `stats: {}` would fall through to parseScalar and parse back
    // as the literal string "{}", silently corrupting an empty stats object.
    if (rest === "{}") {
      data[key] = {};
      continue;
    }

    data[key] = parseScalar(rest);
  }

  return data;
}

// Matches a leading `---` fence, the frontmatter body (group 1, non-greedy up to
// the first closing fence on its own line), the closing fence, and its trailing
// newline. `content` is the exact remainder, so the markdown body is preserved
// byte-for-byte and round-trips are idempotent — only the frontmatter is rewritten.
const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*\r?\n?/;

export function parseFrontmatter(raw) {
  const text = raw.startsWith("﻿") ? raw.slice(1) : raw;
  const match = FRONTMATTER_RE.exec(text);
  if (!match) {
    return { content: text, data: {} };
  }

  const fmLines = match[1].split("\n");
  const content = text.slice(match[0].length);
  return { content, data: parseMapping(fmLines, 0) };
}

// --- serialising -----------------------------------------------------------

const INDICATORS = new Set([
  "!",
  '"',
  "#",
  "%",
  "&",
  "'",
  "*",
  ",",
  "-",
  ":",
  ">",
  "?",
  "@",
  "[",
  "]",
  "`",
  "{",
  "|",
  "}",
]);

function reparsesAsNonString(string_) {
  // True when an unquoted emit of this string would parse back as something
  // other than a string (bool/int/null) or as a date-shaped token worth quoting.
  if (
    string_ === "" ||
    string_ === "null" ||
    string_ === "~" ||
    string_ === "true" ||
    string_ === "false"
  ) {
    return true;
  }

  if (/^-?\d+$/.test(string_)) {
    return true;
  }

  return /^\d{4}-\d{2}-\d{2}/.test(string_);
}

function needsQuoting(string_) {
  if (string_.length === 0) {
    return true;
  }

  if (string_ !== string_.trim()) {
    return true;
  }

  if (INDICATORS.has(string_[0]) || string_.startsWith("- ")) {
    return true;
  }

  if (
    string_.includes(": ") ||
    string_.includes(" #") ||
    string_.includes("\n")
  ) {
    return true;
  }

  return reparsesAsNonString(string_);
}

function serialiseString(string_) {
  if (!needsQuoting(string_)) {
    return string_;
  }

  if (string_.includes("\n")) {
    const escaped = string_
      .replaceAll("\\", "\\\\")
      .replaceAll('"', '\\"')
      .replaceAll("\n", "\\n");
    return `"${escaped}"`;
  }

  return `'${string_.replaceAll("'", "''")}'`;
}

function serialiseScalar(value) {
  if (value === null || value === undefined) {
    return "";
  }

  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }

  if (typeof value === "number") {
    return String(value);
  }

  return serialiseString(String(value));
}

function serialiseValue(key, value, lines) {
  if (Array.isArray(value)) {
    if (value.length === 0) {
      lines.push(`${key}: []`);
      return;
    }

    lines.push(`${key}:`);
    for (const item of value) {
      lines.push(`  - ${serialiseScalar(item)}`);
    }

    return;
  }

  if (value !== null && typeof value === "object") {
    const childEntries = Object.entries(value);
    // Emit `{}` for an empty mapping so it round-trips as an object, mirroring
    // `[]` for an empty array. A bare `key:` would re-parse as null, silently
    // turning an empty `stats: {}` into `stats: null`.
    if (childEntries.length === 0) {
      lines.push(`${key}: {}`);
      return;
    }

    lines.push(`${key}:`);
    for (const [childKey, childValue] of childEntries) {
      const child = serialiseScalar(childValue);
      lines.push(child === "" ? `  ${childKey}:` : `  ${childKey}: ${child}`);
    }

    return;
  }

  const emitted = serialiseScalar(value);
  lines.push(emitted === "" ? `${key}:` : `${key}: ${emitted}`);
}

export function stringifyFrontmatter(content, data) {
  const lines = [];
  for (const [key, value] of Object.entries(data)) {
    serialiseValue(key, value, lines);
  }

  return `${FENCE}\n${lines.join("\n")}\n${FENCE}\n${content}`;
}
