import type { PageNotice } from "../../components/page-notice.js";

const siteName = "Campus Gaming Network";

export const accountNotices = {
  "delete-failed": {
    message: "We could not delete your account. Please try again.",
    severity: "danger",
  },
  "profile-failed": {
    message: "We could not update your profile. Please try again.",
    severity: "danger",
  },
  "profile-updated": { message: "Profile updated.", severity: "success" },
} as const satisfies Record<string, PageNotice>;

// Account deletion ends the session and redirects to the home page.
export const homeAccountNotices = {
  deleted: { message: "Your account was deleted.", severity: "success" },
} as const satisfies Record<string, PageNotice>;
const accountDescription =
  "Manage your Campus Gaming Network profile, home school, and followed schools.";

export function accountHead(publicOrigin = "http://localhost:3000") {
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
      { name: "twitter:description", content: accountDescription },
    ],
  };
}
