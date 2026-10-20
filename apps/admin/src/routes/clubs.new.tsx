import { adminTitle } from "../components/page-title";
import { Link, createFileRoute } from "@tanstack/react-router";
import {
  CatalogNoticeView,
  ClubForm,
} from "../features/catalog/catalog-components";
import { getNewClubSchool } from "../features/catalog/catalog.functions";
import {
  validateCatalogDetailSearch,
  type CatalogDetailSearch,
} from "../features/catalog/contracts";

type NewClubSearch = CatalogDetailSearch & { school?: string };

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const Route = createFileRoute("/clubs/new")({
  validateSearch: (search: Record<string, unknown>): NewClubSearch => ({
    ...validateCatalogDetailSearch(search),
    ...(typeof search.school === "string" && uuidPattern.test(search.school)
      ? { school: search.school }
      : {}),
  }),
  loaderDeps: ({ search }) => ({ school: search.school }),
  loader: ({ deps }) =>
    deps.school ? getNewClubSchool({ data: { id: deps.school } }) : null,
  head: () => ({ meta: [{ title: adminTitle("New club") }] }),
  component: NewClubPage,
});

function NewClubPage() {
  const school = Route.useLoaderData();
  const search = Route.useSearch();

  return (
    <div className="page-stack detail-page">
      <header className="detail-header">
        <div>
          {school ? (
            <Link
              className="back-link"
              params={{ schoolId: school.id }}
              to="/schools/$schoolId"
            >
              ← {school.name}
            </Link>
          ) : (
            <Link className="back-link" to="/clubs">
              ← Clubs
            </Link>
          )}
          <p className="eyebrow">Catalog</p>
          <h1>New club</h1>
          <p>
            {school
              ? `The club belongs to ${school.name}. It is published and unclaimed, and its page says it is maintained by Campus Gaming Network.`
              : "Start from the school's page in Schools, so the club belongs to the right school."}
          </p>
        </div>
      </header>
      <CatalogNoticeView notice={search.notice} />
      {school && school.is_active ? (
        <section className="detail-panel" aria-label="Club details">
          <ClubForm schoolID={school.id} />
        </section>
      ) : school ? (
        <p className="notice notice--error">
          {school.name} is not active, so it cannot have new clubs.
        </p>
      ) : (
        <Link className="primary-button" to="/schools">
          Choose a school
        </Link>
      )}
    </div>
  );
}
