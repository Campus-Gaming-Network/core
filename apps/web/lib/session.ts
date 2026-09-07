export function sessionCookieName() {
  return process.env.API_SESSION_COOKIE ?? "cgn_session";
}

export function hasSessionCookie(
  cookieHeader: string,
  cookieName = sessionCookieName()
) {
  return cookieHeader.split(";").some((pair) => {
    const separator = pair.indexOf("=");
    if (separator < 0) {
      return false;
    }

    const name = pair.slice(0, separator).trim();
    const value = pair.slice(separator + 1).trim();

    return name === cookieName && value.length > 0;
  });
}
