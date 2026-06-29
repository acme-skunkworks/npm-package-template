#!/usr/bin/env node
// Symmetric reply + resolve helper for the triage-pr skill (Phase B RESPOND).
//
// `review-threads.mjs` is read-only: it FETCHES unresolved feedback. This script
// is the write side — it acknowledges findings on the PR and resolves threads,
// symmetrically for accepts and declines, plus a consolidated acknowledgement for
// issue-level review comments (Claude's whole-review comment, CodeRabbit's sticky
// summary) that have no resolvable thread.
//
// The pure planning/formatting layer is kept apart from the `gh` mutation layer
// so the symmetry, idempotency, and `replyOnAccept` rules are unit-tested by
// `--self-test` (and the root vitest suite) without touching a live PR. Only the
// CLI subcommands `thread` and `summary` perform mutations.
//
// Idempotency: every reply/comment we author carries a hidden HTML-comment marker.
// On a re-run (a fix push re-triggers review), planning skips threads already
// carrying our marker, and the consolidated comment is edited in place rather than
// re-posted, so the loop converges without double-posting.
//
// Canonical resolve mechanism (recorded in references/review-discipline.md):
// GitHub's GraphQL `resolveReviewThread` is the only PER-THREAD programmatic
// resolve (PRRT_ ids, idempotent; there is no REST equivalent). We always pair it
// with a reply — the reply is the durable, per-finding acknowledgement reviewers
// (CodeRabbit included) and humans rely on. We never use the bulk
// `@coderabbitai resolve`, which would resolve every CodeRabbit thread at once,
// including declined or not-yet-handled ones.
//
// Usage:
//   node respond-threads.mjs --self-test
//   node respond-threads.mjs thread --thread <PRRT_id> --decision accept --sha <sha>
//   node respond-threads.mjs thread --thread <PRRT_id> --decision decline --reason "<why>"
//   node respond-threads.mjs thread --thread <PRRT_id> --decision defer --reference <ticket>
//   node respond-threads.mjs thread --thread <PRRT_id> --decision accept --sha <sha> --reply-on-accept false
//   node respond-threads.mjs summary --pr <n> [--repo owner/name] --findings '<json>'
//   …add --dry-run to any mutating subcommand to print the plan without writing.

import { execFileSync } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";

// Hidden markers that let a re-run recognise our own prior output. Kept distinct
// so a thread reply is never mistaken for the issue-level summary comment.
export const THREAD_MARKER = "<!-- triage-pr:thread-ack -->";
export const SUMMARY_MARKER = "<!-- triage-pr:summary-ack -->";

const DECISIONS = new Set(["accept", "decline", "defer", "outdated"]);
const STATUSES = new Set(["accepted", "declined", "out-of-scope"]);

// Mirrors review-threads.mjs: GraphQL returns bot logins WITHOUT the `[bot]`
// suffix, so config written either way still matches.
const DEFAULT_BOTS = ["claude", "cursor", "coderabbitai"];

// ---- pure transform (no network) ----------------------------------------

/**
 * True when a thread's author is one of the configured review bots (suffix-
 * insensitive). The `thread` CLI derives human-vs-bot from this so a human
 * thread is never auto-actioned even if its id reaches the mutating path.
 */
function normaliseBot(value) {
  return String(value ?? "").replace(/\[bot\]$/, "");
}

export function isReviewBotAuthor(login, bots = DEFAULT_BOTS) {
  const set = new Set(bots.map(normaliseBot));
  return set.has(normaliseBot(login));
}

/**
 * True when a comment/reply body carries one of our acknowledgement markers.
 */
export function hasMarker(body, marker) {
  const text = String(body ?? "");
  if (marker) {
    return text.includes(marker);
  }

  return text.includes(THREAD_MARKER) || text.includes(SUMMARY_MARKER);
}

/**
 * Build the thread-reply body for an accept, decline, or defer, carrying the
 * marker. Accepts reference the fixing commit; declines carry the technical
 * reasoning; defers reference the follow-up ticket they were tracked as. No
 * sycophancy — the wording states facts only.
 */
