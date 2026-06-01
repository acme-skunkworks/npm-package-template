# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repo

Template repository for Acme Skunkworks npm packages. It ships a minimal, buildable pnpm + TypeScript ESM skeleton plus the shared workflow/release shell, so a new package can be generated and released without rebuilding the infrastructure each time.

When generating a package from this template:

- Rename `name` in `package.json` (the placeholder is `@acme-skunkworks/npm-package-template`) and update `description`/`keywords`/`repository`/`homepage`/`bugs`.
- Replace everything under `src/` with the package's real public API — `src/index.ts` is the published entry point. The surrounding shell (build, lint, release) does not need to change.

## British English

Write all prose in British English — code comments, documentation, commit messages, PR titles/bodies, and any user-facing strings.

- **Spelling:** use British forms — _colour_, _behaviour_, _organisation_, _centre_, _catalogue_, _recognise_, _analyse_.
- **Grammar/punctuation:** follow British conventions where they differ — single quotes for quoting where appropriate, full stops outside the closing quotation mark when the quoted phrase is partial, _whilst_/_amongst_ acceptable.
- **Scope vs. identifiers:** this applies to prose only. Do **not** apply it to identifiers or APIs that mirror upstream names (e.g. `color` props in CSS, third-party API field names) — those stay spelled as the upstream defines them.

## Package manager and Node

pnpm, pinned via `packageManager` in `package.json`. Node 22 required (`.nvmrc`, `engines.node: ">=22"`, `engine-strict=true` in `.npmrc`).

## Commands

```bash
pnpm install        # install deps
pnpm run build      # tsc → dist/ (the published artifact; consumers import from dist)
pnpm tsc            # type-check only (no emit)
pnpm lint           # eslint over src/**/*.ts
pnpm lint:fix       # auto-fix
pnpm lint:md        # markdownlint (excludes the generated CHANGELOG.md)
pnpm format         # prettier write
pnpm clean          # remove node_modules + dist
```

## Source layout

TypeScript source lives under `src/`, compiled by `tsc` to `dist/` (declarations + source maps). Only `dist/` is published (`files: ["dist"]`); `exports`/`main`/`module`/`types` all point into it.

## Linting and formatting

This package dogfoods the org's own shared configs:

- **ESLint** — `eslint.config.mjs` consumes `@acme-skunkworks/eslint-config`, composing the `base` stack plus the `typescript` overrides. The preset also re-exports opt-in presets (`testing`, `frameworkRouting`, `astro`, `sanity`, `storybook`, `tableComponents`) — pull them in as a generated package needs them. The config is authored in `.mjs` (not `.ts`) because it is a trivial re-export and so needs no TypeScript-config loader.
- **Markdown** — `.markdownlint-cli2.jsonc` extends `@acme-skunkworks/markdownlint-config`. `lint:md` excludes `CHANGELOG.md`, which the changelog tooling generates with formatting markdownlint would otherwise fight.
- **Prettier** — `pnpm format` runs `prettier --write .`; `.prettierignore` excludes `node_modules`, `dist`, `tsconfig.json`, and `CHANGELOG.md`.

## Extended by ASW-232

This file documents the package foundation only. The workflow/release **shell** — `.github/` (CI + release + Claude workflows, `load-repo-config` composite action), `infrastructure/` (repo-config, digest-pinned CI bootstraps, changelog automation, tests), and `.changeset/` — is extracted from the sibling `@acme-skunkworks/eslint-config` repo in ASW-232. The corresponding CLAUDE.md sections (GitHub Actions repo config, local hooks, workflow/YAML validation, `act`, release workflow, bootstrap publish) land with that extraction.
