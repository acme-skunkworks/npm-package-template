// Pull the shared agent-skills set into a spawned package repo (A-776).
//
// The template keeps committed skill bundles as bootstrap so the scaffolder can
// run immediately after "Use this template". At scaffold time this module refreshes
// the locked shared set from acme-skunkworks/agent-skills via `npx skills add … --copy`
// into both agent trees — pull-on-instantiation, not hourly push fan-out.
//
// Repo-local `initialise-package-repo` is deliberately absent from the skill list
// so `skills add` never overwrites the scaffolder itself.

import { spawnSync } from "node:child_process";

/** Source repo for the shared skill bundles (skills.sh / npx skills). */
export const AGENT_SKILLS_SOURCE =
  "https://github.com/acme-skunkworks/agent-skills";

/**
 * Shared skills that match `skills-lock.json` on the template. Order is stable for
 * deterministic argv / dry-run reports. Does **not** include initialise-package-repo
 * (repo-local scaffolder — never overwritten by `skills add`).
 */
export const SHARED_SKILLS = Object.freeze([
  "changelog",
  "cleanup-repo",
  "commit",
  "initialise-skills",
  "linear-sync",
  "preflight",
  "release-status",
  "send-it",
  "triage-pr",
]);

/**
 * Build the full argv for `npx skills add …` (including the `npx` binary).
 * @param {readonly string[]} [skills]
 * @returns {string[]}
 */
export function buildSkillsAddArgv(skills = SHARED_SKILLS) {
  const argv = ["npx", "skills", "add", AGENT_SKILLS_SOURCE];
  for (const skill of skills) {
    argv.push("--skill", skill);
  }

  argv.push("--agent", "claude-code", "--agent", "cursor", "--copy");
  return argv;
}

function defaultRun(command, args, options = {}) {
  return spawnSync(command, args, { encoding: "utf8", ...options });
}

/**
 * Dry-run or execute the shared-skills pull.
 *
 * @param {object} [options]
 * @param {string} [options.repoRoot] — cwd for the write-path spawn
 * @param {(cmd: string, args: string[], opts?: object) => { status: number|null, stderr?: string, stdout?: string }} [options.run]
 * @param {boolean} [options.write]
 * @param {readonly string[]} [options.skills]
 * @returns {{ status: string, skills: string[], argv: string[], detail?: string }}
 */
export function pullSharedSkills({
  repoRoot = process.cwd(),
  run = defaultRun,
  write = false,
  skills = SHARED_SKILLS,
} = {}) {
  const list = [...skills];
  const argv = buildSkillsAddArgv(list);

  if (!write) {
    return { argv, skills: list, status: "pending" };
  }

  const [command, ...args] = argv;
  const result = run(command, args, { cwd: repoRoot });

  if (result?.status !== 0) {
    const stderr = (result?.stderr || "").trim();
    return {
      argv,
      detail:
        stderr ||
        (result?.signal
          ? `npx skills add killed by ${result.signal}`
          : `npx skills add exited ${result?.status ?? "unknown"}`),
      skills: list,
      status: "error",
    };
  }

  return { argv, skills: list, status: "pulled" };
}
