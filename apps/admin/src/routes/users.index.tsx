import { Link, createFileRoute } from "@tanstack/react-router";
import {
  CatalogFilters,
  CursorPagination,
  StateBadge,
} from "../features/catalog/catalog-components";
import { getUsers } from "../features/catalog/catalog.functions";
import {
  catalogListKinds,
  validateCatalogSearch,
} from "../features/catalog/contracts";

export const Route = createFileRoute("/users/")({
  validateSearch: validateCatalogSearch("users"),
  loaderDeps: ({ search }) => search,
  loader: ({ deps }) => getUsers({ data: deps }),
  staleTime: 0,
  head: () => ({ meta: [{ title: "Users | CGN Admin Console" }] }),
  component: UsersPage,
});

function UsersPage() {
  const page = Route.useLoaderData();
  const search = Route.useSearch();

  return (
    <div className="page-stack">
      <header className="page-header">
        <div>
          <p className="eyebrow">Accounts</p>
          <h1>Users</h1>
          <p>
            Find an account by email or name prefix. Account changes are named
            operations; there is no general account editor.
          </p>
        </div>
      </header>

      <CatalogFilters
        action="/users"
        label="Email or name"
        search={search}
        states={catalogListKinds.users}
      />

      {page.users.length ? (
        <section className="queue-list" aria-label="Users">
          {page.users.map((user) => (
            <Link
              className="queue-card"
              key={user.id}
              params={{ userId: user.id }}
              to="/users/$userId"
            >
              <span className="queue-card__topline">
                <strong>{user.name}</strong>
                <StateBadge state={user.account_status} />
              </span>
              <span>{user.email}</span>
              <span className="queue-card__meta">
                {[
                  user.site_admin ? "Site admin" : "",
                  user.school_admin_count
                    ? `School admin at ${user.school_admin_count}`
                    : "",
                  user.verification_level.replaceAll("_", " "),
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            </Link>
          ))}
        </section>
      ) : (
        <section className="empty-panel">
          <h2>No users match this search</h2>
          <p>Search needs at least two characters of an email or name.</p>
        </section>
      )}

      <CursorPagination
        label="User pages"
        path="/users"
        search={search}
        previousCursor={page.previous_cursor}
        nextCursor={page.next_cursor}
      />
    </div>
  );
}
