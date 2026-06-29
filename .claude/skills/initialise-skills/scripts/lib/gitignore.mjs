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
 * Does any line already exclude the entry? Matches by exact string equality after
 * trimming — comment lines start with `#` so they can never match, which is the
 * behaviour we want (a commented-out entry does not gitignore the file). The
 * leading-slash anchored form (`/.preflight-summary.json`) ignores the same
 * root-level path, so it counts as present too — we must not append a duplicate.
 * @param {string} text
 * @returns {boolean}
 */
function hasEntry(text) {
  return text.split(/\r?\n/).some((line) => {
    const trimmed = line.trim();
    return trimmed === IGNORE_ENTRY || trimmed === `/${IGNORE_ENTRY}`;
  });
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
 * @returns {{ path: string, status: "present"|"added"|"created"|"would-add"|"would-create" }}
 */
export function reconcilePreflightIgnore(repoRoot, { write = false } = {}) {
  const gitignorePath = join(repoRoot, ".gitignore");

  if (existsSync(gitignorePath)) {
    const raw = readFileSync(gitignorePath, "utf8");
    if (hasEntry(raw)) {
      return { path: gitignorePath, status: "present" };
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
