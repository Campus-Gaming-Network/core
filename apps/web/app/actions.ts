"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  ApiContractError,
  ApiError,
  formString,
  getSetCookieHeader,
  parseSetCookie,
  userMessageForApiError
} from "../lib/cgn-api";
import { apiRequestFromBFF } from "../lib/bff-api";
import {
  emptyResponseSchema,
  eventSchema,
  eventUnlockResponseSchema,
  idResponseSchema,
  profileSchema,
  statusResponseSchema,
  teamSchema
} from "../lib/api-contracts";
import {
  eventBodyFromForm,
  socialLinksFromForm,
  teamBodyFromForm
} from "../lib/action-payloads";
import { type FormState } from "../lib/form-state";
import {
  createEventFormSchema,
  createTeamFormSchema,
  deleteAccountFormSchema,
  emailFormSchema,
  eventInterestFormSchema,
  formValidationFailure,
  loginFormSchema,
  passwordFormSchema,
  profileFormSchema,
  reportFormSchema,
  resetPasswordFormSchema,
  rsvpFormSchema,
  schoolFollowFormSchema,
  signupFormSchema,
  slugFormSchema,
  supportTicketFormSchema,
  teamCaptainFormSchema,
  teamOwnershipFormSchema,
  updateEventFormSchema
} from "../lib/form-validation";
import {
  buildCreateEventRequest,
  buildDeleteEventRequest,
  buildEventInterestRequest,
  buildResendVerificationRequest,
  buildRsvpEventRequest,
  buildSignupRequest,
  buildTeamJoinRequest,
  buildTransferTeamOwnershipRequest,
  buildUnlockEventRequest
} from "../lib/pass-v0-requests";
import {
  eventUnlockCookieName,
  eventUnlockHeaders,
  incomingCookieHeader
} from "../lib/server-api";

export async function signupAction(
  _previousState: FormState,
  formData: FormData
): Promise<FormState> {
  const request = buildSignupRequest(formData);
  const validated = signupFormSchema.safeParse(request.body);

  if (!validated.success) {
    return formValidationFailure(validated.error);
  }

  try {
    await apiRequestFromBFF({
      ...request,
      body: validated.data,
      responseSchema: profileSchema
    });

    return {
      status: "success",
      message:
        "Account created. Check your email for the verification link before logging in."
    };
  } catch (error) {
    return failure(error);
  }
}

export async function loginAction(
  _previousState: FormState,
  formData: FormData
): Promise<FormState> {
  const validated = loginFormSchema.safeParse({
    email: formString(formData, "email"),
    password: formString(formData, "password"),
    next: formString(formData, "next") || undefined
  });

  if (!validated.success) {
    return formValidationFailure(validated.error);
  }

  try {
    const result = await apiRequestFromBFF({
      path: "/auth/login",
      method: "POST",
      body: {
        email: validated.data.email,
        password: validated.data.password
      },
      responseSchema: profileSchema
    });

    await mirrorSessionCookie(result.response);
  } catch (error) {
    return failure(error);
  }

  redirect(safeRedirect(validated.data.next ?? "") ?? "/account");
}

export async function logoutAction() {
  try {
    const result = await apiRequestFromBFF({
      path: "/auth/logout",
      method: "POST",
      cookieHeader: await incomingCookieHeader(),
      responseSchema: emptyResponseSchema
    });

    await mirrorSessionCookie(result.response);
  } catch (error) {
    reportApiContractError(error);
    const cookieStore = await cookies();
    cookieStore.delete(sessionCookieName());
  }

  revalidatePath("/", "layout");
  redirect("/");
}

export async function forgotPasswordAction(
  _previousState: FormState,
  formData: FormData
): Promise<FormState> {
  const validated = emailFormSchema.safeParse({
    email: formString(formData, "email")
  });

  if (!validated.success) {
    return formValidationFailure(validated.error);
  }

  try {
    await apiRequestFromBFF({
      path: "/auth/forgot-password",
      method: "POST",
      body: validated.data,
      responseSchema: statusResponseSchema
    });

    return {
      status: "success",
      message:
        "If that account exists, a password reset link is on the way."
    };
  } catch (error) {
    return failure(error);
  }
}

export async function resetPasswordAction(
  _previousState: FormState,
  formData: FormData
): Promise<FormState> {
  const validated = resetPasswordFormSchema.safeParse({
    token: formString(formData, "token"),
    password: formString(formData, "password")
  });

  if (!validated.success) {
    return formValidationFailure(validated.error);
  }

  try {
    await apiRequestFromBFF({
      path: "/auth/reset-password",
      method: "POST",
      body: validated.data,
      responseSchema: emptyResponseSchema
    });
  } catch (error) {
    return failure(error);
  }

  redirect("/login?reset=complete");
}

