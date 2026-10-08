// The sites a profile link gets its own icon for, each with the hosts that
// belong to it. A host matches itself and its subdomains.
const socialSiteHosts = {
  bluesky: ["bsky.app"],
  discord: ["discord.gg", "discord.com"],
  facebook: ["facebook.com", "fb.com"],
  github: ["github.com"],
  instagram: ["instagram.com"],
  kick: ["kick.com"],
  reddit: ["reddit.com"],
  steam: ["steamcommunity.com", "steampowered.com"],
  tiktok: ["tiktok.com"],
  twitch: ["twitch.tv"],
  x: ["x.com", "twitter.com"],
  youtube: ["youtube.com", "youtu.be"],
} as const;

export type SocialSite = keyof typeof socialSiteHosts;

/** The known site a link points at, or undefined for any other link. */
export function socialSite(url: string): SocialSite | undefined {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return undefined;
  }
  for (const [site, hosts] of Object.entries(socialSiteHosts)) {
    if (hosts.some((known) => host === known || host.endsWith(`.${known}`))) {
      return site as SocialSite;
    }
  }
  return undefined;
}
