---
title: "Consolidate template bootstrap into the README and complete the generation checklist"
release_note:
created_at: "2026-07-03T09:59:59Z"
merged_at:
branch: "a-649-generation-checklist-omits-non-copied-setup-npm-release-env"
pr:
commit:
merge_strategy:
author: "rob@acmeskunkworks.io"
co_authors: []
category: docs
breaking: false
issues: ["A-649"]
stats:
  files_changed:
  loc_added:
  loc_removed:
---

## Changed

- Folded `docs/TEMPLATE-BOOTSTRAP.md` into `README.md` and deleted the `docs/` directory, so a
  spawned-repo owner reads a single self-contained file instead of discovering (and having to
  delete) a separate docs tree ([A-649](https://linear.app/acme-skunkworks/issue/A-649)). The
  README's new "Setup" section is now the **single source of truth** for the non-copied setup;
  `CLAUDE.md` links to it rather than duplicating it.
- Completed the `CLAUDE.md` generation checklist so it no longer reads as complete whilst silently
  omitting non-copied steps. Added the three missing bullets — create the branch-restricted
  `npm-release` environment, onboard the release-orchestrator (install road-runner-bot + add the
  `matrix.repo` entry, [A-648](https://linear.app/acme-skunkworks/issue/A-648)), and the Claude
  review prerequisites (`CLAUDE_CODE_OAUTH_TOKEN` **plus** the Claude GitHub App install, whose
  absence causes the `git fetch … could not read Username` failure —
  [A-621](https://linear.app/acme-skunkworks/issue/A-621) /
  [A-636](https://linear.app/acme-skunkworks/issue/A-636)) — each cross-linking its README subsection.
- Documented the Claude review setup for the first time: org-wide provisioning as the preferred
  target (org secret + Claude App across the config-estate repos), with the per-repo fallback and the
  org-secret scoping/security note.
- Noted that the template already satisfies the orchestrator's repo-side prerequisites, so
  onboarding reduces to installing the bot and adding the matrix entry.
- Repointed the stale `docs/TEMPLATE-BOOTSTRAP.md` references in `README.md`, `CLAUDE.md`, and
  `.github/workflows/pkg-release.yml` at the README.
