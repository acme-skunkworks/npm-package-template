#!/usr/bin/env node
// Unresolved-review-feedback fetcher for the triage-pr skill.
//
// Fetches a pull request's review feedback via `gh api graphql` and prints
// minimal JSON, so Phase B can triage findings without pulling whole comment
// payloads into context. Two shapes of feedback are surfaced separately because
// they live in different GitHub objects:
//
//   - unresolvedThreads : inline review threads with `isResolved == false`,
//                         raised by a configured review bot. Each is trimmed to
//                         { threadId, path, line, isOutdated, author, comments }.
//   - deferredThreads   : the same, for bot threads already carrying our
//                         non-resolving defer marker (recorded at SKILL.md Step 8
//                         but not yet ticketed/resolved at Step 10). Bucketed apart
//                         so they are NOT re-emitted as fresh findings on the next
//                         pass, and so a fresh invocation can rediscover the pending
//                         defers it holds no in-memory record of.
//   - humanThreads      : the same, for threads NOT raised by a review bot —
//                         surfaced so a human isn't silently dropped, but the
//                         skill does not auto-action them.
//   - aiSummaryComments : the headline summary a review bot posts about the whole
//                         PR, drawn from two surfaces — issue-level comments (the
//                         sticky `track_progress` / `use_sticky_comment` summary
//                         CodeRabbit/Claude edit in place) AND review-submission
//                         bodies (Cursor Bugbot's `<!-- BUGBOT_REVIEW -->` review).
//                         Neither is a review thread, so neither has `isResolved`
//                         and the reviewThreads query never returns them.
//   - botsReported      : configured bots that have settled enough to count —
//                         a sticky-marker headline in aiSummaryComments, and/or
//                         at least one unresolved/deferred thread. Plain acks
//                         (first-candidate fallbacks without a sticky marker) do
//                         NOT count, so Step 7 cannot settle on "reviewing now".
//   - botsMissing       : configured bots still without a sticky headline or thread.
//
// The network layer (gh) is kept separate from the pure transform so the
// transform is unit-tested by `--self-test` with no network access.
//
// This script is READ-ONLY — it only fetches and prints — so it has no
// `--dry-run` flag (there is nothing to preview; running it changes nothing).
// The write side lives in `respond-threads.mjs`, which is where `--dry-run`
// belongs.
//
// Usage:
//   node review-threads.mjs <pr-number-or-url>                 # minimal JSON to stdout
//   node review-threads.mjs <pr> --bots "a[bot],b[bot]"        # override review-bot logins
//   node review-threads.mjs <pr> --repo owner/name             # set repo explicitly
//   node review-threads.mjs <pr> --include-resolved            # keep resolved threads too
//   node review-threads.mjs --self-test                        # run built-in fixtures

import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";

// Common AI review-bot logins. GitHub's GraphQL API returns bot logins WITHOUT
// the `[bot]` suffix (e.g. `claude`, `coderabbitai`), whereas the REST API and
// many docs show the suffixed form (`claude[bot]`). `botMatches` normalises both
// sides, so a consumer's config can use either form.
const DEFAULT_BOTS = ["claude", "cursor", "coderabbitai"];

// Non-resolving defer marker written by respond-threads.mjs at SKILL.md Step 8. A
// bot thread bearing it in any comment is a pending follow-up, not a fresh finding,
// so buildResult buckets it into `deferredThreads`. Keep this string in sync with
// respond-threads.mjs (DEFER_PENDING_MARKER there).
const DEFER_PENDING_MARKER = "<!-- triage-pr:defer-pending -->";

// ---- pure transform (no network) ----------------------------------------

/**
 * Strip a trailing `[bot]` suffix so a login compares equal in either form.
 */
function normaliseBot(login) {
  return String(login ?? "").replace(/\[bot\]$/, "");
}

/**
 * Build a suffix-insensitive predicate matching a login against the bot list.
 */
