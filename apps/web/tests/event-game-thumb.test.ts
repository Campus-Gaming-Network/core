import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { EventGameThumb } from "../src/features/event-slice/event-game-thumb.js";

test("a row's game picture names the games unless the row already lists them", () => {
  const games = [
    { name: "Rocket League", slug: "rocket-league", has_cover: true },
    { name: "Chess", slug: "chess", has_cover: false },
  ];
  const render = (props: Parameters<typeof EventGameThumb>[0]) =>
    renderToStaticMarkup(createElement(EventGameThumb, props));

  assert.deepEqual(
    [
      render({ games }),
      render({ games, decorative: true }),
      render({ games: [{ name: "Chess", slug: "chess" }], decorative: true }),
    ].map((markup) => markup.replace(/<svg[\s\S]*<\/svg>/, "<svg/>")),
    [
      '<img alt="Rocket League, Chess" class="event-game-thumb" decoding="async" height="64" loading="lazy" src="/api/games/rocket-league/cover" width="48"/>',
      '<img alt="" class="event-game-thumb" decoding="async" height="64" loading="lazy" src="/api/games/rocket-league/cover" width="48"/>',
      '<span aria-hidden="true" class="event-game-thumb event-game-thumb--fallback"><svg/></span>',
    ],
  );
});
