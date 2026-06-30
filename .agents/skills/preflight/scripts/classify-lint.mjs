#!/usr/bin/env node
/**
 * Classify lint violations as introduced (branch) vs pre-existing.
 */
import {
  getIntroducedLinesPerFile,
  isIntroducedLine,
} from "./lib/diff-lines.mjs";
import { toRepoRelative } from "./lib/paths.mjs";

/**
 * @typedef {{ file: string; line: number; column?: number; ruleId?: string; message: string; source: 'eslint' | 'markdownlint' | 'actionlint'; severity: 'error' | 'warning' }} Violation
 * @typedef {{ introduced: Violation[]; preExisting: Violation[] }} Classified
 */

/**
 * @param {string} mergeBase
 * @param {Violation[]} violations
 * @returns {Classified}
 */
export function classifyViolations(mergeBase, violations) {
  const introducedByFile = getIntroducedLinesPerFile(mergeBase);
  /** @type {Violation[]} */
  const introduced = [];
  /** @type {Violation[]} */
  const preExisting = [];

  for (const violation of violations) {
    if (isIntroducedLine(introducedByFile, violation.file, violation.line)) {
      introduced.push(violation);
    } else {
      preExisting.push(violation);
    }
  }

  return { introduced, preExisting };
}

/**
 * Split introduced violations into the set that blocks the ship and the
 * warn-severity findings surfaced non-blockingly. ESLint `warn`-level findings
 * (severity 1) match `pnpm lint` / CI, which exit 0 on warnings — so by default
 * they are reported but do not gate. A consumer that wants warn-level findings
 * to block sets `blockOnWarnings: true` in `preflight.config.json` (A-601).
 *
 * markdownlint/actionlint findings are always tagged `error` (those tools exit
 * non-zero on any finding, so CI blocks on them) and therefore always block.
 * @param {Violation[]} introduced
 * @param {boolean} blockOnWarnings
 * @returns {{ blocking: Violation[]; warnings: Violation[] }}
 */
export function splitBySeverity(introduced, blockOnWarnings) {
  const warnings = introduced.filter(
    (violation) => violation.severity === "warning",
  );
  const blocking = blockOnWarnings
    ? introduced
    : introduced.filter((violation) => violation.severity !== "warning");
  return { blocking, warnings };
}

/**
 * @param {string} eslintJson
 * @returns {Violation[]}
 */
export function parseEslintJson(eslintJson) {
  if (!eslintJson.trim()) {
    return [];
  }

  let data;
  try {
    data = JSON.parse(eslintJson);
  } catch {
    return [];
  }

  if (!Array.isArray(data)) {
    return [];
  }

  /** @type {Violation[]} */
  const violations = [];
  for (const result of data) {
    const file = toRepoRelative(result.filePath ?? "");
    for (const message of result.messages ?? []) {
      // Drop severity 0 (off) only. Severity 1 (warn) is kept but tagged
      // `warning` so it can be surfaced non-blockingly by default — matching
      // `pnpm lint` / CI, which exit 0 on warnings (A-601). Severity 2 is an
      // error and always blocks.
      if (message.severity === 0 || !message.line) {
        continue;
      }

      violations.push({
        column: message.column,
        file,
        line: message.line,
        message: message.message,
        ruleId: message.ruleId,
        severity: message.severity === 1 ? "warning" : "error",
        source: "eslint",
      });
    }
  }

  return violations;
}

/**
 * markdownlint-cli2 JSON: array of { fileName, lineNumber, ruleNames, ruleDescription, ... }
 *
 * NB: this is for the *optional* `markdownlint-cli2-formatter-json` output (a
 * file artefact a consumer wires up via `outputFormatters`). markdownlint-cli2
 * has **no `--format`/JSON CLI flag**, so the default command-line output is
 * text — preflight parses that with {@link parseMarkdownlintText}. Kept here for
 * repos that do configure the JSON formatter.
 * @param {string} mdJson
 * @returns {Violation[]}
 */
