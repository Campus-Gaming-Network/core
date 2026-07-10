"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  type Profile,
  type SocialLink,
  ApiError,
  apiRequest,
  formCheckbox,
  formString,
  getSetCookieHeader,
  parseSetCookie,
  userMessageForApiError
} from "../lib/cgn-api";
import { type FormState } from "../lib/form-state";
import { incomingCookieHeader } from "../lib/server-api";

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

function failure(error: unknown): FormState {
  return {
    status: "error",
    message: userMessageForApiError(error)
  };
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
