import type { Metadata } from "next";

export const siteName = "Campus Gaming Network";

type PageMetadataOptions = {
  title: string;
  description: string;
  path?: string;
  /**
   * Keep the page out of search results. Use for authenticated pages,
   * one-time token flows, and anything not meant to be discoverable.
   */
  noIndex?: boolean;
};

/**
 * Build page metadata with matching Open Graph and Twitter tags.
 *
 * The root layout sets a "%s | Campus Gaming Network" template for `title`,
 * but that template does not extend to Open Graph or Twitter titles, so those
 * are composed here to keep link previews consistent with the browser tab.
 */
export function pageMetadata({
  title,
  description,
  path,
  noIndex
}: PageMetadataOptions): Metadata {
  const sharedTitle = `${title} | ${siteName}`;

  return {
    title,
    description,
    ...(noIndex ? { robots: { index: false, follow: false } } : {}),
    openGraph: {
      type: "website",
      siteName,
      title: sharedTitle,
      description,
      ...(path ? { url: path } : {})
    },
    twitter: {
      card: "summary",
      title: sharedTitle,
      description
    }
  };
}