export function buildReplyBody({ decision, reason, reference, sha }) {
  if (decision === "accept") {
    const trimmed = String(sha ?? "").trim();
    if (!trimmed) {
      throw new Error("accept reply requires a commit sha");
    }

    return `Addressed in ${trimmed}.\n\n${THREAD_MARKER}`;
  }

  if (decision === "decline") {
    const trimmed = String(reason ?? "").trim();
    if (!trimmed) {
      throw new Error("decline reply requires technical reasoning");
    }

    return `${trimmed}\n\n${THREAD_MARKER}`;
  }

  if (decision === "defer") {
    const trimmed = String(reference ?? "").trim();
    if (!trimmed) {
      throw new Error("defer reply requires a follow-up ticket reference");
    }

    return `Out of scope for this PR; tracked as ${trimmed} for follow-up.\n\n${THREAD_MARKER}`;
  }

  throw new Error(`no reply body for decision: ${decision}`);
}

/**
 * Decide, for each thread decision, what action to take — honouring the
 * human-thread guardrail, the idempotency marker, and `replyOnAccept`.
 *
 * Each decision: { threadId, decision: accept|decline|outdated|defer, sha?,
 * reason?, reference?, isHuman?, comments? }. `comments` is the thread's existing
 * comments (as returned by review-threads.mjs) — used to detect our own prior
 * reply.
 *
 * Returns one action per decision, kind ∈ { reply-resolve, resolve-only, skip }.
 * A `skip` carries `why` ∈ { human, already-handled }. Never emits a mutating
 * action for a human thread.
 */
export function planThreadResponses(decisions, { replyOnAccept = true } = {}) {
  return (decisions ?? []).map((entry) => {
    const { decision, threadId } = entry;
    if (!DECISIONS.has(decision)) {
      throw new Error(`unknown decision for ${threadId}: ${decision}`);
    }

    if (entry.isHuman) {
      return { kind: "skip", threadId, why: "human" };
    }

    const alreadyHandled = (entry.comments ?? []).some((comment) =>
      hasMarker(comment.body, THREAD_MARKER),
    );
    if (alreadyHandled) {
      return { kind: "skip", threadId, why: "already-handled" };
    }

    if (decision === "outdated") {
      // Outdated finding (cited code no longer exists): resolve, no reply.
      return { kind: "resolve-only", threadId };
    }

    if (decision === "decline") {
      return {
        body: buildReplyBody({ decision, reason: entry.reason }),
        kind: "reply-resolve",
        threadId,
      };
    }

    if (decision === "defer") {
      // Out-of-scope finding tracked as a follow-up issue: always reply with the
      // ticket reference (replyOnAccept is accept-specific and never gates this),
      // then resolve.
      return {
        body: buildReplyBody({ decision, reference: entry.reference }),
        kind: "reply-resolve",
        threadId,
      };
    }

    // accept
    if (!replyOnAccept) {
      return { kind: "resolve-only", threadId };
    }

    return {
      body: buildReplyBody({ decision, sha: entry.sha }),
      kind: "reply-resolve",
      threadId,
    };
  });
}

/**
 * Escape a markdown-table cell so a pipe or newline in a title/reason can't
 * break the consolidated comment's table.
 */
function escapeCell(value) {
  return String(value ?? "")
    .replaceAll(/\r?\n/g, " ")
    .replaceAll("|", "\\|")
    .trim();
}

/**
 * Render the reference column per finding status.
 */
function renderReference(status, reference) {
  const reference_ = escapeCell(reference);
  if (status === "accepted") {
    return reference_ ? `\`${reference_}\`` : "—";
  }

  return reference_ || "—";
}

const STATUS_LABELS = {
  accepted: "Accepted",
  declined: "Declined",
  "out-of-scope": "Out of scope",
};

