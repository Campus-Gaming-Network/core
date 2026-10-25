import { Link } from "@tanstack/react-router";
import { Gamepad2 } from "lucide-react";
import type { ReactNode } from "react";
import { SiteNavigation } from "./site-navigation";
import { SiteSocialLinks } from "./site-social-links";

/**
 * The header, the main content area, and the footer around every page. The
 * root's error view uses it too, so a failure at the root keeps the site's
 * navigation; there the viewer is unknown, so `account` is left out.
 */
export function SiteShell({
  account,
  children,
}: {
  account?: ReactNode;
  children: ReactNode;
}) {
  return (
    <>
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>
      <header className="site-header">
        <Link aria-label="Campus Gaming Network" className="brand" to="/">
          <span aria-hidden="true" className="brand-mark">
            <Gamepad2 size={18} strokeWidth={2.25} />
          </span>
          <span className="brand-name">CGN</span>
          <span className="brand-full">Campus Gaming Network</span>
        </Link>
        <nav aria-label="Main navigation">
          <SiteNavigation />
          {account}
        </nav>
      </header>
      <div id="main-content" tabIndex={-1}>
        {children}
      </div>
      <footer className="site-footer">
        <div className="site-footer__inner">
          <span className="site-footer__brand">
            <span aria-hidden="true" className="brand-mark">
              <Gamepad2 size={16} strokeWidth={2.25} />
            </span>
            Campus Gaming Network
          </span>
          <nav aria-label="Footer">
            <ul>
              <li>
                <Link to="/about">About</Link>
              </li>
              <li>
                <Link to="/faq">FAQ</Link>
              </li>
              <li>
                <Link to="/support">Support</Link>
              </li>
              <li>
                <Link to="/terms">Terms</Link>
              </li>
              <li>
                <Link to="/privacy">Privacy</Link>
              </li>
            </ul>
          </nav>
          <SiteSocialLinks />
        </div>
      </footer>
    </>
  );
}
