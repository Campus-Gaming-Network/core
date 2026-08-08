import { Button } from "@heroui/react/button";
import { EmptyState } from "@heroui/react/empty-state";
import { Input } from "@heroui/react/input";
import Link from "next/link";
import { listSchools } from "../../../lib/server-api";
import { pageMetadata } from "../../../lib/metadata";

export const metadata = pageMetadata({
  title: "Schools",
  description:
    "Search and follow colleges and universities to see their gaming events and teams.",
  path: "/schools"
});

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function SchoolsPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const query = param(params.q);
  const state = param(params.state);
  const result = await listSchools({ query, state, limit: 25 }).catch(() => ({
    schools: [],
    limit: 25,
    offset: 0
  }));

  return (
    <main className="narrow">
      <section className="page-heading">
        <p className="eyebrow">Schools</p>
        <h1>Browse schools</h1>
        <p className="lede">
          Search by school name or filter by state. Main and branch campuses are
          listed the same way.
        </p>
      </section>

      <form action="/schools" className="search-bar">
        <label>
          Search
          <Input
            name="q"
            defaultValue={query}
            placeholder="University, college, campus"
          />
        </label>
        <label>
          State
          <Input name="state" defaultValue={state} placeholder="CA" maxLength={2} />
        </label>
        <Button type="submit">Search</Button>
      </form>

      {result.schools.length > 0 ? (
        <div className="list">
          {result.schools.map((school) => (
            <Link className="card card--default list-item" href={`/schools/${school.slug}`} key={school.id}>
              <span>
                <strong>{school.name}</strong>
                {school.alias ? <small>{school.alias}</small> : null}
              </span>
              <span>{schoolLocation(school.city, school.state)}</span>
            </Link>
          ))}
        </div>
      ) : (
        <EmptyState>
          <h2>No schools found</h2>
          <p>
            Try a broader school name or clear the state filter. If this keeps
            happening, the API may still be starting.
          </p>
        </EmptyState>
      )}
    </main>
  );
}

function param(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function schoolLocation(city?: string, state?: string) {
  return [city, state].filter(Boolean).join(", ") || "Location pending";
}
