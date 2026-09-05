import * as z from "zod";
import {
  eventFormatSchema,
  eventRSVPSchema,
  eventVisibilitySchema,
  recurrenceRuleSchema
} from "./api-contracts";
import { type FormState } from "./form-state";

const identifierSchema = z.string().trim().min(1, "This value is required.");
const passwordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters.");
const emailSchema = z.email("Enter a valid email address.");

function requiredText(label: string, maximum: number) {
  return z
    .string()
    .trim()
    .min(1, `${label} is required.`)
    .max(maximum, `${label} must be ${maximum} characters or fewer.`);
}

function optionalText(label: string, maximum: number) {
  return z
    .string()
    .trim()
    .max(maximum, `${label} must be ${maximum} characters or fewer.`);
}

function isHTTPURL(value: string) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function optionalHTTPURL(label: string, maximum: number) {
  return optionalText(label, maximum).refine(
    (value) => value === "" || isHTTPURL(value),
    `${label} must be a valid HTTP or HTTPS URL.`
  );
}

function validIANATimeZone(value: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

const timeZoneSchema = z
  .string()
  .trim()
  .min(1, "Time zone is required.")
  .refine(validIANATimeZone, "Enter a valid IANA time zone.");

export const signupFormSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  name: requiredText("Name", 120),
  home_school_id: z.string().trim().min(1, "Choose a home school."),
  age_confirmed: z.literal(true, {
    error: "Confirm that you are 18 or older."
  }),
  timezone: timeZoneSchema
});

export const loginFormSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Password is required."),
  next: z.string().optional()
});

export const emailFormSchema = z.object({
  email: emailSchema
});

export const resetPasswordFormSchema = z.object({
  token: identifierSchema,
  password: passwordSchema
});

const socialLinkFormSchema = z.object({
  label: requiredText("Social link label", 40),
  url: requiredText("Social link URL", 500).refine(
    (value) => value === "" || isHTTPURL(value),
    "Social link URL must use HTTP or HTTPS."
  )
});

export const profileFormSchema = z.object({
  name: requiredText("Name", 120),
  bio: optionalText("Bio", 2000),
  timezone: timeZoneSchema,
  social_links: z.array(socialLinkFormSchema).max(3)
});

const eventBaseFormSchema = z.object({
  title: requiredText("Title", 120),
  description: optionalText("Description", 5000),
  host_school_id: z.string().trim().min(1, "Choose a host school."),
  game_ids: z.array(identifierSchema).min(1, "Choose at least one game."),
  visibility: eventVisibilitySchema,
  format: eventFormatSchema,
  starts_at: z.iso.datetime({
    offset: true,
    error: "Start time must be an ISO timestamp with a time zone."
  }),
  ends_at: z.iso.datetime({
    offset: true,
    error: "End time must be an ISO timestamp with a time zone."
  }),
  timezone: timeZoneSchema,
  location_name: optionalText("Location name", 200),
  address: optionalText("Address", 1000),
  online_url: optionalHTTPURL("Online URL", 500),
  private_password: z.string().trim(),
  capacity: z
    .number()
    .int()
    .positive("Capacity must be a positive whole number.")
    .optional(),
  is_paid: z.boolean(),
  payment_note: optionalText("Payment note", 1000),
  payment_url: optionalHTTPURL("Payment URL", 500),
  recurrence_rule: z.union([recurrenceRuleSchema, z.literal("")]),
  recurrence_until: z.iso.date("Repeat-until date must be valid.").optional()
});