function makeBotMatcher(bots) {
  const set = new Set(bots.map(normaliseBot));
  return (login) => set.has(normaliseBot(login));
}

/**
 * Reduce raw GraphQL comment nodes to the minimal `{ author, body }`.
 */
function trimComments(commentNodes) {
  return (commentNodes ?? []).map((commentNode) => ({
    author: commentNode.author?.login ?? "unknown",
    body: commentNode.body ?? "",
  }));
}

/**
 * Reduce a raw review-thread node to its minimal shape for the report.
 */
function shapeThread(node) {
  const comments = trimComments(node.comments?.nodes);
  return {
    author: comments[0]?.author ?? "unknown",
    comments,
    isOutdated: Boolean(node.isOutdated),
    line: node.line ?? node.originalLine ?? null,
    path: node.path ?? null,
    threadId: node.id,
  };
}

// Markers that identify a review bot's **sticky summary** comment (the headline
// review, posted/edited in place via `track_progress` / `use_sticky_comment` or a
// walkthrough) as opposed to chatter — "I'll review", command acknowledgements,
// "resolved" replies. Matched case-insensitively against the comment body.
// `BUGBOT_REVIEW` is Cursor Bugbot's marker: unlike CodeRabbit/Claude it posts its
// summary as a review-submission body (see `reviewNodes`), not an issue comment.
const STICKY_MARKERS = [
  /use_sticky_comment/i,
  /track_progress/i,
  /\bwalkthrough\b/i,
  /auto-generated comment/i,
  /\bsummary by\b/i,
  /<!--\s*BUGBOT_REVIEW\s*-->/i,
];

// Cursor Bugbot's free-tier "not reviewed" upsell — the only issue-level comment it
// posts, and never a real summary. Excluded from summary candidates by its literal
// text (the `<!-- BUGBOT_FREE_TIER_DISABLED_UPSELL -->` marker is too recent to rely
// on across a bot's back-catalogue of PRs).
const NOT_ENABLED_NOTICE = /Bugbot is not enabled for your account/i;

/**
 * Whether a body is worth considering as a headline summary. Rejects blank bodies
 * (e.g. an approval review with no text) and Bugbot's "not enabled" upsell.
 * @param {string} body
 * @returns {boolean}
 */
function isSummaryCandidate(body) {
  const text = String(body ?? "").trim();
  return text.length > 0 && !NOT_ENABLED_NOTICE.test(text);
}

/**
 * Whether a comment body carries a sticky-summary marker.
 * @param {string} body
 * @returns {boolean}
 */
export function hasStickyMarker(body) {
  return STICKY_MARKERS.some((marker) => marker.test(body ?? ""));
}

/**
 * Pick at most one summary comment per review bot. Filtering candidates by `isBot`
 * alone surfaces *every* bot comment — walkthrough chatter, command
 * acknowledgements — as "the headline review", inflating Phase B context. Instead,
 * keep each bot's **latest marker-bearing** candidate, falling back to its **first**
 * candidate when none carries a sticky marker. Input order is GitHub's chronological
 * order, so "latest marker-bearing" means a fresh summary always supersedes an older
 * one: an initial "reviewing…" ack (no marker) is upgraded to the real summary, and a
 * re-review's new summary replaces the previous one. That re-review case matters for a
 * bot like Bugbot, which submits a **fresh** `<!-- BUGBOT_REVIEW -->` review per commit
 * rather than editing one comment in place — without preferring the latest, a stale
 * headline would stick. A later *non*-marker candidate never downgrades a real summary.
 *
 * Candidates come from two surfaces, concatenated by the caller as
 * `[...issueComments, ...reviewBodies]` — issue comments seen first, review bodies
 * second. A review-only bot (Bugbot, whose summary is a `<!-- BUGBOT_REVIEW -->`
 * review body) surfaces via its review; the upsell it also posts as an issue comment
 * is dropped by `isSummaryCandidate`. For a bot that posts a marker on **both**
 * surfaces (e.g. CodeRabbit — a sticky issue comment and a walkthrough review body),
 * the review body wins because it is concatenated later and "latest marker wins". That
 * is deliberate and harmless: the two surfaces carry equivalent summary content, and
 * only one summary per bot is surfaced either way. Blank bodies and Bugbot's "not
 * enabled" upsell are dropped by `isSummaryCandidate`.
 * @param {Array<{author?: {login?: string}, body?: string, id?: string}>} commentNodes
 * @param {(login: string|undefined) => boolean} isBot
 */
