import {
  eventBodyFromForm,
  privateUnlockBodyFromForm,
  rsvpBodyFromForm,
  teamJoinBodyFromForm
} from "./action-payloads";
import { formCheckbox, formString } from "./cgn-api";

export function buildSignupRequest(formData: FormData) {
  return {
    path: "/auth/signup",
    method: "POST",
    body: {
      email: formString(formData, "email"),
      password: formString(formData, "password"),
      name: formString(formData, "name"),
      home_school_id: formString(formData, "home_school_id"),
      age_confirmed: formCheckbox(formData, "age_confirmed"),
      timezone:
        formString(formData, "timezone") || "America/Los_Angeles"
    }
  };
}

export function buildResendVerificationRequest(formData: FormData) {
  return {
    path: "/auth/resend-verification",
    method: "POST",
    body: {
      email: formString(formData, "email")
    }
  };
}

export function buildCreateEventRequest(
  formData: FormData,
  cookieHeader: string
) {
  return {
    path: "/events",
    method: "POST",
    cookieHeader,
    body: eventBodyFromForm(formData)
  };
}

export function buildDeleteEventRequest(slug: string, cookieHeader: string) {
  return {
    path: `/events/${encodeURIComponent(slug)}`,
    method: "DELETE",
    cookieHeader
  };
}

export function buildUnlockEventRequest(slug: string, formData: FormData) {
  return {
    path: `/events/${encodeURIComponent(slug)}/unlock`,
    method: "POST",
    body: privateUnlockBodyFromForm(formData)
  };
}

export function buildRsvpEventRequest(
  slug: string,
  formData: FormData,
  cookieHeader: string,
  headers: HeadersInit | undefined
) {
  return {
    path: `/events/${encodeURIComponent(slug)}/rsvp`,
    method: "POST",
    cookieHeader,
    headers,
    body: rsvpBodyFromForm(formData)
  };
}

export function buildEventInterestRequest(
  slug: string,
  interested: boolean,
  cookieHeader: string,
  headers: HeadersInit | undefined
) {
  return {
    path: `/events/${encodeURIComponent(slug)}/interest`,
    method: interested ? "POST" : "DELETE",
    cookieHeader,
    headers
  };
}

export function buildTeamJoinRequest(
  slug: string,
  formData: FormData,
  cookieHeader: string
) {
  return {
    path: `/teams/${encodeURIComponent(slug)}/join`,
    method: "POST",
    cookieHeader,
    body: teamJoinBodyFromForm(formData)
  };
}

export function buildTransferTeamOwnershipRequest(
  slug: string,
  newOwnerUserID: string,
  cookieHeader: string
) {
  return {
    path: `/teams/${encodeURIComponent(slug)}/transfer-ownership`,
    method: "POST",
    cookieHeader,
    body: {
      new_owner_user_id: newOwnerUserID
    }
  };
}

export function buildDashboardEventsRequest(
  limit: number,
  cookieHeader: string
) {
  return {
    path: `/me/events?limit=${encodeURIComponent(String(limit))}`,
    cookieHeader
  };
}

export function buildMyTeamsRequest(limit: number, cookieHeader: string) {
  return {
    path: `/me/teams?limit=${encodeURIComponent(String(limit))}`,
    cookieHeader
  };
}