export async function resendVerificationAction(
  _previousState: FormState,
  formData: FormData
): Promise<FormState> {
  const request = buildResendVerificationRequest(formData);
  const validated = emailFormSchema.safeParse(request.body);

  if (!validated.success) {
    return formValidationFailure(validated.error);
  }

  try {
    await apiRequestFromBFF({
      ...request,
      body: validated.data,
      responseSchema: statusResponseSchema
    });

    return {
      status: "success",
      message:
        "If that account needs verification, another email is on the way."
    };
  } catch (error) {
    return failure(error);
  }
}

export async function updateProfileAction(
  _previousState: FormState,
  formData: FormData
): Promise<FormState> {
  const validated = profileFormSchema.safeParse({
    name: formString(formData, "name"),
    bio: formString(formData, "bio"),
    timezone: formString(formData, "timezone"),
    social_links: socialLinksFromForm(formData)
  });

  if (!validated.success) {
    return formValidationFailure(validated.error);
  }

  try {
    await apiRequestFromBFF({
      path: "/me",
      method: "PATCH",
      cookieHeader: await incomingCookieHeader(),
      body: validated.data,
      responseSchema: profileSchema
    });

    revalidatePath("/account");

    return {
      status: "success",
      message: "Profile updated."
    };
  } catch (error) {
    return failure(error);
  }
}

export async function submitSupportTicketAction(
  _previousState: FormState,
  formData: FormData
): Promise<FormState> {
  const validated = supportTicketFormSchema.safeParse({
    contact_email: formString(formData, "contact_email"),
    name: formString(formData, "name"),
    subject: formString(formData, "subject"),
    message: formString(formData, "message")
  });

  if (!validated.success) {
    return formValidationFailure(validated.error);
  }

  try {
    await apiRequestFromBFF({
      path: "/support-tickets",
      method: "POST",
      cookieHeader: await incomingCookieHeader(),
      body: validated.data,
      responseSchema: idResponseSchema
    });

    return {
      status: "success",
      message: "Support ticket submitted. We will review it soon."
    };
  } catch (error) {
    return failure(error);
  }
}

export async function reportEventAction(
  _previousState: FormState,
  formData: FormData
): Promise<FormState> {
  const slug = formString(formData, "slug");
  const validatedTarget = slugFormSchema.safeParse({ slug });
  const validated = reportFormSchema.safeParse({
    reason: formString(formData, "reason")
  });

  if (!validatedTarget.success) {
    return formValidationFailure(validatedTarget.error);
  }
  if (!validated.success) {
    return formValidationFailure(validated.error);
  }

  try {
    await apiRequestFromBFF({
      path: `/events/${encodeURIComponent(slug)}/report`,
      method: "POST",
      cookieHeader: await incomingCookieHeader(),
      body: validated.data,
      responseSchema: idResponseSchema
    });

    return {
      status: "success",
      message: "Report submitted for review."
    };
  } catch (error) {
    return failure(error);
  }
}

export async function reportUserAction(
  _previousState: FormState,
  formData: FormData
): Promise<FormState> {
  const userID = formString(formData, "user_id");
  const validatedTarget = slugFormSchema.safeParse({ slug: userID });
  const validated = reportFormSchema.safeParse({
    reason: formString(formData, "reason")
  });

  if (!validatedTarget.success) {
    return formValidationFailure(validatedTarget.error);
  }
  if (!validated.success) {
    return formValidationFailure(validated.error);
  }

  try {
    await apiRequestFromBFF({
      path: `/users/${encodeURIComponent(userID)}/report`,
      method: "POST",
      cookieHeader: await incomingCookieHeader(),
      body: validated.data,
      responseSchema: idResponseSchema
    });

    return {
      status: "success",
      message: "Report submitted for review."
    };
  } catch (error) {
    return failure(error);
  }
}

export async function followSchoolAction(formData: FormData) {
  const validated = schoolFollowFormSchema.safeParse({
    school_id: formString(formData, "school_id"),
    slug: formString(formData, "slug")
  });
  const schoolID = validated.success ? validated.data.school_id : "";
  const slug = validated.success ? validated.data.slug : "";
  let destination = `/schools/${encodeURIComponent(slug)}?follow=added`;

  if (!validated.success) {
    destination = "/schools?follow=failed";
  } else {
    try {
      await apiRequestFromBFF({
        path: `/schools/${encodeURIComponent(schoolID)}/follow`,
        method: "POST",
        cookieHeader: await incomingCookieHeader(),
        responseSchema: emptyResponseSchema
      });
    } catch (error) {
      destination = followErrorDestination(error, slug);
    }
  }

  if (validated.success) {
    revalidatePath(`/schools/${slug}`);
  }
  redirect(destination);
}

