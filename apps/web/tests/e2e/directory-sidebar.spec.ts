import { expect, test, type Page } from "@playwright/test";
import { gotoApp, logIn } from "./fixtures/app-navigation.js";

const apiURL = "http://127.0.0.1:18081";
const directories = ["/events", "/teams", "/schools"];

test.beforeEach(async ({ request }) => {
  const response = await request.post(`${apiURL}/__test/reset`);
  expect(response.ok()).toBe(true);
});

// The sidebar takes a column from the tablet width up, so these tests set a
// desktop viewport in both browser projects.
async function readSidebar(page: Page) {
  const sidebar = page.getByRole("complementary", { name: "Directory" });
  await expect(sidebar).toBeVisible();
  return sidebar.evaluate((aside) => {
    // An element's text without its decorative marks, one space between parts.
    const name = (element: Element) => {
      const walker = aside.ownerDocument.createTreeWalker(
        element,
        NodeFilter.SHOW_TEXT,
      );
      const parts = [];
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (!node.parentElement?.closest('[aria-hidden="true"]')) {
          parts.push(node.textContent);
        }
      }
      return parts.join(" ").replaceAll(/\s+/g, " ").trim();
    };
    return {
      sections: Array.from(
        aside.querySelectorAll('nav[aria-label="Directories"] a'),
        (link) => ({
          name: name(link),
          current: link.getAttribute("aria-current"),
        }),
      ),
      headings: Array.from(aside.querySelectorAll("h2"), name),
      links: Array.from(
        aside.querySelectorAll(":scope > :not(nav) a"),
        (link) => ({
          name: name(link),
          href: link.getAttribute("href"),
        }),
      ),
    };
  });
}

const sections = (current: string) =>
  ["Events", "Teams", "Schools"].map((name) => ({
    name,
    current: name === current ? "page" : null,
  }));

test("a visitor's directory sidebar has the section links and a log-in link", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const sidebars = [];
  for (const path of directories) {
    await gotoApp(page, path);
    sidebars.push(await readSidebar(page));
  }

  expect(sidebars).toEqual(
    [
      ["Events", "/events"],
      ["Teams", "/teams"],
      ["Schools", "/schools"],
    ].map(([current, path]) => ({
      sections: sections(current),
      headings: [],
      links: [
        {
          name: "Log in to see your school",
          href: `/login?next=${encodeURIComponent(path)}`,
        },
      ],
    })),
  );
});

test("a viewer's directory sidebar shows their school and the first five schools they follow", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await logIn(page, "sidebar-many-follows@example.test", "/events");
  const sidebars = [];
  for (const path of directories) {
    await gotoApp(page, path);
    sidebars.push(await readSidebar(page));
  }

  const schoolLinks = [
    {
      name: "Browser Test University Irvine, CA",
      href: "/schools/browser-test-university",
    },
    ...[1, 2, 3, 4, 5].map((number) => ({
      name: `Sidebar Follow College ${number}`,
      href: `/schools/sidebar-follow-college-${number}`,
    })),
    { name: "See all followed schools", href: "/account#followed-schools" },
  ];
  expect(sidebars).toEqual(
    ["Events", "Teams", "Schools"].map((current) => ({
      sections: sections(current),
      headings: ["Your school", "Schools you follow"],
      links: schoolLinks,
    })),
  );
});

test("a viewer who follows no schools is told how to follow one", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await logIn(page, "sidebar-no-follows@example.test", "/schools");

  const sidebar = page.getByRole("complementary", { name: "Directory" });
  await expect(
    sidebar.getByRole("region", { name: "Schools you follow" }).locator("p"),
  ).toHaveText("Follow a school from its page to see it here.");
});

test("the directories still render when the viewer's school data fails", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await logIn(page, "sidebar-unavailable@example.test", "/events");
  const pages = [];
  for (const [path, heading] of [
    ["/events", "Browse campus gaming events"],
    ["/teams", "Find campus gaming teams"],
    ["/schools", "Browse schools"],
  ]) {
    await gotoApp(page, path);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(heading);
    pages.push(await readSidebar(page));
  }

  expect(pages).toEqual(
    ["Events", "Teams", "Schools"].map((current) => ({
      sections: sections(current),
      headings: [],
      links: [],
    })),
  );
});

test("below the tablet width the sidebar takes no column and nothing scrolls sideways at 320px", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await logIn(page, "sidebar-many-follows@example.test", "/events");
  const layouts = [];
  for (const path of directories) {
    await gotoApp(page, path);
    layouts.push(
      await page.evaluate(() => ({
        sidebarShown:
          document.querySelector(".directory-sidebar")?.getBoundingClientRect()
            .width !== 0,
        headingLeft: Math.round(
          document.querySelector("main h1")?.getBoundingClientRect().left ?? -1,
        ),
        pageFits:
          document.documentElement.scrollWidth <=
          document.documentElement.clientWidth,
      })),
    );
  }

  expect(layouts).toEqual(
    directories.map(() => ({
      sidebarShown: false,
      headingLeft: 16,
      pageFits: true,
    })),
  );
});
