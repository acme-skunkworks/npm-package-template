#!/usr/bin/env node
/**
 * Map branch-introduced line numbers per file from git diff hunks.
 */
import { spawnSync } from "node:child_process";

/**
 * @param {string} mergeBase
 * @returns {Map<string, Set<number>>}
 */
export function getIntroducedLinesPerFile(mergeBase) {
  const result = spawnSync(
    "git",
    ["diff", `${mergeBase}...HEAD`, "-U0", "--no-color"],
    // A large branch diff can exceed Node's 1 MiB default and be silently
    // truncated (with `result.error` set but `status` possibly still 0).
    // Truncation drops hunks → introduced lines misclassified as pre-existing
    // → preflight falsely passes, so raise the limit and treat `error` as fatal.
    { encoding: "utf8", maxBuffer: 10 * 1024 * 1024 },
  );
  if (result.error || result.status !== 0) {
    const detail =
      result.error?.message ||
      result.stderr?.trim() ||
      "unknown git diff error";
    throw new Error(
      `preflight: git diff for line classification failed: ${detail}`,
    );
  }

  /** @type {Map<string, Set<number>>} */
  const byFile = new Map();
  let currentFile = null;

  for (const line of result.stdout.split("\n")) {
    if (line.startsWith("+++ b/")) {
      const path = line.slice("+++ b/".length);
      currentFile = path === "/dev/null" ? null : path;
      continue;
    }

    if (!line.startsWith("@@") || !currentFile) {
      continue;
    }

    const plus = line.match(/\+(\d+)(?:,(\d+))?/);
    if (!plus) {
      continue;
    }

    const start = Number(plus[1]);
    const count = plus[2] === undefined ? 1 : Number(plus[2]);
    if (count === 0) {
      continue;
    }

    if (!byFile.has(currentFile)) {
      byFile.set(currentFile, new Set());
    }

    const lines = byFile.get(currentFile);
    for (let index = 0; index < count; index++) {
      lines.add(start + index);
    }
  }

  return byFile;
}

/**
 * @param {Map<string, Set<number>>} introducedByFile
 * @param {string} filePath
 * @param {number} line
 */
export function isIntroducedLine(introducedByFile, filePath, line) {
  const normalized = filePath.replace(/^\.\//, "");
  const introduced = introducedByFile.get(normalized);
  if (!introduced) {
    return false;
  }

  return introduced.has(line);
}
