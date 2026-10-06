/**
 * One published version of a policy. A published file is never edited: a
 * change is a new file with a new version, and the API records the SHA-256 of
 * each file so an edit to a published one is detected.
 */
export type PolicyDocument = {
  type: "terms" | "privacy";
  version: string;
  /** ISO 8601 instant the version took effect. */
  effectiveAt: string;
  heading: string;
  lede: string;
  paragraphs: readonly string[];
};
