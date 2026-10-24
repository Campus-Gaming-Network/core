export const fakeAPIHealthPayload = {
  service: "fake-go-api",
  status: "ok",
  source: "web-production-smoke",
};
export const eventSlug = "private-smoke-event";
export const missingEventSlug = "missing-smoke-event";
export const publicEventSlug = "public-smoke-event";
export const schoolSlug = "smoke-test-university";
export const missingSchoolSlug = "missing-smoke-school";
export const teamSlug = "smoke-arena-team";
export const missingTeamSlug = "missing-smoke-team";
// Profile URLs name a user by public ID: ten base58 characters.
export const publicProfileID = "PubSmoke42";
export const missingPublicProfileID = "MissSmoke9";
export const eventPassword = "SmokeEventPassword123!";
export const unlockToken = "smoke-private-event-unlock-token";
export const sessionToken = "smoke-session-token";
// The smoke player's profile URL ID: ten base58 characters, as the API sends.
export const smokePublicID = "Smoke7Pay9";
export const outageSessionToken = "smoke-outage-session-token";
export const privateEventSecrets = {
  title: "Midnight Strategy Session",
  description: "Private tournament plans for invited players only.",
  location: "Secret Student Union Room",
  address: "123 Private Campus Way",
};

export type JSONBody = Record<string, unknown>;

export type UpstreamCall = {
  method: string;
  pathname: string;
  search: string;
  cookie: string | undefined;
  eventUnlock: string | undefined;
  body: JSONBody | undefined;
};
