const siteName = "Campus Gaming Network";
const accountDescription =
  "Manage your Campus Gaming Network profile, home school, and followed schools.";

export function accountHead(publicOrigin = "http://localhost:3100") {
  const title = `Account | ${siteName}`;

  return {
    meta: [
      { title },
      { name: "description", content: accountDescription },
      { name: "robots", content: "noindex,nofollow" },
      { property: "og:type", content: "website" },
      { property: "og:site_name", content: siteName },
      { property: "og:title", content: title },
      { property: "og:description", content: accountDescription },
      { property: "og:url", content: `${publicOrigin}/account` },
      { name: "twitter:card", content: "summary" },
      { name: "twitter:title", content: title },
      { name: "twitter:description", content: accountDescription }
    ]
  };
}
