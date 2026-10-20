import { adminTitle } from "../components/page-title";
import { Timestamp } from "../components/timestamp";
import { Link, createFileRoute } from "@tanstack/react-router";
import { CopyIdButton } from "../components/copy-id-button";
import {
  CatalogAuditPanel,
  CatalogNoticeView,
  ClubForm,
  ClubLinksForm,
  CommandForm,
  StateBadge,
} from "../features/catalog/catalog-components";
import { getClubDetail } from "../features/catalog/catalog.functions";
import {
  clubLinkTypeLabels,
  clubTypeLabels,
  validateCatalogDetailSearch,
} from "../features/catalog/contracts";
import { DetailFact } from "../features/moderation/moderation-components";

export const Route = createFileRoute("/clubs/$clubId")({
  validateSearch: validateCatalogDetailSearch,
  loaderDeps: ({ search }) => ({
    audit_after: search.audit_after,
    audit_before: search.audit_before,
  }),
  loader: ({ params, deps }) =>
    getClubDetail({ data: { id: params.clubId, ...deps } }),
  staleTime: 0,
  head: ({ loaderData }) => ({
    meta: [{ title: adminTitle(loaderData?.club.name ?? "Club", "Clubs") }],
  }),
  component: ClubDetailPage,
});

function ClubDetailPage() {
  const { club, audit } = Route.useLoaderData();
  const search = Route.useSearch();
  const { admin } = Route.useRouteContext();
  const capabilities =
    admin.status === "authenticated" ? admin.session.capabilities : [];
  const canManage = capabilities.includes("clubs.manage");
  const path = `/clubs/${encodeURIComponent(club.id)}`;

  return (
    <div className="page-stack detail-page">
      <header className="detail-header">
        <div>
          <Link className="back-link" to="/clubs">
            ← Clubs
          </Link>
          <p className="eyebrow">Club</p>
          <h1>{club.name}</h1>
          <CopyIdButton entity="club" id={club.id} />
        </div>
        <StateBadge state={club.is_active ? "published" : "hidden"} />
      </header>

      <CatalogNoticeView notice={search.notice} />

      <section className="detail-panel" aria-labelledby="club-facts">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Current record</p>
            <h2 id="club-facts">Club information</h2>
          </div>
        </div>
        <dl className="detail-facts">
          <DetailFact label="School">
            <Link params={{ schoolId: club.school.id }} to="/schools/$schoolId">
              {club.school.name}
            </Link>
          </DetailFact>
          <DetailFact label="Type">{clubTypeLabels[club.type]}</DetailFact>
          <DetailFact label="Slug">
            <code>{club.slug}</code>
          </DetailFact>
          <DetailFact label="Games">
            {club.games.map((game) => game.name).join(", ") || "None"}
          </DetailFact>
          <DetailFact label="Links">
            {club.links.length
              ? club.links
                  .map(
                    (link) =>
                      `${link.label} (${clubLinkTypeLabels[link.type]})`,
                  )
                  .join(", ")
              : "None"}
          </DetailFact>
          <DetailFact label="Page">
            {club.claimed
              ? "Managed by the club (claimed)"
              : "Maintained by Campus Gaming Network (unclaimed)"}
          </DetailFact>
          <DetailFact label="Last checked">
            {club.confirmed_at ? (
              <>
                <Timestamp value={club.confirmed_at} /> by{" "}
                {club.confirmed_source === "club"
                  ? "the club"
                  : "Campus Gaming Network"}
              </>
            ) : (
              "Never"
            )}
          </DetailFact>
          <DetailFact label="Last changed">
            <Timestamp value={club.updated_at} />
          </DetailFact>
        </dl>
      </section>

      {canManage ? (
        <>
          <section className="detail-panel" aria-labelledby="club-edit">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Public profile</p>
                <h2 id="club-edit">Club details</h2>
              </div>
            </div>
            {/* Keyed by version: after any change the forms rebuild from the
                saved record, since a reset select falls back to its first
                option rather than the value it was rendered with. */}
            <ClubForm club={club} key={club.updated_at} />
          </section>

          <section className="detail-panel" aria-labelledby="club-links">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Public profile</p>
                <h2 id="club-links">Links</h2>
              </div>
            </div>
            <ClubLinksForm club={club} key={club.updated_at} />
          </section>

          <section className="detail-panel" aria-labelledby="club-actions">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Lifecycle</p>
                <h2 id="club-actions">Actions</h2>
              </div>
            </div>
            <CommandForm
              command="club.check"
              description="Record that you re-checked the club's public source today. The club page shows the date."
              expectedUpdatedAt={club.updated_at}
              id={club.id}
              returnPath={path}
              submitLabel="Mark as checked"
              title="Mark as checked"
            />
            {club.is_active ? (
              <CommandForm
                command="club.hide"
                description="Take the club off the public site. Its page returns not found and its school no longer lists it."
                expectedUpdatedAt={club.updated_at}
                id={club.id}
                returnPath={path}
                submitLabel="Hide club"
                title="Hide club"
              />
            ) : (
              <CommandForm
                command="club.unhide"
                description="Publish the club again with its current details."
                expectedUpdatedAt={club.updated_at}
                id={club.id}
                returnPath={path}
                submitLabel="Publish club"
                title="Publish club"
              />
            )}
          </section>
        </>
      ) : null}

      <CatalogAuditPanel audit={audit} path={path} search={search} />
    </div>
  );
}
