export const siteName = "Campus Gaming Network";
const localOrigin = "http://localhost:3000";

/** The preview image every page without a better one shares: 1200 by 630. */
const defaultPreviewImagePath = "/og-default.png";

export type PageHeadOptions = {
  description: string;
  /** The site-relative path; empty for the home page. */
  path: "" | `/${string}`;
  title: string;
  /** Use the title as given, without the site name after it. */
  bareTitle?: boolean;
  /** Keep crawlers out. A noindex page has no canonical link or structured data. */
  noIndex?: boolean;
  /** An absolute image that stands for this page. A logo gets the small card;
   * the default image gets the large one. */
  image?: string;
  /** What the image shows, for chat apps that read it aloud. */
  imageAlt?: string;
  /** The pages above this one, outermost first; the home page is added. */
  breadcrumbs?: Array<{ name: string; path: `/${string}` }>;
  /** schema.org data for crawlers; ignored on a noindex page. */
  jsonLd?: Record<string, unknown>;
};

const defaultPreviewImageAlt = `${siteName}: find campus gaming events, teams, and clubs near you`;

export type MetaTag = Record<string, unknown>;

export function absoluteUrl(
  publicOrigin: string | undefined,
  path: string,
): string {
  return `${publicOrigin ?? localOrigin}${path}`;
}

/**
 * The head of a page: title, description, canonical link, Open Graph and
 * Twitter card tags, and optional JSON-LD. Every route that sets its own head
 * builds it here, so a link pasted in a chat shows the same card everywhere.
 */
export function pageHead(
  publicOrigin: string | undefined,
  {
    bareTitle = false,
    description,
    image,
    imageAlt,
    breadcrumbs,
    jsonLd,
    noIndex = false,
    path,
    title,
  }: PageHeadOptions,
): { meta: MetaTag[]; links: Array<Record<string, string>> } {
  const fullTitle = bareTitle ? title : `${title} | ${siteName}`;
  const url = absoluteUrl(publicOrigin, path);
  // A page kept out of search is not meant to be shared, so it gets no image.
  const previewImage =
    image ??
    (noIndex ? undefined : absoluteUrl(publicOrigin, defaultPreviewImagePath));
  const largeCard = image === undefined && !noIndex;
  const previewAlt = image === undefined ? defaultPreviewImageAlt : imageAlt;
  const imageTags = previewImage
    ? [
        { property: "og:image", content: previewImage },
        ...(previewAlt
          ? [{ property: "og:image:alt", content: previewAlt }]
          : []),
        ...(image === undefined
          ? [
              { property: "og:image:width", content: "1200" },
              { property: "og:image:height", content: "630" },
            ]
          : []),
      ]
    : [];

  return {
    meta: [
      { title: fullTitle },
      { name: "description", content: description },
      ...(noIndex ? [{ name: "robots", content: "noindex,nofollow" }] : []),
      { property: "og:type", content: "website" },
      { property: "og:site_name", content: siteName },
      { property: "og:title", content: fullTitle },
      { property: "og:description", content: description },
      { property: "og:url", content: url },
      ...imageTags,
      {
        name: "twitter:card",
        content: largeCard ? "summary_large_image" : "summary",
      },
      { name: "twitter:title", content: fullTitle },
      { name: "twitter:description", content: description },
      ...(previewImage
        ? [{ name: "twitter:image", content: previewImage }]
        : []),
      ...(previewImage && previewAlt
        ? [{ name: "twitter:image:alt", content: previewAlt }]
        : []),
      ...(jsonLd && !noIndex ? [{ "script:ld+json": jsonLd }] : []),
      ...(breadcrumbs && !noIndex
        ? [
            {
              "script:ld+json": breadcrumbList(publicOrigin, [
                { name: "Home", path: "" },
                ...breadcrumbs,
                { name: title, path },
              ]),
            },
          ]
        : []),
    ],
    links: noIndex ? [] : [{ rel: "canonical", href: url }],
  };
}

/** schema.org BreadcrumbList for a trail of pages, outermost first. */
function breadcrumbList(
  publicOrigin: string | undefined,
  trail: Array<{ name: string; path: "" | `/${string}` }>,
): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: trail.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: absoluteUrl(publicOrigin, item.path),
    })),
  };
}

/** Head for a page every visitor may open, with the shared options. */
export function publicPageHead(
  publicOrigin: string | undefined,
  options: PageHeadOptions,
) {
  return pageHead(publicOrigin, options);
}

/** A description cut to what a chat preview shows, at a word boundary. */
export function previewText(value: string, limit = 200): string {
  const text = value.replace(/\s+/g, " ").trim();
  if (text.length <= limit) return text;
  const cut = text.slice(0, limit - 1);
  const boundary = cut.lastIndexOf(" ");
  return `${(boundary > limit / 2 ? cut.slice(0, boundary) : cut).trimEnd()}…`;
}
