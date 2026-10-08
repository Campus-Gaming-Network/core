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
import { socialSite, type SocialSite } from "./social-sites.js";

// Brand marks ship with the app as path data; nothing is fetched.
const sitePaths: Record<SocialSite, string> = {
  bluesky: siBluesky.path,
  discord: siDiscord.path,
  facebook: siFacebook.path,
  github: siGithub.path,
  instagram: siInstagram.path,
  kick: siKick.path,
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
export function SocialLinkIcon({ url }: { url: string }) {
  const site = socialSite(url);
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
