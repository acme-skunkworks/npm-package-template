#!/usr/bin/env node
import { loadConfig } from "./lib/config.mjs";
import { buildIssueRe } from "./lib/vendor/issue-keys.mjs";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { argv } from "node:process";

const {
  changelogDir: CHANGELOG_DIR,
  issueKeys: TEAM_KEYS,
  linearWorkspaceSlug: WORKSPACE,
} = loadConfig();

// `null` when no issue keys are configured (the empty-alternation guard lives in
// buildIssueRe). The matcher construction is the canonical, vendored
// lib/issue-keys.mjs (ADR-0004) — shared with linear-sync / cleanup-repo.
const ISSUE_RE = buildIssueRe(TEAM_KEYS);
const FENCE_RE = /```[\s\S]*?```/g;
const INLINE_CODE_RE = /`[^`]*`/g;
const ALREADY_LINKED_RE = /\[[^\]]*\]\([^)]*\)/g;
// Reference-link definition lines — `[A-123]: <url>`, plus any indented
// continuation lines. The label here is the definition's key, not prose, so
// masking it stops `ISSUE_RE` rewriting it into `[[A-123](url)]: <url>` and
// breaking the reference. CommonMark allows up to three leading spaces before
// the label (four or more would be an indented code block), so allow `{0,3}`.
// Must run before `REFERENCE_LINKED_RE` so a definition is never partially
// consumed as an in-text label.
const REFERENCE_DEFINITION_RE = /^ {0,3}\[[^\]]+\]:[^\n]*(?:\n[ \t][^\n]*)*/gm;
// Reference-style links — `[text][ref]` and the collapsed `[text][]` — also
// already point at a definition, so mask them too. Without this, `ISSUE_RE`
// rewrites inside the label (`[A-1][1]` -> `[[A-1](url)][1]`) and re-runs
// compound the corruption.
const REFERENCE_LINKED_RE = /\[[^\]]*\]\[[^\]]*\]/g;

function buildUrl(id) {
  return `https://linear.app/${WORKSPACE}/issue/${id}`;
}

export function rewriteBody(body) {
  if (!ISSUE_RE) {
    return body;
  }

  // Mask fenced/inline code and existing links so issue-like text inside them
  // isn't linkified. Tokens are delimited with NUL bytes, which cannot occur in
  // a UTF-8 text file, so a token can never collide with real prose on restore
  // (the previous bare `FENCE0`/`INLINE1`/`LINK2` tokens could).
  const masks = [];
  function mask(match) {
    masks.push(match);
    return `\u0000CR_MASK_${masks.length - 1}\u0000`;
  }

  const masked = body
    .replaceAll(FENCE_RE, mask)
    .replaceAll(INLINE_CODE_RE, mask)
    .replaceAll(ALREADY_LINKED_RE, mask)
    .replaceAll(REFERENCE_DEFINITION_RE, mask)
    .replaceAll(REFERENCE_LINKED_RE, mask)
    .replace(ISSUE_RE, (id) => `[${id}](${buildUrl(id)})`);

  return masked.replaceAll(
    /\0CR_MASK_(\d+)\0/g,
    (_, index) => masks[Number(index)],
  );
}

export function splitFrontmatter(raw) {
  // Match the opening/closing `---` fences with either LF or CRLF endings so a
  // file authored on Windows isn't treated as having no frontmatter (which
  // would let `rewriteBody` rewrite the frontmatter region too).
  const match = raw.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n/);
  if (!match) {
    return { body: raw, fm: "" };
  }

  return { body: raw.slice(match[0].length), fm: match[0] };
}

const USAGE = `add-links — rewrite bare Linear issue IDs in changelog bodies to Linear URLs

Usage:
  node add-links.mjs                 Linkify every changelog/<ts>-<slug>.md body (writes)
  node add-links.mjs --check         Report which files would change; write nothing
  node add-links.mjs --dry-run       Alias for --check
  node add-links.mjs --self-test     Run the built-in offline smoke test
  node add-links.mjs --help          Show this message (alias: -h)

--check exits 1 when a rewrite is needed, 0 when nothing would change.`;

