---
title: "Add the initialise-package-repo one-shot post-generation setup skill"
release_note:
created_at: "2026-07-06T10:59:49Z"
merged_at:
branch: "a-663-initialise-package-repo-skill-one-shot-post-generation-setup"
pr:
commit:
merge_strategy:
author: "rob@acmeskunkworks.io"
co_authors: []
category: chore
breaking: false
issues: ["A-663"]
stats:
  files_changed:
  loc_added:
  loc_removed:
---

## Added

- A new **repo-local** `initialise-package-repo` agent skill that drives a repo freshly created
  from this template to a lint/build/release-ready state in one idempotent, dry-run-first pass
  ([A-663](https://linear.app/acme-skunkworks/issue/A-663)) — the executable form of the manual
  generation checklist in `CLAUDE.md` / `README.md`. It lives only in this template's tree
  (`.claude/skills/` + the `.agents/skills/` Cursor mirror), is not in `skills-lock.json`, and
  travels into every spawned repo via "Use this template", where it is run once.
- The skill **automates** the in-repo file edits — resetting `changelog/` to just its `README.md`
  (the flagship fix for the 2026-07-02 changelog-poisoning incident that hit portcullis and
  stylelint-config), re-seeding `.release-please-manifest.json` to the starting `package.json`
  version, rewriting the `package.json` identity and `infrastructure/repo-config.yaml` from the
  repo's own facts (`gh repo view`), and wrapping the existing `initialise-skills` skill to
  generate each skill's `config.json`.
- It also **applies the GitHub settings "Use this template" does not copy**, via `gh api` behind a
  confirmation gate and each idempotent: the `main`-restricted `npm-release` environment, the
  `GO/NO GO` required-check ruleset (pinned to the GitHub Actions integration, `integration_id:
15368`, replicating this template's own live ruleset), and enabling the `Release` workflow.
- The org/browser/cross-repo steps it deliberately cannot take on itself — authoring `src/`,
  release-orchestrator onboarding ([A-648](https://linear.app/acme-skunkworks/issue/A-648)), the
  Claude review prerequisites, and the npm OIDC + first-publish bootstrap — are **verified and
  reported** with cross-links to `README.md#setup`, never silently assumed done.

## Changed

- Folded the `CLAUDE.md` generation checklist and the `README.md` spawned-repo quick checklist to
  lead with "run the `initialise-package-repo` skill", keeping the individual steps as the
  reference for what it does rather than a manual walk. Added the skill to the `CLAUDE.md` agent-skills
  list, flagged as repo-local (distinct from the shared `@acme-skunkworks/agent-skills` bundles).
- Scoped the ESLint config to treat the `.agents/**` skill mirror as non-linted (matching the
  preset's existing `.claude/**` treatment), broadened the `infrastructure/**` dev-dependency
  override to `.mjs`, and added `vitest.config.ts` to `tsconfig.eslint.json` so the change-gated
  preflight resolves it. `vitest.config.ts` now discovers `infrastructure/tests/**/*.test.mjs`, so
  the skill's zero-dependency `.mjs` scripts are unit-tested (90 tests) without pulling untyped
  `.mjs` imports into `pnpm tsc`.
