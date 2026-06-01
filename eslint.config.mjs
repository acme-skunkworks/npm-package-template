import { base, typescript } from "@acme-skunkworks/eslint-config";

/**
 * Self-lint config for the template, dogfooding the published Acme preset:
 * the `base` stack plus the TypeScript-file overrides.
 *
 * Generated packages extend this with the opt-in presets they need — e.g.
 * `testing`, `frameworkRouting`, `astro`, `sanity`, `storybook`,
 * `tableComponents` — all re-exported from `@acme-skunkworks/eslint-config`.
 */
export default [...base, typescript];
