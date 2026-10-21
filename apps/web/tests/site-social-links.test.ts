import assert from "node:assert/strict";
import { test } from "vite-plus/test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SiteSocialLinks } from "../src/components/site-social-links.js";

test("each footer account link is named and shows its site's mark", () => {
  const markup = renderToStaticMarkup(createElement(SiteSocialLinks));
  const links = [
    ...markup.matchAll(
      /<a aria-label="([^"]*)" href="([^"]*)" rel="([^"]*)" target="([^"]*)"><svg aria-hidden="true" data-site="([^"]*)"/g,
    ),
  ].map(([, name, href, rel, target, site]) => ({
    name,
    href,
    rel,
    target,
    site,
  }));
  const external = { rel: "noopener noreferrer", target: "_blank" };

  assert.deepEqual(links, [
    {
      name: "Campus Gaming Network on Discord",
      href: "https://discord.gg/cG2uTEt3tc",
      ...external,
      site: "discord",
    },
    {
      name: "Campus Gaming Network on Instagram",
      href: "https://www.instagram.com/campusgamingnetwork/",
      ...external,
      site: "instagram",
    },
    {
      name: "Campus Gaming Network on X",
      href: "https://x.com/CampusGamingNet",
      ...external,
      site: "x",
    },
    {
      name: "Campus Gaming Network on Facebook",
      href: "https://www.facebook.com/campusgamingnetwork/",
      ...external,
      site: "facebook",
    },
    {
      name: "Campus Gaming Network on LinkedIn",
      href: "https://www.linkedin.com/company/campus-gaming-network/",
      ...external,
      site: "linkedin",
    },
    {
      name: "Campus Gaming Network on GitHub",
      href: "https://github.com/Campus-Gaming-Network",
      ...external,
      site: "github",
    },
  ]);
});

test("an empty account list renders no social section", () => {
  assert.equal(
    renderToStaticMarkup(createElement(SiteSocialLinks, { accounts: [] })),
    "",
  );
});
