// Build and format the initialise-package-repo report (A-663).
//
// The CLI assembles a machine-readable report object; `--json` prints it verbatim
// for the SKILL.md orchestration to parse, and `formatHuman` renders the same data
// as a readable summary for an interactive run. The manual reminders are the steps
// the skill deliberately does NOT automate (org/browser/cross-repo) — surfaced so
// the operator is never left thinking the repo is fully done when it is not.

/**
 * The steps this skill cannot perform itself (org/browser/cross-repo privilege) —
 * printed after every run so they are never silently skipped. Kept in lockstep
 * with README.md#setup, the single source of truth.
 */
export const MANUAL_REMINDERS = [
  {
    detail:
      "Replace everything under src/ with the package's real public API — src/index.ts is the published entry point.",
    title: "Author the package API",
  },
  {
    detail:
      "Install road-runner-bot on the repo and add it to the orchestrator's matrix.repo (A-648) — README.md#release-orchestrator-onboarding.",
    title: "Onboard the release-orchestrator",
  },
  {
    detail:
      "Verify org-wide CLAUDE_CODE_OAUTH_TOKEN + the Claude GitHub App are inherited; add the per-repo secret + App grant if not — README.md#claude-review-prerequisites.",
    title: "Verify Claude review prerequisites",
  },
  {
    detail:
      "Manual first publish (passkey/WebAuthn), then configure the Trusted Publisher against pkg-release.yml — README.md#npm-oidc-trusted-publishing and CLAUDE.md#bootstrap-publish.",
    title: "Bootstrap npm OIDC + first publish",
  },
];

const GLYPH = {
  "already-customised": "•",
  changed: "✔",
  clean: "•",
  created: "✔",
  enabled: "✔",
  present: "•",
  reset: "✔",
  unchanged: "•",
  "would-change": "→",
  "would-create": "→",
  "would-enable": "→",
  "would-reset": "→",
};

function line(label, status, extra = "") {
  const glyph = GLYPH[status] ?? "?";
  const suffix = extra ? `  (${extra})` : "";
  return `  ${glyph} ${label}: ${status}${suffix}`;
}

/**
 * Render the report as human-readable text.
 * @param {object} report
 * @returns {string}
 */
export function formatHuman(report) {
  const { ops, scope, write } = report;
  const mode = write ? "WRITE" : "dry-run";
  const out = [`initialise-package-repo (${mode}, scope: ${scope})`, ""];

  if (ops.files) {
    out.push("In-repo edits:");
    out.push(
      line(
        "changelog reset",
        ops.files.changelog.status,
        ops.files.changelog.deleted.length
          ? `${ops.files.changelog.deleted.length} entries`
          : "",
      ),
    );
    out.push(
      line(
        ".release-please-manifest.json",
        ops.files.manifest.status,
        ops.files.manifest.to ? `\".\" → ${ops.files.manifest.to}` : "",
      ),
    );
    out.push(
      line(
        "package.json identity",
        ops.files.packageIdentity.status,
        ops.files.packageIdentity.name,
      ),
    );
    out.push(
      line(
        "repo-config.yaml",
        ops.files.repoConfig.status,
        Object.keys(ops.files.repoConfig.changes).join(", "),
      ),
    );
    out.push("");
  }

  if (ops.github) {
    out.push("GitHub settings:");
    for (const result of ops.github) {
      out.push(line(result.op, result.status, result.detail ?? ""));
    }

    out.push("");
  }

  out.push("Manual next steps (not automated):");
  for (const reminder of MANUAL_REMINDERS) {
    out.push(`  ▸ ${reminder.title} — ${reminder.detail}`);
  }

  return out.join("\n");
}
