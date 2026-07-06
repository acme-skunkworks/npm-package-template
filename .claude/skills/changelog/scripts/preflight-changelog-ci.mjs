#!/usr/bin/env node
// Optional CI-parity preflight: confirm the active Node satisfies the consumer
// repo's engines/.nvmrc policy, then run `pnpm install --frozen-lockfile` so the
// lockfile is honoured before validating. Assumes the consumer repo uses pnpm
// with a committed lockfile; skip this step if yours does not.
import { isCliEntry } from "./lib/cli-entry.mjs";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();

export function parseVersion(raw) {
  // Accept full and partial versions: a bare `22` or `22.5` (common in
  // `.nvmrc`, which is what `nvm use` writes) pads the missing parts with 0.
  const match = String(raw)
    .trim()
    .replace(/^v/, "")
    .match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
  if (!match) {
    return null;
  }

  return [Number(match[1]), Number(match[2] ?? 0), Number(match[3] ?? 0)];
}

// Extract the minimum concrete version from any common `engines.node` range
// without a semver dependency: `>=22`, `>=22.1.0`, `^22.0.0`, `~22.1`, `22.x`,
// `>=22 <23`, or a bare `22`. We take the first version-like token (the lower
// bound for the ranges we emit) and treat `x`/`*`/missing parts as 0.
export function coerceMinVersion(spec) {
  const match = String(spec).match(/(\d+)(?:\.(\d+|[xX*]))?(?:\.(\d+|[xX*]))?/);
  if (!match) {
    return null;
  }

  function part(value) {
    return value === undefined || /[xX*]/.test(value) ? 0 : Number(value);
  }

  return [Number(match[1]), part(match[2]), part(match[3])];
}

export function compareVersions(a, b) {
  for (let index = 0; index < 3; index++) {
    if (a[index] > b[index]) {
      return 1;
    }

    if (a[index] < b[index]) {
      return -1;
    }
  }

  return 0;
}

export function satisfiesGte(versionParts, minParts) {
  return compareVersions(versionParts, minParts) >= 0;
}

function readEnginesNode() {
  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
  const spec = pkg.engines?.node;
  if (!spec || typeof spec !== "string") {
    console.error(
      "preflight-changelog-ci: package.json engines.node is missing",
    );
    process.exit(1);
  }

  const min = coerceMinVersion(spec);
  if (!min) {
    console.error(
      `preflight-changelog-ci: could not parse a minimum version from engines.node "${spec}"`,
    );
    process.exit(1);
  }

  return min;
}

function readNvmrc() {
  let raw;
  try {
    raw = readFileSync(join(ROOT, ".nvmrc"), "utf8").trim();
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      console.error("preflight-changelog-ci: .nvmrc is missing");
      process.exit(1);
    }

    throw error;
  }

  const version = parseVersion(raw);
  if (!version) {
    console.error(
      `preflight-changelog-ci: could not parse .nvmrc version "${raw}"`,
    );
    process.exit(1);
  }

  return version;
}

const USAGE = `preflight-changelog-ci — confirm Node satisfies the repo policy, then pnpm install --frozen-lockfile

Checks the active Node against package.json engines.node and .nvmrc, then runs
\`pnpm install --frozen-lockfile\`. Optional and pnpm-specific — skip it if the
consumer repo doesn't use pnpm.

Usage:
  node preflight-changelog-ci.mjs            Run the Node-policy check + frozen install
  node preflight-changelog-ci.mjs --self-test  Run the built-in offline smoke test
  node preflight-changelog-ci.mjs --help     Show this message (alias: -h)`;

// Offline smoke test: exercise the pure version helpers — no filesystem, no
// pnpm. The exhaustive cases live in the repo's vitest suite
// (tests/skills/changelog/preflight-changelog-ci.test.ts).
function selfTest() {
  const cases = [
    {
      name: "parseVersion pads a bare major to [22, 0, 0]",
      ok: JSON.stringify(parseVersion("22")) === JSON.stringify([22, 0, 0]),
    },
    {
      name: "parseVersion strips a leading v",
      ok:
        JSON.stringify(parseVersion("v22.5.1")) === JSON.stringify([22, 5, 1]),
    },
    {
      name: "coerceMinVersion reads the lower bound from a range",
      ok:
        JSON.stringify(coerceMinVersion(">=22 <23")) ===
        JSON.stringify([22, 0, 0]),
    },
    {
      name: "coerceMinVersion treats 22.x as [22, 0, 0]",
      ok:
        JSON.stringify(coerceMinVersion("22.x")) === JSON.stringify([22, 0, 0]),
    },
    {
      name: "satisfiesGte is true for an equal-or-greater version",
      ok: satisfiesGte([22, 5, 0], [22, 0, 0]) === true,
    },
    {
      name: "satisfiesGte is false for a lesser version",
      ok: satisfiesGte([20, 0, 0], [22, 0, 0]) === false,
    },
  ];

  let failed = 0;
  for (const { name, ok } of cases) {
    if (ok) {
      console.log(`  ok    ${name}`);
    } else {
      failed += 1;
      console.log(`  FAIL  ${name}`);
    }
  }

  console.log(`\n${cases.length - failed}/${cases.length} passed`);
  process.exit(failed === 0 ? 0 : 1);
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    console.log(USAGE);
    return;
  }

  if (args.includes("--self-test")) {
    selfTest();
    return;
  }

  const active = parseVersion(process.version);
  if (!active) {
    console.error(
      `preflight-changelog-ci: could not parse active Node version "${process.version}"`,
    );
    process.exit(1);
  }

  const enginesMin = readEnginesNode();
  const nvmrc = readNvmrc();

  if (!satisfiesGte(active, enginesMin)) {
    const required = enginesMin.join(".");
    console.error(
      `Active Node is ${process.version}; this repo requires >=${required} (see package.json engines and .nvmrc).`,
    );
    console.error("Switch Node (e.g. nvm use, fnm use) and re-run.");
    process.exit(1);
  }

  if (!satisfiesGte(active, nvmrc)) {
    const recommended = nvmrc.join(".");
    console.error(
      `Active Node is ${process.version}; .nvmrc recommends ${recommended}.`,
    );
    console.error("Switch Node (e.g. nvm use, fnm use) and re-run.");
    process.exit(1);
  }

  const install = spawnSync("pnpm", ["install", "--frozen-lockfile"], {
    cwd: ROOT,
    shell: process.platform === "win32",
    stdio: "inherit",
  });

  if (install.error) {
    console.error(
      `preflight-changelog-ci: could not run pnpm — ${install.error.message}`,
    );
    process.exit(1);
  }

  if (install.status !== 0) {
    process.exit(install.status ?? 1);
  }
}

// Only run when invoked as a CLI, not when imported (e.g. by unit tests
// exercising the pure version helpers).
if (isCliEntry(import.meta.filename)) {
  main();
}
