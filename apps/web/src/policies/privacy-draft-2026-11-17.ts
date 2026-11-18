import type { PolicyDocument } from "./policy-document.js";

export const privacyDraft20261117: PolicyDocument = {
  type: "privacy",
  version: "draft-2026-11-17",
  effectiveAt: "2026-11-17T00:00:00Z",
  heading: "Privacy placeholder",
  lede: "Campus Gaming Network stores account, profile, school, and session information. A reviewed privacy policy is still required before public launch.",
  paragraphs: [
    "This stub exists so the route is present during Phase 1 UI work without pretending legal copy has been finalized.",
  ],
  sections: [
    {
      id: "cookies",
      heading: "Cookies",
      paragraphs: [
        "Campus Gaming Network sets only the cookies the site needs to work. We do not use advertising or tracking cookies, and we do not let other companies set cookies on our site. Because every cookie is needed for something you asked for, the site does not ask for cookie consent.",
        "cgn_session keeps you signed in. It is set when you log in, removed when you log out, and expires after 30 days.",
        "cgn_event_unlock_<event> remembers that you entered the password for a private event, so you are not asked again. It expires after 24 hours.",
        "cgn_signup_email carries the email address you signed up with to the confirmation screen, so it never appears in the page address. It expires after 10 minutes.",
        "These cookies cannot be read by scripts on the page and are sent only to Campus Gaming Network. If you block them, you cannot sign in, open private events, or finish signing up.",
      ],
    },
    {
      id: "analytics-and-error-reports",
      heading: "Analytics and error reports",
      paragraphs: [
        "We count page visits with Plausible Analytics, which sets no cookies and stores nothing on your device. Visit data passes through our own site on its way to Plausible. Your IP address and browser type are used to count unique visitors and are not stored. Codes in page addresses, such as password-reset links, are removed before the data is sent.",
        "When the site hits an error in your browser, it sends an error report to Sentry. The report includes the error and the page address with sensitive codes removed. It contains no cookies, and the site sends Sentry nothing when there is no error.",
      ],
    },
  ],
};
