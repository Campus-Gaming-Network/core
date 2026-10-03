import { expect, test } from "@playwright/test";
import { logIn } from "./fixtures/app-navigation.js";

test("the dashboard previews three events per list and links to the rest", async ({
  page,
}) => {
  await logIn(page, "dashboard-overflow@example.test", "/account");

  const lists = await page.locator(".account-events").evaluateAll((sections) =>
    sections.map((section) => {
      const seeAll = section.querySelector(".account-more a");
      return {
        heading: section.querySelector("h2")?.textContent,
        titles: Array.from(
          section.querySelectorAll(".event-card-heading"),
          (title) => title.textContent,
        ),
        count: section.querySelector(".account-more span")?.textContent,
        seeAll: {
          text: seeAll?.textContent,
          href: seeAll?.getAttribute("href"),
        },
      };
    }),
  );

  expect(lists).toEqual([
    {
      heading: "Upcoming RSVPs",
      titles: [
        "Browser Dashboard RSVP 1",
        "Browser Dashboard RSVP 2",
        "Browser Dashboard RSVP 3",
      ],
      count: "Showing 3 of 5+",
      seeAll: { text: "See all events", href: "/events" },
    },
    {
      heading: "Followed-school events",
      titles: [
        "Browser Followed Event 1",
        "Browser Followed Event 2",
        "Browser Followed Event 3",
      ],
      count: "Showing 3 of 5+",
      seeAll: { text: "See all events", href: "/events" },
    },
  ]);
});

test("every section link on the dashboard points at a section on the page", async ({
  page,
}) => {
  await logIn(page, "player@example.test", "/account");

  const links = await page
    .getByRole("navigation", { name: "Account sections" })
    .getByRole("link")
    .evaluateAll((anchors) =>
      anchors.map((anchor) => ({
        label: anchor.textContent,
        target: document.getElementById(
          (anchor as HTMLAnchorElement).hash.slice(1),
        )?.tagName,
      })),
    );

  expect(links).toEqual([
    { label: "Events", target: "SECTION" },
    { label: "Following", target: "SECTION" },
    { label: "Teams", target: "SECTION" },
    { label: "Profile", target: "SECTION" },
    { label: "Delete", target: "SECTION" },
  ]);
});
