const localOrigin = "https://local-navigation.invalid";

export function safeLocalPath(value: string | undefined): string | null {
  const candidate = value?.trim() ?? "";
  if (
    !candidate.startsWith("/") ||
    candidate.startsWith("//") ||
    candidate.includes("\\") ||
    hasASCIIControlCharacter(candidate)
  ) {
    return null;
  }

  try {
    const resolved = new URL(candidate, localOrigin);
    if (resolved.origin !== localOrigin) {
      return null;
    }

    return `${resolved.pathname}${resolved.search}${resolved.hash}`;
  } catch {
    return null;
  }
}

function hasASCIIControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 0x1f || codePoint === 0x7f;
  });
}
