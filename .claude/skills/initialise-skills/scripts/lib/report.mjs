// Render the reconcile report — both a human-readable summary and the JSON shape
// Claude parses to drive the Linear-fact and per-key drift-opt-in steps (A-409).

import { IGNORE_ENTRY } from "./gitignore.mjs";

/**
 * Human-friendly one-liners for the .gitignore reconcile action (A-569).
 */
const GITIGNORE_LABEL = {
  added: `added ${IGNORE_ENTRY} to .gitignore`,
  created: `created .gitignore with ${IGNORE_ENTRY}`,
  negated: `${IGNORE_ENTRY} deliberately un-ignored (left untouched)`,
  present: `${IGNORE_ENTRY} already ignored`,
  "would-add": `will add ${IGNORE_ENTRY} to .gitignore`,
  "would-create": `will create .gitignore with ${IGNORE_ENTRY}`,
};

/**
 * Human-friendly one-liners for the skills.lock write action (A-616).
 */
const LOCK_LABEL = {
  unchanged: "skills.lock already up to date",
  "would-write": "will write skills.lock",
  written: "wrote skills.lock",
};

/**
 * Human-friendly labels + ordering for the per-key statuses.
 */
const STATUS_LABEL = {
  drift: "drift",
  inferred: "inferred",
  "manual-kept": "manual-kept",
  "needs-manual-input": "needs-manual-input",
  set: "set",
  unchanged: "unchanged",
  "unknown-kept": "unknown-kept",
};

const STATUS_ORDER = [
  "set",
  "inferred",
  "drift",
  "needs-manual-input",
  "manual-kept",
  "unknown-kept",
  "unchanged",
];

function fmt(value) {
  return value === undefined ? "" : JSON.stringify(value);
}

/**
 * Stable per-key ordering shared by the dry-run and review renders: group by
 * status (via STATUS_ORDER), then alphabetically within a status.
 */
function byStatusThenKey(a, b) {
  return (
    STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status) ||
    a.key.localeCompare(b.key)
  );
}

/**
 * @typedef {{
 *   name: string,
 *   configPath: string,
 *   malformed: boolean,
 *   results: Record<string, import('./merge.mjs').KeyResult>,
 *   config?: Record<string, unknown>,
 * }} SkillReport
 * `config` is the parsed config.json data. `main()` attaches it to every entry
 * so the same shape feeds both `buildReport` (which ignores it) and
 * `buildReviewReport` (which needs it); optional for the malformed stub.
 */

/**
 * Aggregate per-skill merge results into the report object.
 * @param {SkillReport[]} skillReports
 * @param {boolean} wrote whether this was a --write run
 * @param {{ path: string, status: string } | null} [gitignore] the .gitignore
 *   reconcile result (A-569), or null when preflight is not installed
 * @param {{ path: string, status: string, needsFacts: boolean } | null} [lock] the
 *   skills.lock write result (A-616), or null when no bundles are installed
 * @returns {object}
 */
export function buildReport(
  skillReports,
  wrote,
  gitignore = null,
  lock = null,
) {
  const totals = {};
  const driftKeys = [];
  const manualKeys = [];
  const setKeys = [];

  const skills = skillReports.map((skillReport) => {
    const keys = Object.entries(skillReport.results).map(([key, result]) => {
      totals[result.status] = (totals[result.status] ?? 0) + 1;
      if (result.status === "drift") {
        driftKeys.push({
          configPath: skillReport.configPath,
          detected: result.detected,
          kept: result.keep,
          key,
          skill: skillReport.name,
        });
      }

      if (result.status === "set") {
        setKeys.push({
          configPath: skillReport.configPath,
          key,
          skill: skillReport.name,
          value: result.write,
        });
      }

      if (result.status === "needs-manual-input") {
        manualKeys.push({
          configPath: skillReport.configPath,
          key,
          skill: skillReport.name,
        });
      }

      return { key, ...result };
    });
    return {
      configPath: skillReport.configPath,
      keys,
      malformed: skillReport.malformed,
      name: skillReport.name,
    };
  });

  return {
    driftKeys,
    gitignore,
    lock,
    manualKeys,
    mode: wrote ? "write" : "dry-run",
    setKeys,
    skills,
    totals,
  };
}

/**
 * Format the report as human-readable text.
 * @param {ReturnType<typeof buildReport>} report
 * @returns {string}
 */
