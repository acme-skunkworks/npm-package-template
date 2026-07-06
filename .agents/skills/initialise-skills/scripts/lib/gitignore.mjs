// Ensure the consumer repo's root .gitignore excludes preflight's scratch output (A-569).
//
// The `preflight` skill writes `.preflight-summary.json` to the repo root on every
// real run. Consumer repos don't ignore it, so after a `/send-it` run (which invokes
// preflight) the file surfaces as an untracked change and `gh pr create` warns.
//
// This is the ONE mutation initialise-skills makes outside a skill's config.json:
// an append-only, idempotent edit to the root .gitignore — it never reorders or
// removes existing lines, and is a no-op once the entry is present. It runs only
// when `preflight` (the producer of the file) is installed.
//
// Zero-deps: plain string work, no formatter dependency.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const IGNORE_ENTRY = ".preflight-summary.json";
export const IGNORE_COMMENT =
  "# preflight skill scratch output (written at the repo root on each run)";

/**
 * Classify how the .gitignore already settles the entry, honouring `.gitignore`'s
 * last-match-wins rule: the LAST line referencing the path decides. Matches by
 * exact string equality after trimming — comment lines start with `#` so they can
 * never match (a commented-out entry does not gitignore the file). The
 * leading-slash anchored forms (`/.preflight-summary.json`, `!/…`) target the same
 * root-level path and are treated identically. Returns:
 *   - `"positive"` — an ignore rule wins, so the file is excluded;
 *   - `"negated"`  — a deliberate un-ignore (`!.preflight-summary.json`) wins;
 *   - `"absent"`   — no line references the path.
 *
 * Both `"positive"` and `"negated"` count as already-handled: the reconcile is
 * intent-preserving and append-only, and appending a positive rule after a
 * deliberate negation would silently flip the consumer's choice (A-582). The two
 * are reported distinctly so a deliberate un-ignore isn't mislabelled "already
 * ignored" (A-613).
 * @param {string} text
 * @returns {"positive"|"negated"|"absent"}
 */
function classifyEntry(text) {
  let verdict = "absent";
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === IGNORE_ENTRY || trimmed === `/${IGNORE_ENTRY}`) {
      verdict = "positive";
    } else if (
      trimmed === `!${IGNORE_ENTRY}` ||
      trimmed === `!/${IGNORE_ENTRY}`
    ) {
      verdict = "negated";
    }
  }

  return verdict;
}

/**
 * Detect the line-ending so a CRLF .gitignore round-trips as CRLF rather than
 * being rewritten with LF on the append (mirrors jsonio.mjs).
 * @param {string} raw
 * @returns {string}
 */
function detectNewline(raw) {
  return raw.includes("\r\n") ? "\r\n" : "\n";
}

/**
 * Reconcile the host repo's root .gitignore so it excludes `.preflight-summary.json`.
 * Idempotent and append-only. With `write:false` (the default) it reports the
 * action it WOULD take without touching disk.
 * @param {string} repoRoot
 * @param {{ write?: boolean }} [options]
 * @returns {{ path: string, status: "present"|"negated"|"added"|"created"|"would-add"|"would-create" }}
 */
export function reconcilePreflightIgnore(repoRoot, { write = false } = {}) {
  const gitignorePath = join(repoRoot, ".gitignore");

  if (existsSync(gitignorePath)) {
    const raw = readFileSync(gitignorePath, "utf8");
    const verdict = classifyEntry(raw);
    if (verdict === "positive") {
      return { path: gitignorePath, status: "present" };
    }

    if (verdict === "negated") {
      // A deliberate un-ignore already settles the path — leave it untouched
      // (A-582), but report it distinctly so it doesn't read as "already
      // ignored" (A-613).
      return { path: gitignorePath, status: "negated" };
    }

    if (!write) {
      return { path: gitignorePath, status: "would-add" };
    }

    const nl = detectNewline(raw);
    // Newline-terminate the existing content, then append the commented entry with
    // a blank-line separator — matching the block style agent-skills uses in its
    // own .gitignore. The separator is skipped for an empty file.
    let next = raw;
    if (next.length && !next.endsWith(nl)) {
      next += nl;
    }

    const separator = next.length ? nl : "";
    next += `${separator}${IGNORE_COMMENT}${nl}${IGNORE_ENTRY}${nl}`;
    writeFileSync(gitignorePath, next);
    return { path: gitignorePath, status: "added" };
  }

  if (!write) {
    return { path: gitignorePath, status: "would-create" };
  }

  // A brand-new file always uses LF — there's no existing content to match, and
  // LF is correct for new files on every non-Windows target.
  writeFileSync(gitignorePath, `${IGNORE_COMMENT}\n${IGNORE_ENTRY}\n`);
  return { path: gitignorePath, status: "created" };
}
