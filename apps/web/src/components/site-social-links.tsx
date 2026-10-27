import { SocialLinkIcon } from "../features/public-profile/social-link-icon.js";
import { socialSite } from "../features/public-profile/social-sites.js";

type SocialAccount = { name: string; url: string };

export const cgnSocialAccounts: readonly SocialAccount[] = [
  { name: "Discord", url: "https://discord.gg/cG2uTEt3tc" },
  { name: "Instagram", url: "https://www.instagram.com/campusgamingnetwork/" },
  { name: "X", url: "https://x.com/CampusGamingNet" },
  { name: "Facebook", url: "https://www.facebook.com/campusgamingnetwork/" },
  {
    name: "LinkedIn",
    url: "https://www.linkedin.com/company/campus-gaming-network/",
  },
  { name: "GitHub", url: "https://github.com/Campus-Gaming-Network" },
];

export function SiteSocialLinks({
  accounts = cgnSocialAccounts,
}: {
  accounts?: readonly SocialAccount[];
}) {
  if (accounts.length === 0) {
    return null;
  }
  return (
    <ul aria-label="Campus Gaming Network elsewhere" className="site-social">
      {accounts.map((account) => (
        <li key={account.url}>
          <a
            aria-label={`Campus Gaming Network on ${account.name}`}
            href={account.url}
            rel="noopener noreferrer"
            target="_blank"
          >
            <SocialLinkIcon site={socialSite(account.url)} />
          </a>
        </li>
      ))}
    </ul>
  );
}
