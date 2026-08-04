import { Button } from "@heroui/react/button";
import { Input } from "@heroui/react/input";
import Link from "next/link";
import { SignupForm } from "../../components/auth-forms";
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
  const result = await listSchools({ query, limit: 50 }).catch(() => ({
    schools: []
  }));

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

      <form action="/signup" className="search-bar compact">
        <label>
          Find home school
          <Input
            name="q"
            defaultValue={query}
            placeholder="Search schools before signing up"
          />
        </label>
        <Button type="submit">Search</Button>
      </form>

      <SignupForm
        schools={result.schools}
        selectedSchoolId={selectedSchoolId}
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
