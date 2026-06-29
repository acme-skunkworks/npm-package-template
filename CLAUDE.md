# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repo

Template repository for Acme Skunkworks npm packages. It ships a minimal, buildable pnpm + TypeScript ESM skeleton plus the shared workflow/release shell, so a new package can be generated and released without rebuilding the infrastructure each time.

The one-time org/repo settings that stand this up as a GitHub Template repository — and the settings every spawned repo inherits (Template flag, `go/no-go` ruleset, npm OIDC, `npm-release` environment, orchestrator onboarding) — live in [`docs/TEMPLATE-BOOTSTRAP.md`](docs/TEMPLATE-BOOTSTRAP.md). The list below covers only the per-package edits inside a generated repo.

When generating a package from this template:

- Rename `name` in `package.json` (the placeholder is `@acme-skunkworks/npm-package-template`) and update `description`/`keywords`/`repository`/`homepage`/`bugs`.
- Replace everything under `src/` with the package's real public API — `src/index.ts` is the published entry point. The surrounding shell (build, lint, release) does not need to change.
- Point `infrastructure/repo-config.yaml` at the new package if any value differs (scope, registry, default branch).
- **Re-seed `.release-please-manifest.json`** so `"."` matches the new package's starting `package.json` version (the template ships `"0.0.0"`). Leaving it empty is the #1 release-please failure mode. `release-please-config.json` itself needs no edit.
- Check the single-package reference in the `send-it` skill config (`.claude/skills/send-it/config.json`, mirrored to `.agents/skills/send-it/config.json`) — `shippablePaths` should point at the new package's published surface (`dist`).
- **Lint configs are inherited as-is.** `eslint.config.ts` (extends `@acme-skunkworks/eslint-config`) and `.markdownlint-cli2.jsonc` (extends `@acme-skunkworks/markdownlint-config`) carry the org defaults; a generated repo needs no edit. Extend `eslint.config.ts` only to pull in the opt-in presets the package needs (`testing`, `frameworkRouting`, `astro`, `sanity`, `storybook`, `tableComponents` — all re-exported from the preset).
- **Re-enable the Release workflow.** It is intentionally disabled on _this template repo_ (see "Release workflow" below); a generated repo needs it on: `gh workflow enable Release`. (Template generation copies files with workflows enabled by default, so this is only a guard against the rare case where it was carried over disabled.)
- **Re-create the `go/no-go` required-check ruleset.** Branch protection and rulesets are **not** copied by "Use this template", so a generated repo must add its own ruleset requiring the `go/no-go` check-run on the default branch, pinned to the GitHub Actions integration (see "CI gate (`go/no-go`)" below). Without it the gate runs but nothing enforces it.

## British English

Write all prose in British English — code comments, documentation, commit messages, PR titles/bodies, and any user-facing strings.

- **Spelling:** use British forms — _colour_, _behaviour_, _organisation_, _centre_, _catalogue_, _recognise_, _analyse_.
- **Grammar/punctuation:** follow British conventions where they differ — single quotes for quoting where appropriate, full stops outside the closing quotation mark when the quoted phrase is partial, _whilst_/_amongst_ acceptable.
- **Scope vs. identifiers:** this applies to prose only. Do **not** apply it to identifiers or APIs that mirror upstream names (e.g. `color` props in CSS, third-party API field names) — those stay spelled as the upstream defines them.

## Package manager and Node

pnpm, pinned via `packageManager` in `package.json`. Node 22 required (`.nvmrc`, `engines.node: ">=22"`, `engine-strict=true` in `.npmrc`).

## Commands

```bash
pnpm install        # install deps (runs prepare → husky hook install)
pnpm run build      # tsc → dist/ (the published artifact; consumers import from dist)
pnpm tsc            # type-check only — src/ (no emit) + infrastructure/ via tsconfig.tools.json
pnpm lint           # eslint over src/** + infrastructure/scripts/** + infrastructure/send-it/**
pnpm lint:fix       # auto-fix
pnpm lint:md        # markdownlint (CI: lint reusable caller)
pnpm lint:yaml      # yamllint . (semantic YAML check; warnings non-blocking)
pnpm lint:workflows # actionlint on .github/workflows/
pnpm lint:sh        # shellcheck on infrastructure/scripts/*.sh + .husky/*
pnpm test           # vitest run (infrastructure/tests/**/*.test.ts)
pnpm test:watch     # vitest in watch mode
pnpm test:sh        # bats on infrastructure/tests/*.bats
pnpm validate:changelog # schema-check changelog/*.md (CI: lint reusable caller)
pnpm format         # prettier write
pnpm clean          # remove node_modules + dist
```

## Agent skills

