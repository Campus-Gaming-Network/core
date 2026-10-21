import { Link as LinkIcon } from "lucide-react";
import {
  siBluesky,
  siDiscord,
  siFacebook,
  siGithub,
  siInstagram,
  siKick,
  siReddit,
  siSteam,
  siTiktok,
  siTwitch,
  siX,
  siYoutube,
} from "simple-icons";
import type { SocialSite } from "./social-sites.js";

// simple-icons no longer ships a LinkedIn mark, so this is its last published
// path, on the same 24x24 grid as the others.
const linkedinPath =
  "M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.06 2.06 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065m1.782 13.019H3.555V9h3.564zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0z";

// Brand marks ship with the app as path data; nothing is fetched.
const sitePaths: Record<SocialSite, string> = {
  bluesky: siBluesky.path,
  discord: siDiscord.path,
  facebook: siFacebook.path,
  github: siGithub.path,
  instagram: siInstagram.path,
  kick: siKick.path,
  linkedin: linkedinPath,
  reddit: siReddit.path,
  steam: siSteam.path,
  tiktok: siTiktok.path,
  twitch: siTwitch.path,
  x: siX.path,
  youtube: siYoutube.path,
};

/**
 * The icon for a profile link: the site's mark for a known site, a chain link
 * for any other. It is decorative; the link's text names it.
 */
export function SocialLinkIcon({ site }: { site: SocialSite | undefined }) {
  if (!site) {
    return <LinkIcon aria-hidden="true" data-site="link" size={16} />;
  }
  return (
    <svg
      aria-hidden="true"
      data-site={site}
      fill="currentColor"
      height={16}
      viewBox="0 0 24 24"
      width={16}
    >
      <path d={sitePaths[site]} />
    </svg>
  );
}
