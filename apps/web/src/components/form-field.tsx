import { cloneElement, type ReactElement } from "react";
import { FieldError, fieldErrorProps } from "./enhanced-mutation";

/**
 * A label wrapping one control and its validation text. The control is the
 * only child; it gains `aria-invalid` and `aria-describedby` when `errors` is
 * not empty. `errorId` is the id the error renders under, which the form's
 * error summary links back to.
 */
export function FormField({
  children,
  errorId,
  errors,
  label,
}: {
  children: ReactElement<{
    "aria-describedby"?: string;
    "aria-invalid"?: boolean;
  }>;
  errorId: string;
  errors?: string[];
  label: string;
}) {
  return (
    <label>
      {label}
      {cloneElement(children, fieldErrorProps(errors, errorId))}
      <FieldError id={errorId} messages={errors} />
    </label>
  );
}