export async function unfollowSchoolAction(formData: FormData) {
  const validated = schoolFollowFormSchema.safeParse({
    school_id: formString(formData, "school_id"),
    slug: formString(formData, "slug")
  });
  const schoolID = validated.success ? validated.data.school_id : "";
  const slug = validated.success ? validated.data.slug : "";
  let destination = `/schools/${encodeURIComponent(slug)}?follow=removed`;

  if (!validated.success) {
    destination = "/schools?follow=failed";
  } else {
    try {
      await apiRequestFromBFF({
        path: `/schools/${encodeURIComponent(schoolID)}/follow`,
        method: "DELETE",
        cookieHeader: await incomingCookieHeader(),
        responseSchema: emptyResponseSchema
      });
    } catch (error) {
      destination = followErrorDestination(error, slug);
    }
  }

  if (validated.success) {
    revalidatePath(`/schools/${slug}`);
  }
  redirect(destination);
}

export async function createEventAction(
  _previousState: FormState,
  formData: FormData
): Promise<FormState> {
  const request = buildCreateEventRequest(
    formData,
    await incomingCookieHeader()
  );
  const validated = createEventFormSchema.safeParse(request.body);

  if (!validated.success) {
    return formValidationFailure(validated.error);
  }

  let destination = "/events";
  try {
    const { data } = await apiRequestFromBFF({
      ...request,
      body: validated.data,
      responseSchema: eventSchema
    });

    revalidatePath("/events");
    destination = `/events/${data.slug}?event=created`;
  } catch (error) {
    return failure(error);
  }

  redirect(destination);
}

export async function updateEventAction(
  _previousState: FormState,
  formData: FormData
): Promise<FormState> {
  const slug = formString(formData, "slug");
  const validatedSlug = slugFormSchema.safeParse({ slug });
  const validated = updateEventFormSchema.safeParse(
    eventBodyFromForm(formData)
  );

  if (!validatedSlug.success) {
    return formValidationFailure(validatedSlug.error);
  }
  if (!validated.success) {
    return formValidationFailure(validated.error);
  }

  let destination = `/events/${encodeURIComponent(slug)}`;
  try {
    const { data } = await apiRequestFromBFF({
      path: `/events/${encodeURIComponent(slug)}`,
      method: "PATCH",
      cookieHeader: await incomingCookieHeader(),
      body: validated.data,
      responseSchema: eventSchema
    });

    revalidatePath("/events");
    revalidatePath(`/events/${data.slug}`);
    destination = `/events/${data.slug}?event=updated`;
  } catch (error) {
    return failure(error);
  }

  redirect(destination);
}

export async function deleteEventAction(formData: FormData) {
  const validated = slugFormSchema.safeParse({
    slug: formString(formData, "slug")
  });

  if (!validated.success) {
    redirect("/events?event=cancel-failed");
  }

  const { slug } = validated.data;

  try {
    await apiRequestFromBFF({
      ...buildDeleteEventRequest(slug, await incomingCookieHeader()),
      responseSchema: emptyResponseSchema
    });
  } catch (error) {
    reportApiContractError(error);
    redirect(`/events/${encodeURIComponent(slug)}?event=cancel-failed`);
  }

  revalidatePath("/events");
  redirect("/events?event=cancelled");
}

export async function createTeamAction(
  _previousState: FormState,
  formData: FormData
): Promise<FormState> {
  const validated = createTeamFormSchema.safeParse(teamBodyFromForm(formData));

  if (!validated.success) {
    return formValidationFailure(validated.error);
  }

  let destination = "/teams";
  try {
    const { data } = await apiRequestFromBFF({
      path: "/teams",
      method: "POST",
      cookieHeader: await incomingCookieHeader(),
      body: validated.data,
      responseSchema: teamSchema
    });

    revalidatePath("/teams");
    destination = `/teams/${data.slug}?team=created`;
  } catch (error) {
    return failure(error);
  }

  redirect(destination);
}

