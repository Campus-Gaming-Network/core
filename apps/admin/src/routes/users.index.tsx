import { Link, createFileRoute } from "@tanstack/react-router";
import { DataTable, dataColumn } from "../components/data-table";
import {
  CatalogFilters,
  CursorPagination,
  StateBadge,
} from "../features/catalog/catalog-components";
import { getUsers } from "../features/catalog/catalog.functions";
import {
  catalogListKinds,
  validateCatalogSearch,
  verificationFilters,
  type AdminUser,
} from "../features/catalog/contracts";

export const Route = createFileRoute("/users/")({
  validateSearch: validateCatalogSearch("users"),
  loaderDeps: ({ search }) => search,
  loader: ({ deps }) => getUsers({ data: deps }),
  staleTime: 0,
  head: () => ({ meta: [{ title: "Users | CGN Admin Console" }] }),
  component: UsersPage,
});

const userColumns = [
  dataColumn<AdminUser>({
    id: "name",
    header: "Name",
    sortValue: (row) => row.name,
    cell: (row) => (
      <Link
        className="data-table__primary"
        params={{ userId: row.id }}
        to="/users/$userId"
      >
        {row.name}
      </Link>
    ),
  }),
  dataColumn<AdminUser>({
    id: "email",
    header: "Email",
    sortValue: (row) => row.email,
  }),
  dataColumn<AdminUser>({
    id: "state",
    header: "State",
    sortValue: (row) => row.account_status,
    cell: (row) => <StateBadge state={row.account_status} />,
  }),
  dataColumn<AdminUser>({
    id: "roles",
    header: "Roles",
    sortValue: (row) =>
      [
        row.site_admin ? "Site admin" : "",
        row.school_admin_count
          ? `School admin at ${row.school_admin_count}`
          : "",
      ]
        .filter(Boolean)
        .join(" · ") || "—",
  }),
  dataColumn<AdminUser>({
    id: "verification_level",
    header: "Verification",
    sortValue: (row) => row.verification_level.replaceAll("_", " "),
  }),
];

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
            Find an account by the start of its email or name, then open it to
            change its trust level, suspend it, or grant admin access.
          </p>
        </div>
      </header>

      <CatalogFilters
        action="/users"
        label="Email or name"
        search={search}
        states={catalogListKinds.users}
      >
        <label>
          Role
          <select defaultValue={search.role ?? ""} name="role">
            <option value="">Any role</option>
            <option value="site_admin">Site admin</option>
            <option value="school_admin">School admin</option>
          </select>
        </label>
        <label>
          Verification
          <select defaultValue={search.verification ?? ""} name="verification">
            <option value="">Any level</option>
            {verificationFilters.map((level) => (
              <option key={level} value={level}>
                {level.replaceAll("_", " ")}
              </option>
            ))}
          </select>
        </label>
      </CatalogFilters>

      {page.users.length ? (
        <DataTable
          columns={userColumns}
          data={page.users}
          getRowId={(user) => user.id}
          label="Users"
        />
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
