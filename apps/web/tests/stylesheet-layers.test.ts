import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { basename, join, relative } from "node:path";
import { test } from "vite-plus/test";

const currentDirectory = process.cwd();
const appRoot =
  basename(currentDirectory) === "web"
    ? currentDirectory
    : join(currentDirectory, "apps/web");
const sourceRoot = join(appRoot, "src");

function stylesheets(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return stylesheets(path);
    return entry.name.endsWith(".css") ? [path] : [];
  });
}

// The top-level statements of a stylesheet: each block's prelude, or a
// statement ending in a semicolon, with comments removed.
function topLevelStatements(css: string): string[] {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const statements: string[] = [];
  let depth = 0;
  let current = "";
  for (const char of text) {
    if (depth === 0 && (char === "{" || char === ";")) {
      statements.push(current.trim() + (char === ";" ? ";" : ""));
      current = "";
    }
    if (char === "{") depth++;
    else if (char === "}") depth--;
    else if (depth === 0 && char !== ";") current += char;
  }
  return statements;
}

test("every web stylesheet puts its rules in a declared cascade layer", () => {
  // A rule outside every layer outranks all layered rules, so one stray
  // block would silently override the components, features, and overrides
  // layers. styles.css loads first and declares their order.
  const declaration = topLevelStatements(
    readFileSync(join(sourceRoot, "styles.css"), "utf8"),
  )[0];
  const declared = /^@layer ([\w\s,-]+);$/
    .exec(declaration ?? "")?.[1]
    ?.split(",")
    .map((name) => name.trim());
  assert.ok(declared, "styles.css must open with its @layer order statement");

  const outsideLayers: Record<string, string[]> = {};
  for (const path of stylesheets(sourceRoot)) {
    const strays = topLevelStatements(readFileSync(path, "utf8")).filter(
      (statement) => {
        const layer = /^@layer ([\w-]+)$/.exec(statement)?.[1];
        if (layer) return !declared.includes(layer);
        return statement !== declaration;
      },
    );
    if (strays.length > 0) outsideLayers[relative(appRoot, path)] = strays;
  }
  assert.deepEqual(outsideLayers, {});
});
