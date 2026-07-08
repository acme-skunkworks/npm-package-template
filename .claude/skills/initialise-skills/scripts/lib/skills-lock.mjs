// Build, read and write the consumer's `.claude/skills.lock` inventory (A-616).
//
// The lock is a committed, machine-readable record of which skill versions a
// consumer has installed, plus the `source` repo + `ref` they were installed from:
//
//   { "source": "https://github.com/acme-skunkworks/agent-skills",
//     "ref": "main",
//     "skills": { "changelog": "1.2.0", "send-it": "2.1.3", … } }
//
// It is the foundation for WS3's push fleet-update orchestrator (A-617): given a
// consumer's lock + a target ref, `check-updates.mjs` reports which skills are
// behind.
//
// Provenance is FACTS-ONLY. skills.sh records nowhere where a consumer's skills
// came from (no `--ref` flag; installs track the source's default branch), and
// this reconciler is generic/shippable — it must not hardcode or guess the
// acme-skunkworks URL. So `source`/`ref` are supplied by the SKILL.md
// orchestration as stdin facts (`lockSource`/`lockRef`), exactly like the Linear
// team name / workspace slug it already can't derive. An existing lock's values
// are preserved when the facts omit them, so a re-run without re-supplying them is
// a clean no-op rather than a wipe. When neither is available the field is written
// as null and the report flags it for manual input — never fabricated.
//
// The writer mirrors lib/gitignore.mjs: a `write:false` dry run reports the action
// it WOULD take without touching disk, an unchanged file is a byte-stable no-op,
// and an IO error throws for the caller to funnel to exit(2).
//
// Zero-deps: plain JSON + string + fs work, no formatter dependency.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * The lock's location under a consumer's repo root. Fixed by convention (A-616):
 * the lock lives at the consumer root regardless of where `skills add` vendored
 * the bundles (`skills/`, `.claude/skills/`, `.agents/skills/`), so it is anchored
 * on repoRoot, not the skills dir.
 * @param {string} repoRoot
 * @returns {string}
 */
export function lockPath(repoRoot) {
  return join(repoRoot, ".claude", "skills.lock");
}

/**
 * Resolve the `source` repo URL for the lock: supplied fact wins, else the
 * existing lock's value (preserved across re-runs), else null. No derivation from
 * a bundle's package.json — provenance is explicit (see file header).
 * @param {{ source?: unknown } | null} existingLock
 * @param {Record<string, unknown>} facts
 * @returns {string | null}
 */
export function resolveSource(existingLock, facts) {
  if (typeof facts.lockSource === "string" && facts.lockSource.trim()) {
    return facts.lockSource.trim();
  }

  if (existingLock && typeof existingLock.source === "string") {
    return existingLock.source;
  }

  return null;
}

/**
 * Resolve the `ref` the skills were installed from: supplied fact wins, else the
 * existing lock's value, else null (the SKILL.md orchestration defaults this to
 * `main` — the fleet convention — when prompting; the script stays explicit).
 * @param {{ ref?: unknown } | null} existingLock
 * @param {Record<string, unknown>} facts
 * @returns {string | null}
 */
export function resolveRef(existingLock, facts) {
  if (typeof facts.lockRef === "string" && facts.lockRef.trim()) {
    return facts.lockRef.trim();
  }

  if (existingLock && typeof existingLock.ref === "string") {
    return existingLock.ref;
  }

  return null;
}

/**
 * Assemble the lock object. `skills` is rebuilt with sorted keys so the serialised
 * bytes are independent of `readdir` order — a precondition for the byte-stable
 * no-op re-run.
 * @param {{ installedVersions: Record<string, string | null>, source: string | null, ref: string | null }} input
 * @returns {{ source: string | null, ref: string | null, skills: Record<string, string | null> }}
 */
export function buildLock({ installedVersions, ref, source }) {
  const skills = {};
  for (const name of Object.keys(installedVersions).toSorted((a, b) =>
    a.localeCompare(b),
  )) {
    skills[name] = installedVersions[name];
  }

  return { ref, skills, source };
}

/**
 * Serialise the lock: 2-space JSON + trailing newline, always LF. The lock is
 * fully regenerated each run (not round-tripped like config.json/.gitignore), so
 * there's no existing indentation/line-ending to preserve. Deliberately carries
 * NO timestamp — a generatedAt field would break byte-stability.
 * @param {object} lock
 * @returns {string}
 */
export function serialiseLock(lock) {
  return `${JSON.stringify(lock, null, 2)}\n`;
}

/**
 * Read an existing lock from a consumer repo root. Returns null when the file is
 * absent or unparseable (a malformed lock is treated as "no prior provenance" —
 * the next write regenerates it cleanly rather than throwing). A genuine IO error
 * (e.g. EACCES/EISDIR on a file that exists but can't be read) is *not* masked —
 * it throws, so real provenance is never silently discarded by an unreadable lock.
 * @param {string} repoRoot
 * @returns {object | null}
 */
export function readLock(repoRoot) {
  const path = lockPath(repoRoot);
  if (!existsSync(path)) {
    return null;
  }

  // Read and parse in separate steps so only a *malformed* lock collapses to null.
  // existsSync already ruled out "absent", so a readFileSync failure here is a real
  // IO error — surface it rather than mistaking it for "no lock".
  let raw;
  try {
    raw = readFileSync(path, "utf8");
  } catch (error) {
    throw new Error(`could not read ${path}: ${error?.message ?? error}`, {
      cause: error,
    });
  }

  try {
    const data = JSON.parse(raw);
    return data && typeof data === "object" && !Array.isArray(data)
      ? data
      : null;
  } catch {
    return null;
  }
}

/**
 * Write (or dry-run) the lock at `<repoRoot>/.claude/skills.lock`. Idempotent: when
 * the computed bytes match what's already on disk it's a no-op with status
 * `unchanged` (no write, no mtime churn). Otherwise `write:false` reports
 * `would-write` and `write:true` writes and reports `written`, creating `.claude/`
 * if absent. Throws on an IO error for the caller to funnel to exit(2).
 * @param {string} repoRoot
 * @param {object} lock
 * @param {{ write?: boolean }} [options]
 * @returns {{ path: string, status: "unchanged" | "would-write" | "written" }}
 */
export function writeLock(repoRoot, lock, { write = false } = {}) {
  const path = lockPath(repoRoot);
  const next = serialiseLock(lock);

  if (existsSync(path)) {
    const current = readFileSync(path, "utf8");
    if (current === next) {
      return { path, status: "unchanged" };
    }
  }

  if (!write) {
    return { path, status: "would-write" };
  }

  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, next);
  return { path, status: "written" };
}
