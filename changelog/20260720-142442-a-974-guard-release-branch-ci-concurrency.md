---
title: Guard release-branch CI concurrency against GO/NO GO cancellation
release_note:
version:
created_at: "2026-07-20T14:24:42Z"
merged_at:
branch: a-974-guard-release-branch-ci-concurrency
pr:
commit:
author: rob@acmeskunkworks.io
co_authors: []
category: chore
breaking: false
issues:
  - A-974
stats:
  files_changed:
  loc_added:
  loc_removed:
---

## Changed

- `ci.yml`'s concurrency group used `cancel-in-progress: true` unconditionally, so a
  fresh push to the `release-please--branches--main` branch cancelled the in-flight
  run — including the required GO/NO GO check the release orchestrator waits on, which
  reads a cancelled check as a NO GO
  ([A-961](https://linear.app/acme-skunkworks/issue/A-961) root cause). The guard now
  keeps cancelling superseded runs on ordinary branches but never cancels the
  release-please branch's run ([A-974](https://linear.app/acme-skunkworks/issue/A-974)).
- This is the npm-publishing template every future npm repo is seeded from, so the fix
  propagates to each new repo at scaffold time (existing npm repos are handled by their
  own [A-961](https://linear.app/acme-skunkworks/issue/A-961) sub-issues; templates seed at creation and never re-sync).
