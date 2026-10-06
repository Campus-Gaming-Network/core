import { Link, createFileRoute } from "@tanstack/react-router";
import {
  CatalogNoticeView,
  GameImportForm,
} from "../features/catalog/catalog-components";
import { searchIGDBGames } from "../features/catalog/catalog.functions";
import { validateCatalogDetailSearch } from "../features/catalog/contracts";

export const Route = createFileRoute("/games/import")({
  validateSearch: (search: Record<string, unknown>) => {
    const { notice } = validateCatalogDetailSearch(search);
    const q = typeof search.q === "string" ? search.q.trim().slice(0, 100) : "";
    return { ...(q ? { q } : {}), ...(notice ? { notice } : {}) };
  },
  loaderDeps: ({ search }) => ({ q: search.q }),
  loader: ({ deps }) => searchIGDBGames({ data: deps }),
  staleTime: 0,
  head: () => ({ meta: [{ title: "Import a game | CGN Admin Console" }] }),
  component: GameImportPage,
});

function GameImportPage() {
  const result = Route.useLoaderData();
  const search = Route.useSearch();

  return (
    <div className="page-stack">
      <header className="page-header">
        <div>
          <Link className="back-link" to="/games">
            ← Games
          </Link>
          <p className="eyebrow">Catalog</p>
          <h1>Import a game from IGDB</h1>
          <p>
            Search IGDB by name and import one game. Its name, slug, and cover
            come from IGDB. An imported game stays hidden from the public picker
            until you show it.
          </p>
        </div>
      </header>

      <CatalogNoticeView notice={search.notice} />

      <form action="/games/import" className="filter-panel" method="get">
        <label>
          Game name
          <input
            defaultValue={search.q ?? ""}
            maxLength={100}
            minLength={2}
            name="q"
            required
            spellCheck={false}
            type="search"
          />
        </label>
        <div className="filter-actions">
          <button type="submit">Search IGDB</button>
        </div>
      </form>

      {result.error ? (
        <p className="notice notice--error" role="alert">
          {result.error}
        </p>
      ) : null}

      {result.games.length ? (
        <section className="detail-panel" aria-labelledby="igdb-matches">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Search results</p>
              <h2 id="igdb-matches">Choose a game</h2>
            </div>
          </div>
          <GameImportForm matches={result.games} />
        </section>
      ) : result.query && !result.error ? (
        <section className="empty-panel">
          <h2>IGDB has no match for this search</h2>
          <p>Try another name.</p>
        </section>
      ) : null}
    </div>
  );
}
