import { publicPageHead } from "../../components/public-page-head.js";

export function authPageHead(
  publicOrigin: string | undefined,
  options: {
    title: string;
    description: string;
    path: `/${string}`;
    noIndex?: boolean;
  }
) {
  const head = publicPageHead(publicOrigin, options);
  return options.noIndex
    ? {
        ...head,
        meta: [
          ...head.meta,
          { name: "robots", content: "noindex,nofollow" }
        ]
      }
    : head;
}