export function selectSummaryComments(commentNodes, isBot) {
  /** @type {Map<string, {author: string, body: string, commentId: string}>} */
  const byAuthor = new Map();
  for (const node of commentNodes ?? []) {
    const login = node.author?.login;
    if (!isBot(login) || !isSummaryCandidate(node.body)) {
      continue;
    }

    const shaped = {
      author: login ?? "unknown",
      body: node.body ?? "",
      commentId: node.id,
    };
    const existing = byAuthor.get(shaped.author);
    if (!existing || hasStickyMarker(shaped.body)) {
      // First candidate for this bot, or a later marker-bearing one — the latter is
      // the freshest real summary, so it supersedes whatever was stored (an earlier
      // ack, or an earlier marker-bearing summary from a prior review round). A later
      // candidate WITHOUT a marker is left to fall through, never displacing a stored
      // summary with chatter.
      byAuthor.set(shaped.author, shaped);
    }
  }

  return [...byAuthor.values()];
}

/**
 * True when any of a thread's comments carries the non-resolving defer marker.
 */
function isDeferPending(thread) {
  return thread.comments.some((comment) =>
    String(comment.body ?? "").includes(DEFER_PENDING_MARKER),
  );
}

/**
 * Build the minimal result from raw GraphQL nodes. Splitting bot threads from
 * human threads honours the skill's "AI bots only" contract while still
 * surfacing human threads for the report. A bot thread already bearing our
 * non-resolving defer marker is bucketed apart into `deferredThreads` so it is not
 * re-emitted as a fresh finding (and stays rediscoverable by a later invocation).
 */
export function buildResult({
  bots,
  commentNodes,
  includeResolved = false,
  isDraft,
  number,
  reviewNodes = [],
  threadNodes,
}) {
  const isBot = makeBotMatcher(bots);
  const unresolvedThreads = [];
  const deferredThreads = [];
  const humanThreads = [];

  for (const node of threadNodes ?? []) {
    if (!includeResolved && node.isResolved) {
      continue;
    }

    const thread = shapeThread(node);
    if (!isBot(thread.author)) {
      humanThreads.push(thread);
    } else if (isDeferPending(thread)) {
      deferredThreads.push(thread);
    } else {
      unresolvedThreads.push(thread);
    }
  }

  // Issue comments first so issue-comment bots keep their existing summary; review
  // bodies (Bugbot's `<!-- BUGBOT_REVIEW -->`) follow so a review-only bot surfaces.
  const aiSummaryComments = selectSummaryComments(
    [...(commentNodes ?? []), ...(reviewNodes ?? [])],
    isBot,
  );

  // Settle helpers for the Phase B hybrid wait (SKILL.md Step 7). A bot counts as
  // reported only when it has a *sticky-marker* headline (not a bare ack that
  // selectSummaryComments keeps as first-candidate fallback) and/or has posted
  // an actionable unresolved/deferred thread.
  const configuredBots = (bots ?? DEFAULT_BOTS).map(normaliseBot);
  const reportedSet = new Set();

  for (const comment of aiSummaryComments) {
    if (hasStickyMarker(comment.body)) {
      reportedSet.add(normaliseBot(comment.author));
    }
  }

  for (const thread of [...unresolvedThreads, ...deferredThreads]) {
    reportedSet.add(normaliseBot(thread.author));
  }

  const botsReported = configuredBots.filter((bot) => reportedSet.has(bot));
  const botsMissing = configuredBots.filter((bot) => !reportedSet.has(bot));

  return {
    aiSummaryComments,
    botsMissing,
    botsReported,
    deferredThreads,
    humanThreads,
    isDraft: Boolean(isDraft),
    pr: number,
    unresolvedThreads,
  };
}

