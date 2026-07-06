import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // .test.ts covers the infra TypeScript tooling; .test.mjs covers the
    // zero-dependency .mjs agent-skill scripts (e.g. initialise-package-repo),
    // whose tests are authored in plain ESM to match their source and to avoid
    // pulling untyped .mjs imports into the `pnpm tsc` type-check.
    include: ["infrastructure/tests/**/*.test.{ts,mjs}"],
  },
});
