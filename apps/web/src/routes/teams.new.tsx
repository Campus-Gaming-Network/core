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

const schoolSearchFormID = "team-school-search-form";

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

      {/* The school search is a GET form of its own. HTML cannot nest forms,
          so this one is empty and the search controls inside the create form
          join it with the form attribute. */}
      <form action="/teams/new" id={schoolSearchFormID} method="get" />
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

  const schoolOptions = uniqueSchools(schools, defaultSchoolID);
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
        <div className="team-school-search">
          <label>
            Find another school
            <input
              defaultValue={schoolQuery}
              form={schoolSearchFormID}
              maxLength={200}
              minLength={2}
              name="school_q"
              placeholder="University or college"
              type="search"
            />
          </label>
          <button form={schoolSearchFormID} type="submit">
            Search schools
          </button>
        </div>
        {schoolSearchFailed ? (
          <p role="alert">
            School search is unavailable. You can still use your home school.
          </p>
        ) : null}
        <FormField
          errorId="team-school-error"
          errors={schoolErrors}
          label="School link"
          optional
        >
          <select defaultValue={defaultSchoolID} name="school_id">
            <option value="">No school link</option>
            {schoolOptions.map((school) => (
              <option key={school.id} value={school.id}>
                {school.name}
              </option>
            ))}
          </select>
        </FormField>

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

function uniqueSchools(
  schools: SchoolSummaryDTO[],
  defaultSchoolID: string,
): SchoolSummaryDTO[] {
  const unique = new Map(schools.map((school) => [school.id, school]));
  if (defaultSchoolID && !unique.has(defaultSchoolID)) {
    unique.set(defaultSchoolID, {
      id: defaultSchoolID,
      name: "Your home school",
      slug: defaultSchoolID,
    });
  }
  return [...unique.values()];
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
