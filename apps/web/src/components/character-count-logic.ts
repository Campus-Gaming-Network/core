/**
 * The pure rules behind CharacterCount. The API measures text in UTF-8 bytes
 * (Go `len`) and a browser submits textarea line breaks as CRLF, so the count
 * follows both; counting UTF-16 units like `maxLength` would read under the
 * limit for text the server then rejects.
 */

const encoder = new TextEncoder();

/** The size of `value` as the server will measure it. */
export function serverTextSize(value: string, multiline: boolean): number {
  const submitted = multiline ? value.replace(/\r?\n/g, "\r\n") : value;
  return encoder.encode(submitted).length;
}

export type CharacterCountMessage = {
  text: string;
  over: boolean;
};

function plural(count: number): string {
  return count === 1 ? "1 character" : `${count} characters`;
}

/** The hint for a field holding `size` of at most `limit`; `null` size is the no-JavaScript wording. */
export function characterCountMessage(
  limit: number,
  size: number | null,
): CharacterCountMessage {
  if (size === null) {
    return { text: `You can enter up to ${plural(limit)}`, over: false };
  }
  const remaining = limit - size;
  if (remaining < 0) {
    return { text: `You have ${plural(-remaining)} too many`, over: true };
  }
  return { text: `You have ${plural(remaining)} remaining`, over: false };
}