This repo adopts the shared `@acme-skunkworks/agent-skills` bundles, installed via [skills.sh](https://skills.sh) under `.claude/skills/` (mirrored to `.agents/skills/` for Cursor). They replace the bespoke `.claude/commands/send-it.md` shim that previously lived here. The installed skills are:

- **`/send-it`** — the all-in-one finisher: commits uncommitted work as atomic Conventional Commits, runs the change-gated lint preflight, writes a dated `changelog/` entry for shippable changes, composes the Conventional Commits PR title, pushes, opens or updates a draft PR, and moves linked Linear issues to In Review. Prefer it over hand-rolled `git commit` + `git push` + `gh pr create`.
- **`/preflight`** — the change-gated, branch-scoped lint preflight (delegated to by `/send-it`).
- **`/changelog`** — authors, refreshes, or repairs the dated `changelog/` entry for the current branch (delegated to by `/send-it`).
- **`/linear-sync`** — transitions the Linear issue(s) linked to the current branch to a target workflow state.
- **`/cleanup-repo`** — prunes merged Git branches and worktrees, then clears filesystem cruft, behind a single confirmation gate.
- **`/triage-pr`** — drives a PR from draft-with-failing-CI to merge-ready.

Each skill carries a `config.json` (reconciled to this repo's facts — `dist` as the shippable surface, `A` as the Linear issue key) alongside its `config.example.json`. Re-run the `initialise-skills` skill to reconcile config after a fresh install or a repo-fact change.

**Template-propagation note.** Because the skills are installed inline with `--copy`, the vendored bundles are committed to the repo and therefore travel into every repo spawned from this template. That is deliberate: a generated package inherits the shared skills with no extra step. The separate getting-started / scaffold track that automates first-package setup is tracked independently (A-467) and must **not** re-vendor or duplicate these bundles.

## Source layout

TypeScript source lives under `src/`, compiled by `tsc` to `dist/` (declarations + source maps). Only `dist/` is published (`files: ["dist"]`); `exports`/`main`/`module`/`types` all point into it. The workflow/release shell — `.github/`, `infrastructure/`, `.husky/`, `changelog/`, `release-please-config.json`, `.release-please-manifest.json` — is **not** part of the published artifact.

## Build / type-check / lint topology

The published `dist/` must contain **only** the compiled `src/`, but the TypeScript tooling under `infrastructure/` still needs type-checking and type-aware linting. Three tsconfigs keep those concerns separate:

- **`tsconfig.json`** — the build config. `rootDir: ./src`, `include: ["src/**/*.ts"]`, emits to `dist/`. `pnpm build` (`tsc`) uses it, so `dist/` stays src-only. Do **not** widen its `include` to "fix" linting — that re-emits infra into `dist/`.
- **`tsconfig.tools.json`** — `noEmit`, `extends ./tsconfig.json`, covers `eslint.config.ts`, `infrastructure/scripts/**`, `infrastructure/send-it/**`, `infrastructure/tests/**`, `vitest.config.ts`. `pnpm tsc` runs it as a second pass to type-check the shell, tests, and the ESLint config.
- **`tsconfig.eslint.json`** — `noEmit`, the linter's project. Spans `src/**` + the infra `.ts`. `eslint.config.ts` pins `parserOptions.project` to it so the base preset's type-aware rules (`project: true`) resolve every linted file regardless of directory. Without this pin ESLint would fail with "file not found by the project service" on infra files (they aren't in the src-only `tsconfig.json`). The ESLint config itself is **not** in this project — the preset's global ignores exclude `eslint.config.ts` from linting, so it is type-checked only via `tsconfig.tools.json`.

`extends` does **not** inherit `include`/`exclude` — only `compilerOptions` — so the two extra configs restate their own `include`/`exclude`.

## Linting and formatting

This package dogfoods the org's own shared configs:

- **ESLint** — `eslint.config.ts` consumes `@acme-skunkworks/eslint-config`, composing the `base` stack plus the `typescript` overrides, then adds two local blocks: an `infrastructure/**/*.ts` override (`complexity: off` + `import/no-extraneous-dependencies` with `devDependencies: true`, since the shell scripts legitimately import devDeps like `gray-matter` and the changelog validator is a branchy flat list of checks), and the `tsconfig.eslint.json` project pin (see above). The preset also re-exports opt-in presets (`testing`, `frameworkRouting`, `astro`, `sanity`, `storybook`, `tableComponents`) — pull them in as a generated package needs them. The config is authored in `.ts` (loaded by `jiti`, a devDependency ESLint v9.18+ requires for TypeScript config) and wrapped in `defineConfig` from `eslint/config`, so the whole array — including the two local override blocks — is type-checked against the preset's shipped types (`./dist/index.d.ts`) instead of only failing at lint-run time. `pnpm tsc` type-checks it via `tsconfig.tools.json`.
- **Markdown** — `.markdownlint-cli2.jsonc` extends `@acme-skunkworks/markdownlint-config`. Pre-commit auto-fixes staged `**/*.{md,mdx}` via lint-staged (`|| true`, so it never blocks); the `lint` reusable caller (markdown lane) enforces. (There is no root `CHANGELOG.md` to exclude — release-please runs with `skip-changelog`.)
- **Prettier** — `pnpm format` runs `prettier --write .`; `.prettierignore` excludes `node_modules`, `dist`, `pnpm-lock.yaml`, and `tsconfig.json`.

## GitHub Actions repo config

Non-secret knobs shared by `ci.yml` and `release.yml` live in **`infrastructure/repo-config.yaml`**, loaded at runtime by the composite `.github/actions/load-repo-config` (`uses: ./.github/actions/load-repo-config`), which allowlist-validates every value before writing it to `GITHUB_OUTPUT` (guards newline/`=` injection; A-330).

| Key                         | Purpose                                                                                                                     |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `defaultBranch`             | Canonical default branch; keep in sync with static `on:` triggers (GitHub cannot derive `on.push.branches` from this file). |
| `nodeVersionFile`           | Passed to `actions/setup-node` `node-version-file`.                                                                         |
| `npmRegistryUrl`            | Public npm registry (`setup-node` when talking to npmjs).                                                                   |
| `npmScope`                  | Package scope; must equal the owning GitHub org so `setup-node` scopes `.npmrc` for the GitHub Packages leg.                |
| `githubPackagesRegistryUrl` | GitHub Packages npm registry (`https://npm.pkg.github.com`) — the secondary publish target.                                 |

Secrets (`GITHUB_TOKEN`), OIDC Trusted Publishing, and release-please behaviour are unchanged — not in this file. **No bot key ships in the template.**

## Local hooks

`pnpm install` runs `prepare` (`husky`), which installs the hooks under `.husky/`. Three hooks fire:

- **`pre-commit`** — runs `pnpm lint-staged`. Auto-fixes only the staged files: `prettier --write` for everything, `eslint --fix` for `**/*.{ts,tsx,js,mjs,cjs}`, `sort-package-json` + `eslint --fix` for `**/package.json`, `markdownlint-cli2 --fix` for `**/*.{md,mdx}`, `yamllint` (read-only check) for `**/*.{yml,yaml}`, `actionlint` (read-only check) for `.github/workflows/*.{yml,yaml}`. Each task is wrapped in `bash -c '… "$@" --` so the staged file paths are passed through. The auto-fixers carry an `|| true` fallback so they never block — CI is the gate. The two YAML linters are best-effort: if the tool isn't on `PATH` locally, the hook prints a platform-appropriate install hint and skips. CI still enforces.
- **`commit-msg`** — strips any `Co-Authored-By: Claude … <noreply@anthropic.com>` trailer. Backstops the global `~/.claude/CLAUDE.md` rule (Claude is tooling, not a contributor).
- **`pre-push`** — blocks direct pushes to `main`; humans should use `/send-it` to open a PR. Bot users (`github-actions[bot]`, `road-runner-bot[bot]`) and the release-please release commit (`chore(main): release <version>`) bypass. It also runs `pnpm lint:workflows` + `pnpm lint:yaml` as a last-line gate before CI.

Hooks are dormant in CI: `release.yml` and `ci.yml` set `HUSKY=0` so the `prepare` script no-ops during `pnpm install`.

To bypass any hook in an emergency: `git commit --no-verify` or `git push --no-verify` — not recommended.

## CI gate (`go/no-go`)

`ci.yml` ends with a single **`go/no-go`** aggregator job — the one stable, estate-canonical gate the release-orchestrator waits on (A-412/A-424). It `needs:` every real job (`config`, `lint`, `build-test`, `pr-title`, `changelog-completeness`), runs `if: ${{ always() }}`, and a one-line `jq` verdict over `toJSON(needs)` succeeds **iff** every job `result` is `success` or `skipped`. The `lint` and `build-test` jobs are thin callers of the shared reusable workflows (see "Shared reusable CI callers" below); `config` is in `needs` so a config failure — which would skip the callers, and skips are accepted — still fails the gate directly.

- **Why a check-run, not a commit status.** The gate is the job's _intrinsic_ check-run, named `go/no-go`. A commit status is writable by any push-scoped token (forgeable); a **check-run can only be minted by a GitHub App** — here, the repo's own Actions run — so a push-scoped token or a fork contributor cannot forge it. Require it on `main` via a **ruleset pinned to the GitHub Actions integration** (`integration_id: 15368`), so nothing but this repo's Actions can satisfy it. Rulesets aren't copied by template generation — see the generation checklist.
- **Footguns (A-418).** The gate must **never** be path-filtered (a path-filtered required check sits Pending forever and blocks merges); `always()` is mandatory or the aggregator skips and never reports; the literal `/` must surface as `check_run.name == "go/no-go"` (it does — emoji/spaces already survive in `lint / Lint`). Fall back to explicit-create (`POST /check-runs`, Option A) only if the `/` ever misbehaves.
- **Transition (A-419).** The private release-orchestrator still waits on `🔬 Build & Lint` until A-419 flips it to the `go/no-go` check-run (dual-accept, then `go/no-go`-only). The caller swap (A-447) **removed** the `🔬 Build & Lint` context from this template — replaced by `lint / Lint` + `build-test / Build & Test` — so the fleet rollout (A-420) must land alongside A-419. Safe on _this_ repo: Release is disabled, so nothing here waits on the orchestrator. `pr-title`'s name is _also_ the estate-pinned required-check context (A-405); don't tidy it.
- **Done (A-411 / A-447).** The `lint` and `build-test` jobs are now thin callers of `acme-skunkworks/shared-workflows`'s reusable `reusable-lint.yml` / `reusable-build-test.yml` (A-415/416). `pr-title` stays inline (its own track, A-428/A-403) and `release` stays inline (no reusable workflow yet, A-417). `go/no-go` stays put across the swap, which is exactly why it lives here (custom per-repo) and not upstream.

## Shared reusable CI callers (A-447)

The `lint` and `build-test` jobs in `ci.yml` are thin callers of the estate's shared reusable workflows — the template is the **reference consumer** that proves the pattern before the fleet rollout (A-420). Both are SHA-pinned to one commit (`9b7e7dc`) so Dependabot bumps them together (A-446).

- **`lint`** → `reusable-lint.yml` runs ESLint + markdownlint + yamllint/actionlint + dated-changelog validation in one job (`lint / Lint`). Inputs: `eslint-args` passes **directory paths** (`src infrastructure/scripts infrastructure/send-it`), not globs — the Layer-1 action runs `eslint $ESLINT_ARGS` word-split with bash `globstar` off, so a `**` glob would mis-expand; directories let ESLint's flat config resolve the file set recursively. `markdown-globs` mirrors the `lint:md` script; `changelog-script: validate:changelog` (the repo's script name; the reusable default is `changelog:validate`). The yaml lane uses **actionlint 1.7.12** (the reusable default, owned upstream in lockstep per A-422 — _not_ the `1.7.5` the local `ensure-actionlint.sh` pins) and shared-workflows' **centralised `.yamllint.yml`** (A-438), so the repo's local `.yamllint.yml` now only feeds the pre-commit hook.
- **`build-test`** → `reusable-build-test.yml` runs build (verification) + Vitest + ShellCheck + bats (`build-test / Build & Test`). `typecheck: false` (CI runs no standalone `pnpm tsc` today). `shellcheck-paths` passes the scripts dir + the three extensionless husky hooks explicitly (the action `find`s `*.sh/*.bash` under directories but takes files literally). `bats: true` runs `pnpm exec bats` — which is why **`bats` is a devDependency** (`bats@1.13.0`, matching `ensure-bats.sh`'s pin); the tests are self-contained (no `bats-support`/`bats-assert`).
- **`config`** loads `repo-config.yaml` once and feeds `node-version-file` to the callers (and to `changelog-completeness`) via `needs` — caller jobs can't run a `load-repo-config` step inline. This is the caller-stub pattern: a generated package that changes `nodeVersionFile` has it flow through without editing the workflow.

The callers run on **all** branches including `release-please--*` (no skip), so the changelog lane validates the finalised entries before the release PR merges. Consequence: yaml/shellcheck/test/bats now also run on the release-please branch (the old inline `yaml-lint`/`infra` jobs skipped there) — harmless, `go/no-go` stays green.

The `ensure-actionlint.sh` / `ensure-yamllint.sh` / `ensure-bats.sh` scripts (and `requirements-yamllint.txt`) are **no longer run in CI** — those tools install inside the reusable workflows now. They are retained as unit-tested reference shell (still exercised by `pnpm test:sh`) and document the install-and-verify pattern.

## Validating workflows and YAML

Two non-Node tools augment Prettier's formatting pass with the semantic checks Prettier can't see (Actions schema, `${{ … }}` expression typos, duplicate keys, etc.). Since A-447, **CI runs them inside the `lint` reusable caller** (the yaml lane), not the inline jobs described here — so the install scripts below are now the **local/pre-commit + reference** path. Note the version split: the reusable workflow pins **actionlint 1.7.12** (and yamllint 1.37.1); the local `ensure-actionlint.sh` still pins **1.7.5**.

- **`actionlint` v1.7.5 (local)** — Go binary. Local install: `brew install actionlint` (macOS) or `bash <(curl -fsSL https://raw.githubusercontent.com/rhysd/actionlint/v1.7.5/scripts/download-actionlint.bash)` elsewhere.
- **`yamllint` 1.37.1** — Python tool. Local install: `brew install yamllint` (macOS) or `pip install --user yamllint==1.37.1` elsewhere.

**Digest-pinned bootstraps (A-327).** The CI install scripts for these tools fetch-and-execute third-party code, so each is pinned by digest, not just a mutable tag:

- `ensure-actionlint.sh` fetches `download-actionlint.bash` from the **immutable commit SHA** of the v1.7.5 tag (not the `v1.7.5` tag), passes the version explicitly so it installs that exact release, then independently re-verifies the extracted binary against a pinned sha256 (enforced on the CI arch, linux/amd64). It also **version-gates the cached binary** and **drops the cache `restore-keys` fallback** (A-349), so a version bump forces a clean reinstall instead of silently restoring a stale binary.
- `ensure-bats.sh` verifies the downloaded release tarball against a pinned sha256 before extraction.
- `ensure-yamllint.sh` installs via `pip install --require-hashes -r infrastructure/requirements-yamllint.txt`, so pip refuses any artefact — yamllint or a transitive dep — whose digest isn't listed. Regenerate that file when bumping (see its header).

When bumping any of these, update the version **and** the matching digest/requirements together. The same install-and-verify discipline now lives in the shared reusable workflows' read-scoped jobs; it must never be added to the `release`/`publish-github-packages` jobs, which is what keeps a compromised upstream away from the publish identity.

Configuration: `.yamllint.yml` at the repo root extends defaults, demotes line-length / indentation to warnings (Prettier owns formatting), allows the GitHub Actions truthy values (`on`, `off`, `yes`, `no`), and ignores `node_modules/`, `dist/`, `.turbo/`, `pnpm-lock.yaml`. **Local + pre-commit only** since A-447 — CI's yaml lane uses shared-workflows' centralised config (A-438). No `.actionlintrc.yaml` — defaults are fine for this repo.

Enforcement: pre-commit is best-effort (skip with install hint when missing); CI is the `lint` reusable caller's yaml lane (`lint / Lint`), always enforced. The local install-and-run logic for both tools lives in `infrastructure/scripts/ensure-yamllint.sh` and `ensure-actionlint.sh` — now CI-unused but kept as unit-tested reference (see `infrastructure/README.md`).

## Validating workflows locally with `act`

`actionlint` and `yamllint` catch schema and expression-level mistakes. They say nothing about whether a workflow actually _works_ end-to-end — Node/pnpm setup ordering, env propagation, conditional skips, step interdependencies. [`act`](https://github.com/nektos/act) closes that gap by running the workflow against your local Docker daemon so you can iterate without push-and-pray.

**Install:** `brew install act` (macOS) or `bash <(curl -fsSL https://raw.githubusercontent.com/nektos/act/master/install.sh)` (Linux). Requires a running container engine — Docker Desktop, Colima, or podman. `pnpm act:list` is the smoke test: if it enumerates the jobs in `.github/workflows/`, you're set up.

**`.actrc`** at the repo root pins `ubuntu-latest` to `catthehacker/ubuntu:act-latest` (Ubuntu 24.04-based, matching real `ubuntu-latest`). The default `act` image is intentionally minimal and silently breaks Node/pnpm setups, so don't remove this. Container architecture is deliberately **not** pinned — `act` defaults to the host arch (arm64 on Apple Silicon), which is fast and matches GHA's _results_ for this codebase even though GHA runners are amd64.

**Capability matrix** for the workflows (the build-once split is validated by static lint — actionlint/yamllint/shellcheck/bats green; the rows below describe expected `act` behaviour):

| Workflow / Job                            | Under `act` | Notes                                                                                                                                                                                                                                                                                     |
| ----------------------------------------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ci.yml` → `config`                       | ✅ full     | Checkout → `load-repo-config`; exposes `node_version_file`. Fast, no network beyond checkout.                                                                                                                                                                                             |
| `ci.yml` → `lint` / `build-test`          | ⚠️ remote   | Thin callers of `acme-skunkworks/shared-workflows` reusable workflows. `act` must **fetch the remote reusable workflow** (needs network + a `GITHUB_TOKEN`); it won't run fully offline. The decisive check is the real PR run, not `act`.                                                |
| `ci.yml` → `pr-title`                     | ✅ full     | Lints the PR title as a Conventional Commit (`amannn/action-semantic-pull-request`). Reads the title from the PR event fixture.                                                                                                                                                           |
| `ci.yml` → `changelog-completeness`       | ✅ full     | Checkout → pnpm → Node 22 → install → completeness gate. A no-op unless the PR title is `feat`/`fix`/breaking (it reads `PR_TITLE`, unset under `act`).                                                                                                                                   |
| `release.yml` → `build`                   | ✅ full     | Checkout → pnpm → Node → install → `npm pack` → upload-artifact. Unprivileged (`contents: read`); no OIDC/publish surface, completes end-to-end (A-328).                                                                                                                                  |
| `release.yml` → `release`                 | ⚠️ partial  | Needs `build`; npm upgrade → version-vs-tag gate → download-artifact succeed. Fails at the npm publish in `publish-via-raw-npm.sh` — `--provenance` needs a real `ACTIONS_ID_TOKEN_REQUEST_URL` that doesn't exist locally. Documented gap. The `npm-release` environment is server-side. |
| `release.yml` → `publish-github-packages` | ⚠️ partial  | Needs `release`; Node (GH Packages) → download-artifact succeed (no build — publishes the prebuilt tarball). Fails at attestation/publish: needs a real OIDC issuer + `GITHUB_TOKEN` against `npm.pkg.github.com`. Same documented gap: confirm the job is _reached_, not that it ships.  |
| `claude-code-review.yml` / `claude.yml`   | ⏭️ skip     | Need `CLAUDE_CODE_OAUTH_TOKEN`. The `act:*` scripts use `-W` to scope to specific workflows, so these aren't loaded by default.                                                                                                                                                           |

**Commands:**

```bash
pnpm act:list           # smoke test — enumerate every job in .github/workflows/
pnpm act:ci             # run ci.yml as a PR event, using .github/act-events/pull_request.json
pnpm act:release:dry    # run release.yml — everything up to the npm publish, then stops at the OIDC-bound provenance check
```

The PR event fixture lives at `.github/act-events/pull_request.json` and sets `pull_request.head.ref` / `pull_request.base.ref` / `pull_request.title` so the changelog-completeness gate (`git diff …origin/${{ github.base_ref }}`) and the `pr-title` lint in `ci.yml` resolve against a real ref and title instead of `origin/`.

**Apple Silicon caveat:** arm64 default is fast (native, no emulation). To strictly mirror real `ubuntu-latest` (amd64) for one-off parity debugging, append `--container-architecture linux/amd64` (expect 3–5× slowdown via Rosetta/QEMU and a multi-minute first-run image pull).

**Post-push triage** (when CI runs remotely, after `/send-it`): `pnpm ci:list` shows recent runs, `pnpm ci:watch` streams the latest one, `pnpm ci:view` opens a specific run. All three require `gh auth login` first.

## `infrastructure/`

`act` validates workflow _wiring_ — that the YAML resolves, steps fire in order, env propagates. It says nothing about whether the logic _inside_ a `run:` block is correct. `infrastructure/` is the home for that logic: shell + TS extracted from workflow `run:` blocks, runnable and unit-tested in isolation. The full conventions document is `infrastructure/README.md`; the high-level rules:

- **Per-script language.** Shell + bats for CLI orchestration (`git`, `gh`, `jq`, `curl`, `pip`). TypeScript + vitest for parsing, branching, anything touching octokit. If a shell script grows past ~20 lines with conditionals, port to TS.
- **Inputs via env, not argv.** Workflows pass values through `env:`; tests mock by passing an env object. No shell quoting drama; clean test seam.
- **Pure functions exported for tests.** Each TS script exports the pure logic; `main()` wires it to real subprocesses. Tests inject a fake runner that records argv.
- **Idempotent.** Re-running with the same inputs is safe. The CI cache-hit branch of `ensure-yamllint.sh` / `ensure-actionlint.sh` / `ensure-bats.sh` is exactly this scenario.
- **Pinned versions in env defaults**, e.g. `ACTIONLINT_VERSION="${ACTIONLINT_VERSION:-1.7.5}"`. The workflow's cache-key still hard-codes the version separately — match them when bumping.

Scripts:

| File                                      | Replaces                                              | Tests                                                                                                                 |
| ----------------------------------------- | ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `scripts/ensure-yamllint.sh`              | `ci.yml` yamllint step                                | `tests/ensure-yamllint.bats` (install / already-installed branches)                                                   |
| `scripts/ensure-actionlint.sh`            | `ci.yml` actionlint step                              | `tests/ensure-actionlint.bats` (cache-hit / cache-miss branches)                                                      |
| `scripts/ensure-bats.sh`                  | `ci.yml` bats install step                            | `tests/ensure-bats.bats` (cache hit/miss, version override, off-PATH cache, substring guard, GITHUB_PATH propagation) |
| `scripts/validate-changelog.ts`           | `lint` caller's changelog lane (`validate:changelog`) | `tests/validate-changelog.test.ts` (vitest — schema accept/reject cases)                                              |
| `scripts/check-changelog-completeness.ts` | `ci.yml` `changelog-completeness` job                 | `tests/check-changelog-completeness.test.ts` (vitest — release-triggering title + entry-presence cases)               |
| `scripts/finalise-changelog.ts`           | orchestrator step after `release-please release-pr`   | `tests/finalise-changelog.test.ts` (vitest — finalise + gh/git resolver via fake runner)                              |
| `scripts/enrich-changelog.ts`             | (pure lib used by finalise)                           | `tests/enrich-changelog.test.ts` (vitest — fill-once, stats overwrite, idempotency)                                   |
| `scripts/add-links-changelog.ts`          | (pure lib used by finalise)                           | `tests/add-links-changelog.test.ts` (vitest — masking code/links, ASW/AKW IDs)                                        |
| `scripts/stamp-changelog-version.ts`      | (pure lib used by finalise)                           | `tests/stamp-changelog-version.test.ts` (vitest — stamp-once, absent-field)                                           |
| `scripts/publish-via-raw-npm.sh`          | `release.yml` npm publish step                        | `tests/publish-via-raw-npm.bats` (idempotency, npm-view probing, error handling)                                      |
| `scripts/publish-to-github-packages.sh`   | `release.yml` GH Packages publish step                | `tests/publish-to-github-packages.bats` (registry hard-code, idempotency)                                             |

CI (A-447): the `build-test` reusable caller runs ShellCheck (`infrastructure/scripts` + the husky hooks), Vitest, and bats (`pnpm exec bats`, so `bats` is a devDependency) against this directory; the `lint` caller runs `validate:changelog`; the `changelog-completeness` job runs the completeness gate (so the changelog checks also cover the release-please branch's finalised entries). Locally, `pnpm lint:sh` / `pnpm test:sh` skip with install hints if `shellcheck` / `bats` aren't on PATH — `pnpm test` (vitest) always runs because vitest is a node devDep.

> The changelog scripts use `gray-matter` (a devDependency) and the validator is a long flat list of schema checks, so `eslint.config.ts` scopes a `devDependencies: true` + `complexity: off` override to `infrastructure/**`.

When adding workflow-extracted tooling, write the test first, then wire from YAML as a one-liner: `run: pnpm tsx infrastructure/scripts/<name>.ts` or `run: bash infrastructure/scripts/<name>.sh`. (The bespoke `/send-it` slash command and its `infrastructure/send-it/` helpers were superseded by the shared `send-it` agent skill — see "## Agent skills"; its bump logic now lives in the bundle's `derive-bump.mjs`.)

## Dated changelog (`changelog/`)

The `changelog/` directory is the **only** changelog in the repo — there is no root `CHANGELOG.md` (release-please runs with `skip-changelog`, A-371). It keeps **one dated Markdown file per shippable change** — a browsable, per-change, machine-readable record (a `version` field per entry ties it back to the published release). `release.yml` sources its GitHub-release notes from these entries. Full schema and lifecycle in **`changelog/README.md`**. The template ships only that README; the first real entry is written by `/send-it`.

Two-stage lifecycle — finalisation rides inside the release-please release PR, which the private release-orchestrator creates (A-320 / A-376).

1. **PR-time** — `/send-it` writes `changelog/<YYYYMMDD-HHMMSS>-<slug>.md` with the PR-time fields (and empty enrichment placeholders), **gated on shippability** (only for shippable changes — i.e. a release-triggering `feat`/`fix`/breaking PR title), so every entry maps to a version bump. The entry merges to `main` with its feature PR and sits with placeholders until release. CI's changelog-completeness gate enforces this coupling (a release-triggering title must carry an entry).
2. **Release (in the release PR)** — the **orchestrator** runs `release-please release-pr` (which bumps `package.json` + `.release-please-manifest.json`) then `finalise-changelog.ts` (= `pnpm changelog:finalise`). For every entry without a `version`, finalise resolves its merged PR from the `branch` field via `gh` (filling `merged_at`/`commit`/`pr`/`merge_strategy`/`stats`), stamps the just-bumped `version`, and rewrites Linear IDs to links. The orchestrator commits those edits **into the release PR** — so they merge and publish through the normal flow. Idempotent and re-run-safe.

`validate:changelog` enforces the schema (CI: the `lint` reusable caller's changelog lane). Required frontmatter is relaxed to `title`/`created_at`/`category`/`breaking` so backfilled historical entries and in-flight entries both pass. `finalise-changelog.ts` is the only CLI; `enrich-changelog.ts`, `add-links-changelog.ts`, and `stamp-changelog-version.ts` are pure library modules it composes.

## Release workflow

> **Disabled on this template repo.** The template's `src/` is a placeholder that is never published, so `release.yml` is switched off here (`gh workflow disable Release`) to avoid a failing publish — and an auto-opened failure issue — on every push to `main`. The workflow file stays in the tree because it is part of the shell that generated packages inherit; only its execution on _this_ repo is suppressed. Re-enable with `gh workflow enable Release` (and in any repo generated from this template — see the generation checklist at the top). Everything below describes the workflow as it runs in a real, publishing package.

There are two release modes — know which one you're in.

### Day-to-day releases (CI via OIDC)

Once the package exists on npm AND its Trusted Publisher is configured against this repo's `release.yml`, every release flows through CI:

1. Make changes on a feature branch; `/send-it` bundles, writes the dated `changelog/<slug>.md` entry (for shippable changes), sets a **Conventional Commits PR title** (the squash subject release-please reads — `feat`/`fix`/`feat!` for shippable, a non-release type otherwise), pushes, opens a PR. CI (`.github/workflows/ci.yml`) runs build/lint, the conventional-PR-title lint, and the changelog-completeness gate on the PR.
2. After merge, the private **release-orchestrator** (road-runner-bot, runs a 15-min cron) mints a short-lived repo-scoped App token, runs `release-please release-pr` (which infers the bump from the merged Conventional-Commit PR titles and writes `package.json` + `.release-please-manifest.json`) then `finalise-changelog.ts`, pushes the `release-please--branches--main` branch, and opens the "`chore(main): release <version>`" release PR. On a later tick it squash-merges that PR once the CI gate is green — the `go/no-go` check-run (the orchestrator moves from `🔬 Build & Lint` to `go/no-go` under A-419; this template now emits only `go/no-go`, not `🔬 Build & Lint` — see "CI gate (`go/no-go`)" above).
3. The orchestrator's App-token merge pushes to `main`, re-firing `release.yml`. An unprivileged `build` job builds + `npm pack`s the tarball once and uploads it as an artifact; the `release` job sees a **freshly bumped, untagged version**, downloads that exact tarball, and publishes it to npm via OIDC Trusted Publishing (no token, no OTP) + provenance attestation, plus git tags + a GitHub release. A third `publish-github-packages` job downloads the **same** tarball and mirrors it to GitHub Packages with a GitHub-native build-provenance attestation.

**`release.yml` is publish-only.** It does **not** create the release PR — that path needs an identity that isn't `github-actions[bot]` (the "Allow GitHub Actions to create and approve pull requests" toggle is deliberately off), so versioning lives in the orchestrator where the App key stays private. A `🔎 Detect release (version vs tag)` step gates the publish on `publish == 'true'`: a feature-merge (version unchanged → its `v<version>` tag exists) is a clean green no-op; a release-PR merge (version freshly bumped → no tag yet) publishes. This keyless gate replaces the old `.changeset/*.md` scan — no Changesets dependency. The bot's private key never touches this public repo's CI.

**Cross-boundary hardening (A-326).** npm Trusted Publishing binds its OIDC subject to repository + workflow filename only — not the trigger event, ref, or actor — so anything able to run `release.yml` against an arbitrary ref could mint a valid publish credential. Three layers close that:

- **No `workflow_dispatch`.** The only trigger is `push: [main]`; re-run a failed release via "Re-run jobs" on the original push run.
- **Branch-restricted `npm-release` environment** on both privileged jobs (`release` and `publish-github-packages`). It permits deployments **only from `refs/heads/main`** (deployment-branch policy), so a non-main ref is rejected before the OIDC token is mintable. **No required reviewers** — releases stay hands-off; this is a structural ref gate, not a manual approval. The environment is configured in repo settings (not in YAML): `gh api -X PUT repos/acme-skunkworks/npm-package-template/environments/npm-release` with `deployment_branch_policy.custom_branch_policies=true`, then a single `main` branch policy.
- **Explicit ref guard** (`github.event_name == 'push' && github.ref == 'refs/heads/main' && …`) on every publish/tag step and the GitHub Packages job `if:`. Redundant with the environment now, but kept as the in-workflow structural defence.

**Build once, publish the exact artifact (A-328).** Build-time code (`pnpm install` + `tsc` + `npm pack`) runs **only** in the unprivileged `build` job (`contents: read`, no `id-token`/`packages`/`contents: write`). Both publish legs download and ship that one tarball, so a compromised build-time dependency never runs alongside a mintable publish credential, and the npm tarball, the GitHub Packages tarball, and the attested digest are guaranteed byte-identical.

**The publish step uses a wrapper script (no `changesets/action`).** The `🚀 Publish (npm)` step runs `bash infrastructure/scripts/publish-via-raw-npm.sh` directly, which calls `$PNPM_HOME/npm publish "$TARBALL" --access public --provenance` on the prebuilt tarball (A-328). Two reasons (both diagnosed in A-174):

- `actions/setup-node` runs after `pnpm/action-setup` and prepends its tool-cache bin to PATH, so plain `npm` resolves to whatever npm Node 22 ships. npm Trusted Publishing requires npm 11.5.1+. The upgrade-npm step works around this by `pnpm add -g npm@11.14.1` (pinned, not `@latest`, for CI reproducibility) and appending `$PNPM_HOME` to `$GITHUB_PATH` so subsequent steps see the upgraded npm at the front of PATH.
- The wrapper calls npm directly rather than via pnpm's own publish path, whose HTTP/OIDC implementation doesn't satisfy what npm Trusted Publishing expects. It is also idempotent: if `npm view name@version` succeeds, it exits 0 instead of re-publishing (which would 409).

In `release.yml`, the publish + tag steps run **only when the version-vs-tag gate reports `publish == 'true'`** — i.e. solely to publish (npm + git tags + GitHub release). release-please (in the orchestrator) owns versioning and the release PR; this workflow never bumps or tags speculatively.

**GitHub Packages — secondary target (A-323).** npmjs.org (OIDC + provenance) is the canonical public source; GitHub Packages is published alongside it as a secondary mirror with the security gaps closed:

- **Separate `publish-github-packages` job**, gated `needs: release` + `if: needs.release.outputs.should_publish == 'true'` **plus the same main-only ref guard + `npm-release` environment** (A-326). `packages: write` is scoped to this job only — never to the `release` job that holds `id-token: write` for npm OIDC.
- **Auth is the ephemeral per-job `GITHUB_TOKEN`** — the most secure option GitHub Packages offers (no OIDC Trusted-Publisher flow exists for it; no standing secret).
- **Provenance via GitHub-native attestation.** `npm publish --provenance` is npmjs.org-only, so the job runs `actions/attest-build-provenance` over the exact tarball it publishes — the attested digest matches both the npm tarball and what consumers download (`gh attestation verify <tarball> --repo acme-skunkworks/npm-package-template`).
- **`publish-to-github-packages.sh`** is idempotent (skips on `npm view` hit, distinguishes 404 from real errors) and reads inputs from env. It **hard-codes the publish target to `https://npm.pkg.github.com` and aborts if `GITHUB_PACKAGES_REGISTRY_URL` drifts from it** (A-330) — the ephemeral `GITHUB_TOKEN` is a bearer credential, so the host must never be redirectable by a config edit.

> **Watch-item:** the npm leg's git tag + GitHub release are created explicitly in the `release` job (`npm publish` creates neither on its own — see the `🏷️ Tag + GitHub release` step, which sources its notes from the matching dated `changelog/` entries). Confirm that step still runs on each release.

Don't reintroduce `NPM_TOKEN` **as a CI secret** unless OIDC is verified broken. The local `.env`-based `NPM_TOKEN` is a different concern — it's for laptop-driven publishes only, never CI.

**Choosing the bump.** There is no changeset file. release-please infers the bump from the **Conventional Commits PR title** (the squash subject): `fix:` → patch, `feat:` → minor, a `!` breaking marker (or a `BREAKING CHANGE:` footer) → major. `/send-it` derives this automatically; for a hand-opened PR, set the title yourself. Non-release types (`docs:`/`chore:`/`ci:`/`refactor:`/`test:`/`build:`/`style:`/`perf:`) don't cut a release. The conventional-PR-title lint + the changelog-completeness gate in `ci.yml` keep the title honest.

### Manual publish (break-glass — CI-down only, after the package exists)

> **This is break-glass, not a routine path (A-331).** Reach for it only when CI/OIDC is genuinely down — every normal release goes through `release.yml` (OIDC, no standing token). The `.env` `NPM_TOKEN` is a long-lived credential, so treat it accordingly: store it in a secrets manager retrieved just-in-time (not a lingering plaintext `.env`), give it the shortest viable lifetime with a documented rotation cadence, and rotate immediately on any exposure. It never touches CI, and manual publishes ship without a provenance badge so they can't masquerade as verified CI ones.

Auth setup (one-time, or after rotating your token):

```bash
NPM_TOKEN=$(grep '^NPM_TOKEN=' .env | cut -d'=' -f2-)
npm config set //registry.npmjs.org/:_authToken "$NPM_TOKEN"
npm whoami    # verify
```

The token must be a **Granular Access Token with the "Bypass 2FA" option enabled at creation time**. Without that flag, every publish hits `EOTP` and you're stuck. Tokens are immutable after creation — if you forgot the flag, revoke and regenerate.

Then publish:

```bash
pnpm run release:manual:dry    # simulate — verifies tarball + auth
pnpm run release:manual        # actual publish
```

`--provenance=false` is intentional — provenance attestation requires a GitHub Actions OIDC issuer, which a laptop doesn't have. Don't try `pnpm run release:manual -- --dry-run`; the chained-script + `--` separator confuses npm into treating `--dry-run` as a positional package spec. Use `release:manual:dry`.

## Bootstrap publish — read this when setting up a new package

The very first publish of a brand-new npm package **cannot go through CI**. Two reasons that compound:

- npm (unlike PyPI) has no pending-Trusted-Publisher flow. The package must exist on the registry before the Trusted Publisher form is reachable at `npmjs.com/package/<name>/access`.
- npm enforces 2FA at the publish endpoint for the first publish of a new package, irrespective of account/org/token bypass settings — so it needs an interactive second factor. A Granular bypass-2FA token does **not** help here: it only honours the bypass from publish #2 onwards. With a recent npm (default `auth-type=web`), that 2FA is satisfied **in the browser via a passkey/WebAuthn approval** — so the first publish completes interactively from a laptop, not in CI.

So bootstrap is always: manual first publish (approve in the browser) → configure Trusted Publisher → CI takes over from publish #2.

**Pre-flight:**

- You belong to the target npm org with publish rights.
- npm CLI ≥ 11.5.1 (`npm install -g npm@latest`) — the floor Trusted Publishing needs; newer is better for the web-auth flow (verified on npm 11.12.1).
- **A passkey/security key registered on your npm account**, an interactive browser on the publishing machine, and `auth-type=web` (the npm default — don't override it). This is the primary path's second factor.
- _Fallback only:_ recovery codes generated and saved, for when no interactive browser/passkey is available (see the fallback below).
- `package.json` and `.release-please-manifest.json` are at the version you want to ship. For a brand-new package, edit both directly (set them to the initial `1.0.0`/`0.1.0`) — no release-please run is needed for the very first publish; release-please takes over bumping from publish #2 once the manifest is seeded.

**Sequence (primary — passkey/WebAuthn browser flow):**

1. Set `package.json` + `.release-please-manifest.json` to the version you want to ship (edit directly for a fresh package). There is no root `CHANGELOG.md` to write — the dated `changelog/` entry carries the release notes.
2. `pnpm run release:manual:dry` — verify tarball + auth. **Note:** dry-run does NOT exercise the 2FA/browser step, so a successful dry-run does not by itself predict a successful real publish.
3. `pnpm run release:manual` — i.e. `npm publish --access public --provenance=false` (no `--otp`). npm opens your browser and prompts for a **passkey/WebAuthn approval** (Touch ID / Face ID / security key). Approve it, and the brand-new scoped package publishes cleanly. _(Verified 2026-06-01 first-publishing `@acme-skunkworks/agent-skills@1.0.0` this way.)_
4. Configure Trusted Publisher: `https://www.npmjs.com/package/<name>/access` → GitHub Actions → org, repo, workflow filename (`release.yml`), environment blank.
5. From here on, releases go through CI cleanly.

**Fallback (recovery-code `--otp`):** for headless / CI-less / no-browser contexts, an account without a passkey, or an npm too old for web auth. Pass a recovery code as `--otp`:

```bash
npm publish --access public --provenance=false --otp=<recovery-code>
```

Generate codes at npmjs.com → Profile → Two-Factor Authentication → Manage Recovery Codes. Each is single-use. The format is a long hex string (not a 6-digit TOTP) — npm accepts it as `--otp` anyway. **After a publish that consumed a code, immediately regenerate your recovery codes** — the one you used is burnt. Then configure Trusted Publisher as in step 4 above.

### Things that look like solutions but aren't

Saving these to spare the next bootstrap from rediscovering them:

- Toggling "Require 2FA for write actions" off in account settings.
- Disabling org-level 2FA enforcement.
- Generating a Granular token with bypass-2FA enabled — works for publish #2+, NOT publish #1.
- `oathtool` for generating TOTP — only works if you have a TOTP secret, and **npm has phased TOTP out of new accounts** (only passkeys + recovery codes are offered now).
- Disabling 2FA entirely — npm's policy _requires_ either 2FA or a bypass-2FA token; you can't disable both.

The passkey/WebAuthn browser flow is the answer for publish #1: with `auth-type=web` (the npm default) a plain `npm publish` opens the browser and lets you approve the package's first-publish 2FA interactively. Recovery-code `--otp` is the fallback for when there's no interactive browser or passkey to drive that flow.

> **Historical note:** earlier revisions of this runbook claimed the first publish would always fail with `EOTP` and that a recovery code passed as `--otp` was the only route — treating `npm publish --auth-type=web` as a no-op (a flag "only for `npm login`"). That was stale: as of npm 11.12.1, web auth is the default and `npm publish` completes first-publish 2FA in the browser via a passkey. Recovery-code `--otp` is now only the fallback.