/**
 * Build the single consolidated issue-level acknowledgement comment that maps
 * each finding from an issue-level review (Claude's review, CodeRabbit's sticky
 * summary) to accepted (`<sha>`) / declined (`<reason>`) / out-of-scope
 * (`<ticket>`). Carries SUMMARY_MARKER so a re-run edits it in place.
 *
 * findings: [{ title, status: accepted|declined|out-of-scope, reference }].
 */
export function buildConsolidatedComment(findings) {
  if (!findings || findings.length === 0) {
    // The caller is told (SKILL.md Step 11) to skip the summary step when there
    // are no issue-level findings; fail loudly rather than post a bare table.
    throw new Error("buildConsolidatedComment requires at least one finding");
  }

  const rows = findings.map((finding) => {
    if (!STATUSES.has(finding.status)) {
      throw new Error(`unknown finding status: ${finding.status}`);
    }

    return `| ${escapeCell(finding.title)} | ${STATUS_LABELS[finding.status]} | ${renderReference(
      finding.status,
      finding.reference,
    )} |`;
  });

  const body = [
    "### triage-pr — review feedback summary",
    "",
    "Acknowledging the issue-level review feedback (no resolvable thread per finding):",
    "",
    "| Finding | Outcome | Reference |",
    "| --- | --- | --- |",
    ...rows,
    "",
    SUMMARY_MARKER,
  ];
  return body.join("\n");
}

/**
 * Find our prior consolidated comment among a PR's issue comments, so the
 * summary is edited in place rather than duplicated. Returns the matching
 * comment (with its `id`) or null.
 */
export function findExistingAckComment(comments) {
  return (
    (comments ?? []).find((comment) =>
      hasMarker(comment.body, SUMMARY_MARKER),
    ) ?? null
  );
}

// ---- argument parsing ----------------------------------------------------

/**
 * Parse a subcommand's flags into an options object. Throws on a flag missing
 * its value, a stray positional, or — when `allowed` is given — an unknown flag.
 * `allowed` is the camelCased keys a subcommand accepts (e.g. `["thread",
 * "decision"]`); `--dry-run` is always permitted. Passing it makes an operator
 * typo (`--reply-on-accep`) fail fast instead of being silently stored.
 */
export function parseArgs(argv, allowed) {
  const allow = allowed ? new Set([...allowed, "dryRun"]) : null;
  const options = { dryRun: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--dry-run") {
      options.dryRun = true;
      continue;
    }

    if (!argument.startsWith("--")) {
      throw new Error(`unexpected argument: ${argument}`);
    }

    const value = argv[++index];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`${argument} requires a value`);
    }

    // --reply-on-accept → replyOnAccept, --thread → thread, …
    const key = argument
      .slice(2)
      .replaceAll(/-([a-z])/g, (_, char) => char.toUpperCase());
    if (allow && !allow.has(key)) {
      throw new Error(`unknown option: ${argument}`);
    }

    options[key] = value;
  }

  return options;
}

// The flags each subcommand accepts (camelCased), passed to parseArgs so an
// unrecognised flag throws rather than being silently ignored.
const THREAD_FLAGS = [
  "thread",
  "decision",
  "sha",
  "reason",
  "reference",
  "replyOnAccept",
  "bots",
];
const SUMMARY_FLAGS = ["pr", "repo", "findings"];

/**
 * Coerce a --reply-on-accept string to a boolean (default true).
 */
export function parseReplyOnAccept(value) {
  if (value === undefined) {
    return true;
  }

  if (value === "true" || value === "false") {
    return value === "true";
  }

  throw new Error("--reply-on-accept must be true or false");
}

// ---- network layer (gh) --------------------------------------------------

/**
 * Run a `gh` command and return stdout; 30s timeout so a stalled call can't hang.
 */
function gh(args) {
  return execFileSync("gh", args, {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    timeout: 30_000,
  });
}

/**
 * Run a GraphQL mutation/query via `gh api graphql`, typing each variable.
 */