export function formatHuman(report) {
  const lines = [];
  const header =
    report.mode === "write"
      ? "initialise-skills — wrote inferred values"
      : "initialise-skills — dry run (no files written)";
  lines.push(header, "");

  for (const skill of report.skills) {
    if (skill.malformed) {
      lines.push(
        `${skill.configPath}  ⚠ existing config.json is unparseable — skipped`,
        "",
      );
      continue;
    }

    lines.push(skill.configPath);
    const ordered = [...skill.keys].toSorted(byStatusThenKey);
    for (const keyResult of ordered) {
      const label = STATUS_LABEL[keyResult.status].padEnd(20);
      const name = keyResult.key.padEnd(22);
      let detail = "";
      if (keyResult.status === "set") {
        detail = `set to ${fmt(keyResult.write)}`;
        if ("from" in keyResult) {
          detail += ` (was ${fmt(keyResult.from)})`;
        }
      } else if (keyResult.status === "inferred") {
        detail = fmt(keyResult.write);
      } else if (keyResult.status === "drift") {
        detail = `keeps ${fmt(keyResult.keep)} vs detected ${fmt(keyResult.detected)}`;
      } else if (keyResult.status === "needs-manual-input") {
        detail = "— provide a value (e.g. via Linear MCP)";
      } else if (
        keyResult.status === "manual-kept" ||
        keyResult.status === "unknown-kept"
      ) {
        detail = `keeps ${fmt(keyResult.keep)}`;
      }

      lines.push(`  ${label}${name}${detail}`.trimEnd());
    }

    lines.push("");
  }

  const totals = report.totals;
  const summary = STATUS_ORDER.filter((status) => totals[status])
    .map((status) => `${totals[status]} ${STATUS_LABEL[status]}`)
    .join(", ");
  lines.push(summary || "no keys to reconcile", "");

  if (report.gitignore) {
    const detail =
      GITIGNORE_LABEL[report.gitignore.status] ?? report.gitignore.status;
    lines.push(`${report.gitignore.path}: ${detail}`, "");
  }

  if (report.lock) {
    const detail = LOCK_LABEL[report.lock.status] ?? report.lock.status;
    const note = report.lock.needsFacts
      ? " (source/ref not supplied — pass lockSource/lockRef)"
      : "";
    lines.push(`${report.lock.path}: ${detail}${note}`, "");
  }

  if (report.mode === "dry-run") {
    if (report.setKeys?.length) {
      lines.push(
        `${report.setKeys.length} key(s) will be set via --set: ${report.setKeys
          .map((setKey) => `${setKey.skill}.${setKey.key}`)
          .join(", ")}. Re-run with --write to apply.`,
      );
    }

    if (report.driftKeys.length) {
      lines.push(
        `${report.driftKeys.length} drifted key(s) kept. To accept a detected value, re-run --write with that key in acceptDrift.`,
      );
    }

    if (report.manualKeys.length) {
      lines.push(
        `${report.manualKeys.length} key(s) need manual input: ${report.manualKeys
          .map((manualKey) => `${manualKey.skill}.${manualKey.key}`)
          .join(", ")}.`,
      );
    }
  }

  return lines.join("\n").replace(/\n+$/, "\n");
}

/**
 * @typedef {{
 *   name: string,
 *   configPath: string,
 *   malformed: boolean,
 *   config?: Record<string, unknown>,
 *   results: Record<string, import('./merge.mjs').KeyResult>,
 * }} SkillReview
 * `config` is absent on the malformed stub (it has no parseable config.json);
 * `buildReviewReport` defaults it to `{}`.
 */

/**
 * Build the read-only `--review` report: every installed skill's full current
 * config, each key annotated with its current value, its merge classification,
 * and a human description from references/detectable-keys.md (A-702). Unlike
 * buildReport this writes nothing and needs no gitignore/mode plumbing — it is a
 * complete snapshot of what each config currently holds.
 * @param {SkillReview[]} skillReviews
 * @param {Map<string, { usedBy: string, detectionSource: string, fallback: string }>} descriptions
 * @returns {object}
 */
export function buildReviewReport(skillReviews, descriptions) {
  const totals = {};

  const skills = skillReviews.map((review) => {
    const config = review.config ?? {};
    const keys = Object.entries(review.results).map(([key, result]) => {
      totals[result.status] = (totals[result.status] ?? 0) + 1;
      const isSet = Object.prototype.hasOwnProperty.call(config, key);
      const description = descriptions.get(key) ?? null;
      return {
        detectionSource: description?.detectionSource ?? null,
        fallback: description?.fallback ?? null,
        isSet,
        key,
        usedBy: description?.usedBy ?? null,
        // The current value as it stands in config.json; omitted when the key is
        // in the template but not yet set (rendered as "not set").
        ...(isSet ? { value: config[key] } : {}),
        ...result,
      };
    });
    return {
      configPath: review.configPath,
      keys,
      malformed: review.malformed,
      name: review.name,
    };
  });

  return { mode: "review", skills, totals };
}

/**
 * Format the review report as human-readable text.
 * @param {ReturnType<typeof buildReviewReport>} report
 * @returns {string}
 */
export function formatReview(report) {
  const lines = ["initialise-skills — review (read-only)", ""];

  for (const skill of report.skills) {
    if (skill.malformed) {
      lines.push(
        `${skill.configPath}  ⚠ existing config.json is unparseable — skipped`,
        "",
      );
      continue;
    }

    lines.push(skill.configPath);
    for (const keyResult of [...skill.keys].toSorted(byStatusThenKey)) {
      const label = STATUS_LABEL[keyResult.status].padEnd(20);
      const name = keyResult.key.padEnd(22);
      const value = keyResult.isSet ? fmt(keyResult.value) : "— not set";
      lines.push(`  ${label}${name}${value}`.trimEnd());
      // For an unset key, surface the fallback default that applies until it's
      // configured — actionable context that otherwise only appeared in --json.
      // (Set keys omit it: the live value already shows what's in effect.)
      if (!keyResult.isSet && keyResult.fallback) {
        lines.push(`      fallback: ${keyResult.fallback}`);
      }

      // Long detection-source prose lives on its own indented line so it never
      // blows out the value column. Omitted for keys with no reference row (e.g.
      // unknown-kept), which have nothing to describe.
      if (keyResult.usedBy && keyResult.detectionSource) {
        lines.push(
          `      used by ${keyResult.usedBy} — ${keyResult.detectionSource}`,
        );
      }
    }

    lines.push("");
  }

  const totals = report.totals;
  const summary = STATUS_ORDER.filter((status) => totals[status])
    .map((status) => `${totals[status]} ${STATUS_LABEL[status]}`)
    .join(", ");
  lines.push(summary || "no keys to review", "");

  return lines.join("\n").replace(/\n+$/, "\n");
}
