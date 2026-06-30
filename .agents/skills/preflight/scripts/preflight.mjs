#!/usr/bin/env node
import {
  classifyViolations,
  parseActionlintText,
  parseEslintJson,
  parseMarkdownlintText,
  splitBySeverity,
} from "./classify-lint.mjs";
import {
  getBranchScope,
  relativiseToWorkspace,
  resolveConfig,
} from "./lib/scope.mjs";
/**
 * Change-gated, branch-scoped lint preflight (originally A-282).
 */
import { spawnSync } from "node:child_process";
import { existsSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const SUMMARY_PATH = join(ROOT, ".preflight-summary.json");
const dryRun = process.argv.includes("--dry-run");

/**
 * @param {string} cmd
 * @param {string[]} args
 * @param {{ encoding?: 'utf8'; input?: string }} [options]
 */
function run(cmd, args, options = {}) {
  return spawnSync(cmd, args, {
    cwd: ROOT,
    encoding: options.encoding ?? "utf8",
    input: options.input,
    // ESLint `-f json` can exceed Node's 1 MiB default on a sizeable codebase;
    // truncated output fails JSON.parse and is swallowed as "zero violations",
    // so the run falsely passes. Raise the buffer well clear.
    maxBuffer: 20 * 1024 * 1024,
    stdio: ["pipe", "pipe", "pipe"],
  });
}

/**
 * @param {string} label
 * @param {string[]} files
 */
function runEslintGroup(label, files) {
  if (files.length === 0) {
    return { label, ok: true, skipped: true, violations: [] };
  }

  if (dryRun) {
    console.log(
      `preflight: [dry-run] would run ESLint (${label}) on ${files.length} file(s)`,
    );
    return { dryRun: true, files, label, ok: true, violations: [] };
  }

  const result = run("pnpm", ["exec", "eslint", "-f", "json", "--", ...files]);
  const violations = parseEslintJson(result.stdout);
  const ok = result.status === 0 && violations.length === 0;
  if (!ok && result.stderr) {
    console.error(result.stderr);
  }

  return { files, label, ok, violations };
}

/**
 * @param {string} filter
 * @param {string[]} files
 * @param {string} prefix workspace prefix (e.g. "apps/studio/")
 */
function runEslintFilter(filter, files, prefix) {
  if (files.length === 0) {
    return { label: filter, ok: true, skipped: true, violations: [] };
  }

  if (dryRun) {
    console.log(
      `preflight: [dry-run] would run ESLint (${filter}) on ${files.length} file(s)`,
    );
    return { dryRun: true, files, label: filter, ok: true, violations: [] };
  }

  // `pnpm --filter <pkg> exec` runs with the workspace dir as cwd, so ESLint
  // needs paths relative to that dir — repo-root-relative paths would resolve
  // to <pkg>/<pkg>/... and fail to match. Violation paths are re-derived from
  // ESLint's absolute filePath via toRepoRelative, so classification stays
  // keyed on repo-relative paths regardless of what we pass in here.
  const result = run("pnpm", [
    "--filter",
    filter,
    "exec",
    "eslint",
    "-f",
    "json",
    "--",
    ...relativiseToWorkspace(files, prefix),
  ]);
  const violations = parseEslintJson(result.stdout);
  const ok = result.status === 0 && violations.length === 0;
  if (!ok && result.stderr) {
    console.error(result.stderr);
  }

  return {
    files,
    label: filter,
    ok,
    violations,
  };
}

/**
 * Detect markdownlint-cli2 being absent (not installed) as opposed to having
 * run and found violations. `pnpm exec` surfaces a recognisable signature when
 * the bin can't be resolved; treat that as a graceful skip (the same posture as
 * actionlint), not a "linter failed to run". Without this, an uninstalled
 * markdownlint exits non-zero with no parseable output and gets misreported as
 * `failedLinters` — indistinguishable from a real run whose violations the gate
 * silently swallowed.
 * @param {ReturnType<typeof run>} result
 */
function markdownlintMissing(result) {
  // pnpm-specific signatures: when `pnpm exec` can't resolve markdownlint-cli2,
  // pnpm itself still spawns cleanly and reports the miss on stderr. We do NOT
  // key off `result.error` — spawnSync only sets that when pnpm fails to spawn
  // (e.g. pnpm absent) or on a maxBuffer overrun, which are real environment
  // failures that should surface as failedLinters, not be downgraded to a skip.
  const out = `${result.stderr ?? ""}\n${result.stdout ?? ""}`;
  return (
    /ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL/.test(out) ||
    /command\s+"?markdownlint-cli2"?\s+not found/i.test(out)
  );
}

/**
 * @param {string[]} files
 */
function runMarkdownlint(files) {
  if (files.length === 0) {
    return { markdownlint: "skipped", ok: true, skipped: true, violations: [] };
  }

  if (dryRun) {
    console.log(
      `preflight: [dry-run] would run markdownlint on ${files.length} file(s)`,
    );
    return {
      dryRun: true,
      files,
      markdownlint: "would-run",
      ok: true,
      violations: [],
    };
  }

  // markdownlint-cli2 has NO `--format`/JSON CLI flag (JSON output needs a
  // configured outputFormatter). It prints violations as text and exits 1 when
  // any are found; parse that text — mirroring runActionlint.
  const result = run("pnpm", ["exec", "markdownlint-cli2", ...files]);

  if (markdownlintMissing(result)) {
    console.warn(
      "preflight: markdownlint-cli2 not installed — skipping markdown lint (install it locally or rely on CI)",
    );
    return { files, markdownlint: "warn-skipped", ok: true, violations: [] };
  }

  const violations = parseMarkdownlintText(
    `${result.stdout ?? ""}\n${result.stderr ?? ""}`,
  );
  const passed = result.status === 0 && violations.length === 0;
  if (!passed && violations.length === 0 && result.stderr) {
    console.error(result.stderr);
  }

  return { files, markdownlint: "ran", ok: passed, violations };
}

/**
 * @param {string[]} files
 */
function runActionlint(files) {
  if (files.length === 0) {
    return { actionlint: "skipped", ok: true, skipped: true, violations: [] };
  }

  if (dryRun) {
    console.log(
      `preflight: [dry-run] would run actionlint on ${files.length} workflow(s)`,
    );
    return {
      actionlint: "would-run",
      dryRun: true,
      files,
      ok: true,
      violations: [],
    };
  }

  let actionlintBin = null;
  if (existsSync(join(ROOT, "actionlint"))) {
    actionlintBin = join(ROOT, "actionlint");
  } else {
    const which = run("bash", ["-lc", "command -v actionlint"]);
    if (which.status === 0 && which.stdout.trim()) {
      actionlintBin = which.stdout.trim();
    }
  }

  if (!actionlintBin) {
    console.warn(
      "preflight: actionlint not installed — skipping workflow lint (install actionlint locally or rely on CI)",
    );
    return { actionlint: "warn-skipped", files, ok: true, violations: [] };
  }

  const result = run(actionlintBin, [...files]);
  const violations = parseActionlintText(result.stderr || result.stdout, files);
  return {
    actionlint: "ran",
    files,
    ok: result.status === 0 && violations.length === 0,
    violations,
  };
}

/**
 * Assemble the machine-readable preflight summary the ship flow reads. Pure —
 * `isDryRun` is passed in (not read from module scope) so both modes are
 * unit-testable.
 * @param {ReturnType<import('./lib/scope.mjs').getBranchScope>} scope
 * @param {{ failedLinters?: string[], actionlintStatus?: string, markdownlintStatus?: string }} results
 * @param {{ introduced: import('./classify-lint.mjs').Violation[], preExisting: import('./classify-lint.mjs').Violation[] }} classified
 * @param {boolean} isDryRun
 * @param {boolean} [blockOnWarnings] gate on introduced warn-severity findings too (default off — A-601)
 */
export function buildSummary(
  scope,
  results,
  classified,
  isDryRun,
  blockOnWarnings = false,
) {
  const failedLinters = results.failedLinters ?? [];
  const categories = {
    actionlint: scope.workflowsChanged ? scope.actionlintTargets : "skipped",
    eslint: scope.codeChanged ? { ...scope.eslint } : "skipped",
    markdown: scope.markdownChanged ? scope.markdown : "skipped",
  };

  // Errors always block; warnings block only under blockOnWarnings (A-601).
  const { blocking: introducedBlocking, warnings: introducedWarnings } =
    splitBySeverity(classified.introduced, blockOnWarnings);

  return {
    blocking: introducedBlocking.length > 0 || failedLinters.length > 0,
    categories,
    deferred: classified.preExisting.length > 0 && !isDryRun,
    dryRun: isDryRun,
    mergeBase: scope.mergeBase,
    passed: introducedBlocking.length === 0 && failedLinters.length === 0,
    results: {
      actionlint: results.actionlintStatus,
      blockOnWarnings,
      eslintRan: scope.codeChanged,
      failedLinters,
      markdownlint:
        results.markdownlintStatus ??
        (scope.markdownChanged ? "ran" : "skipped"),
      markdownRan: scope.markdownChanged,
    },
    violations: {
      introduced: classified.introduced,
      introducedBlocking,
      introducedBlockingCount: introducedBlocking.length,
      introducedCount: classified.introduced.length,
      introducedWarningCount: introducedWarnings.length,
      introducedWarnings,
      preExisting: classified.preExisting,
      preExistingCount: classified.preExisting.length,
    },
  };
}

const USAGE = `preflight — change-gated, branch-scoped lint preflight

Usage:
  node preflight.mjs            Lint the categories the branch changed
  node preflight.mjs --dry-run  Report categories + scoped files without classifying (writes nothing)
  node preflight.mjs --help     Show this message (alias: -h)`;

function main() {
  if (
    process.argv
      .slice(2)
      .some((argument) => argument === "--help" || argument === "-h")
  ) {
    console.log(USAGE);
    return;
  }

  const scope = getBranchScope();
  const { baseBranch, blockOnWarnings } = resolveConfig();

  if (scope.changedFiles.length === 0) {
    console.log(
      `preflight: no files changed vs origin/${baseBranch} — skipping lint preflight`,
    );
    if (!dryRun) {
      const earlySummary = buildSummary(
        scope,
        { actionlintStatus: "skipped" },
        {
          introduced: [],
          preExisting: [],
        },
        dryRun,
      );
      writeFileSync(SUMMARY_PATH, `${JSON.stringify(earlySummary, null, 2)}\n`);
    }

    process.exit(0);
  }

  if (!scope.codeChanged && !scope.markdownChanged && !scope.workflowsChanged) {
    console.log(
      "preflight: no lintable changes (code/markdown/workflows) — skipping lint preflight",
    );
    if (!dryRun) {
      const earlySummary = buildSummary(
        scope,
        { actionlintStatus: "skipped" },
        {
          introduced: [],
          preExisting: [],
        },
        dryRun,
      );
      writeFileSync(SUMMARY_PATH, `${JSON.stringify(earlySummary, null, 2)}\n`);
    }

    process.exit(0);
  }

  /** @type {import('./classify-lint.mjs').Violation[]} */
  const allViolations = [];
  /** @type {string[]} */
  const failedLinters = [];

  if (scope.codeChanged) {
    // Like markdownlint/actionlint below, suppress this outer header under
    // --dry-run — the per-group "[dry-run] would run ESLint (label)" lines say it.
    if (!dryRun) {
      console.log("preflight: running scoped ESLint (code changed on branch)");
    }

    const groups = [
      runEslintGroup("scripts", scope.eslint.scripts),
      runEslintGroup("root", scope.eslint.root),
      ...Object.entries(scope.workspaces).map(([key, { filter, prefix }]) =>
        runEslintFilter(filter, scope.eslint[key], prefix),
      ),
    ];
    for (const group of groups) {
      if (!group.skipped && !group.dryRun) {
        allViolations.push(...group.violations);
        if (group.ok) {
          console.log(`preflight: ESLint passed (${group.label})`);
        } else if (group.violations.length === 0) {
          console.error(
            `preflight: ESLint failed to run successfully (${group.label}) — no parseable violations from non-zero exit`,
          );
          failedLinters.push(`eslint:${group.label}`);
        } else {
          console.error(`preflight: ESLint reported issues (${group.label})`);
        }
      }
    }
  } else {
    console.log("preflight: skipping ESLint (no code changes)");
  }

  let actionlintStatus = "skipped";
  let markdownlintStatus = "skipped";
  if (scope.markdownChanged) {
    if (!dryRun) {
      console.log("preflight: running scoped markdownlint");
    }

    const md = runMarkdownlint(scope.markdown);
    markdownlintStatus = md.markdownlint ?? "ran";
    if (!md.skipped && !md.dryRun && md.markdownlint !== "warn-skipped") {
      allViolations.push(...md.violations);
      if (md.ok) {
        console.log("preflight: markdownlint passed");
      } else if (md.violations.length === 0) {
        console.error(
          "preflight: markdownlint failed to run successfully — no parseable violations from non-zero exit",
        );
        failedLinters.push("markdownlint");
      } else {
        console.error("preflight: markdownlint reported issues");
      }
    }
  } else {
    console.log("preflight: skipping markdownlint (no markdown changes)");
  }

  if (scope.workflowsChanged) {
    const targetCount = scope.actionlintTargets.length;
    if (!dryRun) {
      console.log(
        `preflight: running actionlint on ${targetCount} workflow(s)`,
      );
    }

    const wf = runActionlint(scope.actionlintTargets);
    actionlintStatus = wf.actionlint ?? "ran";
    if (!wf.skipped && !wf.dryRun && wf.actionlint !== "warn-skipped") {
      allViolations.push(...wf.violations);
      if (wf.ok) {
        console.log("preflight: actionlint passed");
      } else if (wf.violations.length === 0) {
        console.error(
          "preflight: actionlint failed to run successfully — no parseable violations from non-zero exit",
        );
        failedLinters.push("actionlint");
      } else {
        console.error("preflight: actionlint reported issues");
      }
    }
  } else {
    console.log("preflight: skipping actionlint (no workflow changes)");
  }

  const classified = dryRun
    ? { introduced: [], preExisting: [] }
    : classifyViolations(scope.mergeBase, allViolations);

  const summary = buildSummary(
    scope,
    { actionlintStatus, failedLinters, markdownlintStatus },
    classified,
    dryRun,
    blockOnWarnings,
  );
  // --dry-run is a true preview: skip the summary write the ship flow reads.
  if (!dryRun) {
    writeFileSync(SUMMARY_PATH, `${JSON.stringify(summary, null, 2)}\n`);
  }

  console.log("");
  console.log("preflight: summary");
  console.log(
    `  categories: eslint=${scope.codeChanged ? (dryRun ? "would-run" : "ran") : "skipped"} markdown=${markdownlintStatus} actionlint=${actionlintStatus}`,
  );
  const { blocking: introducedBlocking, warnings: introducedWarnings } =
    splitBySeverity(classified.introduced, blockOnWarnings);

  if (!dryRun) {
    console.log(
      `  violations: introduced=${classified.introduced.length} (blocking=${introducedBlocking.length} warnings=${introducedWarnings.length}) pre-existing=${classified.preExisting.length}`,
    );
    if (failedLinters.length > 0) {
      console.log(`  failed linters: ${failedLinters.join(", ")}`);
    }

    console.log(`  report: ${SUMMARY_PATH}`);
  }

  if (dryRun) {
    process.exit(0);
  }

  // Non-blocking notice: warn-severity findings the branch introduced are
  // reported but, by default, don't gate the ship — `pnpm lint` / CI exit 0 on
  // warnings too (A-601). A consumer that wants them to block sets
  // `blockOnWarnings: true` (which folds them into `introducedBlocking` above).
  if (!blockOnWarnings && introducedWarnings.length > 0) {
    console.warn(
      "\npreflight: introduced warnings (non-blocking — set blockOnWarnings:true in preflight.config.json to gate on these):",
    );
    for (const violation of introducedWarnings.slice(0, 20)) {
      console.warn(
        `  ${violation.file}:${violation.line} [${violation.source}] ${violation.message}`,
      );
    }

    if (introducedWarnings.length > 20) {
      console.warn(`  … and ${introducedWarnings.length - 20} more`);
    }
  }

  if (introducedBlocking.length > 0) {
    console.error(
      "\npreflight: blocking — introduced violations must be fixed (run node skills/preflight/scripts/lint-fix.mjs and re-run preflight)",
    );
    for (const violation of introducedBlocking.slice(0, 20)) {
      console.error(
        `  ${violation.file}:${violation.line} [${violation.source}] ${violation.message}`,
      );
    }

    if (introducedBlocking.length > 20) {
      console.error(`  … and ${introducedBlocking.length - 20} more`);
    }

    process.exit(1);
  }

  if (failedLinters.length > 0) {
    console.error(
      `\npreflight: blocking — linter(s) failed to run successfully without producing parseable violations: ${failedLinters.join(", ")}`,
    );
    console.error(
      "  inspect linter stderr above for startup errors, non-JSON output, or parser misses",
    );

    process.exit(1);
  }

  if (classified.preExisting.length > 0) {
    console.error(
      "\npreflight: pre-existing violations in branch-touched files — choose fix now or create a Linear debt issue",
    );
    for (const violation of classified.preExisting.slice(0, 20)) {
      console.error(
        `  ${violation.file}:${violation.line} [${violation.source}] ${violation.message}`,
      );
    }

    if (classified.preExisting.length > 20) {
      console.error(`  … and ${classified.preExisting.length - 20} more`);
    }

    process.exit(2);
  }

  console.log("preflight: all scoped checks passed");
  process.exit(0);
}

// Run main() only when invoked directly as a CLI, not when imported. Compare
// realpath'd paths so symlinks (macOS /var→/private/var, pnpm's store) don't
// cause a false negative.
function isCliEntry() {
  if (!process.argv[1]) {
    return false;
  }

  try {
    return realpathSync(import.meta.filename) === realpathSync(process.argv[1]);
  } catch {
    return false;
  }
}

if (isCliEntry()) {
  main();
}
