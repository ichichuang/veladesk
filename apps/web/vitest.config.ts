import { defineProject } from "vitest/config";

/**
 * Server + pure-helper Vitest project: Node runtime tests for the Next.js
 * server layer (config, runtime, HTTP handlers) and for pure feature
 * helpers (workspace layout math). React component tests are not part of
 * this project.
 */
export default defineProject({
  test: {
    environment: "node",
    include: ["server/**/*.test.ts", "features/**/*.test.ts"],
  },
});
