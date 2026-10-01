import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      "packages/*",
      "apps/web",
      {
        // Root tooling scripts (task 025: version management + release
        // tooling) and the web packaging scripts. Plain node environment,
        // .mjs modules — no jsdom, no React.
        test: {
          name: "veladesk-tooling",
          include: ["scripts/**/*.test.mjs", "apps/web/scripts/**/*.test.mjs"],
        },
      },
    ],
  },
});
