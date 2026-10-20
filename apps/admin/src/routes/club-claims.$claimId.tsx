import { adminTitle } from "../components/page-title";
import { Timestamp } from "../components/timestamp";
import { Link, createFileRoute } from "@tanstack/react-router";
import { CopyIdButton } from "../components/copy-id-button";
import { UserLink } from "../components/user-link";
import {
  CatalogAuditPanel,
  CatalogNoticeView,
  CommandForm,
  StateBadge,
} from "../features/catalog/catalog-components";
import { getClubClaimDetail } from "../features/catalog/catalog.functions";
import {
  clubTypeLabels,
  clubTypes,
  validateCatalogDetailSearch,
  type AdminClubClaim,
} from "../features/catalog/contracts";
import { DetailFact } from "../features/moderation/moderation-components";

export const Route = createFileRoute("/club-claims/$claimId")({
  validateSearch: validateCatalogDetailSearch,
  loaderDeps: ({ search }) => ({
    audit_after: search.audit_after,
    audit_before: search.audit_before,
  }),
  loader: ({ params, deps }) =>
    getClubClaimDetail({ data: { id: params.claimId, ...deps } }),
  staleTime: 0,
  head: ({ loaderData }) => ({
    meta: [
      {
        title: adminTitle(
          loaderData ? `Claim on ${loaderData.claim.club_name}` : "Club claim",
          "Club claims",
        ),
      },
    ],
  }),
  component: ClubClaimDetailPage,
});

function ClubClaimDetailPage() {
  const { claim, audit } = Route.useLoaderData();
  const search = Route.useSearch();
  const { admin } = Route.useRouteContext();
  const canManage =
    admin.status === "authenticated" &&
    admin.session.capabilities.includes("clubs.manage");
  const path = `/club-claims/${encodeURIComponent(claim.id)}`;

  return (
    <div className="page-stack detail-page">
      <header className="detail-header">
        <div>
          <Link className="back-link" to="/club-claims">
            ← Club claims
          </Link>
          <p className="eyebrow">
            {claim.kind === "claim" ? "Claim" : "New club request"}
          </p>
          <h1>{claim.club_name}</h1>
          <CopyIdButton entity="claim" id={claim.id} />
        </div>
        <StateBadge state={claim.status} />
      </header>

      <CatalogNoticeView notice={search.notice} />

      <section className="detail-panel" aria-labelledby="claim-facts">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Submitted claim</p>
            <h2 id="claim-facts">Claim information</h2>
          </div>
        </div>
        <dl className="detail-facts">
          <DetailFact label="Club">
            {claim.club_id ? (
              <Link params={{ clubId: claim.club_id }} to="/clubs/$clubId">
                {claim.club_name}
              </Link>
            ) : (
              `${claim.club_name} (not created yet)`
            )}
          </DetailFact>
          {claim.requested_type ? (
            <DetailFact label="Requested type">
              {clubTypeLabels[claim.requested_type]}
            </DetailFact>
          ) : null}
          <DetailFact label="School">
            <Link
              params={{ schoolId: claim.school.id }}
              to="/schools/$schoolId"
            >
              {claim.school.name}
            </Link>
          </DetailFact>
          <DetailFact label="Applicant">
            <UserLink
              name={claim.applicant_name}
              userId={claim.applicant_user_id}
            />
          </DetailFact>
          <DetailFact label="Applicant email">
            {claim.applicant_email}
          </DetailFact>
          <DetailFact label="Club page">
            {claim.club_claimed
              ? "Managed by the club (has an owner)"
              : "Unclaimed"}
          </DetailFact>
          <DetailFact label="Submitted">
            <Timestamp value={claim.created_at} />
          </DetailFact>
          {claim.reviewed_at ? (
            <DetailFact label="Reviewed">
              <Timestamp value={claim.reviewed_at} /> by{" "}
              <UserLink
                name={claim.reviewer_name ?? undefined}
                userId={claim.reviewer_user_id ?? undefined}
              />
            </DetailFact>
          ) : null}
        </dl>
        <div className="stored-content">
          <h3>Evidence</h3>
          <p>{claim.evidence_text}</p>
          {claim.evidence_url ? (
            <p>
              Link: <code>{claim.evidence_url}</code>
            </p>
          ) : null}
        </div>
        {claim.review_note ? (
          <div className="stored-content">
            <h3>Review note</h3>
            <p>{claim.review_note}</p>
          </div>
        ) : null}
      </section>

      {claim.other_pending_claims.length > 0 ? (
        <section className="detail-panel" aria-labelledby="claim-others">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Same club</p>
              <h2 id="claim-others">Other pending claims</h2>
            </div>
          </div>
          <ul className="stored-content">
            {claim.other_pending_claims.map((other) => (
              <li key={other.id}>
                <Link params={{ claimId: other.id }} to="/club-claims/$claimId">
                  {other.applicant_name}
                </Link>
                , submitted <Timestamp value={other.created_at} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {canManage && claim.status === "pending" ? (
        <section className="detail-panel" aria-labelledby="claim-review">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Review</p>
              <h2 id="claim-review">Decision</h2>
            </div>
          </div>
          <ApproveForm claim={claim} returnPath={path} />
          <CommandForm
            command="club_claim.reject"
            description="Close the claim without changing the club. The applicant is emailed that it was not approved; your reason is the review note and is not sent to them."
            expectedUpdatedAt={claim.updated_at}
            id={claim.id}
            returnPath={path}
            submitLabel="Reject claim"
            title="Reject"
          />
        </section>
      ) : claim.status === "pending" ? (
        <p className="notice">You have read-only access to club claims.</p>
      ) : null}

      <CatalogAuditPanel audit={audit} path={path} search={search} />
    </div>
  );
}

function ApproveForm({
  claim,
  returnPath,
}: {
  claim: AdminClubClaim;
  returnPath: string;
}) {
  if (claim.kind === "claim") {
    return (
      <CommandForm
        command="club_claim.approve"
        description="Make the applicant the club's owner. The club page then reads Managed by the club, and the applicant is emailed."
        expectedUpdatedAt={claim.updated_at}
        id={claim.id}
        returnPath={returnPath}
        submitLabel="Approve claim"
        title="Approve"
      />
    );
  }
  // A request creates the club, so the reviewer settles its name, page
  // address, and type, starting from what the applicant asked for.
  const suggestedSlug = `${claim.club_name}-${claim.school.slug}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120)
    .replace(/-+$/, "");
  return (
    <CommandForm
      command="club_claim.approve"
      description="Create the club, published under this school, and make the applicant its owner. The applicant is emailed."
      expectedUpdatedAt={claim.updated_at}
      id={claim.id}
      returnPath={returnPath}
      submitLabel="Approve and create club"
      title="Approve"
    >
      <label>
        Club name
        <input
          defaultValue={claim.requested_name ?? claim.club_name}
          maxLength={120}
          name="club_name"
          required
        />
      </label>
      <label>
        Page address
        <input
          defaultValue={suggestedSlug}
          maxLength={120}
          name="club_slug"
          pattern="[a-z0-9]+(-[a-z0-9]+)*"
          required
          spellCheck={false}
        />
      </label>
      <label>
        Type
        <select
          defaultValue={claim.requested_type ?? "student_club"}
          name="club_type"
        >
          {clubTypes.map((type) => (
            <option key={type} value={type}>
              {clubTypeLabels[type]}
            </option>
          ))}
        </select>
      </label>
    </CommandForm>
  );
}
