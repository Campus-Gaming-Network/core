import type { PolicyDocument } from "./policy-document.js";
import { privacyDraft20261006 } from "./privacy-draft-2026-10-06.js";
import { termsDraft20261006 } from "./terms-draft-2026-10-06.js";

export type { PolicyDocument } from "./policy-document.js";

/**
 * Every published version of each policy, oldest first. The last entry is the
 * one shown when no version is asked for. Add a version by adding a file and
 * a row in a database migration; never edit a published file.
 */
const published: Record<PolicyDocument["type"], readonly PolicyDocument[]> = {
  terms: [termsDraft20261006],
  privacy: [privacyDraft20261006],
};

/** The named version of a policy, or its latest when none is named. */
export function policyDocument(
  type: PolicyDocument["type"],
  version?: string,
): PolicyDocument | undefined {
  const versions = published[type];
  return version === undefined
    ? versions.at(-1)
    : versions.find((document) => document.version === version);
}

export type PolicySearch = { version?: string };

export function validatePolicySearch(
  search: Record<string, unknown>,
): PolicySearch {
  const version = Array.isArray(search.version)
    ? search.version[0]
    : search.version;
  return typeof version === "string" &&
    /^[0-9a-z][0-9a-z.-]{0,39}$/.test(version)
    ? { version }
    : {};
}
