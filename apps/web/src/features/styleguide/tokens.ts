export type DesignToken = { name: string; value: string };

/**
 * The custom properties a stylesheet declares in its first `:root` block, in
 * source order. A value that points at another token (`var(--color-primary)`)
 * is shown as the value it resolves to, which is what the browser applies.
 */
export function designTokens(css: string): DesignToken[] {
  const block = /:root\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
  const declared = [
    ...block
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g),
  ].map((match) => ({
    name: match[1] ?? "",
    value: (match[2] ?? "").trim().replace(/\s+/g, " "),
  }));
  const values = new Map(declared.map((token) => [token.name, token.value]));

  return declared.map((token) => ({
    name: token.name,
    value: token.value.replace(
      /var\((--[\w-]+)\)/g,
      (reference, name: string) => values.get(name) ?? reference,
    ),
  }));
}
