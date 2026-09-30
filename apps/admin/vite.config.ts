import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import { defineConfig } from "vite";

export default defineConfig({
  server: {
    host: "0.0.0.0",
    port: 3002,
  },
  resolve: {
    tsconfigPaths: true,
  },
  plugins: [
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
  ],
});
