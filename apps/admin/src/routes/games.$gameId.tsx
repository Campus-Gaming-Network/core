import { Link, createFileRoute } from "@tanstack/react-router";
import { CopyIdButton } from "../components/copy-id-button";
import {
  CatalogAuditPanel,
  CatalogNoticeView,
  CommandForm,
  GameForm,
  StateBadge,
  recordState,
} from "../features/catalog/catalog-components";
import { getGameDetail } from "../features/catalog/catalog.functions";
import { validateCatalogDetailSearch } from "../features/catalog/contracts";
import {
  DetailFact,
  formatTimestamp,
} from "../features/moderation/moderation-components";

export const Route = createFileRoute("/games/$gameId")({
  validateSearch: validateCatalogDetailSearch,
  loaderDeps: ({ search }) => ({
    audit_after: search.audit_after,
    audit_before: search.audit_before,
  }),
  loader: ({ params, deps }) =>
    getGameDetail({ data: { id: params.gameId, ...deps } }),
  staleTime: 0,
  head: () => ({ meta: [{ title: "Game detail | CGN Admin Console" }] }),
  component: GameDetailPage,
});

function GameDetailPage() {
  const { game, audit } = Route.useLoaderData();
  const search = Route.useSearch();
  const { admin } = Route.useRouteContext();
  const capabilities =
    admin.status === "authenticated" ? admin.session.capabilities : [];
  const state = recordState(game);
  const path = `/games/${encodeURIComponent(game.id)}`;

  return (
    <div className="page-stack detail-page">
      <header className="detail-header">
        <div>
          <Link className="back-link" to="/games">
            ← Games
          </Link>
          <p className="eyebrow">Game</p>
          <h1>{game.name}</h1>
          <CopyIdButton entity="game" id={game.id} />
        </div>
        <StateBadge state={state} />
      </header>

      <CatalogNoticeView notice={search.notice} />

      <section className="detail-panel" aria-labelledby="game-facts">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Current record</p>
            <h2 id="game-facts">Game information</h2>
          </div>
        </div>
        <dl className="detail-facts">
          <DetailFact label="Slug">
            <code>{game.slug}</code>
          </DetailFact>
          <DetailFact label="Public picker">
            {game.is_active ? "Shown" : "Hidden"}
          </DetailFact>
          <DetailFact label="Cover image">
            {game.cover_url || "Not set"}
          </DetailFact>
          <DetailFact label="Last changed">
            <time dateTime={game.updated_at}>
              {formatTimestamp(game.updated_at)}
            </time>
          </DetailFact>
        </dl>
      </section>

      {state !== "deleted" ? (
        <section className="detail-panel" aria-labelledby="game-edit">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Catalog record</p>
              <h2 id="game-edit">Edit game</h2>
            </div>
          </div>
          <GameForm game={game} />
        </section>
      ) : null}

      {state !== "deleted" ? (
        <section className="detail-panel" aria-labelledby="game-removal">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Lifecycle</p>
              <h2 id="game-removal">Removal</h2>
            </div>
          </div>
          <CommandForm
            command="game.delete"
            description="Soft-deletes a game no event or team uses. Hide a game that is in use instead."
            expectedUpdatedAt={game.updated_at}
            id={game.id}
            returnPath={path}
            submitLabel="Delete game"
            title="Delete"
          />
        </section>
      ) : null}

      {capabilities.includes("audit.read") ? (
        <CatalogAuditPanel audit={audit} path={path} search={search} />
      ) : null}
    </div>
  );
}
