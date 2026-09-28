import { Link, createFileRoute } from "@tanstack/react-router";
import {
  CatalogNoticeView,
  SchoolForm,
} from "../features/catalog/catalog-components";
import { validateCatalogDetailSearch } from "../features/catalog/contracts";

export const Route = createFileRoute("/schools/new")({
  validateSearch: validateCatalogDetailSearch,
  head: () => ({ meta: [{ title: "New school | CGN Admin Console" }] }),
  component: NewSchoolPage,
});

function NewSchoolPage() {
  const search = Route.useSearch();

  return (
    <div className="page-stack detail-page">
      <header className="detail-header">
        <div>
          <Link className="back-link" to="/schools">
            ← Schools
          </Link>
          <p className="eyebrow">Catalog</p>
          <h1>New school</h1>
          <p>
            New schools are active and appear on the public site immediately.
            The IPEDS unit ID is optional.
          </p>
        </div>
      </header>
      <CatalogNoticeView notice={search.notice} />
      <section className="detail-panel" aria-label="School details">
        <SchoolForm />
      </section>
    </div>
  );
}
