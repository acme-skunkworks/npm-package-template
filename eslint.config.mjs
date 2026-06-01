import { base, typescript } from "@acme-skunkworks/eslint-config";

/**
 * Self-lint config for the template, dogfooding the published Acme preset:
 * the `base` stack plus the TypeScript-file overrides.
 *
 * Generated packages extend this with the opt-in presets they need — e.g.
 * `testing`, `frameworkRouting`, `astro`, `sanity`, `storybook`,
 * `tableComponents` — all re-exported from `@acme-skunkworks/eslint-config`.
 */
export default [
  ...base,
  typescript,
  // infrastructure/ holds the workflow/release shell's CLI tooling (not
  // published code): it legitimately imports devDependencies (e.g.
  // gray-matter), and the changelog validator is an inherently branchy flat
  // list of schema checks, so the default complexity ceiling doesn't apply.
  // Scoped narrowly to this directory.
  {
    files: ["infrastructure/**/*.ts"],
    rules: {
      complexity: "off",
      "import/no-extraneous-dependencies": ["error", { devDependencies: true }],
    },
  },
  // The base preset enables type-aware linting (parserOptions.project: true),
  // which resolves each file to the nearest tsconfig.json. The published build
  // config (tsconfig.json) is deliberately src-only, so infra/ files aren't in
  // it. Pin an explicit project that spans src/ + infrastructure/ so type-aware
  // rules resolve every linted file without leaking infra into the dist build.
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      parserOptions: {
        project: ["./tsconfig.eslint.json"],
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
];
