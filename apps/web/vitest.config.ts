import { defineProject } from "vitest/config";
import { fileURLToPath } from "node:url";

/**
 * Server + pure-helper Vitest project: Node runtime tests for the Next.js
 * server layer (config, runtime, HTTP handlers), for pure feature
 * helpers (workspace layout math) and for the designed-component token
 * contracts in components/ (source + CSS contract tests, no React mount).
 * React component tests are not part of this project.
 *
 * DOM-hosted component tests (021-R1 theme-boundary regression) opt in
 * per file with the `// @vitest-environment jsdom` pragma and use the same
 * `@components/*` alias the tsconfig gives the app.
 */
export default defineProject({
  // The app tsconfig uses Next's `jsx: preserve`; the transform must still
  // lower JSX for the DOM-hosted component tests.
  oxc: { jsx: { runtime: "automatic" } },
  // The app's PostCSS config (Tailwind) is Next-pipeline-only; tests never
  // need processed CSS — structure tests read the source files directly.
  css: { postcss: { plugins: [] } },
  resolve: {
    alias: {
      "@components": fileURLToPath(new URL("./components", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    setupFiles: ["./vitest.setup.ts"],
    include: [
      "server/**/*.test.ts",
      "lib/**/*.test.ts",
      "features/**/*.test.ts",
      "features/**/*.test.tsx",
      "components/**/*.test.ts",
      "components/**/*.test.tsx",
    ],
  },
});
