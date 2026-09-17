import { defineProject } from "vitest/config";

/**
 * Server-only Vitest project: Node runtime tests for the Next.js server
 * layer (config, runtime, HTTP handlers). React component tests are not
 * part of this project.
 */
export default defineProject({
  test: {
    environment: "node",
    include: ["server/**/*.test.ts"],
  },
});
