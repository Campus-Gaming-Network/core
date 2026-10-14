import { publicPageHead } from "../../components/public-page-head.js";

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
