import { expect, test } from "@playwright/test";
import { gotoApp } from "./fixtures/app-navigation.js";

const apiURL = "http://127.0.0.1:18081";

test.beforeEach(async ({ request }) => {
  const response = await request.post(`${apiURL}/__test/reset`);
  expect(response.ok()).toBe(true);
});

// The event row is the same EventCard on the home page and in /events; the
// home page lists the seeded public event without creating one first.
test("event, team, and school rows share one layout that fits 320px", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 800 });
  const rows = [];
  for (const { path, name } of [
    { path: "/", name: /Public Browser Tournament/ },
    { path: "/teams", name: /Joinable Browser Team/ },
    { path: "/schools", name: /Browser Test University/ },
  ]) {
    await gotoApp(page, path);
    const row = page.getByRole("link", { name });
    await expect(row).toBeVisible();
    rows.push(
      await row.evaluate((link) => {
        const text = (selector: string) =>
          link.querySelector(selector)?.textContent ?? null;
        const copy = link.querySelector(".directory-row__copy");
        const action = link.querySelector(".directory-row__action");
        return {
          identity: link.querySelector(".directory-row__identity") !== null,
          name: text(".directory-row__name"),
          meta: text(".directory-row__meta"),
          tags: Array.from(
            link.querySelectorAll(".directory-row__tags .event-pill"),
            (tag) => tag.textContent,
          ),
          action: text(".directory-row__action"),
          actionBelowCopy:
            copy !== null &&
            action !== null &&
            action.getBoundingClientRect().top >=
              copy.getBoundingClientRect().bottom,
          rowFits: link.scrollWidth <= link.clientWidth,
          pageFits:
            document.documentElement.scrollWidth <=
            document.documentElement.clientWidth,
        };
      }),
    );
  }

  const layout = {
    identity: true,
    actionBelowCopy: true,
    rowFits: true,
    pageFits: true,
  };
  expect(rows).toEqual([
    {
      ...layout,
      name: "Public Browser Tournament",
      meta: "Browser Test University · Browser Student Union · 100 Public Campus Way",
      tags: ["In person", "Strategy Arena"],
      action: "View event",
    },
    {
      ...layout,
      name: "Joinable Browser Team",
      meta: "Browser Test University · Irvine, CA",
      tags: ["Strategy Arena"],
      action: "View team",
    },
    {
      ...layout,
      name: "Browser Test University",
      meta: "BTU · Irvine, CA",
      tags: [],
      action: "View school",
    },
  ]);
});
