import assert from "node:assert/strict";
import test from "node:test";
import {
  characterCountMessage,
  serverTextSize,
} from "../src/components/character-count-logic.js";

test("serverTextSize measures UTF-8 bytes and CRLF line breaks as the server will", () => {
  assert.deepEqual(
    [
      serverTextSize("abc", false),
      serverTextSize("é😀", false),
      serverTextSize("a\nb\r\nc", true),
      serverTextSize("a\nb", false),
    ],
    [3, 6, 7, 3],
  );
});

test("characterCountMessage covers static, remaining, singular and over", () => {
  assert.deepEqual(
    [
      characterCountMessage(120, null),
      characterCountMessage(120, 20),
      characterCountMessage(120, 119),
      characterCountMessage(120, 120),
      characterCountMessage(120, 121),
    ],
    [
      { text: "You can enter up to 120 characters", over: false },
      { text: "You have 100 characters remaining", over: false },
      { text: "You have 1 character remaining", over: false },
      { text: "You have 0 characters remaining", over: false },
      { text: "You have 1 character too many", over: true },
    ],
  );
});
