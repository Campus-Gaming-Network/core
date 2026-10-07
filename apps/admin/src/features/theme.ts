import { createIsomorphicFn } from "@tanstack/react-start";
import { getCookie } from "@tanstack/react-start/server";

export type ColorTheme = "dark" | "light";

const themeCookie = "cgn_admin_theme";
const themeCookieLifetimeSeconds = 60 * 60 * 24 * 365;

const storedTheme = createIsomorphicFn()
  .server(() => normalizeTheme(getCookie(themeCookie)))
  .client(() => themeFromCookie(document.cookie));

/** Returns the persisted theme during both SSR and hydration. */
export function initialColorTheme(): ColorTheme {
  return storedTheme() ?? "light";
}

/** Switches the document immediately and persists the choice for future SSR. */
export function toggleColorTheme(): void {
  const current = normalizeTheme(document.documentElement.dataset.theme);
  const next = nextColorTheme(current ?? "light");
  const root = document.documentElement;
  root.dataset.themeSwitching = "";
  root.dataset.theme = next;
  // Reading a computed style applies the new colors before transitions return.
  void getComputedStyle(root).color;
  delete root.dataset.themeSwitching;
  document.cookie = [
    `${themeCookie}=${next}`,
    `Max-Age=${themeCookieLifetimeSeconds}`,
    "Path=/",
    "SameSite=Strict",
    location.protocol === "https:" ? "Secure" : "",
  ]
    .filter(Boolean)
    .join("; ");
}

export function nextColorTheme(theme: ColorTheme): ColorTheme {
  return theme === "dark" ? "light" : "dark";
}

export function themeFromCookie(cookieHeader: string): ColorTheme | undefined {
  const value = cookieHeader
    .split(";")
    .map((entry) => entry.trim().split("=", 2))
    .find(([name]) => name === themeCookie)?.[1];
  return normalizeTheme(value);
}

function normalizeTheme(value: string | undefined): ColorTheme | undefined {
  return value === "dark" || value === "light" ? value : undefined;
}
