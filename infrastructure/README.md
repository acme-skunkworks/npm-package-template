# `infrastructure/`

Workflow logic extracted from `.github/workflows/*.yml` plus shared dev-tooling helpers. The goal is to make the non-trivial bits of CI runnable, testable, and reviewable in isolation — `act` exercises workflow _wiring_; this directory exercises workflow _logic_.

## Layout

```
infrastructure/
  scripts/                          # executable logic. one file = one purpose
    ensure-yamllint.sh              # CI-unused since A-447 (lint reusable caller installs yamllint); local + reference
    ensure-actionlint.sh            # CI-unused since A-447 (lint reusable caller installs actionlint); local + reference
    ensure-bats.sh                  # CI-unused since A-447 (build-test caller runs `pnpm exec bats`); local + reference
    validate-changelog.ts           # `lint` caller's changelog lane (`validate:changelog`): enforces the entry schema
    check-changelog-completeness.ts # ci.yml `changelog-completeness` job: a release-triggering PR title needs a changelog/ entry
    finalise-changelog.ts           # orchestrator step after `release-please release-pr` (= `pnpm changelog:finalise`); the only changelog CLI
    enrich-changelog.ts             # pure lib used by finalise: fills entry fields once + overwrites stats, idempotently
    add-links-changelog.ts          # pure lib used by finalise: rewrites bare Linear IDs to links (masking code/links)
    stamp-changelog-version.ts      # pure lib used by finalise: stamps the just-bumped version once, leaving absent fields
    publish-via-raw-npm.sh          # release.yml npm publish step (bypasses pnpm)
    publish-to-github-packages.sh   # release.yml publish-github-packages job (token auth, attested tarball)
  tests/
    *.test.ts                       # vitest, run via `pnpm test`
    *.bats                          # bats-core, run via `pnpm test:sh`
    fixtures/                       # static inputs shared by tests
```

## Per-script language rule

- **Shell + bats** for CLI orchestration: `git`, `gh`, `jq`, `curl`, `pip`. No parsing, no branching beyond "does the tool exist / is the file there".
- **TypeScript + vitest** for parsing, branching, anything touching octokit, or anywhere types meaningfully reduce error surface.

If a script grows beyond ~20 lines of shell with conditionals, port it to TS.

## Conventions

- **Inputs via env, not argv.** Workflows pass values through `env:`; tests mock by passing an env object. Avoids shell quoting drama and keeps the test seam clean.
- **Pure functions exported for tests.** Each TS script exports the pure logic; `main()` wires it to real subprocesses. Tests import the pure function with a fake runner.
- **Scripts are idempotent.** Re-running them with the same inputs is safe (and is what the CI cache-hit path exercises).
- **Pinned versions live in env defaults**, not hard-coded. The workflow's cache key still hard-codes the version separately — match them.

## Running tests

```bash
pnpm test          # vitest run (CI)
pnpm test:watch    # vitest in watch mode
pnpm test:sh       # bats; locally prints install hint and exits 0 if bats is missing
pnpm lint:sh       # shellcheck; same skip-with-hint contract locally
```

CI (since A-447) runs these via the shared reusable callers: the `build-test` caller runs ShellCheck + Vitest + bats, and the `lint` caller runs the changelog validation. The `ensure-*.sh` bootstrap scripts are no longer wired into CI (the reusable workflows install yamllint/actionlint/bats themselves) but remain unit-tested here via `pnpm test:sh` as the local + reference path.

## Adding a new script

Workflow-extracted tooling (wired from `.github/workflows/*.yml`) belongs under `infrastructure/scripts/`.

1. Pick the language per the rule above.
2. Write the file to `infrastructure/scripts/<name>.{ts,sh}`. For TS, export pure functions; for shell, keep it under ~20 lines.
3. Write the test in `infrastructure/tests/<name>.{test.ts,bats}`. Tests should cover every meaningful branch, not just the happy path.
4. `pnpm tsc` + `pnpm lint` + `pnpm test` + `pnpm test:sh` + `pnpm lint:sh` all green.
5. Wire it from the workflow as a one-liner: `run: pnpm tsx infrastructure/scripts/<name>.ts` or `run: bash infrastructure/scripts/<name>.sh`.

## Out of scope

- Sharing this directory across repos (e.g. with `markdownlint-config`). Decision deferred — establish the pattern first.
- Husky hooks. They stay in `.husky/`; non-trivial logic _inside_ them can be extracted here and called via a thin shim. None qualifies today.
