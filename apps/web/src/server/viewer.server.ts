import * as z from "zod";
import { ApiError, type ApiClient } from "./api.server.js";

export const profileDtoSchema = z.object({
  id: z.string().min(1),
  email: z.email(),
  email_verified_at: z.iso.datetime({ offset: true }).optional(),
  verification_level: z.string().min(1),
  name: z.string(),
  avatar_url: z.string().optional(),
  bio: z.string().optional(),
  timezone: z.string().min(1),
  home_school_id: z.string().min(1),
  role_indicators: z.array(z.string()).optional()
});

export type ProfileDTO = z.output<typeof profileDtoSchema>;

export type ViewerRequest = {
  api: ApiClient;
  cookieHeader: string;
  sessionCookieValue?: string;
};

export class AuthenticationRequiredError extends Error {
  constructor() {
    super("Authentication is required");
    this.name = "AuthenticationRequiredError";
  }
}

/**
 * Returns null only when the configured session is absent or rejected with a
 * 401. Network, upstream, and response-contract failures remain distinguishable
 * so authenticated routes never turn an outage into a logged-out state.
 */
export async function optionalViewerProfile({
  api,
  cookieHeader,
  sessionCookieValue
}: ViewerRequest): Promise<ProfileDTO | null> {
  if (!sessionCookieValue) {
    return null;
  }

  try {
    const { data } = await api({
      path: "/me",
      cookieHeader,
      cache: "no-store",
      responseSchema: profileDtoSchema
    });
    return data;
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      return null;
    }
    throw error;
  }
}

export async function requiredViewerProfile(
  request: ViewerRequest
): Promise<ProfileDTO> {
  const profile = await optionalViewerProfile(request);
  if (!profile) {
    throw new AuthenticationRequiredError();
  }
  return profile;
}
