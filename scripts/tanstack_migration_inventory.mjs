#!/usr/bin/env node

import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const sourceExtensions = new Set([
  ".cjs",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".mts",
  ".ts",
  ".tsx"
]);
const ignoredDirectories = new Set([
  ".next",
  ".output",
  ".test-build",
  "dist",
  "node_modules",
  "playwright-report",
  "test-results"
]);
const httpMethods = [
  "GET",
  "HEAD",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "OPTIONS"
];

export function routePatternFromRelativeFile(relativeFile) {
  const directory = path.posix.dirname(relativeFile.replaceAll("\\", "/"));
  const segments = directory === "." ? [] : directory.split("/");
  const routeSegments = segments
    .filter(
      (segment) =>
        !(segment.startsWith("(") && segment.endsWith(")")) &&
        !segment.startsWith("@")
    )
    .map(normalizeRouteSegment);

  return routeSegments.length === 0 ? "/" : `/${routeSegments.join("/")}`;
}

export function createMigrationInventory(repositoryRoot) {
  const absoluteRepositoryRoot = path.resolve(repositoryRoot);
  const webRoot = path.join(absoluteRepositoryRoot, "apps", "web");
  const appRoot = path.join(webRoot, "app");
  const sourceFiles = walkSourceFiles(webRoot);
  const pages = [];
  const routeHandlers = [];
  const serverActions = [];
  const nextImports = [];
  const nodeTests = [];
  const playwrightTests = [];

  for (const absoluteFile of sourceFiles) {
    const source = readFileSync(absoluteFile, "utf8");
    const file = relativePath(absoluteRepositoryRoot, absoluteFile);
    const relativeAppFile = relativePath(appRoot, absoluteFile);
    const basename = path.basename(absoluteFile);

    if (isWithin(appRoot, absoluteFile) && /^page\.(?:js|jsx|ts|tsx)$/.test(basename)) {
      pages.push({
        file,
        urlPattern: routePatternFromRelativeFile(relativeAppFile)
      });
    }

    if (isWithin(appRoot, absoluteFile) && /^route\.(?:js|ts)$/.test(basename)) {
      routeHandlers.push({
        file,
        methods: exportedHttpMethods(source),
        urlPattern: routePatternFromRelativeFile(relativeAppFile)
      });
    }

    if (hasUseServerDirective(source)) {
      for (const declaration of exportedDeclarations(source)) {
        serverActions.push({ file, ...declaration });
      }
    }

    const modules = importedNextModules(source);
    if (modules.length > 0) {
      nextImports.push({ file, modules });
    }

    if (importsModule(source, "node:test")) {
      for (const declaration of testDeclarations(source)) {
        nodeTests.push({ file, ...declaration });
      }
    }

    if (importsModule(source, "@playwright/test")) {
      for (const declaration of testDeclarations(source)) {
        playwrightTests.push({ file, ...declaration });
      }
    }
  }

  pages.sort(compareByUrlAndFile);
  routeHandlers.sort(compareByUrlAndFile);
  serverActions.sort(compareByFileLineAndName);
  nextImports.sort((left, right) => compareText(left.file, right.file));
  nodeTests.sort(compareByFileLineAndName);
  playwrightTests.sort(compareByFileLineAndName);

  return {
    schemaVersion: 1,
    root: "apps/web",
    routePatternSyntax: {
      dynamic: ":name",
      catchAll: "*name",
      optionalCatchAll: "*name?"
    },
    counts: {
      pages: pages.length,
      routeHandlers: routeHandlers.length,
      routeHandlerMethods: routeHandlers.reduce(
        (count, handler) => count + handler.methods.length,
        0
      ),
      serverActions: serverActions.length,
      nextImportFiles: nextImports.length,
      nodeTests: nodeTests.length,
      playwrightTests: playwrightTests.length
    },
    pages,
    routeHandlers,
    serverActions,
    nextImports,
    tests: {
      node: nodeTests,
      playwright: playwrightTests
    }
  };
}

function walkSourceFiles(root) {
  const files = [];

  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const absoluteEntry = path.join(root, entry.name);

    if (entry.isDirectory()) {
      if (!ignoredDirectories.has(entry.name)) {
        files.push(...walkSourceFiles(absoluteEntry));
      }
    } else if (entry.isFile() && sourceExtensions.has(path.extname(entry.name))) {
      files.push(absoluteEntry);
    }
  }

  return files.sort(compareText);
}

