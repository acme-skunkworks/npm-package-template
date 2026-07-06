// Re-seed .release-please-manifest.json so its `"."` entry matches the starting
// package.json version (A-663).
//
// Leaving the manifest at the template's "0.0.0" while package.json says something
// else is the #1 release-please failure mode — release-please reads the manifest
// as the last-released version, so a mismatch makes it propose the wrong bump (or
// none). This keeps the two in lockstep. Pure `reseedManifest` is unit-tested; the
// thin fs wrapper is exercised end-to-end.

import { parseJson, serialiseJson } from "./json.mjs";
import { readFileSync, writeFileSync } from "node:fs";

/**
 * Compute the re-seeded manifest text, or `null` when `"."` already equals
 * `version` (the idempotent no-op — the caller writes nothing).
 * @param {string} manifestRaw the current .release-please-manifest.json text
 * @param {string} version the starting package.json version
 * @returns {{ text: string, from: string | undefined } | null}
 */
export function reseedManifest(manifestRaw, version) {
  const parsed = parseJson(manifestRaw);
  const data = parsed.data;
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error(".release-please-manifest.json must contain a JSON object");
  }

  const current = data["."];
  if (current === version) {
    return null;
  }

  // Preserve every other path entry (a monorepo manifest may carry several); only
  // the root `"."` is re-seeded.
  const next = { ...data, ".": version };
  return {
    from: typeof current === "string" ? current : undefined,
    text: serialiseJson(parsed, next),
  };
}

/**
 * fs wrapper: read the manifest + package.json, re-seed, and (when `write`) persist.
 * @param {{ manifestPath: string, packageJsonPath: string, write?: boolean }} opts
 * @returns {{ status: "changed" | "would-change" | "unchanged", from?: string, to: string }}
 */
export function reconcileManifest({
  manifestPath,
  packageJsonPath,
  write = false,
}) {
  const version = JSON.parse(readFileSync(packageJsonPath, "utf8")).version;
  if (typeof version !== "string") {
    throw new TypeError("package.json is missing a string `version`");
  }

  const result = reseedManifest(readFileSync(manifestPath, "utf8"), version);
  if (result === null) {
    return { status: "unchanged", to: version };
  }

  if (write) {
    writeFileSync(manifestPath, result.text);
  }

  return {
    from: result.from,
    status: write ? "changed" : "would-change",
    to: version,
  };
}
