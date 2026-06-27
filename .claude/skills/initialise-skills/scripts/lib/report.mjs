// Render the reconcile report — both a human-readable summary and the JSON shape
// Claude parses to drive the Linear-fact and per-key drift-opt-in steps (A-409).

/**
 * Human-friendly labels + ordering for the per-key statuses.
 */
const STATUS_LABEL = {
  drift: "drift",
  inferred: "inferred",
  "manual-kept": "manual-kept",
  "needs-manual-input": "needs-manual-input",
  unchanged: "unchanged",
  "unknown-kept": "unknown-kept",
};

const STATUS_ORDER = [
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
 * @typedef {{
 *   name: string,
 *   configPath: string,
 *   malformed: boolean,
 *   results: Record<string, import('./merge.mjs').KeyResult>,
 * }} SkillReport
 */

/**
 * Aggregate per-skill merge results into the report object.
 * @param {SkillReport[]} skillReports
 * @param {boolean} wrote whether this was a --write run
 * @returns {object}
 */
export function buildReport(skillReports, wrote) {
  const totals = {};
  const driftKeys = [];
  const manualKeys = [];

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
    manualKeys,
    mode: wrote ? "write" : "dry-run",
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
    const ordered = [...skill.keys].toSorted(
      (a, b) =>
        STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status) ||
        a.key.localeCompare(b.key),
    );
    for (const keyResult of ordered) {
      const label = STATUS_LABEL[keyResult.status].padEnd(20);
      const name = keyResult.key.padEnd(22);
      let detail = "";
      if (keyResult.status === "inferred") {
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

  if (report.mode === "dry-run") {
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
