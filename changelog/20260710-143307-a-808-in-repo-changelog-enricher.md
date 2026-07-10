---
title: "Adopt in-repo changelog enricher and wire it into the scaffold"
release_note: "Spawned packages inherit @acme-skunkworks/changelog-core, the pkg-release.yml changelog-enrich caller, and the Trunk road-runner-bot bypass from birth — no manual per-repo enricher setup."
created_at: "2026-07-10T14:33:07Z"
merged_at:
branch: "a-808-phase-3-roll-out-in-repo-enricher-to-npm-package-template"
pr:
commit:
merge_strategy:
author: "rob@acmeskunkworks.io"
co_authors: []
category: feature
breaking: false
issues: ["A-808"]
stats:
  files_changed:
  loc_added:
  loc_removed:
---

## Added

- **`@acme-skunkworks/changelog-core`** as a devDependency, with `validate:changelog` and
  CI completeness pointing at `pnpm exec changelog-core …` ([A-808](https://linear.app/acme-skunkworks/issue/A-808)).
- A **`changelog-enrich`** sibling job in `pkg-release.yml` calling
  `reusable-changelog-enrich.yml` (`mode: finalise`, pin `a87a5ba`) so post-merge
  metadata and version stamps land in-repo via road-runner-bot (ADR 0004 / [A-821](https://linear.app/acme-skunkworks/issue/A-821)).
- **`ensureTrunkChangelogBypass`** in `initialise-package-repo` — creates or updates the
  repo-level Trunk ruleset with the road-runner-bot bypass so newly scaffolded packages
  inherit enricher write-back from birth.

## Changed

- Removed the vendored `infrastructure/scripts/*changelog*.ts` seam and matching tests;
  dropped `gray-matter` and `changelog:finalise`.
- Documented the post-merge enricher lifecycle in `CLAUDE.md`, `README.md`,
  `changelog/README.md`, and `infrastructure/README.md`.
