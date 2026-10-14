import type { PageNotice } from "../../components/page-notice.js";
import { pageHead } from "../../components/public-page-head.js";

export const accountNotices = {
  "delete-failed": {
    message: "We could not delete your account. Please try again.",
    severity: "danger",
  },
} as const satisfies Record<string, PageNotice>;

export const settingsNotices = {
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

export function settingsProfileHead(publicOrigin?: string) {
  return pageHead(publicOrigin, {
    title: "Edit profile",
    description: "Edit your public Campus Gaming Network profile.",
    path: "/settings/profile",
    noIndex: true,
  });
}

export function accountHead(publicOrigin?: string) {
  return pageHead(publicOrigin, {
    title: "Account",
    description: accountDescription,
    path: "/account",
    noIndex: true,
  });
}
