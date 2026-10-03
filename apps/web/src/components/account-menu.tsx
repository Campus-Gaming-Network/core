import { ChevronDown } from "lucide-react";
import { Link, useRouterState } from "@tanstack/react-router";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { logout } from "../features/event-slice/auth.functions";
import type { NavigationViewer } from "../features/event-slice/contracts";
import { Avatar } from "./avatar";

/**
 * The signed-in header's account menu: the viewer's avatar and first name open
 * a disclosure with Account, Public profile, and Log out. It renders only once
 * the client has learned who the viewer is, because the server HTML is
 * viewer-neutral.
 *
 * The panel is a disclosure of plain links and a native POST form, not an ARIA
 * menu, so it asks for no arrow-key handling: Tab walks through it. It closes
 * on Escape (returning focus to the trigger), on a pointer press or focus
 * outside it, on picking a link, and on any navigation.
 */
export function AccountMenu({
  viewer,
  logoutError,
  logoutPending,
  onLogout,
}: {
  viewer: NavigationViewer;
  logoutError: string;
  logoutPending: boolean;
  onLogout: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const href = useRouterState({ select: (state) => state.location.href });
  // The menu is open for one location only. Moving to another location resets
  // it during render, so coming back later does not find it still open.
  const [openAt, setOpenAt] = useState<string | null>(null);
  if (openAt !== null && openAt !== href) setOpenAt(null);
  const open = openAt === href;
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const name = viewer.name.trim();

  useEffect(() => {
    if (!open) return;

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setOpenAt(null);
      triggerRef.current?.focus();
    }
    // Pressing or focusing anything outside the menu closes it. focusin, not
    // blur, so a click inside the menu that does not move focus (Safari does
    // not focus buttons) cannot close it before the click lands.
    function closeOutside(event: Event) {
      if (
        event.target instanceof Node &&
        !rootRef.current?.contains(event.target)
      ) {
        setOpenAt(null);
      }
    }

    document.addEventListener("keydown", closeOnEscape);
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("focusin", closeOutside);
    return () => {
      document.removeEventListener("keydown", closeOnEscape);
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("focusin", closeOutside);
    };
  }, [open]);

  function closeAfterLink() {
    // Choosing the page already shown does not change the location, and the
    // clicked link is about to be hidden, so close and keep focus visible.
    setOpenAt(null);
    triggerRef.current?.focus();
  }

  return (
    <div className="account-menu" ref={rootRef}>
      <button
        aria-controls={panelId}
        aria-expanded={open}
        aria-label={name ? `${name}, account menu` : "Account menu"}
        className="account-menu__trigger"
        onClick={() => setOpenAt(open ? null : href)}
        ref={triggerRef}
        type="button"
      >
        <Avatar id={viewer.id} name={name} size="small" />
        <span className="account-menu__name">
          {name.split(/\s+/)[0] || "Account"}
        </span>
        <ChevronDown
          aria-hidden="true"
          className="account-menu__chevron"
          size={16}
          strokeWidth={2}
        />
      </button>
      <div className="account-menu__panel" hidden={!open} id={panelId}>
        <Link
          className="account-menu__item"
          onClick={closeAfterLink}
          to="/account"
        >
          Account
        </Link>
        <Link
          className="account-menu__item"
          onClick={closeAfterLink}
          params={{ id: viewer.id }}
          to="/users/$id"
        >
          Public profile
        </Link>
        <form
          action={logout.url}
          className="logout-form"
          method="post"
          onSubmit={onLogout}
        >
          {logoutError ? <p role="alert">{logoutError}</p> : null}
          <button
            className="account-menu__item"
            disabled={logoutPending}
            type="submit"
          >
            {logoutPending ? "Logging out…" : "Log out"}
          </button>
        </form>
      </div>
    </div>
  );
}
