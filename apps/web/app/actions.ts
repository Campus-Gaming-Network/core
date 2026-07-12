"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  type Event,
  type EventUnlockResponse,
  type Profile,
  type SocialLink,
  type Team,
  ApiError,
  apiRequest,
  formCheckbox,
  formString,
  getSetCookieHeader,
  parseSetCookie,
  userMessageForApiError
} from "../lib/cgn-api";
import { type FormState } from "../lib/form-state";
import {
  eventUnlockCookieName,
  eventUnlockHeaders,
  incomingCookieHeader
} from "../lib/server-api";

export async function signupAction(
  _previousState: FormState,
  formData: FormData
): Promise<FormState> {
  try {
    await apiRequest<Profile>({
      path: "/auth/signup",
      method: "POST",
      body: {
        email: formString(formData, "email"),
        password: formString(formData, "password"),
        name: formString(formData, "name"),
        home_school_id: formString(formData, "home_school_id"),
        age_confirmed: formCheckbox(formData, "age_confirmed"),
        timezone: formString(formData, "timezone") || "America/Los_Angeles"
      }
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
  try {
    const result = await apiRequest<Profile>({
      path: "/auth/login",
      method: "POST",
      body: {
        email: formString(formData, "email"),
        password: formString(formData, "password")
      }
    });

    await mirrorSessionCookie(result.response);
  } catch (error) {
    return failure(error);
  }

  redirect(safeRedirect(formString(formData, "next")) ?? "/account");
}

export async function logoutAction() {
  try {
    const result = await apiRequest<void>({
      path: "/auth/logout",
      method: "POST",
      cookieHeader: await incomingCookieHeader()
    });

    await mirrorSessionCookie(result.response);
  } catch {
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
  try {
    await apiRequest<{ status: string }>({
      path: "/auth/forgot-password",
      method: "POST",
      body: {
        email: formString(formData, "email")
      }
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
  try {
    await apiRequest<void>({
      path: "/auth/reset-password",
      method: "POST",
      body: {
        token: formString(formData, "token"),
        password: formString(formData, "password")
      }
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
  try {
    await apiRequest<{ status: string }>({
      path: "/auth/resend-verification",
      method: "POST",
      body: {
        email: formString(formData, "email")
      }
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
  try {
    await apiRequest<Profile>({
      path: "/me",
      method: "PATCH",
      cookieHeader: await incomingCookieHeader(),
      body: {
        name: formString(formData, "name"),
        bio: formString(formData, "bio"),
        timezone: formString(formData, "timezone"),
        social_links: socialLinksFromForm(formData)
      }
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
  try {
    await apiRequest<{ id: string }>({
      path: "/support-tickets",
      method: "POST",
      cookieHeader: await incomingCookieHeader(),
      body: {
        contact_email: formString(formData, "contact_email"),
        name: formString(formData, "name"),
        subject: formString(formData, "subject"),
        message: formString(formData, "message")
      }
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

  try {
    await apiRequest<{ id: string }>({
      path: `/events/${encodeURIComponent(slug)}/report`,
      method: "POST",
      cookieHeader: await incomingCookieHeader(),
      body: {
        reason: formString(formData, "reason")
      }
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

  try {
    await apiRequest<{ id: string }>({
      path: `/users/${encodeURIComponent(userID)}/report`,
      method: "POST",
      cookieHeader: await incomingCookieHeader(),
      body: {
        reason: formString(formData, "reason")
      }
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
  const schoolID = formString(formData, "school_id");
  const slug = formString(formData, "slug");
  let destination = `/schools/${encodeURIComponent(slug)}?follow=added`;

  try {
    await apiRequest<void>({
      path: `/schools/${encodeURIComponent(schoolID)}/follow`,
      method: "POST",
      cookieHeader: await incomingCookieHeader()
    });
  } catch (error) {
    destination = followErrorDestination(error, slug);
  }

  revalidatePath(`/schools/${slug}`);
  redirect(destination);
}

export async function unfollowSchoolAction(formData: FormData) {
  const schoolID = formString(formData, "school_id");
  const slug = formString(formData, "slug");
  let destination = `/schools/${encodeURIComponent(slug)}?follow=removed`;

  try {
    await apiRequest<void>({
      path: `/schools/${encodeURIComponent(schoolID)}/follow`,
      method: "DELETE",
      cookieHeader: await incomingCookieHeader()
    });
  } catch (error) {
    destination = followErrorDestination(error, slug);
  }

  revalidatePath(`/schools/${slug}`);
  redirect(destination);
}

export async function createEventAction(
  _previousState: FormState,
  formData: FormData
): Promise<FormState> {
  let destination = "/events";
  try {
    const { data } = await apiRequest<Event>({
      path: "/events",
      method: "POST",
      cookieHeader: await incomingCookieHeader(),
      body: eventBodyFromForm(formData)
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
  let destination = `/events/${encodeURIComponent(slug)}`;
  try {
    const { data } = await apiRequest<Event>({
      path: `/events/${encodeURIComponent(slug)}`,
      method: "PATCH",
      cookieHeader: await incomingCookieHeader(),
      body: eventBodyFromForm(formData)
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
  const slug = formString(formData, "slug");

  try {
    await apiRequest<void>({
      path: `/events/${encodeURIComponent(slug)}`,
      method: "DELETE",
      cookieHeader: await incomingCookieHeader()
    });
  } catch {
    redirect(`/events/${encodeURIComponent(slug)}?event=delete-failed`);
  }

  revalidatePath("/events");
  redirect("/events?event=deleted");
}

export async function createTeamAction(
  _previousState: FormState,
  formData: FormData
): Promise<FormState> {
  let destination = "/teams";
  try {
    const { data } = await apiRequest<Team>({
      path: "/teams",
      method: "POST",
      cookieHeader: await incomingCookieHeader(),
      body: teamBodyFromForm(formData)
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
  let destination = `/teams/${encodeURIComponent(slug)}?team=joined`;

  try {
    const { data } = await apiRequest<Team>({
      path: `/teams/${encodeURIComponent(slug)}/join`,
      method: "POST",
      cookieHeader: await incomingCookieHeader(),
      body: {
        password: formString(formData, "password")
      }
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
  const slug = formString(formData, "slug");
  const userID = formString(formData, "user_id");
  const captain = formString(formData, "captain") === "true";
  let destination = `/teams/${encodeURIComponent(slug)}?team=manage-failed`;

  try {
    const { data } = await apiRequest<Team>({
      path: `/teams/${encodeURIComponent(slug)}/captains`,
      method: "POST",
      cookieHeader: await incomingCookieHeader(),
      body: {
        user_id: userID,
        captain
      }
    });

    revalidatePath(`/teams/${data.slug}`);
    destination = `/teams/${data.slug}?team=captain-updated`;
  } catch {
    // Keep this as a no-JS management action with a simple redirect notice.
  }

  redirect(destination);
}

export async function transferTeamOwnershipAction(formData: FormData) {
  const slug = formString(formData, "slug");
  const newOwnerUserID = formString(formData, "new_owner_user_id");
  let destination = `/teams/${encodeURIComponent(slug)}?team=manage-failed`;

  try {
    const { data } = await apiRequest<Team>({
      path: `/teams/${encodeURIComponent(slug)}/transfer-ownership`,
      method: "POST",
      cookieHeader: await incomingCookieHeader(),
      body: {
        new_owner_user_id: newOwnerUserID
      }
    });

    revalidatePath("/teams");
    revalidatePath(`/teams/${data.slug}`);
    destination = `/teams/${data.slug}?team=ownership-transferred`;
  } catch {
    // Keep this as a no-JS management action with a simple redirect notice.
  }

  redirect(destination);
}

export async function unlockEventAction(
  _previousState: FormState,
  formData: FormData
): Promise<FormState> {
  const slug = formString(formData, "slug");
  let destination = `/events/${encodeURIComponent(slug)}?event=unlocked`;

  try {
    const { data } = await apiRequest<EventUnlockResponse>({
      path: `/events/${encodeURIComponent(slug)}/unlock`,
      method: "POST",
      body: {
        password: formString(formData, "password")
      }
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
  const slug = formString(formData, "slug");
  let destination = `/events/${encodeURIComponent(slug)}?event=rsvp-updated`;

  try {
    const { data } = await apiRequest<Event>({
      path: `/events/${encodeURIComponent(slug)}/rsvp`,
      method: "POST",
      cookieHeader: await incomingCookieHeader(),
      headers: await eventUnlockHeaders(slug),
      body: {
        response: formString(formData, "response")
      }
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
  const slug = formString(formData, "slug");
  const interested = formString(formData, "interested") === "true";
  let destination = `/events/${encodeURIComponent(slug)}?event=interest-failed`;

  try {
    const { data } = await apiRequest<Event>({
      path: `/events/${encodeURIComponent(slug)}/interest`,
      method: interested ? "POST" : "DELETE",
      cookieHeader: await incomingCookieHeader(),
      headers: await eventUnlockHeaders(slug)
    });

    revalidatePath("/events");
    revalidatePath(`/events/${data.slug}`);
    destination = `/events/${data.slug}?event=${interested ? "interest-added" : "interest-removed"}`;
  } catch {
    // Keep this form as a no-JS redirect toggle for now.
  }

  redirect(destination);
}

function failure(error: unknown): FormState {
  return {
    status: "error",
    message: userMessageForApiError(error)
  };
}

async function storeEventUnlockCookie(slug: string, token: string, expiresAt: string) {
  const parsedExpiresAt = new Date(expiresAt);
  const cookieStore = await cookies();

  cookieStore.set({
    name: eventUnlockCookieName(slug),
    value: token,
    path: `/events/${slug}`,
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

function socialLinksFromForm(formData: FormData) {
  const links: SocialLink[] = [];

  for (let index = 0; index < 3; index += 1) {
    const label = formString(formData, `social_label_${index}`);
    const url = formString(formData, `social_url_${index}`);

    if (label || url) {
      links.push({ label, url });
    }
  }

  return links;
}

function followErrorDestination(error: unknown, slug: string) {
  if (error instanceof ApiError && error.status === 401) {
    return `/login?next=${encodeURIComponent(`/schools/${slug}`)}`;
  }

  return `/schools/${encodeURIComponent(slug)}?follow=failed`;
}

function eventBodyFromForm(formData: FormData) {
  return {
    title: formString(formData, "title"),
    description: formString(formData, "description"),
    host_school_id: formString(formData, "host_school_id"),
    game_ids: formData.getAll("game_ids").filter(isString).map((value) => value.trim()),
    visibility: formString(formData, "visibility"),
    format: formString(formData, "format"),
    starts_at: formString(formData, "starts_at"),
    ends_at: formString(formData, "ends_at"),
    timezone: formString(formData, "timezone") || "America/Los_Angeles",
    location_name: formString(formData, "location_name"),
    address: formString(formData, "address"),
    online_url: formString(formData, "online_url"),
    private_password: formString(formData, "private_password"),
    capacity: capacityFromForm(formData),
    is_paid: formCheckbox(formData, "is_paid"),
    payment_note: formString(formData, "payment_note"),
    payment_url: formString(formData, "payment_url")
  };
}

function capacityFromForm(formData: FormData) {
  const raw = formString(formData, "capacity");
  if (!raw) {
    return undefined;
  }

  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function teamBodyFromForm(formData: FormData) {
  return {
    name: formString(formData, "name"),
    description: formString(formData, "description"),
    school_id: formString(formData, "school_id"),
    game_ids: formData.getAll("game_ids").filter(isString).map((value) => value.trim()),
    password: formString(formData, "password")
  };
}

function isString(value: FormDataEntryValue): value is string {
  return typeof value === "string";
}