// ---- argument parsing ----------------------------------------------------

/**
 * Parse argv into `{ pr, bots, repo, includeResolved }`; throws on a flag missing its value, an unknown `--flag`, or a malformed `--repo`.
 */
export function parseArgs(argv) {
  const options = {
    bots: DEFAULT_BOTS,
    includeResolved: false,
    pr: null,
    repo: null,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--include-resolved") {
      options.includeResolved = true;
    } else if (argument === "--bots") {
      const value = argv[++index];
      if (!value || value.startsWith("--")) {
        throw new Error("--bots requires a comma-separated list of bot logins");
      }

      options.bots = value
        .split(",")
        .map((source) => source.trim())
        .filter(Boolean);
      if (options.bots.length === 0) {
        throw new Error("--bots requires at least one non-empty bot login");
      }
    } else if (argument === "--repo") {
      const value = argv[++index];
      if (!value || value.startsWith("--")) {
        throw new Error("--repo requires an owner/name value");
      }

      if (!/^[^/\s]+\/[^/\s]+$/.test(value)) {
        throw new Error("--repo must be exactly owner/name");
      }

      options.repo = value;
    } else if (!argument.startsWith("--") && options.pr === null) {
      options.pr = argument;
    } else if (argument.startsWith("--")) {
      throw new Error(`unknown option: ${argument}`);
    } else {
      throw new Error(`unexpected argument: ${argument}`);
    }
  }

  return options;
}

/**
 * Accept a bare number or a full PR URL; return `{ number, repo }`.
 */
export function resolvePr(prArgument, repoArgument) {
  if (prArgument === null) {
    throw new Error("no PR number or URL given");
  }

  const urlMatch = String(prArgument).match(
    /github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/,
  );
  if (urlMatch) {
    return {
      number: Number(urlMatch[3]),
      repo: `${urlMatch[1]}/${urlMatch[2]}`,
    };
  }

  const number = Number(prArgument);
  if (!Number.isInteger(number) || number <= 0) {
    throw new Error(`not a PR number or URL: ${prArgument}`);
  }

  return { number, repo: repoArgument };
}

// ---- network layer (gh) --------------------------------------------------

/**
 * Run a `gh` command and return stdout; 30s timeout so a stalled call can't hang.
 */
function gh(args) {
  return execFileSync("gh", args, {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    timeout: 30_000, // don't hang forever if a gh call stalls
  });
}

/**
 * Run a GraphQL query via `gh api graphql`, typing each variable as -f/-F.
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

const THREADS_QUERY = `query($owner:String!,$name:String!,$number:Int!,$cursor:String){
  repository(owner:$owner,name:$name){
    pullRequest(number:$number){
      isDraft
      reviewThreads(first:100, after:$cursor){
        pageInfo{ hasNextPage endCursor }
        nodes{
          id isResolved isOutdated path line originalLine
          comments(first:100){ nodes{ author{ login } body } }
        }
      }
    }
  }
}`;

const COMMENTS_QUERY = `query($owner:String!,$name:String!,$number:Int!,$cursor:String){
  repository(owner:$owner,name:$name){
    pullRequest(number:$number){
      comments(first:100, after:$cursor){
        pageInfo{ hasNextPage endCursor }
        nodes{ id author{ login } body }
      }
    }
  }
}`;

// Review submissions carry the headline summary for bots that post one as a review
// rather than an issue comment (Cursor Bugbot). `state` is selected for context but
// not acted on — Bugbot is always COMMENTED, so it never gates the merge.
const REVIEWS_QUERY = `query($owner:String!,$name:String!,$number:Int!,$cursor:String){
  repository(owner:$owner,name:$name){
    pullRequest(number:$number){
      reviews(first:100, after:$cursor){
        pageInfo{ hasNextPage endCursor }
        nodes{ id author{ login } body state }
      }
    }
  }
}`;

/**
 * Page through a PR sub-connection, collecting every node. Also returns
 * `isDraft`, which is meaningful only for queries that select it (the threads
 * query) and `undefined` otherwise — callers read it from the threads call alone.
 */
