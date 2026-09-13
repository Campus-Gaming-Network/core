const siteName = "Campus Gaming Network";
const localOrigin = "http://localhost:3000";

type PublicPageHeadOptions = {
  description: string;
  path: `/${string}`;
  title: string;
};

export function publicPageHead(
  publicOrigin: string | undefined,
  { description, path, title }: PublicPageHeadOptions
) {
  const fullTitle = `${title} | ${siteName}`;

  return {
    meta: [
      { title: fullTitle },
      { name: "description", content: description },
      { property: "og:type", content: "website" },
      { property: "og:site_name", content: siteName },
      { property: "og:title", content: fullTitle },
      { property: "og:description", content: description },
      {
        property: "og:url",
        content: `${publicOrigin ?? localOrigin}${path}`
      },
      { name: "twitter:card", content: "summary" },
      { name: "twitter:title", content: fullTitle },
      { name: "twitter:description", content: description }
    ]
  };
}
