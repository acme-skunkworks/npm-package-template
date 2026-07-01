---
title: "Accept millisecond precision in changelog ISO timestamps"
release_note:
created_at: "2026-07-01T17:38:05Z"
merged_at:
branch: "a-641-fix-validate-changelog-iso-millisecond-bug-regression-test"
pr:
commit:
merge_strategy:
author: "rob@acmeskunkworks.io"
co_authors: []
category: fix
breaking: false
issues: ["A-641"]
stats:
  files_changed:
  loc_added:
  loc_removed:
  commits:
---

## Fixed

- `validate-changelog` now accepts ISO 8601 UTC timestamps with a millisecond
  fraction (`…ss.sssZ`), not just second precision. When a changelog entry's
  `created_at` / `merged_at` is written as an **unquoted** YAML timestamp,
  gray-matter parses it to a JS `Date` and the validator's own `asIso()` renders it
  via `Date.toISOString()` — which always emits milliseconds — so the previous
  second-only regex rejected the validator's own output. A regression test covers
  the unquoted-timestamp (`Date` → `asIso`) path that the existing quoted-string
  cases never exercised.
