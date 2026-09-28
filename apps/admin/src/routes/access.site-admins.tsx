import { Link, createFileRoute } from "@tanstack/react-router";
import {
  CatalogNoticeView,
  CommandForm,
  CursorPagination,
  StateBadge,
} from "../features/catalog/catalog-components";
import { getSiteGrants } from "../features/catalog/catalog.functions";
import {
  catalogListKinds,
  hasRecentStepUp,
  validateCatalogDetailSearch,
  validateCatalogSearch,
} from "../features/catalog/contracts";
import { formatTimestamp } from "../features/moderation/moderation-components";

export const Route = createFileRoute("/access/site-admins")({
  validateSearch: (search: Record<string, unknown>) => ({
    ...validateCatalogSearch("site-admins")(search),
    ...validateCatalogDetailSearch(search),
  }),
  loaderDeps: ({ search }) => ({
    state: search.state,
    after: search.after,
    before: search.before,
  }),
  loader: ({ deps }) => getSiteGrants({ data: deps }),
  staleTime: 0,
  head: () => ({ meta: [{ title: "Site admins | CGN Admin Console" }] }),
  component: SiteAdminsPage,
});

function SiteAdminsPage() {
  const page = Route.useLoaderData();
  const search = Route.useSearch();
  const { admin } = Route.useRouteContext();
  const stepUpReady = hasRecentStepUp(
    admin.status === "authenticated" ? admin.session.step_up_at : undefined,
    Date.now(),
  );

  return (
    <div className="page-stack">
      <header className="page-header">
        <div>
          <p className="eyebrow">Access</p>
          <h1>Site admins</h1>
          <p>
            Every grant of full Admin Console access. Grant access from a
            user&apos;s page; revoking ends all of that user&apos;s admin
            sessions.
          </p>
        </div>
      </header>

      <CatalogNoticeView notice={search.notice} />

      <form action="/access/site-admins" className="filter-panel" method="get">
        <label>
          State
          <select defaultValue={search.state ?? ""} name="state">
            <option value="">All grants</option>
            {catalogListKinds["site-admins"].map((state) => (
              <option key={state} value={state}>
                {state === "active" ? "Active" : "Revoked"}
              </option>
            ))}
          </select>
        </label>
        <div className="filter-actions">
          <button type="submit">Filter</button>
        </div>
      </form>

      {page.grants.length ? (
        <ul className="record-list" aria-label="Site-admin grants">
          {page.grants.map((grant) => (
            <li key={grant.id}>
              <p>
                <Link params={{ userId: grant.user_id }} to="/users/$userId">
                  <code>{grant.user_id}</code>
                </Link>{" "}
                <StateBadge state={grant.revoked_at ? "revoked" : "active"} />
              </p>
              <p className="audit-meta">
                Granted{" "}
                <time dateTime={grant.granted_at}>
                  {formatTimestamp(grant.granted_at)}
                </time>
                {grant.revoked_at ? (
                  <>
                    {" · Revoked "}
                    <time dateTime={grant.revoked_at}>
                      {formatTimestamp(grant.revoked_at)}
                    </time>
                  </>
                ) : null}
              </p>
              <p className="stored-content">
                {grant.revoke_reason ?? grant.grant_reason}
              </p>
              {grant.revoked_at ? null : (
                <CommandForm
                  command="site_grant.revoke"
                  description="Ends this user's Admin Console access and every admin session. The last active site admin cannot be revoked."
                  expectedUpdatedAt={grant.granted_at}
                  hiddenFields={{ grant_id: grant.id }}
                  id={grant.id}
                  returnPath="/access/site-admins"
                  stepUpReady={stepUpReady}
                  submitLabel="Revoke site-admin access"
                  title="Revoke access"
                />
              )}
            </li>
          ))}
        </ul>
      ) : (
        <section className="empty-panel">
          <h2>No grants match this filter</h2>
          <p>Clear the filter to see every grant.</p>
        </section>
      )}

      <CursorPagination
        label="Grant pages"
        path="/access/site-admins"
        search={search}
        previousCursor={page.previous_cursor}
        nextCursor={page.next_cursor}
      />
    </div>
  );
}
