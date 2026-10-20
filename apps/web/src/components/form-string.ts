/** A text field from a submitted form; a file or a missing field is "". */
export function formString(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}
