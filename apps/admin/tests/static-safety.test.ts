import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { test } from "vite-plus/test";

const currentDirectory = process.cwd();
const appRoot =
  basename(currentDirectory) === "admin"
    ? currentDirectory
    : join(currentDirectory, "apps/admin");

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(entry.name) && entry.name !== "routeTree.gen.ts"
      ? [path]
      : [];
  });
}

const sources = sourceFiles(join(appRoot, "src")).map((path) => ({
  path: path.slice(appRoot.length + 1),
  text: readFileSync(path, "utf8"),
}));

// XSS-02: the console renders stored content as text. Any of these would let
// it be interpreted instead. There is no approved exception; adding one means
// adding its sanitization tests and naming it here.
test("the console has no HTML escape hatch", () => {
  const escapeHatches: [string, RegExp][] = [
    ["dangerouslySetInnerHTML", /dangerouslySetInnerHTML/],
    ["innerHTML or outerHTML", /\b(?:inner|outer)HTML\b/],
    ["insertAdjacentHTML", /insertAdjacentHTML/],
    ["document.write", /document\.write/],
    ["eval", /\beval\s*\(/],
    ["the Function constructor", /new\s+Function\s*\(/],
    ["a string timer", /set(?:Timeout|Interval)\s*\(\s*["'`]/],
    ["a script element", /<script[\s>]/i],
    ["a javascript: URL", /javascript:/i],
    ["a data: URL assignment", /(?:href|src|action)\s*=\s*\{?["'`]data:/i],
  ];

  const found = sources.flatMap(({ path, text }) =>
    escapeHatches
      .filter(([, pattern]) => pattern.test(text))
      .map(([name]) => `${path}: ${name}`),
  );

  assert.deepEqual(found, []);
});

// LOG-05: the console talks to one third party, its error-monitoring project,
// through the SDK in its own bundle. The error-monitor tests cover what an
// event may carry. Any other tracking package, or a host named in the source,
// fails here.
test("the console loads no third-party analytics and one error monitor", () => {
  const manifest = JSON.parse(
    readFileSync(join(appRoot, "package.json"), "utf8"),
  ) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  const dependencies = Object.keys({
    ...manifest.dependencies,
    ...manifest.devDependencies,
  });
  const tracking =
    /sentry|datadog|posthog|segment|mixpanel|amplitude|heap|hotjar|fullstory|logrocket|bugsnag|rollbar|newrelic|google-analytics|gtag|plausible|clarity|intercom|@vercel\/analytics/i;

  assert.deepEqual(
    dependencies.filter((name) => tracking.test(name)),
    ["@sentry/browser", "@sentry/node"],
  );

  const externalHosts = sources.flatMap(({ path, text }) =>
    [
      ...text.matchAll(
        /https?:\/\/(?!localhost|127\.0\.0\.1|example\.|admin\.example|cgn\.)[a-z0-9.-]+/gi,
      ),
    ].map((match) => `${path}: ${match[0]}`),
  );
  // Only documentation links and schema constants may name another host.
  assert.deepEqual(
    externalHosts.filter((entry) => !/www\.w3\.org/.test(entry)),
    [],
  );
});

// The console never displays a record ID. A value is shown only through a
// name and a link, with "Copy <entity> ID" for the rare need. This catches a
// component that renders an ID field as text, or prefills a visible input
// with one; hidden inputs, props, and keys are fine.
test("the console renders no record ID as text", () => {
  const idExpression = String.raw`[\w.?]*(?:\.id|_id|Id|ID|uuid)\b`;
  const rendersID = new RegExp(
    String.raw`>\s*\{${idExpression}\}|\$\{${idExpression}\}[^\`]*<|defaultValue=\{${idExpression}\}`,
  );

  const found = sources
    .filter(({ path }) => path.endsWith(".tsx"))
    .filter(({ text }) => rendersID.test(text))
    .map(({ path }) => path);

  assert.deepEqual(found, []);
});
