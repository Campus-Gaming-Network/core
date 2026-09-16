export type CookieMutation =
  | {
      kind: "set";
      name: string;
      value: string;
      options: {
        path: "/";
        expires?: Date;
        maxAge?: number;
        httpOnly: boolean;
        secure: boolean;
        sameSite: "strict";
      };
    }
  | { kind: "delete"; name: string; options: { path: "/" } };

type ParsedCookie = {
  name: string;
  value: string;
  expires?: Date;
  maxAge?: number;
  httpOnly: boolean;
  secure: boolean;
  sameSite?: string;
  path?: string;
  domain?: string;
};

export function adminCookieHeader(
  sessionName: string,
  sessionValue: string | undefined,
  csrfName?: string,
  csrfValue?: string
): string {
  return [
    sessionValue ? `${sessionName}=${sessionValue}` : "",
    csrfName && csrfValue ? `${csrfName}=${csrfValue}` : ""
  ]
    .filter(Boolean)
    .join("; ");
}

export function mirroredAdminCookies(
  headers: Headers,
  names: { session: string; csrf: string },
  strictDeployment: boolean
): CookieMutation[] | null {
  const parsed = setCookieHeaders(headers).map(parseSetCookie);
  const session = parsed.find((cookie) => cookie?.name === names.session);
  const csrf = parsed.find((cookie) => cookie?.name === names.csrf);
  if (!session || !csrf) return null;

  const sessionMutation = toMutation(session, true, strictDeployment);
  const csrfMutation = toMutation(csrf, false, strictDeployment);
  return sessionMutation && csrfMutation
    ? [sessionMutation, csrfMutation]
    : null;
}

export function adminCookieDeletions(names: {
  session: string;
  csrf: string;
}): CookieMutation[] {
  return [names.session, names.csrf].map((name) => ({
    kind: "delete" as const,
    name,
    options: { path: "/" as const }
  }));
}

function toMutation(
  cookie: ParsedCookie,
  httpOnly: boolean,
  strictDeployment: boolean
): CookieMutation | null {
  if (cookie.path !== "/" || cookie.domain || cookie.sameSite !== "strict") {
    return null;
  }
  if (cookie.httpOnly !== httpOnly || (strictDeployment && !cookie.secure)) {
    return null;
  }
  if (
    (cookie.maxAge !== undefined && cookie.maxAge <= 0) ||
    (cookie.expires !== undefined && cookie.expires.getTime() <= Date.now())
  ) {
    return { kind: "delete", name: cookie.name, options: { path: "/" } };
  }
  if (!cookie.value) return null;
  return {
    kind: "set",
    name: cookie.name,
    value: cookie.value,
    options: {
      path: "/",
      expires: cookie.expires,
      maxAge: cookie.maxAge,
      httpOnly,
      secure: cookie.secure || strictDeployment,
      sameSite: "strict"
    }
  };
}

function setCookieHeaders(headers: Headers): string[] {
  const extended = headers as Headers & { getSetCookie?: () => string[] };
  const values = extended.getSetCookie?.();
  if (values?.length) return values;
  const value = headers.get("set-cookie");
  return value ? [value] : [];
}

function parseSetCookie(header: string): ParsedCookie | null {
  const [nameValue = "", ...attributes] = header
    .split(";")
    .map((part) => part.trim());
  const separator = nameValue.indexOf("=");
  if (separator < 1) return null;
  const parsed: ParsedCookie = {
    name: nameValue.slice(0, separator),
    value: nameValue.slice(separator + 1),
    httpOnly: false,
    secure: false
  };

  for (const attribute of attributes) {
    const position = attribute.indexOf("=");
    const key = (position < 0 ? attribute : attribute.slice(0, position)).toLowerCase();
    const value = position < 0 ? "" : attribute.slice(position + 1);
    if (key === "path") parsed.path = value;
    if (key === "domain") parsed.domain = value;
    if (key === "httponly") parsed.httpOnly = true;
    if (key === "secure") parsed.secure = true;
    if (key === "samesite") parsed.sameSite = value.toLowerCase();
    if (key === "expires") {
      const expires = new Date(value);
      if (!Number.isNaN(expires.getTime())) parsed.expires = expires;
    }
    if (key === "max-age") {
      const maxAge = Number.parseInt(value, 10);
      if (Number.isFinite(maxAge)) parsed.maxAge = maxAge;
    }
  }
  return parsed;
}
