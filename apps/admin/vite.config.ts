import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import tailwindcss from "@tailwindcss/vite";
import viteReact from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import { defineConfig, lazyPlugins } from "vite-plus";

export default defineConfig({
  lint: {
    categories: {
      correctness: "error",
      suspicious: "warn",
      perf: "warn",
    },
    ignorePatterns: [".output", "node_modules", "src/routeTree.gen.ts"],
    jsPlugins: [
      {
        name: "vite-plus",
        specifier: "vite-plus/oxlint-plugin",
      },
    ],
    rules: {
      "vite-plus/prefer-vite-plus-imports": "error",
    },
  },
  test: {
    // Unit tests only; the Playwright suites live under tests/e2e*.
    include: ["tests/*.test.ts"],
  },
  server: {
    host: "0.0.0.0",
    port: 3002,
    // The API and Admin BFF fetch the local development JWKS over Compose DNS.
    // Keep Vite's host check enabled and admit only that internal service name.
    allowedHosts: ["admin"],
  },
  resolve: {
    tsconfigPaths: true,
  },
  plugins: lazyPlugins(() => [
    tailwindcss(),
    tanstackStart({
      srcDirectory: "src",
    }),
    viteReact(),
    nitro({
      routeRules: {
        // Built assets are served by Nitro before the request middleware runs,
        // so they get the private-response headers here.
        "/assets/**": {
          headers: {
            "cache-control": "private, no-store",
            "x-robots-tag": "noindex, nofollow, noarchive, nosnippet",
            "x-content-type-options": "nosniff",
            "referrer-policy": "no-referrer",
          },
        },
      },
    }),
  ]),
});
