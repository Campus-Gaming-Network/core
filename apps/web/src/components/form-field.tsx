import { cloneElement, useId, type ReactElement } from "react";
import { CharacterCount } from "./character-count.js";
import { FieldError, fieldErrorProps } from "./enhanced-mutation.js";

/**
 * A label wrapping one control and its validation text. The control is the
 * only child; it gains `aria-invalid` and `aria-describedby` when `errors` is
 * not empty. `errorId` is the id the error renders under, which the form's
 * error summary links back to. `optional` adds "(optional)" to the label;
 * a form with optional fields also shows RequiredFieldsNote. `characterCount`
 * adds a CharacterCount under the control for the control's `maxLength`.
 */
export function FormField({
  characterCount = false,
  children,
  errorId,
  errors,
  label,
  optional = false,
}: {
  children: ReactElement<{
    "aria-describedby"?: string;
    "aria-label"?: string;
    "aria-labelledby"?: string;
    "aria-invalid"?: boolean;
    maxLength?: number;
  }>;
  characterCount?: boolean;
  errorId: string;
  errors?: string[];
  label: string;
  optional?: boolean;
}) {
  const labelID = useId();
  const hintId = `${useId()}-count`;
  const limit = characterCount ? children.props.maxLength : undefined;
  const errorProps = fieldErrorProps(errors, errorId);
  const describedBy = [errorProps["aria-describedby"], limit ? hintId : null]
    .filter(Boolean)
    .join(" ");
  return (
    <label>
      {/* Labels are grids, so the marker shares a cell with the label text.
          The control names itself from this text alone, so a button beside
          it (such as the password toggle) does not become part of its name. */}
      <span id={labelID}>
        {label}
        {optional ? <span className="field-optional"> (optional)</span> : null}
      </span>
      {cloneElement(children, {
        ...(children.props["aria-label"] ? {} : { "aria-labelledby": labelID }),
        ...errorProps,
        "aria-describedby": describedBy || undefined,
      })}
      <FieldError id={errorId} messages={errors} />
      {limit ? <CharacterCount hintId={hintId} limit={limit} /> : null}
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