export async function joinTeamAction(
  _previousState: FormState,
  formData: FormData
): Promise<FormState> {
  const slug = formString(formData, "slug");
  const validatedSlug = slugFormSchema.safeParse({ slug });
  const validated = passwordFormSchema.safeParse({
    password: formString(formData, "password")
  });

  if (!validatedSlug.success) {
    return formValidationFailure(validatedSlug.error);
  }
  if (!validated.success) {
    return formValidationFailure(validated.error);
  }

  let destination = `/teams/${encodeURIComponent(slug)}?team=joined`;

  try {
    const { data } = await apiRequestFromBFF({
      ...buildTeamJoinRequest(slug, formData, await incomingCookieHeader()),
      body: validated.data,
      responseSchema: teamSchema
    });

    revalidatePath("/teams");
    revalidatePath(`/teams/${data.slug}`);
    destination = `/teams/${data.slug}?team=joined`;
  } catch (error) {
    return failure(error);
  }

  redirect(destination);
}

export async function setTeamCaptainAction(formData: FormData) {
  const validated = teamCaptainFormSchema.safeParse({
    slug: formString(formData, "slug"),
    user_id: formString(formData, "user_id"),
    captain: formString(formData, "captain")
  });
  const slug = validated.success ? validated.data.slug : "";
  let destination = validated.success
    ? `/teams/${encodeURIComponent(slug)}?team=manage-failed`
    : "/teams?team=manage-failed";

  if (validated.success) {
    try {
      const { data } = await apiRequestFromBFF({
        path: `/teams/${encodeURIComponent(slug)}/captains`,
        method: "POST",
        cookieHeader: await incomingCookieHeader(),
        body: {
          user_id: validated.data.user_id,
          captain: validated.data.captain
        },
        responseSchema: teamSchema
      });

      revalidatePath(`/teams/${data.slug}`);
      destination = `/teams/${data.slug}?team=captain-updated`;
    } catch (error) {
      reportApiContractError(error);
      // Keep this as a no-JS management action with a simple redirect notice.
    }
  }

  redirect(destination);
}

export async function transferTeamOwnershipAction(formData: FormData) {
  const validated = teamOwnershipFormSchema.safeParse({
    slug: formString(formData, "slug"),
    new_owner_user_id: formString(formData, "new_owner_user_id")
  });
  const slug = validated.success ? validated.data.slug : "";
  let destination = validated.success
    ? `/teams/${encodeURIComponent(slug)}?team=manage-failed`
    : "/teams?team=manage-failed";

  if (validated.success) {
    try {
      const { data } = await apiRequestFromBFF({
        ...buildTransferTeamOwnershipRequest(
          slug,
          validated.data.new_owner_user_id,
          await incomingCookieHeader()
        ),
        responseSchema: teamSchema
      });

      revalidatePath("/teams");
      revalidatePath(`/teams/${data.slug}`);
      destination = `/teams/${data.slug}?team=ownership-transferred`;
    } catch (error) {
      reportApiContractError(error);
      // Keep this as a no-JS management action with a simple redirect notice.
    }
  }

  redirect(destination);
}

export async function unlockEventAction(
  _previousState: FormState,
  formData: FormData
): Promise<FormState> {
  const slug = formString(formData, "slug");
  const validatedSlug = slugFormSchema.safeParse({ slug });
  const validated = passwordFormSchema.safeParse({
    password: formString(formData, "password")
  });

  if (!validatedSlug.success) {
    return formValidationFailure(validatedSlug.error);
  }
  if (!validated.success) {
    return formValidationFailure(validated.error);
  }

  let destination = `/events/${encodeURIComponent(slug)}?event=unlocked`;

  try {
    const { data } = await apiRequestFromBFF({
      ...buildUnlockEventRequest(slug, formData),
      body: validated.data,
      responseSchema: eventUnlockResponseSchema
    });

    await storeEventUnlockCookie(slug, data.unlock_token, data.expires_at);
    revalidatePath(`/events/${slug}`);
    destination = `/events/${data.event.slug}?event=unlocked`;
  } catch (error) {
    return failure(error);
  }

  redirect(destination);
}

export async function rsvpEventAction(
  _previousState: FormState,
  formData: FormData
): Promise<FormState> {
  const validated = rsvpFormSchema.safeParse({
    slug: formString(formData, "slug"),
    response: formString(formData, "response")
  });

  if (!validated.success) {
    return formValidationFailure(validated.error);
  }

  const { slug } = validated.data;
  let destination = `/events/${encodeURIComponent(slug)}?event=rsvp-updated`;

  try {
    const request = buildRsvpEventRequest(
      slug,
      formData,
      await incomingCookieHeader(),
      await eventUnlockHeaders(slug)
    );
    const { data } = await apiRequestFromBFF({
      ...request,
      body: { response: validated.data.response },
      responseSchema: eventSchema
    });

    revalidatePath("/events");
    revalidatePath(`/events/${data.slug}`);
    destination = `/events/${data.slug}?event=rsvp-updated`;
  } catch (error) {
    return failure(error);
  }

  redirect(destination);
}

