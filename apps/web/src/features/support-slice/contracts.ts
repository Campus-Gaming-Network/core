import * as z from "zod";

const emailSchema = z.string().trim().pipe(
  z.email("Enter a valid email address.")
);

function requiredText(label: string, maximum: number) {
  return z.string().trim().min(1, `${label} is required.`).max(
    maximum,
    `${label} must be ${maximum} characters or fewer.`
  );
}

export const supportTicketInputSchema = z.object({
  contact_email: emailSchema,
  name: z.string().trim().max(120, "Name must be 120 characters or fewer."),
  subject: requiredText("Subject", 160),
  message: requiredText("Message", 5000)
});

export const supportTicketIdDtoSchema = z.object({
  id: z.string().trim().min(1)
});

export type SupportTicketInput = z.output<typeof supportTicketInputSchema>;
export type SupportFieldErrors = Record<string, string[] | undefined>;

export type SupportTicketResult =
  | {
      status: "success";
      message: "Support ticket submitted. We will review it soon.";
    }
  | {
      status: "error";
      message: string;
      fieldErrors?: SupportFieldErrors;
    };

export type ValidatedSupportInput =
  | { valid: true; value: SupportTicketInput }
  | {
      valid: false;
      message: "Check the highlighted fields and try again.";
      fieldErrors: SupportFieldErrors;
    };

export function validateSupportTicketServerInput(
  input: SupportTicketInput | FormData
): ValidatedSupportInput {
  const candidate = {
    contact_email: inputValue(input, "contact_email"),
    name: inputValue(input, "name"),
    subject: inputValue(input, "subject"),
    message: inputValue(input, "message")
  };
  const parsed = supportTicketInputSchema.safeParse(candidate);
  if (parsed.success) return { valid: true, value: parsed.data };

  const fieldErrors: SupportFieldErrors = {};
  for (const issue of parsed.error.issues) {
    const field = typeof issue.path[0] === "string" ? issue.path[0] : "_form";
    const messages = fieldErrors[field] ?? [];
    if (!messages.includes(issue.message)) messages.push(issue.message);
    fieldErrors[field] = messages;
  }

  return {
    valid: false,
    message: "Check the highlighted fields and try again.",
    fieldErrors
  };
}

export type SupportSearch = {
  support?: "failed" | "submitted";
};

export function validateSupportSearch(
  search: Record<string, unknown>
): SupportSearch {
  const value = firstString(search.support);
  return value === "failed" || value === "submitted"
    ? { support: value }
    : {};
}

function inputValue(input: FormData | object, name: string): string {
  const value = input instanceof FormData
    ? input.get(name)
    : name in input
      ? Reflect.get(input, name)
      : undefined;
  return typeof value === "string" ? value.trim() : "";
}

function firstString(value: unknown): string {
  if (typeof value === "string") return value;
  return Array.isArray(value) && typeof value[0] === "string" ? value[0] : "";
}
