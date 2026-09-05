import Link from "next/link";
import { SignupForm } from "../../components/auth-forms";
import { NoScriptSchoolSearch } from "../../components/school-picker";
import { listSchools } from "../../lib/server-api";
import { pageMetadata } from "../../lib/metadata";

export const metadata = pageMetadata({
  title: "Sign up",
  description:
    "Create a Campus Gaming Network account, pick your home school, and join the campus gaming scene.",
  path: "/signup"
});

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function SignupPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const query = param(params.q);
  const selectedSchoolId = param(params.school_id);
  const result = query.trim().length >= 2
    ? await listSchools({ query, limit: 50 })
        .then(({ schools }) => ({ schools, failed: false }))
        .catch(() => ({ schools: [], failed: true }))
    : { schools: [], failed: false };

  return (
    <main className="auth-page">
      <section className="page-heading">
        <p className="eyebrow">Create account</p>
        <h1>Join with your home school.</h1>
        <p className="lede">
          You need to be 18 or older, choose an active home school, and verify
          your email before logging in.
        </p>
      </section>

      <NoScriptSchoolSearch action="/signup" query={query} queryParam="q" />

      <SignupForm
        schools={result.schools}
        selectedSchoolId={selectedSchoolId}
        initialSchoolQuery={query}
        initialSchoolSearchFailed={result.failed}
      />
      <p className="form-footer">
        Already verified? <Link className="link" href="/login">Log in</Link>
      </p>
    </main>
  );
}

function param(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}
