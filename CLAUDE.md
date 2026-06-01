# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repo

Template repository for Acme Skunkworks npm packages. It ships a minimal, buildable pnpm + TypeScript ESM skeleton plus the shared workflow/release shell, so a new package can be generated and released without rebuilding the infrastructure each time.

When generating a package from this template:

- Rename `name` in `package.json` (the placeholder is `@acme-skunkworks/npm-package-template`) and update `description`/`keywords`/`repository`/`homepage`/`bugs`.
- Replace everything under `src/` with the package's real public API — `src/index.ts` is the published entry point. The surrounding shell (build, lint, release) does not need to change.
- Point `infrastructure/repo-config.yaml` at the new package if any value differs (scope, registry, default branch).
- Rename the package reference in `.claude/commands/send-it.md`'s changeset example.
- **Re-enable the Release workflow.** It is intentionally disabled on _this template repo_ (see "Release workflow" below); a generated repo needs it on: `gh workflow enable Release`. (Template generation copies files with workflows enabled by default, so this is only a guard against the rare case where it was carried over disabled.)

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
pnpm lint:md        # markdownlint (CI: build-and-lint job in ci.yml; excludes generated CHANGELOG.md)
pnpm lint:yaml      # yamllint . (semantic YAML check; warnings non-blocking)
pnpm lint:workflows # actionlint on .github/workflows/
pnpm lint:sh        # shellcheck on infrastructure/scripts/*.sh + .husky/*
pnpm test           # vitest run (infrastructure/tests/**/*.test.ts)
pnpm test:watch     # vitest in watch mode
pnpm test:sh        # bats on infrastructure/tests/*.bats
pnpm validate:changelog # schema-check changelog/*.md (CI: infra job)
pnpm format         # prettier write
pnpm clean          # remove node_modules + dist
pnpm changeset      # interactive changeset (or write .changeset/<slug>.md by hand)
```

## Source layout

TypeScript source lives under `src/`, compiled by `tsc` to `dist/` (declarations + source maps). Only `dist/` is published (`files: ["dist"]`); `exports`/`main`/`module`/`types` all point into it. The workflow/release shell — `.github/`, `infrastructure/`, `.changeset/`, `.husky/`, `changelog/` — is **not** part of the published artifact.

## Build / type-check / lint topology

The published `dist/` must contain **only** the compiled `src/`, but the TypeScript tooling under `infrastructure/` still needs type-checking and type-aware linting. Three tsconfigs keep those concerns separate:

- **`tsconfig.json`** — the build config. `rootDir: ./src`, `include: ["src/**/*.ts"]`, emits to `dist/`. `pnpm build` (`tsc`) uses it, so `dist/` stays src-only. Do **not** widen its `include` to "fix" linting — that re-emits infra into `dist/`.
- **`tsconfig.tools.json`** — `noEmit`, `extends ./tsconfig.json`, covers `infrastructure/scripts/**`, `infrastructure/send-it/**`, `infrastructure/tests/**`, `vitest.config.ts`. `pnpm tsc` runs it as a second pass to type-check the shell + tests.
- **`tsconfig.eslint.json`** — `noEmit`, the linter's project. Spans `src/**` + the infra `.ts`. `eslint.config.mjs` pins `parserOptions.project` to it so the base preset's type-aware rules (`project: true`) resolve every linted file regardless of directory. Without this pin ESLint would fail with "file not found by the project service" on infra files (they aren't in the src-only `tsconfig.json`).

`extends` does **not** inherit `include`/`exclude` — only `compilerOptions` — so the two extra configs restate their own `include`/`exclude`.

## Linting and formatting

This package dogfoods the org's own shared configs:

- **ESLint** — `eslint.config.mjs` consumes `@acme-skunkworks/eslint-config`, composing the `base` stack plus the `typescript` overrides, then adds two local blocks: an `infrastructure/**/*.ts` override (`complexity: off` + `import/no-extraneous-dependencies` with `devDependencies: true`, since the shell scripts legitimately import devDeps like `gray-matter` and the changelog validator is a branchy flat list of checks), and the `tsconfig.eslint.json` project pin (see above). The preset also re-exports opt-in presets (`testing`, `frameworkRouting`, `astro`, `sanity`, `storybook`, `tableComponents`) — pull them in as a generated package needs them. The config is authored in `.mjs` (not `.ts`) because it is a trivial re-export and so needs no TypeScript-config loader.
- **Markdown** — `.markdownlint-cli2.jsonc` extends `@acme-skunkworks/markdownlint-config`. `lint:md` excludes `CHANGELOG.md`, which the changelog tooling generates with formatting markdownlint would otherwise fight. Pre-commit auto-fixes staged `**/*.{md,mdx}` via lint-staged (`|| true`, so it never blocks); the `build-and-lint` job in `ci.yml` enforces.
- **Prettier** — `pnpm format` runs `prettier --write .`; `.prettierignore` excludes `node_modules`, `dist`, `pnpm-lock.yaml`, `tsconfig.json`, and `CHANGELOG.md`.

## GitHub Actions repo config

Non-secret knobs shared by `ci.yml` and `release.yml` live in **`infrastructure/repo-config.yaml`**, loaded at runtime by the composite `.github/actions/load-repo-config` (`uses: ./.github/actions/load-repo-config`), which allowlist-validates every value before writing it to `GITHUB_OUTPUT` (guards newline/`=` injection; ASW-330).

| Key                         | Purpose                                                                                                                     |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `defaultBranch`             | Canonical default branch; keep in sync with static `on:` triggers (GitHub cannot derive `on.push.branches` from this file). |
| `nodeVersionFile`           | Passed to `actions/setup-node` `node-version-file`.                                                                         |
| `npmRegistryUrl`            | Public npm registry (`setup-node` when talking to npmjs).                                                                   |
| `npmScope`                  | Package scope; must equal the owning GitHub org so `setup-node` scopes `.npmrc` for the GitHub Packages leg.                |
| `githubPackagesRegistryUrl` | GitHub Packages npm registry (`https://npm.pkg.github.com`) — the secondary publish target.                                 |

Secrets (`GITHUB_TOKEN`), OIDC Trusted Publishing, and Changesets behaviour are unchanged — not in this file. **No bot key ships in the template.**

## Local hooks

`pnpm install` runs `prepare` (`husky`), which installs the hooks under `.husky/`. Three hooks fire:

- **`pre-commit`** — runs `pnpm lint-staged`. Auto-fixes only the staged files: `prettier --write` for everything, `eslint --fix` for `**/*.{ts,tsx,js,mjs,cjs}`, `sort-package-json` + `eslint --fix` for `**/package.json`, `markdownlint-cli2 --fix` for `**/*.{md,mdx}`, `yamllint` (read-only check) for `**/*.{yml,yaml}`, `actionlint` (read-only check) for `.github/workflows/*.{yml,yaml}`. Each task is wrapped in `bash -c '… "$@" --` so the staged file paths are passed through. The auto-fixers carry an `|| true` fallback so they never block — CI is the gate. The two YAML linters are best-effort: if the tool isn't on `PATH` locally, the hook prints a platform-appropriate install hint and skips. CI still enforces.
- **`commit-msg`** — strips any `Co-Authored-By: Claude … <noreply@anthropic.com>` trailer. Backstops the global `~/.claude/CLAUDE.md` rule (Claude is tooling, not a contributor).
- **`pre-push`** — blocks direct pushes to `main`; humans should use `/send-it` to open a PR. Bot users (`github-actions[bot]`, `road-runner-bot[bot]`) and the changesets release commit (`release: version packages`) bypass. It also runs `pnpm lint:workflows` + `pnpm lint:yaml` as a last-line gate before CI.

Hooks are dormant in CI: `release.yml` and `ci.yml` set `HUSKY=0` so the `prepare` script no-ops during `pnpm install`.

To bypass any hook in an emergency: `git commit --no-verify` or `git push --no-verify` — not recommended.

## Validating workflows and YAML

Two non-Node tools augment Prettier's formatting pass with the semantic checks Prettier can't see (Actions schema, `${{ … }}` expression typos, duplicate keys, etc.):

- **`actionlint` v1.7.5** — Go binary. Local install: `brew install actionlint` (macOS) or `bash <(curl -fsSL https://raw.githubusercontent.com/rhysd/actionlint/v1.7.5/scripts/download-actionlint.bash)` elsewhere. CI downloads the official tarball and caches it.
- **`yamllint` 1.37.1** — Python tool. Local install: `brew install yamllint` (macOS) or `pip install --user yamllint==1.37.1` elsewhere. CI installs via pip and caches `~/.local`.

**Digest-pinned bootstraps (ASW-327).** The CI install scripts for these tools fetch-and-execute third-party code, so each is pinned by digest, not just a mutable tag:

- `ensure-actionlint.sh` fetches `download-actionlint.bash` from the **immutable commit SHA** of the v1.7.5 tag (not the `v1.7.5` tag), passes the version explicitly so it installs that exact release, then independently re-verifies the extracted binary against a pinned sha256 (enforced on the CI arch, linux/amd64). It also **version-gates the cached binary** and **drops the cache `restore-keys` fallback** (ASW-349), so a version bump forces a clean reinstall instead of silently restoring a stale binary.
- `ensure-bats.sh` verifies the downloaded release tarball against a pinned sha256 before extraction.
- `ensure-yamllint.sh` installs via `pip install --require-hashes -r infrastructure/requirements-yamllint.txt`, so pip refuses any artefact — yamllint or a transitive dep — whose digest isn't listed. Regenerate that file when bumping (see its header). The `yaml-lint` cache key in `ci.yml` is keyed on its hash.

When bumping any of these, update the version **and** the matching digest/requirements together. These scripts run only in read-scoped CI jobs (`yaml-lint`, `infra`) — they must never be added to the `release`/`publish-github-packages` jobs, which is what keeps a compromised upstream away from the publish identity.

Configuration: `.yamllint.yml` at the repo root extends defaults, demotes line-length / indentation to warnings (Prettier owns formatting), allows the GitHub Actions truthy values (`on`, `off`, `yes`, `no`), and ignores `node_modules/`, `dist/`, `.turbo/`, `pnpm-lock.yaml`. No `.actionlintrc.yaml` — defaults are fine for this repo.

Enforcement: pre-commit is best-effort (skip with install hint when missing); CI is the `yaml-lint` job in `ci.yml`, parallel to `build-and-lint`, always enforced. The install-and-run logic for both tools lives in `infrastructure/scripts/ensure-yamllint.sh` and `ensure-actionlint.sh`; the workflow calls those as one-liners (see `infrastructure/README.md`). Cache steps stay inline in `ci.yml` because caching is a workflow concern.

## Validating workflows locally with `act`

`actionlint` and `yamllint` catch schema and expression-level mistakes. They say nothing about whether a workflow actually _works_ end-to-end — Node/pnpm setup ordering, env propagation, conditional skips, step interdependencies. [`act`](https://github.com/nektos/act) closes that gap by running the workflow against your local Docker daemon so you can iterate without push-and-pray.

**Install:** `brew install act` (macOS) or `bash <(curl -fsSL https://raw.githubusercontent.com/nektos/act/master/install.sh)` (Linux). Requires a running container engine — Docker Desktop, Colima, or podman. `pnpm act:list` is the smoke test: if it enumerates the jobs in `.github/workflows/`, you're set up.

**`.actrc`** at the repo root pins `ubuntu-latest` to `catthehacker/ubuntu:act-latest` (Ubuntu 24.04-based, matching real `ubuntu-latest`). The default `act` image is intentionally minimal and silently breaks Node/pnpm setups, so don't remove this. Container architecture is deliberately **not** pinned — `act` defaults to the host arch (arm64 on Apple Silicon), which is fast and matches GHA's _results_ for this codebase even though GHA runners are amd64.

**Capability matrix** for the workflows (the build-once split is validated by static lint — actionlint/yamllint/shellcheck/bats green; the rows below describe expected `act` behaviour):

| Workflow / Job                            | Under `act` | Notes                                                                                                                                                                                                                                                                                    |
| ----------------------------------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ci.yml` → `build-and-lint`               | ✅ full     | Checkout → pnpm → Node 22 → install → build → lint all green. The `📝 Changeset status` step is `continue-on-error: true` and "fails" locally whenever the branch has changes vs `main` but no changeset yet — expected pre-`/send-it` noise.                                            |
| `ci.yml` → `yaml-lint`                    | ✅ full     | yamllint pip install + actionlint curl-bash both work inside the container. Needs `pip install --user --break-system-packages` (Ubuntu 24.04 / PEP 668; no-op on real GHA) and `export PATH="$HOME/.local/bin:$PATH"` within the step (catthehacker runs as root).                       |
| `release.yml` → `build`                   | ✅ full     | Checkout → pnpm → Node → install → `npm pack` → upload-artifact. Unprivileged (`contents: read`); no OIDC/publish surface, completes end-to-end (ASW-328).                                                                                                                               |
| `release.yml` → `release`                 | ⚠️ partial  | Needs `build`; npm upgrade → detect changesets → download-artifact succeed. Fails at the npm publish in `publish-via-raw-npm.sh` — `--provenance` needs a real `ACTIONS_ID_TOKEN_REQUEST_URL` that doesn't exist locally. Documented gap. The `npm-release` environment is server-side.  |
| `release.yml` → `publish-github-packages` | ⚠️ partial  | Needs `release`; Node (GH Packages) → download-artifact succeed (no build — publishes the prebuilt tarball). Fails at attestation/publish: needs a real OIDC issuer + `GITHUB_TOKEN` against `npm.pkg.github.com`. Same documented gap: confirm the job is _reached_, not that it ships. |
| `claude-code-review.yml` / `claude.yml`   | ⏭️ skip     | Need `CLAUDE_CODE_OAUTH_TOKEN`. The `act:*` scripts use `-W` to scope to specific workflows, so these aren't loaded by default.                                                                                                                                                          |

**Commands:**

```bash
pnpm act:list           # smoke test — enumerate every job in .github/workflows/
pnpm act:ci             # run ci.yml as a PR event, using .github/act-events/pull_request.json
pnpm act:release:dry    # run release.yml — everything up to the npm publish, then stops at the OIDC-bound provenance check
```

The PR event fixture lives at `.github/act-events/pull_request.json` and sets `pull_request.head.ref` / `pull_request.base.ref` so `pnpm changeset status --since=origin/${{ github.base_ref }}` in `ci.yml` resolves to a real ref instead of `origin/`.

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

| File                                    | Replaces                                  | Tests                                                                                                                 |
| --------------------------------------- | ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `scripts/ensure-yamllint.sh`            | `ci.yml` yamllint step                    | `tests/ensure-yamllint.bats` (install / already-installed branches)                                                   |
| `scripts/ensure-actionlint.sh`          | `ci.yml` actionlint step                  | `tests/ensure-actionlint.bats` (cache-hit / cache-miss branches)                                                      |
| `scripts/ensure-bats.sh`                | `ci.yml` bats install step                | `tests/ensure-bats.bats` (cache hit/miss, version override, off-PATH cache, substring guard, GITHUB_PATH propagation) |
| `send-it/derive-changeset.ts`           | (used by `/send-it`)                      | `tests/derive-changeset.test.ts` (vitest — slug, bump, body)                                                          |
| `scripts/validate-changelog.ts`         | `ci.yml` infra job `validate:changelog`   | `tests/validate-changelog.test.ts` (vitest — schema accept/reject cases)                                              |
| `scripts/finalise-changelog.ts`         | `release.yml` `changeset:version` command | `tests/finalise-changelog.test.ts` (vitest — finalise + gh/git resolver via fake runner)                              |
| `scripts/enrich-changelog.ts`           | (pure lib used by finalise)               | `tests/enrich-changelog.test.ts` (vitest — fill-once, stats overwrite, idempotency)                                   |
| `scripts/add-links-changelog.ts`        | (pure lib used by finalise)               | `tests/add-links-changelog.test.ts` (vitest — masking code/links, ASW/AKW IDs)                                        |
| `scripts/stamp-changelog-version.ts`    | (pure lib used by finalise)               | `tests/stamp-changelog-version.test.ts` (vitest — stamp-once, absent-field)                                           |
| `scripts/publish-via-raw-npm.sh`        | `release.yml` npm publish step            | `tests/publish-via-raw-npm.bats` (idempotency, npm-view probing, error handling)                                      |
| `scripts/publish-to-github-packages.sh` | `release.yml` GH Packages publish step    | `tests/publish-to-github-packages.bats` (registry hard-code, idempotency)                                             |

CI: the `infra` job in `ci.yml` runs `pnpm lint:sh`, `pnpm test`, `pnpm test:sh`, and `pnpm validate:changelog` against this directory. Locally, `pnpm lint:sh` / `pnpm test:sh` skip with install hints if `shellcheck` / `bats` aren't on PATH — `pnpm test` (vitest) always runs because vitest is a node devDep.

> The changelog scripts use `gray-matter` (a devDependency) and the validator is a long flat list of schema checks, so `eslint.config.mjs` scopes a `devDependencies: true` + `complexity: off` override to `infrastructure/**`.

When adding workflow-extracted tooling, write the test first, then wire from YAML as a one-liner: `run: pnpm tsx infrastructure/scripts/<name>.ts` or `run: bash infrastructure/scripts/<name>.sh`. Slash-command-only helpers under `infrastructure/send-it/` are invoked from `.claude/commands/send-it.md` instead.

## Dated changelog (`changelog/`)

Alongside the Changesets-generated root `CHANGELOG.md`, the repo keeps **one dated Markdown file per shippable change** under `changelog/` — a browsable, per-change, machine-readable record (a `version` field per entry ties it back to the published release). Full schema and lifecycle in **`changelog/README.md`**. The template ships only that README; the first real entry is written by `/send-it`.

Two-stage lifecycle — finalisation rides inside the Changesets version PR (ASW-317), which the private release-orchestrator creates.

1. **PR-time** — `/send-it` writes `changelog/<YYYYMMDD-HHMMSS>-<slug>.md` with the PR-time fields (and empty enrichment placeholders), **gated identically to the changeset** (only for shippable changes), so every entry maps to a version bump. The entry merges to `main` with its feature PR and sits with placeholders until release.
2. **Release (in the version PR)** — the **orchestrator** runs `pnpm run changeset:version` (= `changeset version` then `finalise-changelog.ts`) when it builds the version PR. For every entry without a `version`, finalise resolves its merged PR from the `branch` field via `gh` (filling `merged_at`/`commit`/`pr`/`merge_strategy`/`stats`), stamps the just-bumped `version`, and rewrites Linear IDs to links. The orchestrator commits those edits **into the version PR** — so they merge and publish through the normal flow. Idempotent and re-run-safe.

`validate:changelog` enforces the schema (CI: the `infra` job). Required frontmatter is relaxed to `title`/`created_at`/`category`/`breaking` so backfilled historical entries and in-flight entries both pass. `finalise-changelog.ts` is the only CLI; `enrich-changelog.ts`, `add-links-changelog.ts`, and `stamp-changelog-version.ts` are pure library modules it composes.

## Release workflow

> **Disabled on this template repo.** The template's `src/` is a placeholder that is never published, so `release.yml` is switched off here (`gh workflow disable Release`) to avoid a failing publish — and an auto-opened failure issue — on every push to `main`. The workflow file stays in the tree because it is part of the shell that generated packages inherit; only its execution on _this_ repo is suppressed. Re-enable with `gh workflow enable Release` (and in any repo generated from this template — see the generation checklist at the top). Everything below describes the workflow as it runs in a real, publishing package.

There are two release modes — know which one you're in.

### Day-to-day releases (CI via OIDC)

Once the package exists on npm AND its Trusted Publisher is configured against this repo's `release.yml`, every release flows through CI:

1. Make changes on a feature branch; `/send-it` bundles, writes `.changeset/<slug>.md`, pushes, opens a PR. CI (`.github/workflows/ci.yml`) runs build/lint/changeset-status on the PR.
2. After merge, the private **release-orchestrator** (road-runner-bot, runs a 15-min cron) detects the pending changeset, mints a short-lived repo-scoped App token, runs `pnpm changeset:version`, pushes `changeset-release/main`, and opens the "`<pkg>@<version>`" version PR. On a later tick it squash-merges that PR once `🔬 Build & Lint` is green.
3. The orchestrator's App-token merge pushes to `main`, re-firing `release.yml`. An unprivileged `build` job builds + `npm pack`s the tarball once and uploads it as an artifact; the `release` job sees **no pending changesets**, downloads that exact tarball, and publishes it to npm via OIDC Trusted Publishing (no token, no OTP) + provenance attestation, plus git tags + a GitHub release. A third `publish-github-packages` job downloads the **same** tarball and mirrors it to GitHub Packages with a GitHub-native build-provenance attestation.

**`release.yml` is publish-only.** It does **not** create the version PR — that path needs an identity that isn't `github-actions[bot]` (the "Allow GitHub Actions to create and approve pull requests" toggle is deliberately off), so versioning lives in the orchestrator where the App key stays private. A `🔎 Detect pending changesets` step gates the publish on `has == 'false'`: a feature-merge (changesets pending) is a clean green no-op; a version-PR merge (none pending) publishes. The bot's private key never touches this public repo's CI.

**Cross-boundary hardening (ASW-326).** npm Trusted Publishing binds its OIDC subject to repository + workflow filename only — not the trigger event, ref, or actor — so anything able to run `release.yml` against an arbitrary ref could mint a valid publish credential. Three layers close that:

- **No `workflow_dispatch`.** The only trigger is `push: [main]`; re-run a failed release via "Re-run jobs" on the original push run.
- **Branch-restricted `npm-release` environment** on both privileged jobs (`release` and `publish-github-packages`). It permits deployments **only from `refs/heads/main`** (deployment-branch policy), so a non-main ref is rejected before the OIDC token is mintable. **No required reviewers** — releases stay hands-off; this is a structural ref gate, not a manual approval. The environment is configured in repo settings (not in YAML): `gh api -X PUT repos/acme-skunkworks/npm-package-template/environments/npm-release` with `deployment_branch_policy.custom_branch_policies=true`, then a single `main` branch policy.
- **Explicit ref guard** (`github.event_name == 'push' && github.ref == 'refs/heads/main' && …`) on every publish/tag step and the GitHub Packages job `if:`. Redundant with the environment now, but kept as the in-workflow structural defence.

**Build once, publish the exact artifact (ASW-328).** Build-time code (`pnpm install` + `tsc` + `npm pack`) runs **only** in the unprivileged `build` job (`contents: read`, no `id-token`/`packages`/`contents: write`). Both publish legs download and ship that one tarball, so a compromised build-time dependency never runs alongside a mintable publish credential, and the npm tarball, the GitHub Packages tarball, and the attested digest are guaranteed byte-identical.

**The publish step uses a wrapper script, not `pnpm changeset publish`.** `changesets/action`'s `publish:` input invokes `bash infrastructure/scripts/publish-via-raw-npm.sh`, which calls `$PNPM_HOME/npm publish "$TARBALL" --access public --provenance` directly on the prebuilt tarball (ASW-328). Two reasons (both diagnosed in ASW-174):

- `actions/setup-node` runs after `pnpm/action-setup` and prepends its tool-cache bin to PATH, so plain `npm` resolves to whatever npm Node 22 ships. npm Trusted Publishing requires npm 11.5.1+. The upgrade-npm step works around this by `pnpm add -g npm@11.14.1` (pinned, not `@latest`, for CI reproducibility) and appending `$PNPM_HOME` to `$GITHUB_PATH` so subsequent steps see the upgraded npm at the front of PATH.
- Even with PATH correct, `pnpm changeset publish` itself fails — pnpm's own publish HTTP/OIDC implementation inside `@changesets/cli` doesn't satisfy what npm Trusted Publishing expects. The wrapper sidesteps this by calling npm directly. It is also idempotent: if `npm view name@version` succeeds, it exits 0 instead of re-publishing (which would 409).

In `release.yml`, `changesets/action` runs **only when there are no pending changesets** — i.e. solely to publish (npm + git tags + GitHub release). It takes no `version:`/`commit:`/`title:` input; the orchestrator owns versioning and the version PR.

**GitHub Packages — secondary target (ASW-323).** npmjs.org (OIDC + provenance) is the canonical public source; GitHub Packages is published alongside it as a secondary mirror with the security gaps closed:

- **Separate `publish-github-packages` job**, gated `needs: release` + `if: needs.release.outputs.has_pending_changesets == 'false'` **plus the same main-only ref guard + `npm-release` environment** (ASW-326). `packages: write` is scoped to this job only — never to the `release` job that holds `id-token: write` for npm OIDC.
- **Auth is the ephemeral per-job `GITHUB_TOKEN`** — the most secure option GitHub Packages offers (no OIDC Trusted-Publisher flow exists for it; no standing secret).
- **Provenance via GitHub-native attestation.** `npm publish --provenance` is npmjs.org-only, so the job runs `actions/attest-build-provenance` over the exact tarball it publishes — the attested digest matches both the npm tarball and what consumers download (`gh attestation verify <tarball> --repo acme-skunkworks/npm-package-template`).
- **`publish-to-github-packages.sh`** is idempotent (skips on `npm view` hit, distinguishes 404 from real errors) and reads inputs from env. It **hard-codes the publish target to `https://npm.pkg.github.com` and aborts if `GITHUB_PACKAGES_REGISTRY_URL` drifts from it** (ASW-330) — the ephemeral `GITHUB_TOKEN` is a bearer credential, so the host must never be redirectable by a config edit.

> **Watch-item:** the npm leg's git tag + GitHub release are created explicitly in the `release` job (the raw-npm wrapper makes `changesets/action` report `published=false`, so `createGithubReleases` never fires — see the `🏷️ Tag + GitHub release` step). Confirm that step still runs on each release.

Don't reintroduce `NPM_TOKEN` **as a CI secret** unless OIDC is verified broken. The local `.env`-based `NPM_TOKEN` is a different concern — it's for laptop-driven publishes only, never CI.

**Manual changeset.** `pnpm changeset` (interactive) or hand-write `.changeset/<slug>.md`:

```markdown
---
"@acme-skunkworks/npm-package-template": <patch|minor|major>
---

<body>
```

### Manual publish (break-glass — CI-down only, after the package exists)

> **This is break-glass, not a routine path (ASW-331).** Reach for it only when CI/OIDC is genuinely down — every normal release goes through `release.yml` (OIDC, no standing token). The `.env` `NPM_TOKEN` is a long-lived credential, so treat it accordingly: store it in a secrets manager retrieved just-in-time (not a lingering plaintext `.env`), give it the shortest viable lifetime with a documented rotation cadence, and rotate immediately on any exposure. It never touches CI, and manual publishes ship without a provenance badge so they can't masquerade as verified CI ones.

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
- npm enforces 2FA at the publish endpoint for the first publish of a new package, irrespective of account/org/token bypass settings. Granular bypass-2FA tokens only honour the bypass on subsequent publishes.

So bootstrap is always: manual first publish → configure Trusted Publisher → CI takes over from publish #2.

**Pre-flight:**

- You belong to the target npm org with publish rights.
- npm CLI ≥ 11.5.1 (`npm install -g npm@latest`).
- Account has 2FA enabled with **recovery codes generated and saved** (you'll need one).
- `package.json` is at the version you want to ship (`pnpm changeset version` consumes pending changesets and bumps).

**Sequence:**

1. `pnpm changeset version` — consume pending changesets, bump `package.json`, write `CHANGELOG.md`.
2. `pnpm run release:manual:dry` — verify tarball + auth. **Note:** dry-run does NOT trigger 2FA enforcement, so a successful dry-run does not predict a successful real publish.
3. `pnpm run release:manual` — first real attempt. **This will fail with `EOTP`.** That's expected.
4. Use a **recovery code as the `--otp` value**:

   ```bash
   npm publish --access public --provenance=false --otp=<recovery-code>
   ```

   Generate codes at npmjs.com → Profile → Two-Factor Authentication → Manage Recovery Codes. Each is single-use. The format is a long hex string (not a 6-digit TOTP) — npm accepts it as `--otp` anyway.

5. After publish succeeds, **immediately regenerate recovery codes**. The one you used is burnt.
6. Configure Trusted Publisher: `https://www.npmjs.com/package/<name>/access` → GitHub Actions → org, repo, workflow filename (`release.yml`), environment blank.
7. From here on, releases go through CI cleanly.

### Things that look like solutions but aren't

Saving these to spare the next bootstrap from rediscovering them:

- `npm publish --auth-type=web` — flag is for `npm login`, ignored by `publish`.
- Toggling "Require 2FA for write actions" off in account settings.
- Disabling org-level 2FA enforcement.
- Generating a Granular token with bypass-2FA enabled — works for publish #2+, NOT publish #1.
- `npm login --auth-type=web` to refresh the session token. Auth swaps successfully but the publish endpoint still demands OTP.
- `oathtool` for generating TOTP — only works if you have a TOTP secret, and **npm has phased TOTP out of new accounts** (only passkeys + recovery codes are offered now).
- Disabling 2FA entirely — npm's policy _requires_ either 2FA or a bypass-2FA token; you can't disable both.

Recovery codes are the answer because they're the only OTP-shaped value an npm account can produce when its only 2FA factor is a passkey.
