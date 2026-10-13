import { GamePickerExtras } from "../components/game-picker";
import {
  Link,
  createFileRoute,
  redirect,
  type ErrorComponentProps,
} from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { type FormEvent } from "react";
import {
  FieldError,
  FormErrorSummary,
  fieldErrorProps,
  useEnhancedMutation,
} from "../components/enhanced-mutation";
import { FormField, RequiredFieldsNote } from "../components/form-field";
import { FormSection } from "../components/form-section";
import {
  newIdempotencyKey,
  useIdempotencyKey,
} from "../components/idempotency-key";
import {
  NoScriptSchoolSearch,
  SchoolSearchSelect,
} from "../components/school-search-select";
import { RouteErrorView, RoutePending } from "../components/route-boundaries";
import {
  newTeamPageInputSchema,
  validateNewTeamSearch,
  type GameSummaryDTO,
  type SchoolSummaryDTO,
} from "../features/team-slice/contracts";
import {
  createTeam,
  getNewTeamPage,
} from "../features/team-slice/team.functions";
import { newTeamHead } from "../features/team-slice/presentation";
import teamCSS from "../features/team-slice/teams.css?url";

export const Route = createFileRoute("/teams/new")({
  validateSearch: validateNewTeamSearch,
  loaderDeps: ({ search }) =>
    newTeamPageInputSchema.parse({ schoolQuery: search.school_q ?? "" }),
  loader: async ({ context, deps }) => {
    const result = await getNewTeamPage({ data: deps });
    if (result.status === "unauthenticated") {
      throw redirect({
        to: "/login",
        search: { next: "/teams/new" },
      });
    }
    if (result.status !== "ready") {
      throw new Error("Team creation is unavailable");
    }
    return {
      ...result,
      publicOrigin: context.publicOrigin,
      idempotencyKey: newIdempotencyKey(),
    };
  },
  staleTime: 0,
  headers: () => ({
    "cache-control": "private, no-store",
    vary: "Cookie",
  }),
  head: ({ loaderData }) => ({
    ...newTeamHead(loaderData?.publicOrigin),
    links: [{ rel: "stylesheet", href: teamCSS }],
  }),
  pendingComponent: NewTeamPending,
  errorComponent: NewTeamError,
  component: NewTeamPage,
});

function NewTeamPage() {
  const data = Route.useLoaderData();
  const search = Route.useSearch();

  return (
    <main className="narrow">
      <section className="page-heading">
        <p className="eyebrow">Create team</p>
        <h1>Create a campus gaming team</h1>
        <p className="lede">
          Start with public team details. The join password will be used for
          member access after the team is created.
        </p>
      </section>

      <NoScriptSchoolSearch action="/teams/new" query={search.school_q ?? ""} />
      <CreateTeamForm
        defaultSchoolID={data.defaultSchoolID}
        games={data.games}
        idempotencyKey={data.idempotencyKey}
        initialFailure={search.team === "create-failed"}
        schoolQuery={search.school_q ?? ""}
        schoolSearchFailed={data.schoolSearchFailed}
        schools={data.schools}
      />
      <p className="form-footer">
        <Link to="/teams">Back to teams</Link>
      </p>
    </main>
  );
}

function CreateTeamForm({
  defaultSchoolID,
  games,
  idempotencyKey,
  initialFailure,
  schoolQuery,
  schoolSearchFailed,
  schools,
}: {
  defaultSchoolID: string;
  games: GameSummaryDTO[];
  idempotencyKey: string;
  initialFailure: boolean;
  schoolQuery: string;
  schoolSearchFailed: boolean;
  schools: SchoolSummaryDTO[];
}) {
  const idempotency = useIdempotencyKey(idempotencyKey);
  const runCreateTeam = useServerFn(createTeam);
  const mutation = useEnhancedMutation(
    "We could not create that team. Please try again.",
  );

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    await mutation.execute(() => runCreateTeam({ data }));
  }

  const nameErrors = mutation.fieldErrors.name;
  const descriptionErrors = mutation.fieldErrors.description;
  const schoolErrors = mutation.fieldErrors.school_id;
  const gameErrors = mutation.fieldErrors.game_ids;
  const passwordErrors = mutation.fieldErrors.password;

  return (
    <form
      action={createTeam.url}
      className="form-stack team-create-form sectioned-form"
      method="post"
      onSubmit={submit}
    >
      <input name="idempotency_key" type="hidden" value={idempotency.key} />
      <FormErrorSummary
        fieldErrors={mutation.fieldErrors}
        fieldIds={{
          name: "team-name-error",
          description: "team-description-error",
          school_id: "team-school-error",
          game_ids: "team-games-error",
          other_game: "team-other-game-error",
          password: "team-password-error",
        }}
        message={
          mutation.message ||
          (initialFailure
            ? "We could not create that team. Please try again."
            : "")
        }
        summaryRef={mutation.errorSummaryRef}
      />

      <RequiredFieldsNote />
      <FormSection
        title="Team basics"
        description="Introduce the team to players browsing the public directory."
      >
        <FormField
          errorId="team-name-error"
          errors={nameErrors}
          label="Team name"
        >
          <input maxLength={120} name="name" required />
        </FormField>

        <FormField
          errorId="team-description-error"
          errors={descriptionErrors}
          label="Description"
          optional
        >
          <textarea maxLength={5000} name="description" rows={6} />
        </FormField>
      </FormSection>

      <FormSection
        title="Campus and games"
        description="Link the team to a school and choose the games it plays."
      >
        <SchoolSearchSelect
          defaultSchool={
            defaultSchoolID
              ? {
                  id: defaultSchoolID,
                  name: "Your home school",
                  slug: defaultSchoolID,
                }
              : undefined
          }
          defaultValue={defaultSchoolID}
          describedBy={schoolErrors?.length ? "team-school-error" : undefined}
          emptyLabel="No school link"
          initialQuery={schoolQuery}
          initialSchools={schools}
          initialSearchFailed={schoolSearchFailed}
          invalid={Boolean(schoolErrors?.length)}
          label="School link (optional)"
          name="school_id"
          valueField="id"
        />
        <FieldError id="team-school-error" messages={schoolErrors} />

        <fieldset
          className="team-game-group"
          {...fieldErrorProps(gameErrors, "team-games-error")}
        >
          <legend>Games</legend>
          <div className="team-option-list">
            {games.map((game) => (
              <label className="checkbox-field" key={game.id}>
                <input name="game_ids" type="checkbox" value={game.id} />
                {game.name}
              </label>
            ))}
          </div>
          <FieldError id="team-games-error" messages={gameErrors} />
        </fieldset>
        <GamePickerExtras
          otherGameErrorId="team-other-game-error"
          otherGameErrors={mutation.fieldErrors.other_game}
        />
      </FormSection>

      <FormSection
        title="Member access"
        description="Team pages are public. This password is only for joining the team."
      >
        <FormField
          errorId="team-password-error"
          errors={passwordErrors}
          label="Join password"
        >
          <input
            autoComplete="new-password"
            minLength={8}
            maxLength={200}
            name="password"
            required
            type="password"
          />
        </FormField>
      </FormSection>

      <div className="form-actions">
        <button type="submit" disabled={mutation.pending}>
          {mutation.pending ? "Creating…" : "Create team"}
        </button>
      </div>
    </form>
  );
}

function NewTeamPending() {
  return <RoutePending message="Loading team form…" />;
}

function NewTeamError({ reset }: ErrorComponentProps) {
  return (
    <RouteErrorView
      reset={reset}
      eyebrow="Team creation unavailable"
      heading="We could not load the team form."
    />
  );
}
