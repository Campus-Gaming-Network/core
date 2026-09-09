export type SameSite = "lax" | "strict" | "none";

export type CookieOptions = {
  path: string;
  expires?: Date;
  maxAge?: number;
  httpOnly: boolean;
  secure: boolean;
  sameSite: SameSite;
};

export type CookieMutation =
  | { kind: "set"; name: string; value: string; options: CookieOptions }
  | { kind: "delete"; name: string; options: { path: string } };

type ParsedCookie = {
  name: string;
  value: string;
  path?: string;
  expires?: Date;
  maxAge?: number;
  httpOnly: boolean;
  secure: boolean;
  sameSite?: SameSite;
};

export function sessionCookieName(
  environment: Readonly<Record<string, string | undefined>> = process.env
): string {
  return environment.API_SESSION_COOKIE?.trim() || "cgn_session";
}

export function eventUnlockCookieName(slug: string): string {
  return `cgn_event_unlock_${slug.replace(/[^A-Za-z0-9_-]/g, "_")}`;
}

export function configuredCookieDeletion(name: string): CookieMutation {
  return { kind: "delete", name, options: { path: "/" } };
}

export function unlockCookieMutation(
  slug: string,
  token: string,
  expiresAt: string,
  production: boolean
): CookieMutation {
  const expires = new Date(expiresAt);

  return {
    kind: "set",
    name: eventUnlockCookieName(slug),
    value: token,
    options: {
      path: "/",
      expires: Number.isNaN(expires.getTime()) ? undefined : expires,
      httpOnly: true,
      secure: production,
      sameSite: "lax"
    }
  };
}

export function mirroredSessionCookieMutation(
  headers: Headers,
  expectedName: string
): CookieMutation | null {
  const parsed = setCookieHeaders(headers)
    .map(parseSetCookie)
    .find((cookie) => cookie?.name === expectedName);

  if (!parsed) {
    return null;
  }
  if (
    (parsed.maxAge !== undefined && parsed.maxAge <= 0) ||
    (parsed.expires !== undefined && parsed.expires.getTime() <= Date.now())
  ) {
    return { kind: "delete", name: parsed.name, options: { path: parsed.path ?? "/" } };
  }

  return {
    kind: "set",
    name: parsed.name,
    value: parsed.value,
    options: {
      path: parsed.path ?? "/",
      expires: parsed.expires,
      maxAge: parsed.maxAge,
      httpOnly: parsed.httpOnly,
      secure: parsed.secure,
      sameSite: parsed.sameSite ?? "lax"
    }
  };
}

function setCookieHeaders(headers: Headers): string[] {
  const extended = headers as Headers & { getSetCookie?: () => string[] };
  const values = extended.getSetCookie?.();
  if (values && values.length > 0) {
    return values;
  }

  const value = headers.get("set-cookie");
  return value ? [value] : [];
}

function parseSetCookie(header: string): ParsedCookie | null {
  const [nameValue = "", ...attributes] = header
    .split(";")
    .map((part) => part.trim());
  const separator = nameValue.indexOf("=");
  if (separator < 1) {
    return null;
  }

  const parsed: ParsedCookie = {
    name: nameValue.slice(0, separator),
    value: nameValue.slice(separator + 1),
    httpOnly: false,
    secure: false
  };

  for (const attribute of attributes) {
    const attributeSeparator = attribute.indexOf("=");
    const key = (attributeSeparator < 0
      ? attribute
      : attribute.slice(0, attributeSeparator)
    ).toLowerCase();
    const value = attributeSeparator < 0 ? "" : attribute.slice(attributeSeparator + 1);

    if (key === "path") {
      parsed.path = value;
    } else if (key === "expires") {
      const expires = new Date(value);
      if (!Number.isNaN(expires.getTime())) parsed.expires = expires;
    } else if (key === "max-age") {
      const maxAge = Number.parseInt(value, 10);
      if (Number.isFinite(maxAge)) parsed.maxAge = maxAge;
    } else if (key === "httponly") {
      parsed.httpOnly = true;
    } else if (key === "secure") {
      parsed.secure = true;
    } else if (key === "samesite") {
      const sameSite = value.toLowerCase();
      if (sameSite === "lax" || sameSite === "strict" || sameSite === "none") {
        parsed.sameSite = sameSite;
      }
    }
  }

  return parsed;
}
