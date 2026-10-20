import { Link, useRouterState } from "@tanstack/react-router";
import { Menu, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

/**
 * The site's one set of global destinations, inside the header's main
 * navigation landmark. Clubs, People, and a Universities rename wait on those
 * features (see the design handoff audit), so only existing pages are listed.
 *
 * From the phone breakpoint down the links collapse behind a Menu button, a
 * disclosure like the account menu: plain links, Tab walks through them, and it
 * closes on Escape (returning focus to the button), on a press or focus outside
 * it, on picking a link, and on any navigation. Wider, the button is hidden and
 * the links sit in the header. Without script the links always show (see the
 * `noscript` style in the root route).
 */
export function SiteNavigation() {
  const href = useRouterState({ select: (state) => state.location.href });
  // Open for one location only, so navigating away closes it.
  const [openAt, setOpenAt] = useState<string | null>(null);
  if (openAt !== null && openAt !== href) setOpenAt(null);
  const open = openAt === href;
  const rootRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const listId = useId();

  useEffect(() => {
    if (!open) return;

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setOpenAt(null);
      toggleRef.current?.focus();
    }
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
    // Choosing the page already shown does not change the location.
    setOpenAt(null);
  }

  return (
    <div className="site-nav" ref={rootRef}>
      <button
        aria-controls={listId}
        aria-expanded={open}
        aria-label="Main menu"
        className="site-nav__toggle"
        onClick={() => setOpenAt(open ? null : href)}
        ref={toggleRef}
        type="button"
      >
        {open ? (
          <X aria-hidden="true" size={22} strokeWidth={2} />
        ) : (
          <Menu aria-hidden="true" size={22} strokeWidth={2} />
        )}
      </button>
      <ul className="site-nav__links" data-open={open} id={listId}>
        <li>
          <Link activeOptions={{ exact: true }} onClick={closeAfterLink} to="/">
            Home
          </Link>
        </li>
        <li>
          <Link onClick={closeAfterLink} to="/events">
            Events
          </Link>
        </li>
        <li>
          <Link onClick={closeAfterLink} to="/teams">
            Teams
          </Link>
        </li>
        <li>
          <Link onClick={closeAfterLink} to="/clubs">
            Clubs
          </Link>
        </li>
        <li>
          <Link onClick={closeAfterLink} to="/schools">
            Schools
          </Link>
        </li>
      </ul>
    </div>
  );
}
