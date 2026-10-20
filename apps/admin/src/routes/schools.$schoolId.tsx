import { adminTitle } from "../components/page-title";
import { Timestamp } from "../components/timestamp";
import { Link, createFileRoute } from "@tanstack/react-router";
import { CopyIdButton } from "../components/copy-id-button";
import {
  BundledLogoPreview,
  CatalogAuditPanel,
  CatalogNoticeView,
  CommandForm,
  LogoUploadForm,
  SchoolForm,
  StateBadge,
  recordState,
} from "../features/catalog/catalog-components";
import { getSchoolDetail } from "../features/catalog/catalog.functions";
import { validateCatalogDetailSearch } from "../features/catalog/contracts";
import { DetailFact } from "../features/moderation/moderation-components";

export const Route = createFileRoute("/schools/$schoolId")({
  validateSearch: validateCatalogDetailSearch,
  loaderDeps: ({ search }) => ({
    audit_after: search.audit_after,
    audit_before: search.audit_before,
  }),
  loader: ({ context, params, deps }) =>
    getSchoolDetail({
      data: {
        id: params.schoolId,
        ...deps,
        include_grants:
          context.admin.status === "authenticated" &&
          context.admin.session.capabilities.includes("school_grants.manage"),
      },
    }),
  staleTime: 0,
  head: ({ loaderData }) => ({
    meta: [
      { title: adminTitle(loaderData?.school.name ?? "School", "Schools") },
    ],
  }),
  component: SchoolDetailPage,
});

