// Derive the new package's identity from the GitHub repo it now lives in (A-663).
//
// "Use this template" gives the spawned repo its own name/owner, so the correct
// package identity is almost entirely derivable — only `description` and
// `keywords` are genuinely human-authored. `deriveIdentity` is a pure mapping from
// a `gh repo view --json` payload (+ any operator-supplied overrides) so it is
// unit-testable without shelling out; `fetchRepoView` is the thin `gh` wrapper.

import { spawnSync } from "node:child_process";

/**
 * The scoped name the template ships with — its presence means "not yet renamed".
 */
export const PLACEHOLDER_NAME = "@acme-skunkworks/npm-package-template";

/**
 * Map a `gh repo view` payload onto the package-identity fields, layering any
 * operator-supplied facts on top. URLs are always derived from owner/repo (the
 * ground truth); `name` defaults to `@<owner>/<repo>` but can be overridden (e.g.
 * a repo whose npm name differs from its repo slug); `description` falls back to
 * the GitHub repo description; `keywords` is left `undefined` unless supplied, so
 * the caller can flag it for manual input rather than guess.
 * @param {{ name?: string, owner?: { login?: string }, description?: string,
 *   defaultBranchRef?: { name?: string } }} view
 * @param {{ name?: string, description?: string, keywords?: string[] }} [facts]
 * @returns {{ owner: string, repo: string, slug: string, name: string,
 *   description: string, keywords: string[] | undefined, homepage: string,
 *   bugsUrl: string, repositoryUrl: string, defaultBranch: string, scope: string }}
 */
export function deriveIdentity(view, facts = {}) {
  const owner = view?.owner?.login;
  const repo = view?.name;
  if (!owner || !repo) {
    throw new Error("gh repo view did not return owner.login and name");
  }

  const slug = `${owner}/${repo}`;
  const name = facts.name ?? `@${owner}/${repo}`;
  // Only derive the scope from `name` when it is a well-formed scoped name
  // (`@scope/pkg`). A malformed override like `@foo` (no slash) would otherwise
  // slice to `@fo` and silently write a broken `npmScope`; fall back to `@owner`.
  const scope =
    name.startsWith("@") && name.includes("/")
      ? name.slice(0, name.indexOf("/"))
      : `@${owner}`;

  return {
    bugsUrl: `https://github.com/${slug}/issues`,
    defaultBranch: view?.defaultBranchRef?.name ?? "main",
    description: facts.description ?? view?.description ?? "",
    homepage: `https://github.com/${slug}#readme`,
    keywords: facts.keywords,
    name,
    owner,
    repo,
    repositoryUrl: `https://github.com/${slug}.git`,
    scope,
    slug,
  };
}

/**
 * Fetch the repo facts via `gh`. Returns `null` when `gh` is unavailable or the
 * cwd is not a GitHub repo, so the caller can degrade to a clear "run gh auth
 * login / not a GitHub repo" message rather than crash.
 * @param {string} root
 * @param {(args: string[], opts: object) => { status: number, stdout: string }} [run]
 * @returns {object | null}
 */
export function fetchRepoView(root, run = defaultRun) {
  const result = run(
    ["repo", "view", "--json", "name,owner,description,url,defaultBranchRef"],
    { cwd: root, encoding: "utf8" },
  );
  if (!result || result.status !== 0 || !result.stdout) {
    return null;
  }

  try {
    return JSON.parse(result.stdout);
  } catch {
    return null;
  }
}

function defaultRun(args, options) {
  return spawnSync("gh", args, options);
}
