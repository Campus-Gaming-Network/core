import type { ReactNode } from "react";

/**
 * One numbered section of a sectioned form: a title and short description on
 * the left, the fields on the right. Render inside a form with the classes
 * `form-stack sectioned-form`. It is a native fieldset, so it works without
 * JavaScript and keeps its group semantics.
 */
export function FormSection({
  children,
  description,
  title,
}: {
  children: ReactNode;
  description: string;
  title: string;
}) {
  return (
    <fieldset className="form-section">
      <legend>{title}</legend>
      <p className="form-help">{description}</p>
      <div className="form-section-fields">{children}</div>
    </fieldset>
  );
}
