/** A form's submitted values as sorted [name, value] pairs, so two snapshots compare by content. */
export type FormSnapshot = Array<[string, string]>;

/**
 * Reads the values a form would submit. Files compare by name, size and
 * modified time, since their contents are not worth reading to detect a change.
 */
export function snapshotForm(form: HTMLFormElement): FormSnapshot {
  const entries: FormSnapshot = [];
  for (const [name, value] of new FormData(form)) {
    // Not something the person typed; it is regenerated or advanced by the server after each submit.
    if (name === "idempotency_key" || name === "expected_updated_at") continue;
    entries.push([
      name,
      typeof value === "string"
        ? value
        : `${value.name}:${value.size}:${value.lastModified}`,
    ]);
  }
  return sortSnapshot(entries);
}

/** Orders entries by name, then value, without disturbing the input. */
export function sortSnapshot(entries: FormSnapshot): FormSnapshot {
  return [...entries].sort(
    ([nameA, valueA], [nameB, valueB]) =>
      compare(nameA, nameB) || compare(valueA, valueB),
  );
}

/** True when two snapshots differ in any name or value. */
export function isDirty(initial: FormSnapshot, current: FormSnapshot): boolean {
  if (initial.length !== current.length) return true;
  return initial.some(
    ([name, value], index) =>
      name !== current[index]?.[0] || value !== current[index]?.[1],
  );
}

/**
 * Whether an in-app navigation should ask first: only when the form has
 * unsaved changes, no submit is in flight, and the page itself changes.
 * Search-only changes stay on the same page and keep the typed values.
 */
export function shouldConfirmLeave({
  dirty,
  submitting,
  currentPathname,
  nextPathname,
}: {
  dirty: boolean;
  submitting: boolean;
  currentPathname: string;
  nextPathname: string;
}): boolean {
  return dirty && !submitting && currentPathname !== nextPathname;
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
