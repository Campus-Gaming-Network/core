import * as z from "zod";
import {
  pageNoticeKey,
  type PageNotice,
} from "../../components/page-notice.js";

const slugSchema = z.string().trim().min(1).max(200);
const timestampSchema = z.iso.datetime({ offset: true });

export const organizerInviteDtoSchema = z.object({
  id: z.uuid(),
  email: z.string(),
  expires_at: timestampSchema,
  created_at: timestampSchema,
});
export const organizerInvitesResponseDtoSchema = z.object({
  invites: z.array(organizerInviteDtoSchema),
});
export const acceptOrganizerInviteResponseDtoSchema = z.object({
  event_slug: slugSchema,
});
export type OrganizerInviteDTO = z.output<typeof organizerInviteDtoSchema>;

/** The creator's pending invites; unavailable never fails the edit page. */
export type OrganizerInvitesResult =
  | { status: "ready"; invites: OrganizerInviteDTO[] }
  | { status: "unavailable" };

export type OrganizerMutationResult = { status: "success"; redirectTo: string };

export const organizerNotices = {
  invited: {
    message: "Invitation sent. The link expires in seven days.",
    severity: "success",
  },
  withdrawn: { message: "Invitation withdrawn.", severity: "success" },
  removed: { message: "Co-organizer removed.", severity: "success" },
  transferred: {
    message:
      "You handed this event to another organizer. You're now a co-organizer.",
    severity: "success",
  },
  "invalid-email": {
    message: "Enter a valid email address to send an invitation.",
    severity: "danger",
  },
  "invite-limit": {
    message:
      "This event has as many organizers and invitations as it can. Withdraw an invitation or remove a co-organizer first.",
    severity: "danger",
  },
  failed: {
    message: "We could not update the organizers. Please try again.",
    severity: "danger",
  },
} as const satisfies Record<string, PageNotice>;
export type OrganizerNotice = keyof typeof organizerNotices;

export function validateOrganizerSearch(search: Record<string, unknown>): {
  organizers?: OrganizerNotice;
} {
  const organizers = pageNoticeKey(organizerNotices, search.organizers);
  return organizers ? { organizers } : {};
}

export const acceptOrganizerInviteResults = [
  "invalid",
  "wrong-account",
  "failed",
] as const;
export type AcceptOrganizerInviteResult =
  (typeof acceptOrganizerInviteResults)[number];

export function validateAcceptOrganizerInviteSearch(
  search: Record<string, unknown>,
): { token?: string; result?: AcceptOrganizerInviteResult } {
  const token = z.string().trim().min(1).max(512).safeParse(search.token);
  const result = z.enum(acceptOrganizerInviteResults).safeParse(search.result);
  return {
    ...(token.success ? { token: token.data } : {}),
    ...(result.success ? { result: result.data } : {}),
  };
}

const inviteInputSchema = z.object({
  slug: slugSchema,
  email: z.email().max(254),
});
const revokeInputSchema = z.object({ slug: slugSchema, invite_id: z.uuid() });
const organizerInputSchema = z.object({ slug: slugSchema, user_id: z.uuid() });
const acceptInputSchema = z.object({
  token: z.string().trim().min(1).max(512),
});

export type InviteOrganizerInput = z.output<typeof inviteInputSchema>;
export type RevokeOrganizerInviteInput = z.output<typeof revokeInputSchema>;
export type OrganizerInput = z.output<typeof organizerInputSchema>;
export type AcceptOrganizerInviteInput = z.output<typeof acceptInputSchema>;

/**
 * A form's fields, parsed. An invalid invite still carries its slug, so the
 * redirect can return to the same event with a notice.
 */
export type ValidatedOrganizerInput<T> =
  | { valid: true; value: T }
  | { valid: false; slug?: string };

export function validateInviteOrganizerInput(
  input: object | FormData,
): ValidatedOrganizerInput<InviteOrganizerInput> {
  return validated(inviteInputSchema, input, ["slug", "email"]);
}

export function validateRevokeOrganizerInviteInput(
  input: object | FormData,
): ValidatedOrganizerInput<RevokeOrganizerInviteInput> {
  return validated(revokeInputSchema, input, ["slug", "invite_id"]);
}

export function validateOrganizerInput(
  input: object | FormData,
): ValidatedOrganizerInput<OrganizerInput> {
  return validated(organizerInputSchema, input, ["slug", "user_id"]);
}

export function validateAcceptOrganizerInviteInput(
  input: object | FormData,
): ValidatedOrganizerInput<AcceptOrganizerInviteInput> {
  return validated(acceptInputSchema, input, ["token"]);
}

function validated<T>(
  schema: z.ZodType<T>,
  input: object | FormData,
  fields: string[],
): ValidatedOrganizerInput<T> {
  const values = Object.fromEntries(
    fields.map((field) => [field, inputValue(input, field)]),
  );
  const parsed = schema.safeParse(values);
  if (parsed.success) return { valid: true, value: parsed.data };
  const slug = slugSchema.safeParse(values.slug);
  return { valid: false, ...(slug.success ? { slug: slug.data } : {}) };
}

function inputValue(input: object | FormData, field: string): string {
  const value =
    input instanceof FormData
      ? input.get(field)
      : (input as Record<string, unknown>)[field];
  return typeof value === "string" ? value.trim() : "";
}
