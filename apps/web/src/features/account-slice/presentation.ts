import type { PageNotice } from "../../components/page-notice.js";
import { pageHead } from "../../components/public-page-head.js";

// The delete account page shows a failed deletion after a native form post.
export const deleteAccountNotices = {
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
  "games-updated": { message: "Your games were updated.", severity: "success" },
  "games-failed": {
    message: "We could not update your games. Please try again.",
    severity: "danger",
  },
  "favorite-add-failed": {
    message:
      "You can list five favorite games. Remove one before you add another.",
    severity: "danger",
  },
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

export function deleteAccountHead(publicOrigin?: string) {
  return pageHead(publicOrigin, {
    title: "Delete account",
    description: "Permanently delete your Campus Gaming Network account.",
    path: "/settings/delete-account",
    noIndex: true,
  });
}

/** Head for the signed-in viewer's own pages, kept out of search. */
export function yourPageHead(
  publicOrigin: string | undefined,
  page: "events" | "teams",
) {
  const pages = {
    events: {
      title: "Your events",
      description:
        "Events you are going to, might go to, or are interested in.",
    },
    teams: {
      title: "Your teams",
      description: "The teams you belong to on Campus Gaming Network.",
    },
  } as const;
  return pageHead(publicOrigin, {
    ...pages[page],
    path: `/account/${page}`,
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
