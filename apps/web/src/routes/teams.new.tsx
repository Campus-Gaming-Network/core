import {
  Link,
  createFileRoute,
  redirect,
  type ErrorComponentProps
} from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { type FormEvent } from "react";
import {
  FieldError,
  fieldErrorProps,
  useEnhancedMutation
} from "../components/enhanced-mutation";
import { RouteErrorView, RoutePending } from "../components/route-boundaries";
import {
  newTeamPageInputSchema,
  validateNewTeamSearch,
  type GameSummaryDTO,
  type NewTeamSearch,
  type SchoolSummaryDTO
} from "../features/team-slice/contracts";
import {
  createTeam,
  getNewTeamPage
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
        search: { next: "/teams/new" }
      });
    }
    if (result.status !== "ready") {
      throw new Error("Team creation is unavailable");
    }
    return { ...result, publicOrigin: context.publicOrigin };
  },
  staleTime: 0,
  headers: () => ({
    "cache-control": "private, no-store",
    vary: "Cookie"
  }),
  head: ({ loaderData }) => ({
    ...newTeamHead(loaderData?.publicOrigin),
    links: [{ rel: "stylesheet", href: teamCSS }]
  }),
  pendingComponent: NewTeamPending,
  errorComponent: NewTeamError,
  component: NewTeamPage
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

      <SchoolSearch search={search} failed={data.schoolSearchFailed} />
      <CreateTeamForm
        defaultSchoolID={data.defaultSchoolID}
        games={data.games}
        initialFailure={search.team === "create-failed"}
        schools={data.schools}
      />
      <p className="form-footer">
        <Link to="/teams">Back to teams</Link>
      </p>
    </main>
  );
}

function SchoolSearch({
  failed,
  search
}: {
  failed: boolean;
  search: NewTeamSearch;
}) {
  return (
    <section
      className="team-school-search"
      aria-labelledby="school-search-heading"
    >
      <h2 id="school-search-heading">Find another school</h2>
      <form action="/teams/new" className="search-bar" method="get">
        <label>
          School name
          <input
            defaultValue={search.school_q}
            minLength={2}
            maxLength={200}
            name="school_q"
            placeholder="University or college"
          />
        </label>
        <button type="submit">Search schools</button>
      </form>
      {failed ? (
        <p role="alert">
          School search is unavailable. You can still use your home school.
        </p>
      ) : null}
    </section>
  );
}

function CreateTeamForm({
  defaultSchoolID,
  games,
  initialFailure,
  schools
}: {
  defaultSchoolID: string;
  games: GameSummaryDTO[];
  initialFailure: boolean;
  schools: SchoolSummaryDTO[];
}) {
  const runCreateTeam = useServerFn(createTeam);
  const mutation = useEnhancedMutation(
    "We could not create that team. Please try again."
  );

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await mutation.execute(() =>
      runCreateTeam({
        data: {
          name: String(form.get("name") ?? ""),
          description: String(form.get("description") ?? ""),
          school_id: String(form.get("school_id") ?? ""),
          game_ids: form
            .getAll("game_ids")
            .filter((value): value is string => typeof value === "string"),
          password: String(form.get("password") ?? "")
        }
      })
    );
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
      className="form-stack team-create-form"
      method="post"
      onSubmit={submit}
    >
      {mutation.message || initialFailure ? (
        <p role="alert" aria-live="polite">
          {mutation.message ||
            "We could not create that team. Please try again."}
        </p>
      ) : null}

      <label>
        Team name
        <input
          maxLength={120}
          name="name"
          required
          {...fieldErrorProps(nameErrors, "team-name-error")}
        />
        <FieldError id="team-name-error" messages={nameErrors} />
      </label>

      <label>
        Description
        <textarea
          maxLength={5000}
          name="description"
          rows={6}
          {...fieldErrorProps(descriptionErrors, "team-description-error")}
        />
        <FieldError
          id="team-description-error"
          messages={descriptionErrors}
        />
      </label>

      <label>
        School link
        <select
          defaultValue={defaultSchoolID}
          name="school_id"
          {...fieldErrorProps(schoolErrors, "team-school-error")}
        >
          <option value="">No school link</option>
          {schoolOptions.map((school) => (
            <option key={school.id} value={school.id}>
              {school.name}
            </option>
          ))}
        </select>
        <FieldError id="team-school-error" messages={schoolErrors} />
      </label>

      <fieldset {...fieldErrorProps(gameErrors, "team-games-error")}>
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

      <label>
        Join password
        <input
          autoComplete="new-password"
          minLength={8}
          maxLength={200}
          name="password"
          required
          type="password"
          {...fieldErrorProps(passwordErrors, "team-password-error")}
        />
        <FieldError id="team-password-error" messages={passwordErrors} />
      </label>
      <p className="form-help">
        Team pages are public. This password is only for joining the team.
      </p>

      <button type="submit" disabled={mutation.pending}>
        {mutation.pending ? "Creating…" : "Create team"}
      </button>
    </form>
  );
}

function uniqueSchools(
  schools: SchoolSummaryDTO[],
  defaultSchoolID: string
): SchoolSummaryDTO[] {
  const unique = new Map(schools.map((school) => [school.id, school]));
  if (defaultSchoolID && !unique.has(defaultSchoolID)) {
    unique.set(defaultSchoolID, {
      id: defaultSchoolID,
      name: "Your home school",
      slug: defaultSchoolID
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
