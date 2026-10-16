export type ListboxKey = "ArrowDown" | "ArrowUp" | "Home" | "End";

/**
 * The option a combobox highlights after an arrow, Home, or End key. `-1`
 * means no option is highlighted. Arrow keys wrap, and ArrowUp from nothing
 * goes to the last option, as in a native listbox.
 */
export function nextActiveIndex(
  current: number,
  count: number,
  key: ListboxKey,
): number {
  if (count <= 0) return -1;
  switch (key) {
    case "Home":
      return 0;
    case "End":
      return count - 1;
    case "ArrowDown":
      return current < 0 || current >= count - 1 ? 0 : current + 1;
    case "ArrowUp":
      return current <= 0 ? count - 1 : current - 1;
  }
}

export function isListboxKey(key: string): key is ListboxKey {
  return (
    key === "ArrowDown" || key === "ArrowUp" || key === "Home" || key === "End"
  );
}
