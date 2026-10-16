import { Link } from "@tanstack/react-router";
import { LayoutDashboard, Trash2, UserRound } from "lucide-react";

/**
 * The signed-in person's settings pages, as the left column of the settings
 * layout (reference sheets 06 and 09). The router marks the current page with
 * `aria-current="page"`, which the account CSS highlights. On a phone the
 * links sit in one row above the page.
 */
export function SettingsNav() {
  return (
    <nav aria-label="Settings" className="settings-nav">
      <p className="settings-nav__heading">Account settings</p>
      <ul>
        <li>
          <Link to="/settings/profile">
            <UserRound aria-hidden="true" size={18} strokeWidth={2} />
            Profile
          </Link>
        </li>
        <li>
          <Link to="/account">
            <LayoutDashboard aria-hidden="true" size={18} strokeWidth={2} />
            Account
          </Link>
        </li>
        <li>
          <Link className="settings-nav__danger" to="/settings/delete-account">
            <Trash2 aria-hidden="true" size={18} strokeWidth={2} />
            Delete account
          </Link>
        </li>
      </ul>
    </nav>
  );
}
