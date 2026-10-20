import { defineConfig } from "vite-plus";

export default defineConfig({
  lint: {
    jsPlugins: [{ name: "vite-plus", specifier: "vite-plus/oxlint-plugin" }],
    rules: { "vite-plus/prefer-vite-plus-imports": "error" },
    options: { typeAware: true, typeCheck: true },
    overrides: [
      {
        // node:test runs each top-level test() and awaits its promise itself.
        files: ["apps/*/tests/**"],
        rules: { "typescript/no-floating-promises": "off" },
      },
    ],
  },
  test: {
    projects: ["apps/web", "apps/admin"],
  },
  fmt: {
    ignorePatterns: [
      "**/node_modules/**",
      "**/.next/**",
      "**/.output/**",
      "**/.vite/**",
      "**/.cache/**",
      "**/.pnpm-store/**",
      "**/build/**",
      "**/coverage/**",
      "**/dist/**",
      "**/out/**",
      "**/playwright-report*/**",
      "**/test-results/**",
      "**/routeTree.gen.ts",
      "**/public/school-logos/**",
      "apps/api/internal/schools/bundled_logos.json",
      "apps/api/internal/emaillayout/testdata/**",
    ],
    printWidth: 80,
    sortPackageJson: false,
  },
});