function normalizeRouteSegment(segment) {
  const optionalCatchAll = segment.match(/^\[\[\.\.\.(.+)\]\]$/);
  if (optionalCatchAll) {
    return `*${optionalCatchAll[1]}?`;
  }

  const catchAll = segment.match(/^\[\.\.\.(.+)\]$/);
  if (catchAll) {
    return `*${catchAll[1]}`;
  }

  const dynamic = segment.match(/^\[(.+)\]$/);
  return dynamic ? `:${dynamic[1]}` : segment;
}

function exportedHttpMethods(source) {
  return httpMethods.filter((method) => {
    const functionPattern = new RegExp(
      `\\bexport\\s+(?:async\\s+)?function\\s+${method}\\b`
    );
    const variablePattern = new RegExp(
      `\\bexport\\s+(?:const|let|var)\\s+${method}\\b`
    );
    const exportListPattern = new RegExp(
      `\\bexport\\s*\\{[^}]*\\b(?:${method}|\\w+\\s+as\\s+${method})\\b[^}]*\\}`,
      "s"
    );

    return (
      functionPattern.test(source) ||
      variablePattern.test(source) ||
      exportListPattern.test(source)
    );
  });
}

function hasUseServerDirective(source) {
  return /(?:^|\n)\s*["']use server["']\s*;/.test(source);
}

function exportedDeclarations(source) {
  const declarations = [];
  const patterns = [
    /\bexport\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g,
    /\bexport\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g
  ];

  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      declarations.push({
        line: lineNumberAt(source, match.index),
        name: match[1]
      });
    }
  }

  return declarations.sort(
    (left, right) => left.line - right.line || compareText(left.name, right.name)
  );
}

function importedNextModules(source) {
  const modules = new Set();
  const patterns = [
    /\b(?:import|export)\s+(?:type\s+)?(?:[^;]*?\s+from\s+)?["'](next(?:\/[^"']*)?)["']/gs,
    /\bimport\s*\(\s*["'](next(?:\/[^"']*)?)["']\s*\)/g,
    /\brequire\s*\(\s*["'](next(?:\/[^"']*)?)["']\s*\)/g
  ];

  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      modules.add(match[1]);
    }
  }

  return [...modules].sort(compareText);
}

function importsModule(source, moduleName) {
  const escapedModule = moduleName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const staticImport = new RegExp(
    `\\b(?:import|export)\\s+(?:type\\s+)?(?:[^;]*?\\s+from\\s+)?["']${escapedModule}["']`,
    "s"
  );
  const requireImport = new RegExp(
    `\\brequire\\s*\\(\\s*["']${escapedModule}["']\\s*\\)`
  );

  return staticImport.test(source) || requireImport.test(source);
}

function testDeclarations(source) {
  const declarations = [];
  const pattern =
    /\b(?:test|it)\s*\(\s*(?:"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)'|`((?:\\.|[^`\\])*)`)/g;

  for (const match of source.matchAll(pattern)) {
    declarations.push({
      line: lineNumberAt(source, match.index),
      name: decodeSimpleEscapes(match[1] ?? match[2] ?? match[3] ?? "")
    });
  }

  return declarations;
}

function decodeSimpleEscapes(value) {
  return value
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\r")
    .replace(/\\t/g, "\t")
    .replace(/\\(["'`\\])/g, "$1");
}

function lineNumberAt(source, index = 0) {
  return source.slice(0, index).split("\n").length;
}

function isWithin(root, file) {
  const relative = path.relative(root, file);
  return relative !== "" && !relative.startsWith(`..${path.sep}`) && relative !== "..";
}

function relativePath(root, file) {
  return path.relative(root, file).split(path.sep).join("/");
}

function compareByUrlAndFile(left, right) {
  return (
    compareText(left.urlPattern, right.urlPattern) ||
    compareText(left.file, right.file)
  );
}

function compareByFileLineAndName(left, right) {
  return (
    compareText(left.file, right.file) ||
    left.line - right.line ||
    compareText(left.name, right.name)
  );
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

const scriptPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (scriptPath === fileURLToPath(import.meta.url)) {
  const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  process.stdout.write(`${JSON.stringify(createMigrationInventory(repositoryRoot), null, 2)}\n`);
}
