import { Link } from "@tanstack/react-router";
import { ArrowRight, School } from "lucide-react";
import type { DirectorySidebarResult } from "../features/account-slice/contracts";
import { schoolLocation } from "../features/school-slice/presentation";
import { SchoolLogo } from "./school-logo";

/**
 * The home page's left column (reference sheet 12): the viewer's home school
 * and the first schools they follow. It holds no section links; the header is
 * the one global navigation. A visitor, or a viewer whose school data could
 * not load, gets no column and the page uses the full width. A home school is
 * chosen at signup and cannot be changed yet (#249), so the block has no
 * "Change" link. A long school name ends in an ellipsis and its link's title
 * gives the full name. Below the tablet width the column is hidden. Render it
 * after the main content, so the page's h1 is the first heading; the
 * `.layout-with-sidebar` grid places it on the left. Styles live in
 * components.css.
 */
export function DirectorySidebar({
  sidebar,
}: {
  sidebar: DirectorySidebarResult;
}) {
  if (sidebar.status !== "found") return null;

  return (
    <aside aria-label="Your schools" className="directory-sidebar">
      <SchoolBlocks sidebar={sidebar} />
    </aside>
  );
}

function SchoolBlocks({
  sidebar,
}: {
  sidebar: Extract<DirectorySidebarResult, { status: "found" }>;
}) {
  return (
    <>
      {sidebar.homeSchool ? (
        <section
          aria-labelledby="directory-sidebar-home"
          className="directory-sidebar__block"
        >
          <h2 id="directory-sidebar-home">Your school</h2>
          <Link
            className="directory-sidebar__home"
            to="/schools/$slug"
            params={{ slug: sidebar.homeSchool.slug }}
            title={sidebar.homeSchool.name}
          >
            <span aria-hidden="true" className="school-directory-mark">
              {sidebar.homeSchool.name.slice(0, 1).toUpperCase()}
              <SchoolLogo logoURL={sidebar.homeSchool.logo_url} size={36} />
            </span>
            <span>
              <strong>{sidebar.homeSchool.name}</strong>
              <small>{schoolLocation(sidebar.homeSchool, "")}</small>
            </span>
          </Link>
        </section>
      ) : null}

      <section
        aria-labelledby="directory-sidebar-followed"
        className="directory-sidebar__block"
      >
        <h2 id="directory-sidebar-followed">Schools you follow</h2>
        {sidebar.followedSchools.length > 0 ? (
          <ul className="directory-sidebar__followed">
            {sidebar.followedSchools.map((school) => (
              <li key={school.id}>
                <Link
                  params={{ slug: school.slug }}
                  title={school.name}
                  to="/schools/$slug"
                >
                  <span
                    aria-hidden="true"
                    className="school-directory-mark directory-sidebar__followed-mark"
                  >
                    <School size={14} strokeWidth={2} />
                    <SchoolLogo logoURL={school.logo_url} size={24} />
                  </span>
                  <span>{school.name}</span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="directory-sidebar__empty">
            Follow a school from its page to see it here.
          </p>
        )}
        {sidebar.moreFollowedSchools ? (
          <Link
            className="link with-arrow"
            to="/account"
            hash="followed-schools"
          >
            See all followed schools
            <ArrowRight aria-hidden="true" size={14} strokeWidth={2.25} />
          </Link>
        ) : null}
      </section>
    </>
  );
}
