import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  createMigrationInventory,
  routePatternFromRelativeFile
} from "./tanstack_migration_inventory.mjs";

test("normalizes App Router groups and dynamic segments", () => {
  assert.equal(routePatternFromRelativeFile("page.tsx"), "/");
  assert.equal(
    routePatternFromRelativeFile("events/(browse)/page.tsx"),
    "/events"
  );
  assert.equal(
    routePatternFromRelativeFile("events/[slug]/edit/page.tsx"),
    "/events/:slug/edit"
  );
  assert.equal(
    routePatternFromRelativeFile("docs/[...parts]/page.tsx"),
    "/docs/*parts"
  );
  assert.equal(
    routePatternFromRelativeFile("docs/[[...parts]]/page.tsx"),
    "/docs/*parts?"
  );
});

test("builds a deterministic migration inventory", async () => {
  const fixtureRoot = await mkdtemp(
    path.join(tmpdir(), "tanstack-migration-inventory-")
  );

  try {
    await writeFixture(fixtureRoot, "apps/web/app/(browse)/page.tsx", [
      'import Link from "next/link";',
      "export default function Page() { return <Link href=\"/\" />; }"
    ]);
    await writeFixture(fixtureRoot, "apps/web/app/events/[slug]/page.tsx", [
      'import type { Metadata } from "next";',
      "export default function Page() { return null; }"
    ]);
    await writeFixture(fixtureRoot, "apps/web/app/api/health/route.ts", [
      "export async function GET() { return Response.json({ ok: true }); }",
      "export const POST = async () => new Response(null, { status: 204 });"
    ]);
    await writeFixture(fixtureRoot, "apps/web/app/actions.ts", [
      '"use server";',
      "export async function saveAction() {}",
      "export const removeAction = async () => {};"
    ]);
    await writeFixture(fixtureRoot, "apps/web/tests/example.test.ts", [
      'import test from "node:test";',
      'test("unit behavior", () => {});'
    ]);
    await writeFixture(fixtureRoot, "apps/web/tests/e2e/example.spec.ts", [
      'import { test } from "@playwright/test";',
      'test("browser behavior", async () => {});'
    ]);

    const first = createMigrationInventory(fixtureRoot);
    const second = createMigrationInventory(fixtureRoot);

    assert.deepEqual(first, second);
    assert.deepEqual(first.counts, {
      pages: 2,
      routeHandlers: 1,
      routeHandlerMethods: 2,
      serverActions: 2,
      nextImportFiles: 2,
      nodeTests: 1,
      playwrightTests: 1
    });
    assert.deepEqual(
      first.pages.map(({ urlPattern }) => urlPattern),
      ["/", "/events/:slug"]
    );
    assert.deepEqual(first.routeHandlers[0].methods, ["GET", "POST"]);
    assert.deepEqual(
      first.serverActions.map(({ name }) => name),
      ["saveAction", "removeAction"]
    );
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

async function writeFixture(root, relativeFile, lines) {
  const absoluteFile = path.join(root, relativeFile);
  await mkdir(path.dirname(absoluteFile), { recursive: true });
  await writeFile(absoluteFile, `${lines.join("\n")}\n`);
}