export async function eventInterestAction(formData: FormData) {
  const validated = eventInterestFormSchema.safeParse({
    slug: formString(formData, "slug"),
    interested: formString(formData, "interested")
  });
  const slug = validated.success ? validated.data.slug : "";
  const interested = validated.success ? validated.data.interested : false;
  let destination = validated.success
    ? `/events/${encodeURIComponent(slug)}?event=interest-failed`
    : "/events?event=interest-failed";

  if (validated.success) {
    try {
      const { data } = await apiRequestFromBFF({
        ...buildEventInterestRequest(
          slug,
          interested,
          await incomingCookieHeader(),
          await eventUnlockHeaders(slug)
        ),
        responseSchema: eventSchema
      });

      revalidatePath("/events");
      revalidatePath(`/events/${data.slug}`);
      destination = `/events/${data.slug}?event=${interested ? "interest-added" : "interest-removed"}`;
    } catch (error) {
      reportApiContractError(error);
      // Keep this form as a no-JS redirect toggle for now.
    }
  }

  redirect(destination);
}

function failure(error: unknown): FormState {
  reportApiContractError(error);

  return {
    status: "error",
    message: userMessageForApiError(error)
  };
}

function reportApiContractError(error: unknown) {
  if (error instanceof ApiContractError) {
    console.error("API response contract violation", {
      path: error.path,
      issues: error.issues
    });
  }
}

async function storeEventUnlockCookie(slug: string, token: string, expiresAt: string) {
  const parsedExpiresAt = new Date(expiresAt);
  const cookieStore = await cookies();

  cookieStore.set({
    name: eventUnlockCookieName(slug),
    value: token,
    // Login happens at /login, so a path-scoped event cookie is absent from the
    // server action request that renders the redirect back to this event.
    // Event-specific names keep tokens isolated while the root path preserves
    // private-event access across that authentication round trip.
    path: "/",
    expires: Number.isNaN(parsedExpiresAt.getTime()) ? undefined : parsedExpiresAt,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax"
  });
}

async function mirrorSessionCookie(response: Response) {
  const parsed = parseSetCookie(
    getSetCookieHeader(response.headers),
    sessionCookieName()
  );

  if (!parsed) {
    return;
  }

  const cookieStore = await cookies();

  if (parsed.maxAge !== undefined && parsed.maxAge < 0) {
    cookieStore.delete(parsed.name);
    return;
  }

  cookieStore.set({
    name: parsed.name,
    value: parsed.value,
    path: parsed.path ?? "/",
    expires: parsed.expires,
    maxAge: parsed.maxAge,
    httpOnly: parsed.httpOnly,
    secure: parsed.secure,
    sameSite: parsed.sameSite ?? "lax"
  });
}

function sessionCookieName() {
  return process.env.API_SESSION_COOKIE ?? "cgn_session";
}

function safeRedirect(value: string) {
  if (value.startsWith("/") && !value.startsWith("//")) {
    return value;
  }

  return null;
}

function followErrorDestination(error: unknown, slug: string) {
  reportApiContractError(error);

  if (error instanceof ApiError && error.status === 401) {
    return `/login?next=${encodeURIComponent(`/schools/${slug}`)}`;
  }

  return `/schools/${encodeURIComponent(slug)}?follow=failed`;
}

export async function deleteAccountAction(
  _previousState: FormState,
  formData: FormData
): Promise<FormState> {
  const validated = deleteAccountFormSchema.safeParse({
    confirm: formString(formData, "confirm")
  });

  // Typed confirmation, so an irreversible action cannot be a stray click.
  if (!validated.success) {
    return formValidationFailure(validated.error);
  }

  try {
    await apiRequestFromBFF({
      path: "/me",
      method: "DELETE",
      cookieHeader: await incomingCookieHeader(),
      responseSchema: emptyResponseSchema
    });
  } catch (error) {
    return failure(error);
  }

  // The API revokes every session, so drop the local cookie to match.
  const cookieStore = await cookies();
  cookieStore.delete(sessionCookieName());

  revalidatePath("/", "layout");
  redirect("/?account=deleted");
}
