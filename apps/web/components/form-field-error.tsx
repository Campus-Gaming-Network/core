import { Icon, appIcon } from "./icon";
import { type FormState } from "../lib/form-state";

export function FieldError({
  name,
  state
}: {
  name: string;
  state: FormState;
}) {
  const messages = state.fieldErrors?.[name];

  if (!messages || messages.length === 0) {
    return null;
  }

  // The icon is decorative: aria-describedby already routes this text to the
  // field, and the red is reinforced by the glyph for anyone who cannot rely on
  // color alone.
  return (
    <p className="form-error icon-text icon-text--top" id={fieldErrorID(name)}>
      <Icon icon={appIcon.error} size="sm" />
      {messages.join(" ")}
    </p>
  );
}

export function fieldErrorProps(
  state: FormState,
  name: string,
  describedBy?: string
) {
  const invalid = (state.fieldErrors?.[name]?.length ?? 0) > 0;
  const ariaDescribedBy = [
    describedBy,
    invalid ? fieldErrorID(name) : undefined
  ]
    .filter(Boolean)
    .join(" ");

  return {
    "aria-describedby": ariaDescribedBy || undefined,
    "aria-invalid": invalid || undefined
  };
}

function fieldErrorID(name: string) {
  return `${name.replace(/[^A-Za-z0-9_-]/g, "-")}-error`;
}
