import assert from "node:assert/strict";
import test from "node:test";
import { socialSite } from "../src/features/public-profile/social-sites.js";

test("profile links are matched to known sites by host", () => {
  assert.deepEqual(
    [
      "https://www.youtube.com/@player",
      "https://youtu.be/abc",
      "https://x.com/player",
      "https://twitter.com/player",
      "https://m.twitch.tv/player",
      "https://discord.gg/invite",
      "https://steamcommunity.com/id/player",
      "https://player.example.test/blog",
      // A known name inside another host or in the path is not that site.
      "https://notyoutube.com/player",
      "https://example.test/youtube.com",
      "not a url",
    ].map(socialSite),
    [
      "youtube",
      "youtube",
      "x",
      "x",
      "twitch",
      "discord",
      "steam",
      undefined,
      undefined,
      undefined,
      undefined,
    ],
  );
});
