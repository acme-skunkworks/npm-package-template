---
title: Bump @acme-skunkworks packages and fix markdownlint 3.x fallout
release_note: ""
created_at: "2026-08-07T15:13:11Z"
merged_at: ""
branch: a-1348-npm-package-template-bump-acme-skunkworks-and-fix-lint
pr:
commit:
author: rob@acmeskunkworks.io
co_authors: []
category: chore
breaking: false
issues:
  - A-1348
stats:
  files_changed:
  loc_added:
  loc_removed:
  commits:
---

## Changed

**Bump @acme-skunkworks packages and fix markdownlint 3.x fallout ([A-1348](https://linear.app/rheged-studio/issue/A-1348))**

- Raise `@acme-skunkworks/markdownlint-config` to `^3.0.0`, `eslint-config` to `^1.1.3`, `changelog-core` to `^1.1.1`, and `commitlint-config` to `^1.0.1`
- Exclude vendored `.claude/skills/**` and `.agents/skills/**` from markdownlint (config ignores, `lint:md` globs, and CI `markdown-globs`)
- Fix first-party MD040/MD044 hits in `AGENTS.md`, `CLAUDE.md`, and `infrastructure/README.md`