function SchoolDetailPage() {
  const { school, audit, grants, logoPreviewURL, bundledLogoPreviewURL } =
    Route.useLoaderData();
  const search = Route.useSearch();
  const { admin } = Route.useRouteContext();
  const capabilities =
    admin.status === "authenticated" ? admin.session.capabilities : [];
  const canManage = capabilities.includes("schools.manage");
  const canManageLogo = capabilities.includes("school_logos.manage");
  const canReadClubs = capabilities.includes("clubs.read");
  const canManageClubs = capabilities.includes("clubs.manage");
  const state = recordState(school);
  const path = `/schools/${encodeURIComponent(school.id)}`;

  return (
    <div className="page-stack detail-page">
      <header className="detail-header">
        <div>
          <Link className="back-link" to="/schools">
            ← Schools
          </Link>
          <p className="eyebrow">School</p>
          <h1>{school.name}</h1>
          <CopyIdButton entity="school" id={school.id} />
        </div>
        <StateBadge state={state} />
      </header>

      <CatalogNoticeView notice={search.notice} />

      <section className="detail-panel" aria-labelledby="school-facts">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Current record</p>
            <h2 id="school-facts">School information</h2>
          </div>
        </div>
        <dl className="detail-facts">
          <DetailFact label="Slug">
            <code>{school.slug}</code>
          </DetailFact>
          <DetailFact label="Unit ID">{school.unitid ?? "None"}</DetailFact>
          <DetailFact label="Location">
            {[school.city, school.state, school.zip]
              .filter(Boolean)
              .join(", ") || "Not set"}
          </DetailFact>
          <DetailFact label="Campus">
            {school.is_main_campus ? "Main campus" : "Branch campus"} ·{" "}
            {school.num_branches} branches
          </DetailFact>
          <DetailFact label="Website">
            {school.website_url || "Not set"}
          </DetailFact>
          <DetailFact label="Last changed">
            <Timestamp value={school.updated_at} />
          </DetailFact>
        </dl>
      </section>

      <section className="detail-panel" aria-labelledby="school-logo">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Public image</p>
            <h2 id="school-logo">Logo</h2>
          </div>
        </div>
        {logoPreviewURL ? (
          <img
            alt={`${school.name} logo`}
            className="logo-preview"
            src={logoPreviewURL}
          />
        ) : school.logo_url ? (
          <p className="empty-copy">
            The stored logo is not on the approved asset host, so it is not
            shown. Upload a replacement.
          </p>
        ) : bundledLogoPreviewURL ? (
          <>
            <BundledLogoPreview
              name={school.name}
              url={bundledLogoPreviewURL}
            />
            <p className="empty-copy">
              No logo has been uploaded. Public pages show this bundled logo.
            </p>
          </>
        ) : (
          <p className="empty-copy">
            No logo has been uploaded and none is bundled. Public pages show the
            school&apos;s initial.
          </p>
        )}
        {canManageLogo && state !== "deleted" ? (
          <>
            <LogoUploadForm school={school} />
            {school.logo_url ? (
              <CommandForm
                command="school.logo_remove"
                description="Removes the uploaded logo. Public pages show the bundled logo when there is one, otherwise the school's initial."
                expectedUpdatedAt={school.updated_at}
                id={school.id}
                returnPath={path}
                submitLabel="Remove logo"
                title="Remove logo"
              />
            ) : null}
          </>
        ) : null}
      </section>

      {canReadClubs ? (
        <section className="detail-panel" aria-labelledby="school-clubs">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Public profile</p>
              <h2 id="school-clubs">Clubs</h2>
            </div>
          </div>
          <p className="field-help">
            Student clubs and university programs at this school.
          </p>
          <div className="actions">
            <Link search={{ school: school.id }} to="/clubs">
              View clubs at {school.name}
            </Link>
            {canManageClubs && state === "active" ? (
              <Link
                className="primary-button"
                search={{ school: school.id }}
                to="/clubs/new"
              >
                <span aria-hidden="true">+</span> New club
              </Link>
            ) : null}
          </div>
        </section>
      ) : null}

      {canManage && state !== "deleted" ? (
        <section className="detail-panel" aria-labelledby="school-edit">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Catalog record</p>
              <h2 id="school-edit">Edit school</h2>
            </div>
          </div>
          <SchoolForm school={school} />
        </section>
      ) : null}

      {canManage && state !== "deleted" ? (
        <section className="detail-panel" aria-labelledby="school-lifecycle">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Lifecycle</p>
              <h2 id="school-lifecycle">Visibility and removal</h2>
            </div>
          </div>
          {state === "active" ? (
            <CommandForm
              command="school.deactivate"
              description="Hides the school from public search and pickers. Existing events and teams keep their link."
              expectedUpdatedAt={school.updated_at}
              id={school.id}
              returnPath={path}
              submitLabel="Deactivate school"
              title="Deactivate"
            />
          ) : (
            <CommandForm
              command="school.reactivate"
              description="Shows the school on the public site again."
              expectedUpdatedAt={school.updated_at}
              id={school.id}
              returnPath={path}
              submitLabel="Reactivate school"
              title="Reactivate"
            />
          )}
          <CommandForm
            command="school.delete"
            description="Soft-deletes a school with no users, events, teams, follows, or admin grants. Deactivate a school that has history instead."
            expectedUpdatedAt={school.updated_at}
            id={school.id}
            returnPath={path}
            submitLabel="Delete school"
            title="Delete"
          />
        </section>
      ) : null}

      {grants ? (
        <section className="detail-panel" aria-labelledby="school-admins">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Access</p>
              <h2 id="school-admins">School admins</h2>
            </div>
          </div>
          {grants.length ? (
            <ul className="record-list">
              {grants.map((grant) => (
                <li key={grant.id}>
                  <p>
                    <Link
                      params={{ userId: grant.user_id }}
                      to="/users/$userId"
                    >
                      {grant.user_name || "Unknown user"}
                    </Link>{" "}
                    <StateBadge
                      state={grant.revoked_at ? "revoked" : "active"}
                    />
                  </p>
                  {grant.revoked_at ? (
                    <CommandForm
                      command="school_grant.grant"
                      description="Restores this user's school-admin access."
                      expectedUpdatedAt={grant.updated_at}
                      hiddenFields={{ user_id: grant.user_id }}
                      id={school.id}
                      returnPath={path}
                      submitLabel="Restore access"
                      title="Restore"
                    />
                  ) : (
                    <CommandForm
                      command="school_grant.revoke"
                      description="Removes this user's school-admin access and ends their sessions."
                      expectedUpdatedAt={grant.updated_at}
                      hiddenFields={{ grant_id: grant.id }}
                      id={school.id}
                      returnPath={path}
                      submitLabel="Revoke access"
                      title="Revoke"
                    />
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="empty-copy">No school admins yet.</p>
          )}
          {state !== "deleted" ? (
            <CommandForm
              command="school_grant.grant"
              description="Enter the email address of an active, email-verified account."
              id={school.id}
              returnPath={path}
              submitLabel="Grant access"
              title="Grant school-admin access"
            >
              <label>
                User email
                <input
                  autoComplete="off"
                  maxLength={320}
                  name="user_email"
                  required
                  spellCheck={false}
                  type="email"
                />
              </label>
            </CommandForm>
          ) : null}
        </section>
      ) : null}

      {capabilities.includes("audit.read") ? (
        <CatalogAuditPanel audit={audit} path={path} search={search} />
      ) : null}
    </div>
  );
}
