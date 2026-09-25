import { expect, test } from "@playwright/test";
import { gotoApp } from "./fixtures/app-navigation.js";

const browsePages = [
  {
    name: "events",
    filter: "/events?school=",
    unavailable: "Events are unavailable right now",
    empty: "No public events found",
  },
  {
    name: "teams",
    filter: "/teams?school=",
    unavailable: "Teams are unavailable right now",
    empty: "No teams found",
  },
  {
    name: "schools",
    filter: "/schools?q=",
    unavailable: "Schools are unavailable right now",
    empty: "No schools found",
  },
];

for (const browse of browsePages) {
  test(`${browse.name} browse tells an outage apart from an empty result`, async ({
    page,
  }) => {
    for (const trigger of ["unavailable-browse", "malformed-browse"]) {
      await gotoApp(page, browse.filter + trigger);
      const alert = page.getByRole("alert");
      await expect(
        alert.getByRole("heading", { name: browse.unavailable }),
      ).toBeVisible();
      await expect(
        alert.getByRole("link", { name: "Try again" }),
      ).toHaveAttribute("href", new RegExp(`${trigger}$`));
      await expect(
        page.getByRole("heading", { name: browse.empty }),
      ).toHaveCount(0);
    }

    await gotoApp(page, `${browse.filter}empty-browse`);
    await expect(
      page.getByRole("heading", { name: browse.empty }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: browse.unavailable }),
    ).toHaveCount(0);
  });
}
