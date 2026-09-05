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

  return (
    <p className="form-error" id={fieldErrorID(name)}>
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
