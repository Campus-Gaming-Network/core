import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  characterCountMessage,
  serverTextSize,
} from "../src/components/character-count-logic.js";
import { FormField } from "../src/components/form-field.js";

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

test("a counted field states its limit without JavaScript and is described by it", () => {
  const render = (errors?: string[]) =>
    renderToStaticMarkup(
      createElement(FormField, {
        characterCount: true,
        children: createElement("textarea", { maxLength: 2000, name: "bio" }),
        errorId: "bio-error",
        errors,
        label: "Bio",
      }),
    );

  assert.deepEqual(
    [render(), render(["Bio must be 2000 characters or fewer."])].map(
      (markup) => markup.replace(/_R_[A-Za-z0-9]+_/g, "id"),
    ),
    [
      '<label><span id="id">Bio</span><textarea maxLength="2000" name="bio" aria-labelledby="id" aria-describedby="id-count"></textarea><span class="character-count"><span class="character-count__hint" id="id-count">You can enter up to 2000 characters</span><span aria-live="polite" class="visually-hidden"></span></span></label>',
      '<label><span id="id">Bio</span><textarea maxLength="2000" name="bio" aria-labelledby="id" aria-describedby="bio-error id-count" aria-invalid="true"></textarea><p class="form-error" id="bio-error">Bio must be 2000 characters or fewer.</p><span class="character-count"><span class="character-count__hint" id="id-count">You can enter up to 2000 characters</span><span aria-live="polite" class="visually-hidden"></span></span></label>',
    ],
  );
});
