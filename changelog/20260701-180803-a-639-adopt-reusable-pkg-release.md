---
title: "Adopt the reusable pkg-release workflow (retire inline release.yml)"
release_note:
created_at: "2026-07-01T18:08:03Z"
merged_at:
branch: "a-639-adopt-the-reusable-pkg-release-workflow-retire-inline"
pr:
commit:
merge_strategy:
author: "rob@acmeskunkworks.io"
co_authors: []
category: chore
breaking: false
issues: ["A-639"]
stats:
  files_changed:
  loc_added:
  loc_removed:
  commits:
---

## Changed

- Replaced the ~380-line inline release workflow with a thin caller of the estate's
  shared `reusable-pkg-release.yml` (pinned to v1.0.2,
  `9febdb14373f383e3ae4f5a6e3f6bb75a59d0c3d`), mirroring eslint-config's
  `pkg-release.yml`. A `config` job loads `infrastructure/repo-config.yaml` and feeds
  `npm-scope` / `node-version-file` / the registry URLs through to the reusable
  workflow, so a generated repo inherits its own knobs without editing the caller.
- The file moved `release.yml` → `pkg-release.yml` for estate parity; the workflow
  **name** stays `Release` so `gh workflow enable/disable Release` and the generation
  checklist keep working. npm Trusted Publishing binds its OIDC subject to
  repository + workflow filename, so a generated repo now configures its Trusted
  Publisher against `pkg-release.yml`. Updated the `act:release:dry` script and the
  `dependabot.yml` / `repo-config.yaml` filename references to match.
- The security model is unchanged, now enforced upstream in the reusable workflow:
  build-once/publish-exact-artifact ([A-328](https://linear.app/acme-skunkworks/issue/A-328)), npm-OIDC Trusted Publishing with
  provenance, the branch-restricted `npm-release` environment + main-only ref guards
  ([A-326](https://linear.app/acme-skunkworks/issue/A-326)), the version-vs-tag publish gate, git tag + GitHub release, and the
  secondary GitHub Packages mirror with a build-provenance attestation.
- Release stays **disabled on this template repo** (its `src/` is a placeholder that
  never publishes). The now-CI-unused `publish-via-raw-npm.sh` and
  `publish-to-github-packages.sh` are retained as unit-tested reference shell
  (matching the `ensure-*.sh` precedent); their bats suites still run.
