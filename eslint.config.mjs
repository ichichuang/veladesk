import coreWebVitals from "eslint-config-next/core-web-vitals";
import typescript from "eslint-config-next/typescript";

const eslintConfig = [
  {
    ignores: [
      "**/node_modules/**",
      "**/.next/**",
      "**/dist/**",
      "**/coverage/**",
      "**/.turbo/**",
      "**/next-env.d.ts",
      // Task debug archives: generated build/trace snapshots (e.g. the
      // task 018 Playwright report) are not source code. Scoped to the
      // archive root only — apps/ and packages/ stay fully linted.
      "artifacts/**",
    ],
  },
  ...coreWebVitals,
  ...typescript,
  {
    rules: {
      // App Router only — there is no pages/ directory for this rule to check.
      "@next/next/no-html-link-for-pages": "off",
    },
  },
];

export default eslintConfig;