function fetchAll(query, owner, name, number, pick) {
  const nodes = [];
  let cursor = null;
  let isDraft;
  do {
    const data = ghGraphQL(query, { cursor, name, number, owner });
    const pr = data.data.repository.pullRequest;
    if (pr.isDraft !== undefined) {
      isDraft = pr.isDraft;
    }

    const conn = pick(pr);
    nodes.push(...conn.nodes);
    cursor = conn.pageInfo.hasNextPage ? conn.pageInfo.endCursor : null;
  } while (cursor);

  return { isDraft, nodes };
}

/**
 * Fetch a PR's review threads and issue comments from GitHub.
 */
function fetchFromGitHub(number, repo) {
  const nameWithOwner = repo ?? detectRepo();
  const parts = nameWithOwner.split("/");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new Error(`could not resolve repo: ${nameWithOwner}`);
  }

  const [owner, name] = parts;
  const threads = fetchAll(
    THREADS_QUERY,
    owner,
    name,
    number,
    (pr) => pr.reviewThreads,
  );
  const comments = fetchAll(
    COMMENTS_QUERY,
    owner,
    name,
    number,
    (pr) => pr.comments,
  );
  const reviews = fetchAll(
    REVIEWS_QUERY,
    owner,
    name,
    number,
    (pr) => pr.reviews,
  );
  return {
    commentNodes: comments.nodes,
    isDraft: threads.isDraft,
    reviewNodes: reviews.nodes,
    threadNodes: threads.nodes,
  };
}

// ---- self-test -----------------------------------------------------------

/**
 * Map an array of shaped threads to their `threadId`s (self-test helper).
 */
function ids(array) {
  return array.map((thread) => thread.threadId);
}

/**
 * Run the built-in fixtures (no network) and exit non-zero on any failure.
 */
