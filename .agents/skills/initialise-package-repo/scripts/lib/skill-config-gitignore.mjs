// Strip the template-seed skill-config.json gitignore rules from a spawned
// consumer (A-812).
//
// The template gitignores `.claude/skills/*/config.json` and
// `.agents/skills/*/config.json` so "Use this template" never copies a local
// resolved config into a new repo. That rule is correct for the *template seed*
// but wrong for a *consumer*: agent-skills expects the resolved per-skill
// config.json to be committed after initialise-skills runs. Leaving the ignore
// in place means CI/fresh clones have no runnable config.
//
// This module removes those two patterns (and the A-640 comment block that
// usually sits above them). Idempotent; dry-run reports without writing.

import { existsSync, readFileSync, writeFileSync } from "node:fs";

/** Patterns that must not remain in a consumer .gitignore (A-812). */
export const SKILL_CONFIG_IGNORE_PATTERNS = [
  ".claude/skills/*/config.json",
  ".agents/skills/*/config.json",
  "/.claude/skills/*/config.json",
  "/.agents/skills/*/config.json",
];

/**
 * True when a trimmed .gitignore line is one of the skill-config ignore patterns.
 * @param {string} trimmed
 * @returns {boolean}
 */
export function isSkillConfigIgnorePattern(trimmed) {
  return SKILL_CONFIG_IGNORE_PATTERNS.includes(trimmed);
}

/**
 * True when a comment line belongs to the A-640 / generated-config block that
 * documents the (now-incorrect-for-consumers) skill-config ignore. Matches the
 * *start* of the block (or any line that clearly names the rule); intermediate
 * wrap lines are consumed by the look-ahead in `planSkillConfigIgnoreStrip`.
 * @param {string} trimmed
 * @returns {boolean}
 */
export function isSkillConfigIgnoreComment(trimmed) {
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
 * Plan the stripped .gitignore text. Pure — no I/O.
 * @param {string} raw
 * @returns {{ changed: boolean, removed: string[], text: string }}
 */
export function planSkillConfigIgnoreStrip(raw) {
  const nl = raw.includes("\r\n") ? "\r\n" : "\n";
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

    // Drop a contiguous comment block that immediately precedes a skill-config
    // ignore pattern. Once the opening comment matches, consume every following
    // `#` line (wrap lines often omit "config.json") until the pattern.
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

/**
 * Reconcile the repo-root .gitignore so skill config.json is trackable (A-812).
 * @param {{ path: string, write?: boolean }} options
 * @returns {{ path: string, removed: string[], status: "clean"|"stripped"|"would-strip" }}
 */
export function reconcileSkillConfigIgnore({ path, write = false }) {
  if (!existsSync(path)) {
    return { path, removed: [], status: "clean" };
  }

  const raw = readFileSync(path, "utf8");
  const plan = planSkillConfigIgnoreStrip(raw);
  if (!plan.changed) {
    return { path, removed: [], status: "clean" };
  }

  if (!write) {
    return { path, removed: plan.removed, status: "would-strip" };
  }

  writeFileSync(path, plan.text);
  return { path, removed: plan.removed, status: "stripped" };
}
