import { Link } from "@tanstack/react-router";
import { ArrowRight, CalendarDays, School, Users } from "lucide-react";
import type { DirectorySidebarResult } from "../features/account-slice/contracts";
import { schoolLocation } from "../features/school-slice/presentation";
import { SchoolLogo } from "./school-logo";

export type DirectorySection = "events" | "teams" | "schools";

const sections = [
  { key: "events", label: "Events", to: "/events", Icon: CalendarDays },
  { key: "teams", label: "Teams", to: "/teams", Icon: Users },
  { key: "schools", label: "Schools", to: "/schools", Icon: School },
] as const;

/**
 * The left sidebar of the event, team, and school directories: links to the
 * three directories with the current one marked, then the viewer's home school
 * and the first schools they follow. A visitor gets a log-in link instead, and
 * a viewer whose school data could not load gets the section links only.
 * A home school is chosen at signup and cannot be changed yet, so the block
 * has no "Change" link.
 * It is the first child of the directory's `<main className="directory-page">`;
 * below the tablet breakpoint it is hidden and the header is the navigation.
 * Styles live in components.css.
 */
export function DirectorySidebar({
  current,
  sidebar,
}: {
  current: DirectorySection;
  sidebar: DirectorySidebarResult;
}) {
  return (
    <aside aria-label="Directory" className="directory-sidebar">
      <nav aria-label="Directories">
        <ul className="directory-sidebar__sections">
          {sections.map(({ key, label, to, Icon }) => (
            <li key={key}>
              <Link aria-current={key === current ? "page" : undefined} to={to}>
                <Icon aria-hidden="true" size={18} strokeWidth={1.75} />
                {label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      {sidebar.status === "visitor" ? (
        <p className="directory-sidebar__block">
          <Link className="link" to="/login" search={{ next: `/${current}` }}>
            Log in to see your school
          </Link>
        </p>
      ) : null}

      {sidebar.status === "found" ? (
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
                    <Link to="/schools/$slug" params={{ slug: school.slug }}>
                      <SchoolLogo inline logoURL={school.logo_url} size={20} />
                      {school.name}
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
      ) : null}
    </aside>
  );
}
