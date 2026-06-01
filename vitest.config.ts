import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["infrastructure/tests/**/*.test.ts"],
  },
});
