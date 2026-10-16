import type { ReactNode } from "react";

/**
 * One section of a sectioned form: a heading, a short description, then the
 * fields. Render inside a form with the classes `form-stack sectioned-form`.
 * It is a native fieldset, so it works without JavaScript and keeps its group
 * semantics. An `id` makes it a target for in-page section links.
 */
export function FormSection({
  children,
  description,
  id,
  title,
}: {
  children: ReactNode;
  description: string;
  id?: string;
  title: string;
}) {
  return (
    <fieldset className="form-section" id={id}>
      <legend>{title}</legend>
      <p className="form-help">{description}</p>
      <div className="form-section-fields">{children}</div>
    </fieldset>
  );
}
