// Reconcile infrastructure/repo-config.yaml to the spawned repo's facts (A-663).
//
// The file is comment-heavy YAML consumed by the load-repo-config composite
// action, so we deliberately do NOT round-trip it through a YAML parser (that
// would drop the comments and reflow it). Instead we do a targeted, line-scoped
// value replacement for the only two keys that can legitimately differ per repo —
// `npmScope` and `defaultBranch` — preserving every comment, blank line, and the
// original quoting style. `reconcileRepoConfigText` is a pure string transform.

import { readFileSync, writeFileSync } from "node:fs";

/**
 * The keys this reconcile knows how to update, in file order.
 */
const RECONCILABLE = ["defaultBranch", "npmScope"];

/**
 * Replace the value of a top-level `key: value` line, keeping the key's existing
 * quote style (bare vs `"…"`). Returns the new text and whether it changed.
 * @param {string} text
 * @param {string} key
 * @param {string} value
 * @returns {{ text: string, changed: boolean, from?: string }}
 */
function replaceScalar(text, key, value) {
  // Anchor to a top-level key (no leading indent) so we never touch a nested or
  // commented occurrence. Capture any existing surrounding quotes to preserve them.
  const re = new RegExp(
    `^(${key}:[ \\t]*)(")?([^"\\n#]*?)(")?([ \\t]*(?:#.*)?)$`,
    "m",
  );
  const match = text.match(re);
  if (!match) {
    return { changed: false, text };
  }

  const [, prefix, openQuote = "", currentRaw, closeQuote = "", trailer = ""] =
    match;
  const current = currentRaw.trim();
  if (current === value) {
    return { changed: false, text };
  }

  // Preserve quoting: if the source value was quoted, keep it quoted.
  const quote = openQuote || closeQuote ? '"' : "";
  const replacement = `${prefix}${quote}${value}${quote}${trailer}`;
  // Use a replacer *function* so `$&`, `$1`, etc. in the value are treated
  // literally — `String.replace(re, string)` would interpret them as special
  // substitution sequences and corrupt the output.
  return {
    changed: true,
    from: current,
    text: text.replace(re, () => replacement),
  };
}

/**
 * Apply the reconcilable facts to the YAML text. Only keys present in `facts`
 * with a defined value are considered; unchanged keys are skipped. Returns the new
 * text and a per-key change map (empty when nothing changed → idempotent no-op).
 * @param {string} text
 * @param {{ defaultBranch?: string, npmScope?: string }} facts
 * @returns {{ text: string, changes: Record<string, { from: string, to: string }> }}
 */
export function reconcileRepoConfigText(text, facts) {
  let out = text;
  const changes = {};
  for (const key of RECONCILABLE) {
    const value = facts[key];
    if (typeof value !== "string") {
      continue;
    }

    const result = replaceScalar(out, key, value);
    if (result.changed) {
      out = result.text;
      changes[key] = { from: result.from ?? "", to: value };
    }
  }

  return { changes, text: out };
}

/**
 * fs wrapper: read repo-config.yaml, reconcile, and (when `write`) persist.
 * @param {{ path: string, facts: object, write?: boolean }} opts
 * @returns {{ status: "changed" | "would-change" | "unchanged",
 *   changes: Record<string, { from: string, to: string }> }}
 */
export function reconcileRepoConfig({ facts, path, write = false }) {
  const { changes, text } = reconcileRepoConfigText(
    readFileSync(path, "utf8"),
    facts,
  );
  const changed = Object.keys(changes).length > 0;
  if (changed && write) {
    writeFileSync(path, text);
  }

  return {
    changes,
    status: changed ? (write ? "changed" : "would-change") : "unchanged",
  };
}