function ghGraphQL(query, variables) {
  const args = ["api", "graphql", "-f", `query=${query}`];
  for (const [key, value] of Object.entries(variables)) {
    if (value === null || value === undefined) {
      continue;
    }

    if (typeof value === "number" || typeof value === "boolean") {
      args.push("-F", `${key}=${value}`);
    } else {
      args.push("-f", `${key}=${value}`);
    }
  }

  return JSON.parse(gh(args));
}

/**
 * Return the current repository as `owner/name`.
 */
function detectRepo() {
  return gh([
    "repo",
    "view",
    "--json",
    "nameWithOwner",
    "-q",
    ".nameWithOwner",
  ]).trim();
}

const REPLY_MUTATION = `mutation($threadId:ID!,$body:String!){
  addPullRequestReviewThreadReply(input:{pullRequestReviewThreadId:$threadId, body:$body}){
    comment{ id }
  }
}`;

const RESOLVE_MUTATION = `mutation($threadId:ID!){
  resolveReviewThread(input:{threadId:$threadId}){ thread{ isResolved } }
}`;

const THREAD_COMMENTS_QUERY = `query($threadId:ID!){
  node(id:$threadId){
    ... on PullRequestReviewThread {
      comments(first:100){ nodes{ author{ login } body } }
    }
  }
}`;

/**
 * Fetch a single review thread's existing comments as `{ author, body }`, so the
 * marker check in planThreadResponses can skip a thread we already replied to.
 */
function fetchThreadComments(threadId) {
  const data = ghGraphQL(THREAD_COMMENTS_QUERY, { threadId });
  const nodes = data.data?.node?.comments?.nodes ?? [];
  return nodes.map((commentNode) => ({
    author: commentNode.author?.login ?? "unknown",
    body: commentNode.body ?? "",
  }));
}

/**
 * Post a reply on a review thread.
 */
function addReviewThreadReply(threadId, body) {
  ghGraphQL(REPLY_MUTATION, { body, threadId });
}

/**
 * Resolve a review thread (idempotent — safe on an already-resolved thread).
 */
function resolveReviewThread(threadId) {
  ghGraphQL(RESOLVE_MUTATION, { threadId });
}

/**
 * Fetch a PR's issue comments (REST, up to 100) as `{ id, user, body }`.
 */
function fetchIssueComments(repo, number) {
  const out = gh([
    "api",
    "-X",
    "GET",
    `repos/${repo}/issues/${number}/comments`,
    "-F",
    "per_page=100",
  ]);
  return JSON.parse(out).map((comment) => ({
    body: comment.body ?? "",
    id: comment.id,
    user: comment.user?.login ?? "unknown",
  }));
}

/**
 * Create or edit the consolidated comment in place (upsert via the marker).
 */
function upsertIssueComment(repo, number, body, existingId) {
  if (existingId) {
    gh([
      "api",
      "-X",
      "PATCH",
      `repos/${repo}/issues/comments/${existingId}`,
      "-f",
      `body=${body}`,
    ]);
    return { action: "edited", id: existingId };
  }

  const out = gh([
    "api",
    "-X",
    "POST",
    `repos/${repo}/issues/${number}/comments`,
    "-f",
    `body=${body}`,
  ]);
  return { action: "created", id: JSON.parse(out).id };
}

// ---- subcommands ---------------------------------------------------------

/**
 * `thread` — reply to (per replyOnAccept / decision) and resolve one thread.
 */
