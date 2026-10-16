/** The parts of a form control this module reads and moves. */
type Control = {
  willValidate?: boolean;
  validity?: { valid: boolean };
  closest?: (
    selector: string,
  ) => { scrollIntoView: Element["scrollIntoView"] } | null;
  focus?: (options?: FocusOptions) => void;
  scrollIntoView?: Element["scrollIntoView"];
};

/**
 * For a form's `onInvalidCapture`. A blocked submit fires `invalid` on every
 * failing control; on the first one, scroll its field (the label around it)
 * to the middle of the screen and focus the control. Mobile browsers, iOS
 * Chrome among them, can focus the control without scrolling to it and show
 * no message, so the submit looked like it did nothing. Returns whether this
 * event was for the first failing control.
 */
export function revealFirstInvalidField(event: {
  currentTarget: { elements: ArrayLike<unknown> };
  target: unknown;
}): boolean {
  const first = Array.from(
    event.currentTarget.elements as ArrayLike<Control>,
  ).find(
    (control) => control.willValidate && control.validity?.valid === false,
  );
  if (!first || first !== event.target) return false;
  const field = first.closest?.("label, fieldset") ?? first;
  field.scrollIntoView?.({ block: "center" });
  first.focus?.({ preventScroll: true });
  return true;
}
