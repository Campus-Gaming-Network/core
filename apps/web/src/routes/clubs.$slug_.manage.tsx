import {
  Link,
  createFileRoute,
  notFound,
  redirect,
} from "@tanstack/react-router";
import { BreadcrumbLink, Breadcrumbs } from "../components/breadcrumbs";
import { FieldError } from "../components/enhanced-mutation";
import { FormField } from "../components/form-field";
import { FormSection } from "../components/form-section";
import { PageNoticeView } from "../components/page-notice-view";
import { pageHead } from "../components/public-page-head";
import { RouteErrorView, RoutePending } from "../components/route-boundaries";
import { StatusLabel } from "../components/status-label";
import { ClubCommandForm } from "../features/club-slice/club-command-form";
import { getClubManagement } from "../features/club-slice/club.functions";
import {
  clubNotices,
  maximumClubLinks,
  validateClubManageSearch,
  type ClubManagementDTO,
} from "../features/club-slice/contracts";
import {
  clubConfirmedLine,
  clubNeedsConfirmationLabel,
  clubTypeLabels,
} from "../features/club-slice/presentation";
import clubCSS from "../features/club-slice/clubs.css?url";

export const Route = createFileRoute("/clubs/$slug_/manage")({
  validateSearch: validateClubManageSearch,
  loader: async ({ context, params }) => {
    const result = await getClubManagement({ data: { slug: params.slug } });
    const path: `/${string}` = `/clubs/${encodeURIComponent(params.slug)}/manage`;
    if (result.status === "unauthenticated") {
      throw redirect({ to: "/login", search: { next: path } });
    }
    if (result.status === "not_found") throw notFound();
    if (result.status === "error")
      throw new Error("Club management is unavailable");
    return {
      result,
      path,
      publicOrigin: context.publicOrigin,
      slug: params.slug,
    };
  },
  staleTime: 0,
  headers: () => ({ "cache-control": "private, no-store", vary: "Cookie" }),
  head: ({ loaderData }) => {
    const head = pageHead(loaderData?.publicOrigin, {
      title:
        loaderData?.result.status === "found"
          ? `Manage ${loaderData.result.management.club.name}`
          : "Manage club",
      description: "Edit a club's page and its people.",
      path: loaderData?.path ?? "/clubs",
      noIndex: true,
    });
    return {
      ...head,
      links: [...head.links, { rel: "stylesheet", href: clubCSS }],
    };
  },
  pendingComponent: () => <RoutePending message="Loading club…" />,
  errorComponent: () => (
    <RouteErrorView
      eyebrow="Club unavailable"
      heading="We could not load this club's settings."
    />
  ),
  component: ManageClubPage,
});

