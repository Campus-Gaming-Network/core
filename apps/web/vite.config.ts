import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import { defineConfig, lazyPlugins } from "vite-plus";

export default defineConfig(({ mode }) => ({
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
  // Unit tests exercise application handlers directly. Start's RPC transform
  // replaces them with transport stubs and also starts the Nitro dev runtime.
  plugins: lazyPlugins(() =>
    mode === "test"
      ? [viteReact()]
      : [tanstackStart({ srcDirectory: "src" }), viteReact(), nitro()],
  ),
}));
