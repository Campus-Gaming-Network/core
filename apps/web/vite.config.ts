import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import { redact } from "@tanstack/redact/vite";
import viteReact from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import { defineConfig, lazyPlugins } from "vite-plus";

export default defineConfig(({ command, mode }) => ({
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
    port: 3000,
  },
  resolve: {
    tsconfigPaths: true,
  },
  // Bundle server dependencies so Redact can redirect their React imports.
  // The dev module runner cannot evaluate the CommonJS that Sentry's Node SDK
  // loads, and the SDK does not import React. Production bundles it.
  ssr:
    mode === "test"
      ? undefined
      : {
          noExternal: true,
          external: command === "serve" ? ["@sentry/node"] : [],
        },
  // Unit tests exercise application handlers directly. Start's RPC transform
  // replaces them with transport stubs and also starts the Nitro dev runtime.
  // They render with React: Vitest skips Redact's per-environment aliases, so
  // dependencies would load a second React copy.
  plugins: lazyPlugins(() =>
    mode === "test"
      ? [viteReact()]
      : [
          tanstackStart({ srcDirectory: "src" }),
          viteReact(),
          redact(),
          nitro(),
        ],
  ),
}));