function ManageClubPage() {
  const { result, slug } = Route.useLoaderData();
  const search = Route.useSearch();
  if (result.status !== "found") {
    return (
      <main className="form-page">
        <section className="page-heading">
          <div>
            <h1>You do not manage this club</h1>
            <p className="lede">
              Only the club&apos;s owners and editors can change its page.{" "}
              <Link params={{ slug }} to="/clubs/$slug">
                Back to the club
              </Link>
            </p>
          </div>
        </section>
      </main>
    );
  }
  const { management, games } = result;
  const { club } = management;
  const owner = management.role === "owner";

  return (
    <main className="form-page">
      <Breadcrumbs current="Manage">
        <BreadcrumbLink to="/clubs/$slug" params={{ slug: club.slug }}>
          {club.name}
        </BreadcrumbLink>
      </Breadcrumbs>
      <section className="page-heading">
        <div>
          <h1>Manage {club.name}</h1>
          <p className="lede">
            You are {owner ? "an owner" : "an editor"} of this club. Changes
            show on the club&apos;s page right away.
          </p>
        </div>
      </section>
      <PageNoticeView
        notice={search.club ? clubNotices[search.club] : undefined}
      />

      <FormSection
        title="Club details"
        description="What the club page says about the club."
      >
        <ClubCommandForm
          command="profile"
          fieldIds={{
            name: "club-name-error",
            type: "club-type-error",
            summary: "club-summary-error",
            how_to_join: "club-join-error",
            game_ids: "club-games-error",
          }}
          page="manage"
          slug={club.slug}
          submitLabel="Save details"
        >
          {(errors) => (
            <>
              <FormField
                errorId="club-name-error"
                errors={errors.name}
                label="Club name"
                characterCount
              >
                <input
                  defaultValue={club.name}
                  maxLength={120}
                  name="name"
                  required
                />
              </FormField>
              <FormField
                errorId="club-type-error"
                errors={errors.type}
                label="Type"
              >
                <select defaultValue={club.type} name="type">
                  {Object.entries(clubTypeLabels).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </FormField>
              <FormField
                errorId="club-summary-error"
                errors={errors.summary}
                label="About"
                optional
                characterCount
              >
                <textarea
                  defaultValue={club.summary}
                  maxLength={2000}
                  name="summary"
                  rows={5}
                />
              </FormField>
              <FormField
                errorId="club-join-error"
                errors={errors.how_to_join}
                label="How to join"
                optional
                characterCount
              >
                <textarea
                  defaultValue={club.how_to_join ?? ""}
                  maxLength={2000}
                  name="how_to_join"
                  rows={4}
                />
              </FormField>
              <fieldset className="club-game-options">
                <legend>Games</legend>
                {games.map((game) => (
                  <label className="checkbox-field" key={game.id}>
                    <input
                      defaultChecked={club.games.some(
                        (chosen) => chosen.id === game.id,
                      )}
                      name="game_ids"
                      type="checkbox"
                      value={game.id}
                    />
                    {game.name}
                  </label>
                ))}
                <FieldError id="club-games-error" messages={errors.game_ids} />
              </fieldset>
            </>
          )}
        </ClubCommandForm>
      </FormSection>

      <FormSection
        title="Links"
        description="Labeled links to the club's site, Discord, or social pages. Leave a row blank to remove it."
      >
        <ClubCommandForm
          command="links"
          fieldIds={{ links: "club-links-error" }}
          page="manage"
          slug={club.slug}
          submitLabel="Save links"
        >
          {(errors) => <LinkRows club={club} errors={errors.links} />}
        </ClubCommandForm>
      </FormSection>

      <FormSection
        title="Confirm details"
        description="Once the details and links above are right, confirm them. The club page shows the date, and after 90 days it says the club needs confirmation."
      >
        <p>
          {clubConfirmedLine(club) ?? "No one has confirmed these details yet."}
          {club.needs_confirmation ? (
            <>
              {" "}
              <StatusLabel>{clubNeedsConfirmationLabel}</StatusLabel>
            </>
          ) : null}
        </p>
        <ClubCommandForm
          command="confirm"
          page="manage"
          pendingLabel="Confirming…"
          slug={club.slug}
          submitLabel="Confirm these details are current"
          variant="secondary"
        />
      </FormSection>

      <People management={management} />

      {owner ? <EditorInvites management={management} /> : null}
    </main>
  );
}

function LinkRows({
  club,
  errors,
}: {
  club: ClubManagementDTO["club"];
  errors?: string[];
}) {
  const rows = [
    ...club.links,
    ...Array.from(
      {
        length: Math.max(
          0,
          Math.min(maximumClubLinks, club.links.length + 2) - club.links.length,
        ),
      },
      () => ({ type: "website" as const, label: "", url: "" }),
    ),
  ];
  return (
    <div className="club-link-rows">
      {rows.map((link, index) => (
        <fieldset className="split-fields" key={index}>
          <legend className="visually-hidden">Link {index + 1}</legend>
          <label>
            Type
            <select defaultValue={link.type} name="link_type">
              <option value="website">Website</option>
              <option value="discord">Discord</option>
              <option value="social">Social</option>
            </select>
          </label>
          <label>
            Label
            <input defaultValue={link.label} maxLength={60} name="link_label" />
          </label>
          <label>
            Address
            <input
              defaultValue={link.url}
              inputMode="url"
              maxLength={500}
              name="link_url"
              placeholder="https://"
              type="url"
            />
          </label>
        </fieldset>
      ))}
      <FieldError id="club-links-error" messages={errors} />
    </div>
  );
}

const roleNames = { owner: "Owner", editor: "Editor", member: "Member" };

function People({ management }: { management: ClubManagementDTO }) {
  const { club, members, ownership_offer: offer } = management;
  const owner = management.role === "owner";
  return (
    <FormSection
      title="People"
      description={
        owner
          ? "Editors can change the club's page and remove members. Offer the club to someone to hand it over; nothing changes until they accept, and you then become an editor."
          : "Editors can change the club's page and remove members. Owners manage editors."
      }
    >
      {offer ? (
        <div className="club-offer">
          <p>
            Ownership offered to {offer.name}. Nothing changes until they
            accept.
          </p>
          {owner ? (
            <ClubCommandForm
              command="cancel-offer"
              page="manage"
              slug={club.slug}
              submitLabel="Withdraw offer"
              variant="secondary"
            />
          ) : null}
        </div>
      ) : null}
      <ul className="club-people">
        {members.map((member) => {
          const removable =
            member.role === "member" || (owner && member.role === "editor");
          return (
            <li key={member.user_id}>
              <div>
                <Link params={{ id: member.public_id }} to="/users/$id">
                  {member.name}
                </Link>{" "}
                <span className="muted">{roleNames[member.role]}</span>
              </div>
              <div className="club-people__actions">
                {owner &&
                member.role !== "owner" &&
                offer?.user_id !== member.user_id ? (
                  <ClubCommandForm
                    command="offer"
                    hidden={{ user_id: member.user_id }}
                    page="manage"
                    slug={club.slug}
                    submitLabel={`Offer ownership to ${member.name}`}
                    variant="secondary"
                  />
                ) : null}
                {removable ? (
                  <ClubCommandForm
                    command="remove-member"
                    hidden={{ user_id: member.user_id }}
                    page="manage"
                    slug={club.slug}
                    submitLabel={`Remove ${member.name}`}
                    variant="destructive"
                  />
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
    </FormSection>
  );
}

function EditorInvites({ management }: { management: ClubManagementDTO }) {
  const { club, invites } = management;
  return (
    <FormSection
      title="Invite an editor"
      description="We email them a link that works once and expires in 7 days. They accept it while signed in with that address."
    >
      <ClubCommandForm
        command="invite"
        fieldIds={{ email: "editor-email-error" }}
        page="manage"
        slug={club.slug}
        submitLabel="Send invitation"
        pendingLabel="Sending…"
      >
        {(errors) => (
          <FormField
            errorId="editor-email-error"
            errors={errors.email}
            label="Email address"
          >
            <input
              autoComplete="off"
              maxLength={254}
              name="email"
              required
              type="email"
            />
          </FormField>
        )}
      </ClubCommandForm>
      {invites.length > 0 ? (
        <ul className="club-people">
          {invites.map((invite) => (
            <li key={invite.id}>
              <span>{invite.email}</span>
              <ClubCommandForm
                command="revoke-invite"
                hidden={{ invite_id: invite.id }}
                page="manage"
                slug={club.slug}
                submitLabel={`Withdraw invitation to ${invite.email}`}
                variant="secondary"
              />
            </li>
          ))}
        </ul>
      ) : null}
    </FormSection>
  );
}