function selfTest() {
  // GraphQL returns bot logins WITHOUT the `[bot]` suffix (e.g. `cursor`,
  // `claude`, `coderabbitai`), so the fixtures use the bare form.
  const threadNodes = [
    {
      comments: { nodes: [{ author: { login: "cursor" }, body: "nit: typo" }] },
      id: "T_bot_unresolved",
      isOutdated: false,
      isResolved: false,
      line: 42,
      path: "skills/x/SKILL.md",
    },
    {
      comments: { nodes: [{ author: { login: "claude" }, body: "done" }] },
      id: "T_bot_resolved",
      isOutdated: false,
      isResolved: true,
      line: 1,
      path: "a.ts",
    },
    {
      comments: { nodes: [{ author: { login: "claude" }, body: "moved" }] },
      id: "T_bot_outdated",
      isOutdated: true,
      isResolved: false,
      line: null,
      originalLine: 9,
      path: "b.ts",
    },
    {
      comments: {
        nodes: [{ author: { login: "alice" }, body: "please rename" }],
      },
      id: "T_human",
      isOutdated: false,
      isResolved: false,
      line: 3,
      path: "c.ts",
    },
    // A bot thread we deferred (Step 8): the bot's finding plus our own
    // non-resolving marker reply. It must bucket into deferredThreads.
    {
      comments: {
        nodes: [
          { author: { login: "coderabbitai" }, body: "extract this helper" },
          {
            author: { login: "RobEasthope" },
            body: `Noted as deferred.\n\n${DEFER_PENDING_MARKER}`,
          },
        ],
      },
      id: "T_bot_deferred",
      isOutdated: false,
      isResolved: false,
      line: 12,
      path: "e.ts",
    },
  ];
  const commentNodes = [
    {
      author: { login: "coderabbitai" },
      body: "## Review summary",
      id: "IC_summary",
    },
    // Later chatter from the same bot — a command acknowledgement, not a summary.
    {
      author: { login: "coderabbitai" },
      body: "@coderabbitai resolved",
      id: "IC_chatter",
    },
    // A bot whose first comment is an ack and whose real summary (with a sticky
    // marker) lands later — the marker comment should win.
    {
      author: { login: "claude" },
      body: "On it — reviewing now.",
      id: "IC_ack",
    },
    {
      author: { login: "claude" },
      body: "<!-- use_sticky_comment -->\n## Walkthrough\n…",
      id: "IC_sticky",
    },
    { author: { login: "bob" }, body: "lgtm", id: "IC_human" },
    // Bugbot's only issue-level comment — the free-tier upsell, never a summary.
    {
      author: { login: "cursor" },
      body: "Bugbot is not enabled for your account, so this pull request was not reviewed.",
      id: "IC_cursor_upsell",
    },
  ];
  // Review submissions: Bugbot posts its summary here (not as an issue comment).
  // Two BUGBOT_REVIEW bodies model a re-review — Bugbot submits a fresh review per
  // commit rather than editing one in place, so the NEWER one must win.
  const reviewNodes = [
    {
      author: { login: "cursor" },
      body: "<!-- BUGBOT_REVIEW -->\nCursor Bugbot reviewed an earlier commit and found 3 potential issues.",
      id: "REV_bugbot_stale",
      state: "COMMENTED",
    },
    {
      author: { login: "cursor" },
      body: "<!-- BUGBOT_REVIEW -->\nCursor Bugbot has reviewed your changes using default effort and found 2 potential issues.",
      id: "REV_bugbot_summary",
      state: "COMMENTED",
    },
    // A human's approval with no body — must not become a "summary".
    { author: { login: "alice" }, body: "", id: "REV_human_blank" },
  ];
  const bots = DEFAULT_BOTS;

  const result = buildResult({
    bots,
    commentNodes,
    isDraft: false,
    number: 7,
    reviewNodes,
    threadNodes,
  });
  const withResolved = buildResult({
    bots,
    commentNodes,
    includeResolved: true,
    isDraft: false,
    number: 7,
    reviewNodes,
    threadNodes,
  });

  const cases = [
    {
      name: "unresolved bot thread is included",
      ok: ids(result.unresolvedThreads).includes("T_bot_unresolved"),
    },
    {
      name: "resolved bot thread is excluded by default",
      ok: !ids(result.unresolvedThreads).includes("T_bot_resolved"),
    },
    {
      name: "--include-resolved keeps the resolved bot thread",
      ok: ids(withResolved.unresolvedThreads).includes("T_bot_resolved"),
    },
    {
      name: "outdated flag and originalLine fallback are preserved",
      ok:
        result.unresolvedThreads.find(
          (thread) => thread.threadId === "T_bot_outdated",
        )?.isOutdated === true &&
        result.unresolvedThreads.find(
          (thread) => thread.threadId === "T_bot_outdated",
        )?.line === 9,
    },
    {
      name: "human thread goes to humanThreads, not unresolvedThreads",
      ok:
        ids(result.humanThreads).includes("T_human") &&
        !ids(result.unresolvedThreads).includes("T_human"),
    },
    {
      name: "defer-pending bot thread is bucketed into deferredThreads",
      ok:
        ids(result.deferredThreads).includes("T_bot_deferred") &&
        !ids(result.unresolvedThreads).includes("T_bot_deferred"),
    },
    {
      name: "a plain unresolved bot thread stays out of deferredThreads",
      ok: !ids(result.deferredThreads).includes("T_bot_unresolved"),
    },
    {
      name: "comments are trimmed to author + body only",
      ok: result.unresolvedThreads.every((thread) =>
        thread.comments.every(
          (comment) =>
            Object.keys(comment).toSorted().join(",") === "author,body",
        ),
      ),
    },
    {
      name: "thread author is taken from the first comment",
      ok:
        result.unresolvedThreads.find(
          (thread) => thread.threadId === "T_bot_unresolved",
        )?.author === "cursor",
    },
    {
      name: "sticky AI summary comment is picked up",
      ok: result.aiSummaryComments.some(
        (comment) => comment.commentId === "IC_summary",
      ),
    },
    {
      name: "botsReported counts sticky headlines and/or threads; botsMissing the rest",
      ok:
        result.botsReported.includes("coderabbitai") &&
        result.botsReported.includes("claude") &&
        result.botsReported.includes("cursor") &&
        result.botsMissing.length === 0,
    },
    {
      name: "human issue comment is not treated as an AI summary",
      ok: !result.aiSummaryComments.some(
        (comment) => comment.commentId === "IC_human",
      ),
    },
    {
      name: "later bot chatter is dropped — one summary per bot",
      ok:
        !result.aiSummaryComments.some(
          (comment) => comment.commentId === "IC_chatter",
        ) &&
        result.aiSummaryComments.filter(
          (comment) => comment.author === "coderabbitai",
        ).length === 1,
    },
    {
      name: "a marker-bearing comment wins over an earlier acknowledgement",
      ok:
        result.aiSummaryComments.some(
          (comment) => comment.commentId === "IC_sticky",
        ) &&
        !result.aiSummaryComments.some(
          (comment) => comment.commentId === "IC_ack",
        ),
    },
    {
      name: "a bot's review-submission summary (BUGBOT_REVIEW) is surfaced",
      ok: result.aiSummaryComments.some(
        (comment) => comment.commentId === "REV_bugbot_summary",
      ),
    },
    {
      name: "Bugbot's 'not enabled' upsell is not treated as a summary",
      ok: !result.aiSummaryComments.some(
        (comment) => comment.commentId === "IC_cursor_upsell",
      ),
    },
    {
      name: "a blank review body is never a summary",
      ok: !result.aiSummaryComments.some(
        (comment) => comment.commentId === "REV_human_blank",
      ),
    },
    {
      name: "the cursor summary is its review body, not the upsell comment",
      ok:
        result.aiSummaryComments.find((comment) => comment.author === "cursor")
          ?.commentId === "REV_bugbot_summary",
    },
    {
      name: "a re-review's newer summary supersedes an earlier one (same marker)",
      ok:
        result.aiSummaryComments.some(
          (comment) => comment.commentId === "REV_bugbot_summary",
        ) &&
        !result.aiSummaryComments.some(
          (comment) => comment.commentId === "REV_bugbot_stale",
        ),
    },
  ];

  // A config entry written with the `[bot]` suffix must still match the bare
  // login GraphQL returns (and vice versa).
  const normalised = buildResult({
    bots: ["claude[bot]"],
    commentNodes: [],
    isDraft: false,
    number: 7,
    threadNodes: [
      {
        comments: { nodes: [{ author: { login: "claude" }, body: "x" }] },
        id: "T_norm",
        isOutdated: false,
        isResolved: false,
        line: 1,
        path: "d.ts",
      },
    ],
  });
  cases.push({
    name: "config '[bot]' suffix matches a bare GraphQL login",
    ok: ids(normalised.unresolvedThreads).includes("T_norm"),
  });

  // argument + PR-resolution parsing
  const parsed = parseArgs([
    "123",
    "--bots",
    "x[bot], y[bot]",
    "--include-resolved",
  ]);
  cases.push({
    name: "parseArgs reads pr, bots (trimmed), and --include-resolved",
    ok:
      parsed.pr === "123" &&
      parsed.includeResolved === true &&
      parsed.bots.join(",") === "x[bot],y[bot]",
  });
  const fromUrl = resolvePr("https://github.com/acme/widgets/pull/88", null);
  cases.push({
    name: "resolvePr parses owner/repo/number from a PR URL",
    ok: fromUrl.number === 88 && fromUrl.repo === "acme/widgets",
  });
  const fromNumber = resolvePr("12", "acme/widgets");
  cases.push({
    name: "resolvePr accepts a bare number with --repo",
    ok: fromNumber.number === 12 && fromNumber.repo === "acme/widgets",
  });
  cases.push({
    name: "resolvePr throws on a non-number, non-URL string",
    ok: (() => {
      try {
        resolvePr("abc", null);
        return false;
      } catch {
        return true;
      }
    })(),
  });
  cases.push({
    name: "parseArgs throws when --bots has no value",
    ok: (() => {
      try {
        parseArgs(["123", "--bots"]);
        return false;
      } catch {
        return true;
      }
    })(),
  });
  cases.push({
    name: "parseArgs throws when --repo has no value",
    ok: (() => {
      try {
        parseArgs(["123", "--repo"]);
        return false;
      } catch {
        return true;
      }
    })(),
  });
  cases.push({
    name: "parseArgs throws on an unknown --flag",
    ok: (() => {
      try {
        parseArgs(["123", "--nope"]);
        return false;
      } catch {
        return true;
      }
    })(),
  });
  cases.push({
    name: "parseArgs throws on a malformed --repo (extra segments)",
    ok: (() => {
      try {
        parseArgs(["123", "--repo", "acme/widgets/extra"]);
        return false;
      } catch {
        return true;
      }
    })(),
  });
  cases.push({
    name: "parseArgs throws on an extra positional argument",
    ok: (() => {
      try {
        parseArgs(["123", "456"]);
        return false;
      } catch {
        return true;
      }
    })(),
  });

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

const USAGE = `review-threads — fetch a PR's unresolved review feedback as minimal JSON (read-only)

Usage:
  node review-threads.mjs <pr-number-or-url>           Print minimal JSON to stdout
  node review-threads.mjs <pr> --bots "a[bot],b[bot]"  Override review-bot logins
  node review-threads.mjs <pr> --repo owner/name       Set the repo explicitly
  node review-threads.mjs <pr> --include-resolved      Keep resolved threads too
  node review-threads.mjs --self-test                  Run the built-in offline fixtures
  node review-threads.mjs --help                       Show this message (alias: -h)`;

/**
 * CLI entry: parse args, fetch from GitHub, and print the minimal JSON.
 */
function main() {
  const argv = process.argv.slice(2);
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(USAGE);
    return;
  }

  if (argv.includes("--self-test")) {
    selfTest();
    return;
  }

  let options;
  let pr;
  try {
    options = parseArgs(argv);
    pr = resolvePr(options.pr, options.repo);
  } catch (error) {
    console.error(`review-threads: ${error.message}`);
    process.exit(2);
  }

  try {
    const { commentNodes, isDraft, reviewNodes, threadNodes } = fetchFromGitHub(
      pr.number,
      pr.repo,
    );
    const result = buildResult({
      bots: options.bots,
      commentNodes,
      includeResolved: options.includeResolved,
      isDraft,
      number: pr.number,
      reviewNodes,
      threadNodes,
    });
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    // Non-zero exit so the skill can tell "couldn't fetch" from "no findings".
    console.error(
      `review-threads: failed to fetch from GitHub — ${error.message}`,
    );
    process.exit(1);
  }
}

// Detect "run directly as a CLI" vs "imported as a module". A raw
// `import.meta.url === file://${argv[1]}` string compare breaks two ways:
// `import.meta.url` percent-encodes characters such as spaces, and the ESM
// loader symlink-resolves it whereas `process.argv[1]` is left untouched (e.g.
// macOS /var → /private/var, pnpm's symlinked store). Normalise both sides
// through realpath before comparing.
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
