#!/usr/bin/env node
/**
 * Normalise tool output paths to repo-relative form (matches git diff keys).
 */
import { relative, resolve } from "node:path";

const ROOT = process.cwd();

/**
 * @param {string} filePath
 * @returns {string}
 */
export function toRepoRelative(filePath) {
  if (!filePath) {
    return "";
  }

  const abs = filePath.startsWith("/") ? filePath : resolve(ROOT, filePath);
  const rel = relative(ROOT, abs);

  if (rel.startsWith("..")) {
    return filePath.replace(/^\//, "").replaceAll("\\", "/");
  }

  return rel.replaceAll("\\", "/");
}