function runThread(options) {
  const { decision, thread: threadId } = options;
  if (!threadId) {
    throw new Error("thread requires --thread <PRRT_id>");
  }

  if (!DECISIONS.has(decision)) {
    throw new Error("thread requires --decision accept|decline|outdated|defer");
  }

  const replyOnAccept = parseReplyOnAccept(options.replyOnAccept);
  const bots = options.bots
    ? options.bots
        .split(",")
        .map((bot) => bot.trim())
        .filter(Boolean)
    : DEFAULT_BOTS;

  // On a real run, feed the thread's existing comments into the planner so a
  // retry (e.g. the reply landed but a prior resolve failed) is recognised as
  // already-handled and doesn't double-post. Dry-run stays network-free.
  const comments = options.dryRun ? undefined : fetchThreadComments(threadId);
  // Defence in depth: classify the thread from its author against the configured
  // review bots, so a human thread id reaching this CLI path is skipped, never
  // auto-actioned. Only derivable on a real run (comments fetched).
  const isHuman =
    comments !== undefined && !isReviewBotAuthor(comments[0]?.author, bots);
  const [action] = planThreadResponses(
    [
      {
        comments,
        decision,
        isHuman,
        reason: options.reason,
        reference: options.reference,
        sha: options.sha,
        threadId,
      },
    ],
    { replyOnAccept },
  );

  if (options.dryRun) {
    console.log(JSON.stringify(action, null, 2));
    return;
  }

  // A human thread is never auto-actioned — not even resolved. Every other
  // outcome (reply-resolve, resolve-only, or an already-handled skip from a
  // half-finished prior run) ends resolved; only reply-resolve posts a reply.
  if (action.kind === "skip" && action.why === "human") {
    console.log(JSON.stringify({ ...action, done: false }, null, 2));
    return;
  }

  if (action.kind === "reply-resolve") {
    addReviewThreadReply(threadId, action.body);
  }

  resolveReviewThread(threadId);
  console.log(JSON.stringify({ ...action, done: true }, null, 2));
}

/**
 * Read the --findings value: an inline JSON string or `@path` to a JSON file.
 */
function readFindings(raw) {
  if (!raw) {
    throw new Error("summary requires --findings '<json>'");
  }

  const text = raw.startsWith("@") ? readFileSync(raw.slice(1), "utf8") : raw;
  const parsed = JSON.parse(text);
  if (!Array.isArray(parsed)) {
    throw new TypeError("--findings must be a JSON array");
  }

  return parsed;
}

/**
 * `summary` — upsert the consolidated issue-level acknowledgement comment.
 */
function runSummary(options) {
  const number = Number(options.pr);
  if (!Number.isInteger(number) || number <= 0) {
    throw new Error("summary requires --pr <number>");
  }

  const repo = options.repo ?? detectRepo();
  const body = buildConsolidatedComment(readFindings(options.findings));

  if (options.dryRun) {
    console.log(body);
    return;
  }

  const existing = findExistingAckComment(fetchIssueComments(repo, number));
  const result = upsertIssueComment(repo, number, body, existing?.id);
  console.log(JSON.stringify(result, null, 2));
}

// ---- self-test -----------------------------------------------------------

/**
 * Run the built-in fixtures (no network) and exit non-zero on any failure.
 */