// Offline smoke test for the pure rewriteBody: linkify a sample body and check
// the masking rules (fenced/inline code and existing links are left alone).
// The exhaustive cases live in the repo's vitest suite
// (infrastructure/tests/add-links*.test.ts); this is a light wiring check with
// no filesystem or network access. The exact linkification depends on the
// configured issue keys, so where a key is configured we assert it is linked;
// either way we assert the masking invariants that hold regardless of config.
function selfTest() {
  const cases = [];

  // Masking invariants hold whatever the config: an already-linked ID and an
  // inline-code ID must survive a rewrite untouched.
  const alreadyLinked = "See [A-1](https://example.test/A-1) for context.";
  cases.push({
    name: "an already-linked issue ID is left untouched",
    ok: rewriteBody(alreadyLinked) === alreadyLinked,
  });

  const inlineCode = "The token `A-1` is code, not a link.";
  cases.push({
    name: "an issue ID inside inline code is not linkified",
    ok: rewriteBody(inlineCode) === inlineCode,
  });

  const fenced = "```\nA-1 in a fence\n```";
  cases.push({
    name: "an issue ID inside a code fence is not linkified",
    ok: rewriteBody(fenced) === fenced,
  });

  // When the host config has issue keys, a bare ID for the first key linkifies.
  if (ISSUE_RE && TEAM_KEYS.length > 0) {
    const key = TEAM_KEYS[0];
    const id = `${key}-123`;
    const before = `Closes ${id}.`;
    const after = rewriteBody(before);
    cases.push({
      name: `a bare ${id} is rewritten to a Linear link`,
      ok: after === `Closes [${id}](${buildUrl(id)}).`,
    });
  } else {
    cases.push({
      name: "no issue keys configured — rewriteBody is a no-op",
      ok: rewriteBody("Closes A-1.") === "Closes A-1.",
    });
  }

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
  const args = argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    console.log(USAGE);
    return;
  }

  if (args.includes("--self-test")) {
    selfTest();
    return;
  }

  // --check (alias --dry-run): report which files would be rewritten and write
  // nothing. Exit 0 when nothing would change, 1 when a rewrite is needed —
  // prettier-style, so CI can gate on it.
  const check = args.some(
    (argument) => argument === "--check" || argument === "--dry-run",
  );

  let stat;
  try {
    stat = statSync(CHANGELOG_DIR);
  } catch {
    console.error(`changelog directory not found: ${CHANGELOG_DIR}`);
    process.exit(2);
  }

  if (!stat.isDirectory()) {
    console.error(`${CHANGELOG_DIR} is not a directory`);
    process.exit(2);
  }

  const files = readdirSync(CHANGELOG_DIR)
    .filter((name) => name.endsWith(".md") && name !== "README.md")
    .map((name) => join(CHANGELOG_DIR, name));

  let touched = 0;
  for (const file of files) {
    const raw = readFileSync(file, "utf8");
    const { body, fm } = splitFrontmatter(raw);
    const next = rewriteBody(body);
    if (next !== body) {
      if (!check) {
        writeFileSync(file, fm + next);
      }

      touched++;
      console.log(
        check ? `[check] would rewrite: ${file}` : `rewrote: ${file}`,
      );
    }
  }

  if (check) {
    console.log(
      `[check] Linear link rewriting: ${touched} file(s) would be updated.`,
    );
    process.exit(touched > 0 ? 1 : 0);
  }

  console.log(`Linear link rewriting complete. ${touched} file(s) updated.`);
}

// Only run the filesystem pass when invoked as a CLI, not when imported (e.g.
// by unit tests exercising `rewriteBody`).
if (argv[1] && import.meta.filename === argv[1]) {
  main();
}
