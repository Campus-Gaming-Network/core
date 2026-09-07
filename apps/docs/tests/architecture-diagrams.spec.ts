import { expect, test } from "@playwright/test";

test("renders every architecture diagram as a distinct SVG", async ({ page }) => {
  await page.goto("/architecture-diagrams");

  const diagrams = page.locator(".mermaid-frame");
  await expect(diagrams).toHaveCount(3);

  for (const diagram of await diagrams.all()) {
    const svg = diagram.locator("svg");
    await expect(svg).toHaveCount(1);
    await expect(svg).toBeVisible();
    await expect(diagram.locator(".mermaid-error")).toHaveCount(0);
  }

  const ids = await diagrams.locator("svg").evaluateAll((elements) =>
    elements.map((element) => element.id)
  );
  expect(new Set(ids).size).toBe(3);

  const frontendDiagram = diagrams.first();
  const diagramWidth = await frontendDiagram
    .locator(".mermaid-chart")
    .evaluate((element) => element.getBoundingClientRect().width);

  await frontendDiagram.getByRole("button", { name: "Zoom in" }).click();
  await expect(
    frontendDiagram.getByRole("button", { name: "Reset zoom" })
  ).toHaveText("125%");
  await expect
    .poll(() =>
      frontendDiagram
        .locator(".mermaid-chart")
        .evaluate((element) => element.getBoundingClientRect().width)
    )
    .toBeGreaterThan(diagramWidth);

  await frontendDiagram
    .getByRole("button", { name: "Enter full screen" })
    .click();
  await expect
    .poll(() => page.evaluate(() => document.fullscreenElement !== null))
    .toBe(true);
  await expect(
    frontendDiagram.getByRole("button", { name: "Exit full screen" })
  ).toBeVisible();
});
