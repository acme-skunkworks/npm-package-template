<!--
  Managed upstream in acme-skunkworks/shared-agents-md and vendored into estate repos by the
  release-orchestrator fan-out (fanout-agents-md.yml). Do NOT edit this copy — edit the canonical
  AGENTS.md in shared-agents-md; changes here are overwritten on the next fan-out.
-->

# Shared agent instructions

Estate-wide guidance for AI coding agents (Claude Code, Cursor, cloud agents) working in the
**ACME Skunkworks** estate. Repo-specific guidance lives in each repo's own `CLAUDE.md`, not here —
only add a rule here if it is true for **every** estate repo.

## Writing

- Use **British English** spelling and grammar in human-facing prose (documentation, ADRs, commit
  messages, PR titles and bodies): *colour*, *behaviour*, *organise*, *-ise*/*-yse* over
  *-ize*/*-yze*, *licence* (noun) / *license* (verb).
- This applies to prose written for humans — **not** to identifiers, dependency or package names,
  CSS `color`, CLI flags, config keys, environment variable names, or third-party API field
  names/values that mirror upstream. Leave those spelt as the code or upstream requires.
- Two named exceptions: Linear's **`Canceled`** state stays US-spelt (it is a fixed API value); and
  **"trunk"** means the git trunk — LanguageTool / CodeRabbit reads it as a vehicle part and suggests
  the British "boot"; decline that.

## Estate identity

- The Linear team is **ACME Skunkworks**; its team key is **`A`** and the workspace slug is
  **`acme-skunkworks`**.
- Resolve Linear MCP calls by team **name** ("ACME Skunkworks"), **not** by key — the key has been
  renamed repeatedly and older references are stale.
- Issue IDs are **`A-<number>`**. Keep **one Linear project per repo** — don't split a single repo's
  work across parallel projects.

## Branches

- Name branches `<linear-id>-<slug>`, lower-cased (e.g. `a-523-lay-out-the-canonical-repo`).
- **Verify the issue is real and relevant** (via the Linear MCP) before putting its ID in a branch —
  never fabricate or guess an ID. If no issue exists, use a descriptive branch name **without** an
  ID prefix.
- **Branch from `main`**: check out and pull `main` first, then create the branch — not from
  whatever branch the session happened to start on.

## Commits, PRs & releases

- Commit messages and PR titles follow **Conventional Commits** (`feat:`, `fix:`, `chore:`, …).
- Repos **squash-merge**, so the **PR title is the bump signal** release-please reads — a mistyped
  or under-typed prefix silently cuts the wrong version bump, or none. Get the PR title's type right.
- Version bump by type: `feat` → minor; `fix` / `perf` / `revert` → patch; `!` or `BREAKING CHANGE:`
  → major; `chore` / `docs` / `ci` / `build` / `refactor` / `test` / `style` → no release. When a
  branch spans several levels, title the PR with the highest-bumping type.
- Scopes are optional and for readability only — they do **not** drive the bump. Group commits by
  **intent** (a feature, a fix, a refactor), not by package boundary; never stage unrelated changes
  into one commit (e.g. via `git add -A`).
- Leave the Conventional Commits tokens themselves unchanged (`feat`, `BREAKING CHANGE:` are
  upstream identifiers — see the Writing carve-out).
- **Ship with `/send-it`.** Open and update PRs through the `/send-it` skill — the estate's
  canonical ship flow (atomic commits, change-gated preflight, Conventional Commits PR title, push,
  draft PR). Do **not** bypass it with ad-hoc `gh pr create` or manual PR steps when send-it is
  installed. Re-run send-it to update an existing PR's title and body.

## Collaboration guardrails

- **Never push directly to `main`** — always branch and open a PR. `main` is the only protected
  branch.
- **Claude is tooling, not a contributor** — don't add a `Co-Authored-By: Claude` trailer; it
  misrepresents authorship, and estate repos with the `commit-msg` hook strip it anyway.
- **Bot reviews (CodeRabbit, Bugbot, Claude review) are advisory** — a green bot check is not proof a
  review actually ran; CI is the gate.
- **Label mechanical rollout PRs `skip-review`.** When a PR only fans out or re-syncs shared code
  across the estate — a mechanical rollout with no new behaviour (shared-workflows distributions,
  `AGENTS.md` fan-outs, agent-skills re-syncs) — add the `skip-review` label so CodeRabbit skips it
  and the review quota is reserved for the PRs that actually change behaviour.
- **Never label a behaviour change `skip-review`.** If a PR introduces or alters functionality, leave
  it unlabelled so it gets reviewed. When unsure, don't label — a forgotten label errs towards *more*
  review, not less. The `skip-review` label must already exist in the target repo (bootstrapped per
  the estate rollout config); if it is absent, that is a provisioning gap — flag it rather than
  shipping the rollout silently reviewed, and leave creating the label to the rollout tooling / repo
  provisioning.
- **Leave the merge to the human** — take a PR to green and ready-for-review, but don't merge it.
