---
title: "Sort keys in root tsconfig.eslint/tools to clear jsonc lint debt"
release_note:
created_at: "2026-07-06T12:05:41Z"
merged_at:
branch: "a-707-root-tsconfig-files-carry-uncaught-jsonc-lint-debt"
pr:
commit:
merge_strategy:
author: "rob@acmeskunkworks.io"
co_authors: []
category: chore
breaking: false
issues: ["A-707"]
stats:
  files_changed:
  loc_added:
  loc_removed:
  commits:
---

## Changed

- Ran `eslint --fix` over `tsconfig.eslint.json` and `tsconfig.tools.json` to clear
  the `jsonc/sort-keys` debt that [A-663](https://linear.app/acme-skunkworks/issue/A-663) surfaced — top-level keys and
  `compilerOptions` are now in natural-ascending order. No semantic change: `extends`
  only inherits `compilerOptions`, so its new position is inert; `pnpm tsc` and the
  published `dist/` are unaffected. These root config files sit outside CI's ESLint
  scope (`src infrastructure/scripts`), so the debt was only visible via the
  change-gated preflight when a branch touched them.

## Deferred

- The `jsonc/array-bracket-newline` + `jsonc/array-element-newline` half of the debt
  (the short `exclude: ["dist", "node_modules"]` arrays) is **not** fixed here: those
  stylistic rules require the arrays multiline, but the pre-commit Prettier hook
  collapses them straight back, so `eslint --fix` never converges. That is a
  Prettier-owns-formatting conflict in the shared `@acme-skunkworks/eslint-config`
  preset, tracked in [A-709](https://linear.app/acme-skunkworks/issue/A-709). Bringing root config files into an enforced lint lane is
  tracked separately in [A-708](https://linear.app/acme-skunkworks/issue/A-708).
