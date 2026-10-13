import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// The stylesheet is built once for the browser bundle and once for the server
// bundle. If the two differ, their hashed names differ, and pages link to a
// stylesheet that was never published. Fail the build instead.
const output = new URL("../.output/", import.meta.url).pathname;
const missing = new Set<string>();
for (const entry of readdirSync(join(output, "server"), {
  recursive: true,
  withFileTypes: true,
})) {
  if (!entry.isFile() || !entry.name.endsWith(".mjs")) continue;
  const source = readFileSync(join(entry.parentPath, entry.name), "utf8");
  for (const [stylesheet] of source.matchAll(/assets\/[\w.-]+\.css/g)) {
    if (!existsSync(join(output, "public", stylesheet))) {
      missing.add(stylesheet);
    }
  }
}
if (missing.size > 0) {
  throw new Error(
    `[build] The server links to stylesheets that were not published: ${[...missing].join(", ")}`,
  );
}
