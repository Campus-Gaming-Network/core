#!/usr/bin/env node

// Checks that relative links in the documentation resolve to a file in the
// repository and, when they name one, to a heading anchor in that file.
// External links are not fetched.

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const documentationRoot = path.join(repositoryRoot, "docs");

const markdownFiles = [
  ...readdirSync(documentationRoot)
    .filter((name) => name.endsWith(".md"))
    .map((name) => path.join(documentationRoot, name)),
  path.join(repositoryRoot, "README.md"),
  path.join(repositoryRoot, "AGENTS.md"),
];

const anchorsByFile = new Map();

// Anchors are explicit HTML ids plus GitHub's heading anchors: lowercase, drop
// punctuation other than hyphens and underscores, turn whitespace into
// hyphens, and suffix repeats with -1, -2, …
function anchorsFor(file) {
  if (anchorsByFile.has(file)) return anchorsByFile.get(file);
  const anchors = new Set();
  const seen = new Map();
  let inFence = false;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
    if (inFence) continue;
    for (const id of line.matchAll(/\b(?:id|name)="([^"]+)"/g)) {
      anchors.add(id[1]);
    }
    const heading = line.match(/^#{1,6}\s+(.+?)\s*#*\s*$/);
    if (!heading) continue;
    const base = heading[1]
      .replace(/<[^>]+>/g, "")
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s_-]/gu, "")
      .replace(/\s/g, "-");
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    anchors.add(count === 0 ? base : `${base}-${count}`);
  }
  anchorsByFile.set(file, anchors);
  return anchors;
}

const failures = [];
for (const file of markdownFiles) {
  let inFence = false;
  readFileSync(file, "utf8")
    .split("\n")
    .forEach((line, index) => {
      if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
      if (inFence) return;
      const withoutCode = line.replace(/`[^`]*`/g, "");
      for (const match of withoutCode.matchAll(
        /\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g,
      )) {
        const target = match[1].replace(/^<|>$/g, "");
        if (/^[a-z][a-z0-9+.-]*:/i.test(target)) continue;
        const [targetPath, anchor] = target.split("#", 2);
        const resolved = targetPath
          ? path.resolve(path.dirname(file), decodeURIComponent(targetPath))
          : file;
        const location = `${path.relative(repositoryRoot, file)}:${index + 1}`;
        if (!existsSync(resolved)) {
          failures.push(`${location}: ${target} does not exist`);
          continue;
        }
        if (
          anchor &&
          statSync(resolved).isFile() &&
          resolved.endsWith(".md") &&
          !anchorsFor(resolved).has(anchor)
        ) {
          failures.push(`${location}: ${target} has no heading #${anchor}`);
        }
      }
    });
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  console.error(`\n${failures.length} broken documentation link(s).`);
  process.exit(1);
}
console.log(`Checked links in ${markdownFiles.length} documentation files.`);
