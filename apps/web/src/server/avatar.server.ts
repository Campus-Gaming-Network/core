import BoringAvatar from "boring-avatars";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// Avatars are where the page gets most of its color, so the palette is bright:
// the product's amber and royal blue plus an emerald, a coral, and a sky blue.
// None is black or near-black. The avatar is rendered here so the browser never
// contacts an avatar service or learns another seed.
const avatarColors = ["#ffbe18", "#1f4ed8", "#16b384", "#ff6b57", "#4cc9f0"];

// Real ids are UUIDs. The shape check keeps the seed short and free of path or
// markup characters; it does not look anything up, so an id that belongs to no
// account gets an avatar like any other and reveals nothing about accounts.
const seedPattern = /^[A-Za-z0-9_-]{1,64}$/;

const svgHeaders = {
  "content-type": "image/svg+xml; charset=utf-8",
  // The picture is a pure function of the id and the pinned library, so it may
  // be cached by anyone for a day.
  "cache-control": "public, max-age=86400, stale-while-revalidate=604800",
  "x-content-type-options": "nosniff",
  // Even opened directly, a generated avatar can run no script or load nothing.
  "content-security-policy":
    "default-src 'none'; style-src 'unsafe-inline'; sandbox",
} as const;

export function avatarResponse(id: string): Response {
  if (!seedPattern.test(id)) return new Response(null, { status: 404 });

  const svg = renderToStaticMarkup(
    createElement(BoringAvatar, {
      colors: avatarColors,
      name: id.toLowerCase(),
      size: 80,
      variant: "beam",
    }),
  );
  return new Response(svg, { status: 200, headers: svgHeaders });
}

export function avatarMethodNotAllowedResponse(): Response {
  return new Response(null, {
    status: 405,
    headers: { allow: "GET, HEAD" },
  });
}
