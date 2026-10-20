import { adminTitle } from "../components/page-title";
import { Link, createFileRoute } from "@tanstack/react-router";
import { DataTable, dataColumn } from "../components/data-table";
import {
  CatalogFilters,
  CatalogNoticeView,
  CursorPagination,
  StateBadge,
  recordState,
} from "../features/catalog/catalog-components";
import { getGames } from "../features/catalog/catalog.functions";
import {
  catalogListKinds,
  validateCatalogDetailSearch,
  validateCatalogSearch,
  type AdminGame,
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
  head: () => ({ meta: [{ title: adminTitle("Games") }] }),
  component: GamesPage,
});

const gameColumns = [
  dataColumn<AdminGame>({
    id: "name",
    header: "Game",
    sortValue: (row) => row.name,
    cell: (row) => (
      <Link
        className="data-table__primary"
        params={{ gameId: row.id }}
        to="/games/$gameId"
      >
        {row.name}
      </Link>
    ),
  }),
  dataColumn<AdminGame>({
    id: "slug",
    header: "Slug",
    sortValue: (row) => row.slug,
    cell: (row) => <code>{row.slug}</code>,
  }),
  dataColumn<AdminGame>({
    id: "state",
    header: "State",
    sortValue: (row) => recordState(row),
    cell: (row) => <StateBadge state={recordState(row)} />,
  }),
];

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
            Games users added from IGDB, or typed in, for their events and
            teams. Open one to correct its name, slug, or cover, or to hide it.
            A hidden game leaves game search, but events and teams that already
            use it keep it.
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
        <DataTable
          columns={gameColumns}
          data={page.games}
          getRowId={(game) => game.id}
          label="Games"
          rowHeader="name"
        />
      ) : (
        <section className="empty-panel">
          <h2>
            {search.q
              ? `No games match "${search.q}"`
              : "No games match this search"}
          </h2>
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
    </div>
  );
}
