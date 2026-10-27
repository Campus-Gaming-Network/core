import { publicPageHead } from "../../components/public-page-head.js";
import type { VerifyEmailSearch } from "./contracts.js";

/** Head for a login, signup, or password page. None of them belong in search. */
export function authPageHead(
  publicOrigin: string | undefined,
  options: {
    title: string;
    description: string;
    path: `/${string}`;
    noIndex?: boolean;
  },
) {
  return publicPageHead(publicOrigin, { ...options, noIndex: true });
}

/**
 * What the verify-email page says for a search. A visit without a token, such
 * as the redirect after a resend without JavaScript, asks for an email instead
 * of reporting a broken link.
 */
export function verifyEmailCopy(search: VerifyEmailSearch): {
  heading: string;
  message: { role: "status" | "lede" | "alert"; text: string };
} {
  if (search.verified === "complete") {
    return {
      heading: "Your email is verified",
      message: {
        role: "status",
        text: "Your email is verified. You can log in now.",
      },
    };
  }
  if (search.token && !search.error) {
    return {
      heading: "Confirm your email",
      message: {
        role: "lede",
        text: "Almost there. Select Verify email to confirm your address.",
      },
    };
  }
  if (!search.token && !search.error) {
    return {
      heading: "Send a new verification email",
      message: {
        role: "lede",
        text: "Enter the email you signed up with and we will send another verification link.",
      },
    };
  }
  return {
    heading: "We could not verify that link",
    message: {
      role: "alert",
      text: search.error
        ? "That link is invalid or has expired. Enter your email to get a new one."
        : "This verification link is incomplete. Enter your email to get a new one.",
    },
  };
}

export function resendVerificationMessage(status?: "sent" | "failed"): string {
  if (status === "sent") {
    return "If that account needs verification, another email is on the way.";
  }
  if (status === "failed") {
    return "We could not resend verification. Please try again.";
  }
  return "";
}
