// Ensure the consumer repo's root .gitignore is correct for installed skills:
//
// 1. Preflight scratch (A-569): append .preflight-summary.json when preflight is
//    installed (append-only, idempotent).
// 2. Skill-config ignore strip (A-812): remove erroneous consumer rules that
//    gitignore vendored skill config.json under .claude/.agents (those patterns
//    belong only in the agent-skills source repo and the npm-package-template
//    seed). In a consumer the resolved config.json must be committed.
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

/**
 * Consumer patterns that must not ignore resolved skill config.json (A-812).
 */
export const SKILL_CONFIG_IGNORE_PATTERNS = [
  ".claude/skills/*/config.json",
  ".agents/skills/*/config.json",
  "/.claude/skills/*/config.json",
  "/.agents/skills/*/config.json",
];

/**
 * Comment lines that document the (consumer-incorrect) skill-config ignore.
 * Matches the start of the block; wrap lines are consumed by look-ahead.
 * @param {string} trimmed
 * @returns {boolean}
 */
function isSkillConfigIgnoreComment(trimmed) {
  if (!trimmed.startsWith("#")) {
    return false;
  }

  const lower = trimmed.toLowerCase();
  return (
    lower.includes("a-640") ||
    lower.includes("a-812") ||
    lower.includes("generated-config") ||
    lower.includes("template-seed") ||
    (lower.includes("config.json") &&
      (lower.includes("initialise-skills") ||
        lower.includes("per-skill agent-skills") ||
        lower.includes("not committed") ||
        lower.includes("resolved skill")))
  );
}

/**
 * @param {string} trimmed
 * @returns {boolean}
 */
function isSkillConfigIgnorePattern(trimmed) {
  return SKILL_CONFIG_IGNORE_PATTERNS.includes(trimmed);
}

/**
 * Plan stripping erroneous skill-config ignore rules from a .gitignore body.
 * Pure — no I/O.
 * @param {string} raw
 * @returns {{ changed: boolean, removed: string[], text: string }}
 */
export function planSkillConfigIgnoreStrip(raw) {
  const nl = detectNewline(raw);
  const lines = raw.split(/\r?\n/);
  const removed = [];
  const kept = [];

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const trimmed = line.trim();

    if (isSkillConfigIgnorePattern(trimmed)) {
      removed.push(trimmed);
      continue;
    }

    if (isSkillConfigIgnoreComment(trimmed)) {
      let look = index + 1;
      while (look < lines.length) {
        const ahead = lines[look].trim();
        if (ahead === "" || ahead.startsWith("#")) {
          look++;
          continue;
        }

        break;
      }

      if (
        look < lines.length &&
        isSkillConfigIgnorePattern(lines[look].trim())
      ) {
        removed.push(trimmed);
        // Record intervening comment wrap lines for the audit trail; blanks are
        // dropped silently. The pattern itself is removed on its own iteration.
        for (let skip = index + 1; skip < look; skip++) {
          const skipped = lines[skip].trim();
          if (skipped.startsWith("#")) {
            removed.push(skipped);
          }
        }

        index = look - 1;
        continue;
      }
    }

    kept.push(line);
  }

  // Only tidy blank runs when we actually stripped something — otherwise a
  // file with consecutive blanks but no skill-config patterns would spuriously
  // report changed/would-strip.
  let text;
  if (removed.length === 0) {
    text = raw;
  } else {
    // Collapse consecutive blank lines left by the strip down to one.
    const collapsed = [];
    let blankRun = 0;
    for (const line of kept) {
      if (line.trim() === "") {
        blankRun++;
        if (blankRun <= 1) {
          collapsed.push(line);
        }

        continue;
      }

      blankRun = 0;
      collapsed.push(line);
    }

    while (
      collapsed.length >= 2 &&
      collapsed.at(-1)?.trim() === "" &&
      collapsed.at(-2)?.trim() === ""
    ) {
      collapsed.pop();
    }

    text = collapsed.join(nl);
    if (raw.endsWith(nl) && text.length > 0 && !text.endsWith(nl)) {
      text += nl;
    }

    if (text.trim() === "") {
      text = "";
    }
  }

  return {
    changed: removed.length > 0,
    removed: [...new Set(removed)],
    text,
  };
}

export function stripSkillConfigIgnores(repoRoot, { write = false } = {}) {
  const gitignorePath = join(repoRoot, ".gitignore");
  if (!existsSync(gitignorePath)) {
    return { path: gitignorePath, removed: [], status: "clean" };
  }

  const raw = readFileSync(gitignorePath, "utf8");
  const plan = planSkillConfigIgnoreStrip(raw);
  if (!plan.changed) {
    return { path: gitignorePath, removed: [], status: "clean" };
  }

  if (!write) {
    return {
      path: gitignorePath,
      removed: plan.removed,
      status: "would-strip",
    };
  }

  writeFileSync(gitignorePath, plan.text);
  return { path: gitignorePath, removed: plan.removed, status: "stripped" };
}