function eventFormSchema(mode: "create" | "update") {
  return eventBaseFormSchema.superRefine((event, context) => {
    const startsAt = new Date(event.starts_at);
    const endsAt = new Date(event.ends_at);

    if (
      Number.isFinite(startsAt.getTime()) &&
      Number.isFinite(endsAt.getTime()) &&
      endsAt <= startsAt
    ) {
      context.addIssue({
        code: "custom",
        message: "End time must be after start time.",
        path: ["ends_at"]
      });
    }

    if (event.visibility === "private") {
      if (mode === "create" && event.private_password.length < 8) {
        context.addIssue({
          code: "custom",
          message: "Private events require a password of at least 8 characters.",
          path: ["private_password"]
        });
      } else if (
        mode === "update" &&
        event.private_password !== "" &&
        event.private_password.length < 8
      ) {
        context.addIssue({
          code: "custom",
          message: "A new private-event password must be at least 8 characters.",
          path: ["private_password"]
        });
      }
    } else if (event.private_password !== "") {
      context.addIssue({
        code: "custom",
        message: "Only private events may have a private password.",
        path: ["private_password"]
      });
    }

    if (event.recurrence_rule === "" && event.recurrence_until) {
      context.addIssue({
        code: "custom",
        message: "Choose a repeat interval for this end date.",
        path: ["recurrence_rule"]
      });
    }

    if (event.recurrence_rule !== "" && !event.recurrence_until) {
      context.addIssue({
        code: "custom",
        message: "Choose when the recurrence ends.",
        path: ["recurrence_until"]
      });
    }

    if (event.recurrence_rule !== "" && event.recurrence_until) {
      const recurrenceEnd = new Date(
        `${event.recurrence_until}T23:59:59.999Z`
      );

      if (
        Number.isFinite(endsAt.getTime()) &&
        recurrenceEnd <= endsAt
      ) {
        context.addIssue({
          code: "custom",
          message: "Recurrence must end after the first event.",
          path: ["recurrence_until"]
        });
      }

      if (Number.isFinite(startsAt.getTime())) {
        const recurrenceDate = new Date(
          `${event.recurrence_until}T00:00:00Z`
        );
        const maximumDate = new Date(
          Date.UTC(
            startsAt.getUTCFullYear() + 1,
            startsAt.getUTCMonth(),
            startsAt.getUTCDate()
          )
        );

        if (recurrenceDate > maximumDate) {
          context.addIssue({
            code: "custom",
            message: "Recurrence cannot extend more than one year.",
            path: ["recurrence_until"]
          });
        }
      }
    }
  });
}

export const createEventFormSchema = eventFormSchema("create");
export const updateEventFormSchema = eventFormSchema("update");

export const createTeamFormSchema = z.object({
  name: requiredText("Team name", 120),
  description: optionalText("Description", 5000),
  school_id: z.string().trim(),
  game_ids: z.array(identifierSchema).min(1, "Choose at least one game."),
  password: passwordSchema
});

export const passwordFormSchema = z.object({
  password: passwordSchema
});

export const supportTicketFormSchema = z.object({
  contact_email: emailSchema,
  name: optionalText("Name", 120),
  subject: requiredText("Subject", 160),
  message: requiredText("Message", 5000)
});

export const reportFormSchema = z.object({
  reason: requiredText("Reason", 2000)
});

export const schoolFollowFormSchema = z.object({
  school_id: identifierSchema,
  slug: identifierSchema
});

export const slugFormSchema = z.object({
  slug: identifierSchema
});

export const rsvpFormSchema = z.object({
  slug: identifierSchema,
  response: eventRSVPSchema
});

export const eventInterestFormSchema = z.object({
  slug: identifierSchema,
  interested: z
    .enum(["true", "false"])
    .transform((value) => value === "true")
});

export const teamCaptainFormSchema = z.object({
  slug: identifierSchema,
  user_id: identifierSchema,
  captain: z
    .enum(["true", "false"])
    .transform((value) => value === "true")
});

export const teamOwnershipFormSchema = z.object({
  slug: identifierSchema,
  new_owner_user_id: identifierSchema
});

export const deleteAccountFormSchema = z.object({
  confirm: z
    .string()
    .trim()
    .toUpperCase()
    .pipe(z.literal("DELETE", { error: "Type DELETE to confirm." }))
});

export function formValidationFailure(error: z.ZodError): FormState {
  const fieldErrors: NonNullable<FormState["fieldErrors"]> = {};

  for (const issue of error.issues) {
    const field = formFieldName(issue.path);
    const messages = fieldErrors[field] ?? [];

    if (!messages.includes(issue.message)) {
      messages.push(issue.message);
    }
    fieldErrors[field] = messages;
  }

  return {
    status: "error",
    message: "Check the highlighted fields and try again.",
    fieldErrors
  };
}

function formFieldName(path: PropertyKey[]) {
  if (
    path[0] === "social_links" &&
    typeof path[1] === "number" &&
    (path[2] === "label" || path[2] === "url")
  ) {
    return `social_${path[2]}_${path[1]}`;
  }

  return typeof path[0] === "string" ? path[0] : "_form";
}
