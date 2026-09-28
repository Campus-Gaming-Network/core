import { Link, createFileRoute } from "@tanstack/react-router";
import {
  CatalogFilters,
  CatalogNoticeView,
  CursorPagination,
  GameForm,
  StateBadge,
  recordState,
} from "../features/catalog/catalog-components";
import { getGames } from "../features/catalog/catalog.functions";
import {
  catalogListKinds,
  validateCatalogDetailSearch,
  validateCatalogSearch,
} from "../features/catalog/contracts";

export const Route = createFileRoute("/games/")({
  validateSearch: (search: Record<string, unknown>) => ({
    ...validateCatalogSearch("games")(search),
    ...validateCatalogDetailSearch(search),
  }),
  loaderDeps: ({ search }) => ({
    q: search.q,
    state: search.state,
    after: search.after,
    before: search.before,
  }),
  loader: ({ deps }) => getGames({ data: deps }),
  staleTime: 0,
  head: () => ({ meta: [{ title: "Games | CGN Admin Console" }] }),
  component: GamesPage,
});

function GamesPage() {
  const page = Route.useLoaderData();
  const search = Route.useSearch();

  return (
    <div className="page-stack">
      <header className="page-header">
        <div>
          <p className="eyebrow">Catalog</p>
          <h1>Games</h1>
          <p>
            The curated game list. Inactive games leave the public picker, but
            events and teams that already use them keep them.
          </p>
        </div>
      </header>

      <CatalogNoticeView notice={search.notice} />

      <CatalogFilters
        action="/games"
        label="Name or slug"
        search={search}
        states={catalogListKinds.games}
      />

      {page.games.length ? (
        <section className="queue-list" aria-label="Games">
          {page.games.map((game) => (
            <Link
              className="queue-card"
              key={game.id}
              params={{ gameId: game.id }}
              to="/games/$gameId"
            >
              <span className="queue-card__topline">
                <strong>{game.name}</strong>
                <StateBadge state={recordState(game)} />
              </span>
              <span>
                <code>{game.slug}</code>
              </span>
            </Link>
          ))}
        </section>
      ) : (
        <section className="empty-panel">
          <h2>No games match this search</h2>
          <p>Try another name, or clear the state filter.</p>
        </section>
      )}

      <CursorPagination
        label="Game pages"
        path="/games"
        search={search}
        previousCursor={page.previous_cursor}
        nextCursor={page.next_cursor}
      />

      <section className="detail-panel" aria-labelledby="new-game">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Catalog record</p>
            <h2 id="new-game">Add a game</h2>
          </div>
        </div>
        <GameForm />
      </section>
    </div>
  );
}