function selfTest() {
  const decisions = [
    { decision: "accept", sha: "abc1234", threadId: "T_accept" },
    {
      decision: "decline",
      reason: "Breaks the public API.",
      threadId: "T_decline",
    },
    { decision: "outdated", threadId: "T_outdated" },
    { decision: "defer", reference: "A-601", threadId: "T_defer" },
    {
      decision: "defer",
      isHuman: true,
      reference: "A-602",
      threadId: "T_defer_human",
    },
    { decision: "accept", isHuman: true, sha: "deadbee", threadId: "T_human" },
    {
      comments: [{ author: "me", body: `Addressed in x.\n\n${THREAD_MARKER}` }],
      decision: "accept",
      sha: "feed123",
      threadId: "T_done",
    },
  ];
  const planned = planThreadResponses(decisions);
  const byId = Object.fromEntries(planned.map((a) => [a.threadId, a]));

  const noReply = planThreadResponses(
    [{ decision: "accept", sha: "abc1234", threadId: "T_accept" }],
    { replyOnAccept: false },
  );

  const summary = buildConsolidatedComment([
    {
      reference: "abc1234",
      status: "accepted",
      title: "Read missing from allowed-tools",
    },
    {
      reference: "out of scope per YAGNI",
      status: "declined",
      title: "Add retry wrapper",
    },
    {
      reference: "A-411",
      status: "out-of-scope",
      title: "Refactor fetch layer",
    },
  ]);

  const existing = findExistingAckComment([
    { body: "lgtm", id: 1, user: "human" },
    { body: `### summary\n${SUMMARY_MARKER}`, id: 2, user: "me" },
  ]);

  const cases = [
    {
      name: "accepted thread → reply-resolve referencing the sha",
      ok:
        byId.T_accept.kind === "reply-resolve" &&
        byId.T_accept.body.includes("abc1234") &&
        byId.T_accept.body.includes(THREAD_MARKER),
    },
    {
      name: "declined thread → reply-resolve with reasoning",
      ok:
        byId.T_decline.kind === "reply-resolve" &&
        byId.T_decline.body.includes("Breaks the public API."),
    },
    {
      name: "outdated thread → resolve-only, no reply",
      ok:
        byId.T_outdated.kind === "resolve-only" && !("body" in byId.T_outdated),
    },
    {
      name: "deferred thread → reply-resolve referencing the ticket",
      ok:
        byId.T_defer.kind === "reply-resolve" &&
        byId.T_defer.body.includes("A-601") &&
        byId.T_defer.body.includes("for follow-up") &&
        byId.T_defer.body.includes(THREAD_MARKER),
    },
    {
      name: "human thread is never auto-actioned (defer)",
      ok:
        byId.T_defer_human.kind === "skip" &&
        byId.T_defer_human.why === "human",
    },
    {
      name: "human thread is never auto-actioned",
      ok: byId.T_human.kind === "skip" && byId.T_human.why === "human",
    },
    {
      name: "thread already carrying our marker is skipped (idempotent)",
      ok: byId.T_done.kind === "skip" && byId.T_done.why === "already-handled",
    },
    {
      name: "replyOnAccept:false → accept resolves without a reply",
      ok: noReply[0].kind === "resolve-only",
    },
    {
      name: "accept reply without a sha throws",
      ok: (() => {
        try {
          buildReplyBody({ decision: "accept" });
          return false;
        } catch {
          return true;
        }
      })(),
    },
    {
      name: "decline reply without reasoning throws",
      ok: (() => {
        try {
          buildReplyBody({ decision: "decline", reason: "  " });
          return false;
        } catch {
          return true;
        }
      })(),
    },
    {
      name: "defer reply without a reference throws",
      ok: (() => {
        try {
          buildReplyBody({ decision: "defer", reference: "  " });
          return false;
        } catch {
          return true;
        }
      })(),
    },
    {
      name: "consolidated comment tabulates each status + carries the marker",
      ok:
        summary.includes(
          "| Read missing from allowed-tools | Accepted | `abc1234` |",
        ) &&
        summary.includes("Declined") &&
        summary.includes("Out of scope") &&
        summary.includes(SUMMARY_MARKER),
    },
    {
      name: "table cells escape pipes",
      ok: buildConsolidatedComment([
        { reference: "a|b", status: "declined", title: "x|y" },
      ]).includes("x\\|y"),
    },
    {
      name: "findExistingAckComment matches the marker-bearing comment",
      ok: existing?.id === 2,
    },
    {
      name: "findExistingAckComment returns null when absent",
      ok: findExistingAckComment([{ body: "lgtm", id: 1, user: "h" }]) === null,
    },
    {
      name: "parseReplyOnAccept defaults to true, parses booleans",
      ok:
        parseReplyOnAccept(undefined) === true &&
        parseReplyOnAccept("false") === false &&
        parseReplyOnAccept("true") === true,
    },
    {
      name: "parseReplyOnAccept throws on a non-boolean",
      ok: (() => {
        try {
          parseReplyOnAccept("yes");
          return false;
        } catch {
          return true;
        }
      })(),
    },
    {
      name: "parseArgs reads flags and --dry-run, camel-cases keys",
      ok: (() => {
        const parsed = parseArgs([
          "--thread",
          "PRRT_1",
          "--reply-on-accept",
          "false",
          "--dry-run",
        ]);
        return (
          parsed.thread === "PRRT_1" &&
          parsed.replyOnAccept === "false" &&
          parsed.dryRun === true
        );
      })(),
    },
    {
      name: "parseArgs throws when a flag lacks a value",
      ok: (() => {
        try {
          parseArgs(["--thread"]);
          return false;
        } catch {
          return true;
        }
      })(),
    },
    {
      name: "parseArgs rejects an unknown flag when given an allow-list",
      ok: (() => {
        try {
          parseArgs(["--reply-on-accep", "false"], ["replyOnAccept"]);
          return false;
        } catch {
          return true;
        }
      })(),
    },
    {
      name: "parseArgs accepts an allowed flag (and --dry-run) with a list",
      ok: (() => {
        const parsed = parseArgs(
          ["--reply-on-accept", "false", "--dry-run"],
          ["replyOnAccept"],
        );
        return parsed.replyOnAccept === "false" && parsed.dryRun === true;
      })(),
    },
    {
      name: "already-handled thread (with comments) skips, not reply",
      ok: (() => {
        const [action] = planThreadResponses([
          {
            comments: [{ author: "me", body: `x\n\n${THREAD_MARKER}` }],
            decision: "accept",
            sha: "abc",
            threadId: "T_retry",
          },
        ]);
        return action.kind === "skip" && action.why === "already-handled";
      })(),
    },
    {
      name: "buildConsolidatedComment throws on no findings",
      ok: (() => {
        try {
          buildConsolidatedComment([]);
          return false;
        } catch {
          return true;
        }
      })(),
    },
    {
      name: "isReviewBotAuthor matches bots (suffix-insensitive), rejects humans",
      ok:
        isReviewBotAuthor("coderabbitai", ["coderabbitai"]) === true &&
        isReviewBotAuthor("claude[bot]", ["claude"]) === true &&
        isReviewBotAuthor("RobEasthope", ["claude", "coderabbitai"]) === false,
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

// ---- main ----------------------------------------------------------------

/**
 * CLI entry: dispatch to a subcommand.
 */
const USAGE = `respond-threads — reply to and resolve AI review threads on a PR

Usage:
  respond-threads thread  --thread <PRRT_id> --decision <accept|decline|outdated|defer> [--sha <sha>] [--reason <text>] [--reference <ticket>] [--reply-on-accept <true|false>] [--bots <csv>] [--dry-run]
  respond-threads summary --pr <number> --findings <json> [--repo <owner/name>] [--dry-run]
  respond-threads --self-test
  respond-threads --help

Subcommands:
  thread     Reply to and resolve a single review thread by its decision
             (defer replies with the follow-up ticket from --reference, then resolves).
  summary    Upsert the consolidated issue-level acknowledgement comment.

Other:
  --dry-run    Print the planned gh calls and change nothing (no replies, no resolves).
  --self-test  Run the built-in offline assertions (no network).
  --help, -h   Show this message.`;

function main() {
  const argv = process.argv.slice(2);
  const command = argv[0];
  if (command === "--self-test") {
    selfTest();
    return;
  }

  if (command === "--help" || command === "-h") {
    console.log(USAGE);
    return;
  }

  try {
    if (command === "thread") {
      runThread(parseArgs(argv.slice(1), THREAD_FLAGS));
    } else if (command === "summary") {
      runSummary(parseArgs(argv.slice(1), SUMMARY_FLAGS));
    } else {
      throw new Error(
        `unknown command: ${command ?? "(none)"} — expected thread | summary | --self-test | --help`,
      );
    }
  } catch (error) {
    console.error(`respond-threads: ${error.message}`);
    process.exit(error.code === "ENOENT" ? 1 : 2);
  }
}

/**
 * Detect "run directly as a CLI" vs "imported as a module" — realpath both
 * sides so symlinked stores / macOS /var → /private/var don't break the compare.
 */
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
