/** What the "/" shortcut needs to know about a keydown. */
export type SearchShortcutEvent = {
  key: string;
  modified: boolean;
  targetTag: string;
  targetType: string | undefined;
  editable: boolean;
};

const nonTextInputTypes = new Set([
  "button",
  "checkbox",
  "color",
  "file",
  "image",
  "radio",
  "range",
  "reset",
  "submit",
]);

/** True for a bare "/" while focus is not in something the user types into. */
export function shouldFocusSearchShortcut(event: SearchShortcutEvent): boolean {
  if (event.key !== "/" || event.modified || event.editable) return false;
  const tag = event.targetTag.toUpperCase();
  if (tag === "TEXTAREA" || tag === "SELECT") return false;
  if (tag === "INPUT") return nonTextInputTypes.has(event.targetType ?? "");
  return true;
}
