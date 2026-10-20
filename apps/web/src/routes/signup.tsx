import { Link, createFileRoute } from "@tanstack/react-router";
import {
  SignupConfirmation,
  SignupForm,
} from "../features/auth-flow-slice/auth-forms";
import "../features/auth-flow-slice/auth-flow.css";
import {
  getCurrentPolicies,
  getSignupConfirmationEmail,
  getSignupSchools,
} from "../features/auth-flow-slice/auth-flow.functions";
import { validateSignupSearch } from "../features/auth-flow-slice/contracts";
import { authPageHead } from "../features/auth-flow-slice/presentation";

const description =
  "Create a Campus Gaming Network account, pick your home school, and join the campus gaming scene.";

export const Route = createFileRoute("/signup")({
  validateSearch: validateSignupSearch,
  loaderDeps: ({ search }) => ({
    query: search.q ?? "",
    created: search.auth === "created",
  }),
  loader: async ({ context, deps }) => {
    if (deps.created) {
      return {
        created: true as const,
        email: await getSignupConfirmationEmail(),
        publicOrigin: context.publicOrigin,
      };
    }
    const [schoolSearch, policies] = await Promise.all([
      getSignupSchools({ data: deps.query }),
      getCurrentPolicies(),
    ]);
    return {
      created: false as const,
      schoolSearch,
      policies,
      publicOrigin: context.publicOrigin,
    };
  },
  head: ({ loaderData }) =>
    authPageHead(loaderData?.publicOrigin, {
      title: "Sign up",
      description,
      path: "/signup",
    }),
  component: SignupPage,
});

function SignupPage() {
  const search = Route.useSearch();
  const data = Route.useLoaderData();

  if (data.created) {
    return (
      <main className="auth-page">
        <SignupConfirmation email={data.email} />
        <p className="auth-footer">
          Already verified? <Link to="/login">Log in</Link>
        </p>
      </main>
    );
  }
  const { schoolSearch, policies } = data;

  return (
    <main className="auth-page auth-page--wide">
      <header className="auth-heading">
        <h1>Create an account</h1>
        <p className="lede">
          Find the players, teams, and game nights at your school.
        </p>
      </header>

      <noscript>
        <form action="/signup" className="search-bar compact" method="get">
          <label>
            Search schools
            <input
              defaultValue={search.q}
              name="q"
              placeholder="Search by school name"
              required
              enterKeyHint="search"
              type="search"
            />
          </label>
          <button type="submit">Search</button>
        </form>
      </noscript>

      <SignupForm
        schools={schoolSearch.schools}
        selectedSchoolId={search.school_id}
        initialQuery={search.q}
        initialSearchFailed={schoolSearch.failed}
        initialStatus={search.auth === "failed" ? "failed" : undefined}
        policies={policies}
      />
      <p className="auth-footer">
        Already have an account? <Link to="/login">Log in</Link>
      </p>
    </main>
  );
}
