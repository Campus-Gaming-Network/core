import { Link, createFileRoute } from "@tanstack/react-router";
import { SignupForm } from "../features/auth-flow-slice/auth-forms";
import "../features/auth-flow-slice/auth-flow.css";
import {
  getCurrentPolicies,
  getSignupSchools,
} from "../features/auth-flow-slice/auth-flow.functions";
import { validateSignupSearch } from "../features/auth-flow-slice/contracts";
import { authPageHead } from "../features/auth-flow-slice/presentation";

const description =
  "Create a Campus Gaming Network account, pick your home school, and join the campus gaming scene.";

export const Route = createFileRoute("/signup")({
  validateSearch: validateSignupSearch,
  loaderDeps: ({ search }) => ({ query: search.q ?? "" }),
  loader: async ({ context, deps }) => {
    const [schoolSearch, policies] = await Promise.all([
      getSignupSchools({ data: deps.query }),
      getCurrentPolicies(),
    ]);
    return { schoolSearch, policies, publicOrigin: context.publicOrigin };
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
  const { schoolSearch, policies } = Route.useLoaderData();

  return (
    <main className="narrow">
      <section className="page-heading">
        <p className="eyebrow">Create account</p>
        <h1>Join with your home school.</h1>
        <p className="lede">
          You need to be 18 or older, choose an active home school, and verify
          your email before logging in.
        </p>
      </section>

      <noscript>
        <form action="/signup" className="search-bar compact" method="get">
          <label>
            Search schools
            <input
              defaultValue={search.q}
              name="q"
              placeholder="Search by school name"
              required
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
        initialStatus={search.auth}
        policies={policies}
      />
      <p className="form-footer">
        Already verified? <Link to="/login">Log in</Link>
      </p>
    </main>
  );
}