export function parseMarkdownlintJson(mdJson) {
  if (!mdJson.trim()) {
    return [];
  }

  let data;
  try {
    data = JSON.parse(mdJson);
  } catch {
    return [];
  }

  const items = Array.isArray(data) ? data : (data?.issues ?? []);
  if (!Array.isArray(items)) {
    return [];
  }

  /** @type {Violation[]} */
  const violations = [];
  for (const item of items) {
    const file = toRepoRelative(item.fileName ?? item.file ?? "");
    const line = item.lineNumber ?? item.line;
    if (!file || !line) {
      continue;
    }

    violations.push({
      file,
      line,
      message:
        item.ruleDescription ??
        item.ruleInformation ??
        "markdownlint violation",
      ruleId: Array.isArray(item.ruleNames)
        ? item.ruleNames.join("/")
        : item.ruleName,
      // markdownlint-cli2 exits non-zero on any finding, so CI blocks on them —
      // tag as error to mirror that (the warn/error severity split is ESLint-only).
      severity: "error",
      source: "markdownlint",
    });
  }

  return violations;
}

/**
 * Parse markdownlint-cli2's DEFAULT text output (the command-line format — it
 * has no JSON CLI flag). Each violation prints as:
 *
 *   <file>:<line>[:<col>] [error|warning] <ruleNames> <description> [detail]
 *
 * e.g. `README.md:4:81 error MD013/line-length Line length [Expected: 80; …]`
 * or   `README.md:1 error MD022/blanks-around-headings Headings should be …`
 *
 * The banner lines markdownlint-cli2 also emits (`markdownlint-cli2 vX`,
 * `Finding:`, `Linting:`, `Summary:`) carry no `:<line>` token and so don't
 * match. The severity word is optional — older markdownlint-cli2 omitted it.
 * @param {string} text combined stdout + stderr
 * @returns {Violation[]}
 */
export function parseMarkdownlintText(text) {
  if (!text || !text.trim()) {
    return [];
  }

  /** @type {Violation[]} */
  const violations = [];
  for (const raw of text.split("\n")) {
    const match = raw.trimEnd().match(/^(.+?):(\d+)(?::(\d+))?\s+(\S.*)$/);
    if (!match) {
      continue;
    }

    // Strip an optional `error`/`warning` severity token, then split the rest
    // into the rule name(s) and the human description.
    let rest = match[4];
    const severity = rest.match(/^(?:error|warning)\s+(\S.*)$/i);
    if (severity) {
      rest = severity[1];
    }

    const firstSpace = rest.indexOf(" ");
    const ruleId = firstSpace === -1 ? rest : rest.slice(0, firstSpace);
    const message = firstSpace === -1 ? "" : rest.slice(firstSpace + 1);

    violations.push({
      file: toRepoRelative(match[1]),
      line: Number(match[2]),
      ...(match[3] ? { column: Number(match[3]) } : {}),
      message,
      ruleId,
      severity: "error",
      source: "markdownlint",
    });
  }

  return violations;
}

/**
 * actionlint outputs text to stderr; map line-based errors when present.
 *
 * Lines that don't match `file:line:col: message` are attributed to the single
 * workflow file when only one was passed, and otherwise silently dropped.
 * preflight's process-level guard exits 1 whenever actionlint exits non-zero
 * with no parseable violations, which catches the all-or-nothing failure case.
 * If a run emits a mix of parseable and unparseable lines the parseable ones
 * still surface and the unmatched lines remain dropped — in practice
 * actionlint's text format is consistent enough that this case is vanishingly
 * rare.
 * @param {string} stderr
 * @param {string[]} workflowFiles
 * @returns {Violation[]}
 */
export function parseActionlintText(stderr, workflowFiles) {
  /** @type {Violation[]} */
  const violations = [];
  const lines = stderr.split("\n").filter(Boolean);
  for (const line of lines) {
    const match = line.match(/^([^:]+):(\d+):(\d+): (.+)$/);
    if (match) {
      violations.push({
        column: Number(match[3]),
        file: toRepoRelative(match[1]),
        line: Number(match[2]),
        message: match[4],
        severity: "error",
        source: "actionlint",
      });
      continue;
    }

    if (workflowFiles.length === 1) {
      violations.push({
        file: workflowFiles[0],
        line: 1,
        message: line,
        severity: "error",
        source: "actionlint",
      });
    }
  }

  return violations;
}
