import assert from "node:assert/strict";
import { test } from "vite-plus/test";
import { revealFirstInvalidField } from "../src/components/reveal-invalid-field.js";

function control(name: string, valid: boolean, calls: string[]) {
  return {
    willValidate: true,
    validity: { valid },
    closest: () => ({
      scrollIntoView: (options?: boolean | ScrollIntoViewOptions) =>
        calls.push(`scroll ${name} label ${JSON.stringify(options)}`),
    }),
    focus: (options?: FocusOptions) =>
      calls.push(`focus ${name} ${JSON.stringify(options)}`),
  };
}

test("a blocked submit scrolls to and focuses only the first missing field", () => {
  const calls: string[] = [];
  const hidden = { willValidate: false, validity: { valid: false } };
  const title = control("title", true, calls);
  const type = control("type", false, calls);
  const audience = control("audience", false, calls);
  const form = { elements: [hidden, title, type, audience] };

  const revealed = [type, audience].map((target) =>
    revealFirstInvalidField({ currentTarget: form, target }),
  );

  assert.deepEqual(
    { revealed, calls },
    {
      revealed: [true, false],
      calls: [
        'scroll type label {"block":"center"}',
        'focus type {"preventScroll":true}',
      ],
    },
  );
});
