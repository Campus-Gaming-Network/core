const titleSeparator = " · ";

/**
 * Builds a document title that ends with the console name, most specific part
 * first, for example "Jane Doe · Users · CGN Admin". Parts are record names or
 * section names, never record IDs.
 */
export function adminTitle(...parts: string[]): string {
  return [...parts.filter((part) => part.trim() !== ""), "CGN Admin"].join(
    titleSeparator,
  );
}
