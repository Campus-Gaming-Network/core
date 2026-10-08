import { cloneElement, type ReactElement } from "react";
import { FieldError, fieldErrorProps } from "./enhanced-mutation";

/**
 * A label wrapping one control and its validation text. The control is the
 * only child; it gains `aria-invalid` and `aria-describedby` when `errors` is
 * not empty. `errorId` is the id the error renders under, which the form's
 * error summary links back to. `optional` adds "(optional)" to the label;
 * a form with optional fields also shows RequiredFieldsNote.
 */
export function FormField({
  children,
  errorId,
  errors,
  label,
  optional = false,
}: {
  children: ReactElement<{
    "aria-describedby"?: string;
    "aria-invalid"?: boolean;
  }>;
  errorId: string;
  errors?: string[];
  label: string;
  optional?: boolean;
}) {
  return (
    <label>
      {/* Labels are grids, so the marker shares a cell with the label text. */}
      {optional ? (
        <span>
          {label} <span className="field-optional">(optional)</span>
        </span>
      ) : (
        label
      )}
      {cloneElement(children, fieldErrorProps(errors, errorId))}
      <FieldError id={errorId} messages={errors} />
    </label>
  );
}

/**
 * Says how a form marks its fields. Forms mark the optional fields because
 * they are the smaller group.
 */
export function RequiredFieldsNote() {
  return (
    <p className="form-help required-fields-note">
      Fields are required unless marked optional.
    </p>
  );
}
