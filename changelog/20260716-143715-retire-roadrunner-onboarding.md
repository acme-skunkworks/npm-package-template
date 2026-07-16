---
title: Retire per-repo road-runner-bot onboarding from the template runbooks
release_note: Newly-generated repos no longer need to install road-runner-bot or grant ROADRUNNER_* access — both are provisioned org-wide; only matrix.repo registration remains.
version:
created_at: "2026-07-16T14:37:15Z"
merged_at:
branch: a-991-docs-retire-per-repo-road-runner-bot-onboarding-from
pr:
commit:
author: hello@robeasthope.com
co_authors: []
category: docs
breaking: false
issues:
  - A-991
stats:
  files_changed:
  loc_added:
  loc_removed:
---

## Changed

- road-runner-bot is now installed org-wide across every ACME Skunkworks repo with
  the correct permissions (`contents: write` + `pull-requests: write`), with the
  `ROADRUNNER_PRIVATE_KEY` secret granted to the config-estate repos and the
  `ROADRUNNER_CLIENT_ID` org variable provisioned org-wide ([A-945](https://linear.app/acme-skunkworks/issue/A-945)). The template's generation runbooks still told operators to
  **install road-runner-bot** and **grant `ROADRUNNER_*` selected access** (the old
  [A-821](https://linear.app/acme-skunkworks/issue/A-821) per-repo grant) on every spawned repo — both now obsolete.
- Reduced release-orchestrator onboarding to its one remaining per-repo step:
  registering the repo in the orchestrator's `matrix.repo` ([A-648](https://linear.app/acme-skunkworks/issue/A-648)), which is
  orchestrator config rather than a bot install or permission grant. Updated
  `README.md`, `CLAUDE.md`, and the `initialise-package-repo` skill — its
  `MANUAL_REMINDERS`, `SKILL.md`, skill `README.md`, and `github-settings.mjs` header
  comment — across both the `.claude/` and `.agents/` trees (kept byte-identical).
- Rewrote the `ROADRUNNER_PRIVATE_KEY` security guidance to describe the org-wide
  grant to the config-estate repos (needed by each repo's in-repo `changelog-enrich`
  job) instead of the retired "scoped to `release-orchestrator` only" framing, keeping
  the "never truly public / all repositories" caution.
- Left the Trunk changelog bypass automation untouched: it configures a repo-scoped
  ruleset that still needs creating, and the org-wide install is its prerequisite, not
  its replacement.
