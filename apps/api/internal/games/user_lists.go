package games

import (
	"context"
	"errors"
	"fmt"
	"slices"

	"github.com/Campus-Gaming-Network/core/apps/api/internal/apperror"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

// List names one of the game lists on a user's profile.
type List string

const (
	ListFavorite   List = "favorite"
	ListLike       List = "like"
	ListWantToPlay List = "want_to_play"
)

// MaximumFavorites caps a user's favorite games, so the list reads as a
// highlight. The other lists are uncapped. The database enforces the same cap.
const MaximumFavorites = 5

// MaximumAddedGames bounds how many games one request adds to a list.
const MaximumAddedGames = 10

var (
	ErrFavoritesFull      = apperror.New(apperror.KindConflict, "favorite_games_full", "a user lists at most five favorite games")
	ErrListedGameNotFound = apperror.New(apperror.KindNotFound, "listed_game_not_found", "the game is not in the user's lists")
	ErrListUserNotFound   = apperror.New(apperror.KindNotFound, "user_not_found", "the user does not exist")
)

// Valid reports whether list names a profile game list.
func (list List) Valid() bool {
	return list == ListFavorite || list == ListLike || list == ListWantToPlay
}

// UserLists are the games a user lists on their profile, each list in the
// user's order. A game the catalog has deleted is left out.
type UserLists struct {
	Favorite   []Game `json:"favorite"`
	Like       []Game `json:"like"`
	WantToPlay []Game `json:"want_to_play"`
}

// Games returns every listed game, favorites first.
func (lists UserLists) Games() []*Game {
	result := make([]*Game, 0, len(lists.Favorite)+len(lists.Like)+len(lists.WantToPlay))
	for _, list := range [][]Game{lists.Favorite, lists.Like, lists.WantToPlay} {
		for index := range list {
			result = append(result, &list[index])
		}
	}
	return result
}

// UserLists returns the games a user lists on their profile.
func (r *PostgresRepository) UserLists(ctx context.Context, userID string) (UserLists, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT ug.list, `+gameColumns+`
		FROM user_games ug
		JOIN games ON games.id = ug.game_id
		WHERE ug.user_id = $1::uuid AND games.deleted_at IS NULL
		ORDER BY ug.list, ug.position
	`, userID)
	if err != nil {
		return UserLists{}, fmt.Errorf("list user games: %w", err)
	}
	defer rows.Close()

	lists := UserLists{Favorite: []Game{}, Like: []Game{}, WantToPlay: []Game{}}
	for rows.Next() {
		var list List
		var game Game
		if err := rows.Scan(&list, &game.ID, &game.Name, &game.Slug, &game.CoverURL, &game.HasCover); err != nil {
			return UserLists{}, fmt.Errorf("scan user game: %w", err)
		}
		switch list {
		case ListFavorite:
			lists.Favorite = append(lists.Favorite, game)
		case ListLike:
			lists.Like = append(lists.Like, game)
		case ListWantToPlay:
			lists.WantToPlay = append(lists.WantToPlay, game)
		}
	}
	if err := rows.Err(); err != nil {
		return UserLists{}, fmt.Errorf("iterate user games: %w", err)
	}
	return lists, nil
}

// AddToList appends games to the end of one of a user's lists, in order. A
// game already in another of the user's lists moves to this one; a game
// already in this list keeps its place. Adding past the fifth favorite fails
// with ErrFavoritesFull and adds nothing.
func (r *PostgresRepository) AddToList(ctx context.Context, userID string, list List, gameIDs []string) error {
	unique := make([]string, 0, len(gameIDs))
	for _, gameID := range gameIDs {
		if !slices.Contains(unique, gameID) {
			unique = append(unique, gameID)
		}
	}
	gameIDs = unique
	if !list.Valid() || len(gameIDs) == 0 || len(gameIDs) > MaximumAddedGames {
		return apperror.Validation("invalid game list change")
	}
	return r.changeLists(ctx, userID, func(tx pgx.Tx) error {
		var usable int
		if err := tx.QueryRow(ctx, `
			SELECT COUNT(*) FROM games
			WHERE id::text = ANY($1) AND deleted_at IS NULL AND (is_active OR user_submitted)
		`, gameIDs).Scan(&usable); err != nil {
			return fmt.Errorf("check listed games: %w", err)
		}
		if usable != len(gameIDs) {
			return ErrGameUnavailable
		}
		for _, gameID := range gameIDs {
			if _, err := tx.Exec(ctx, `DELETE FROM user_games WHERE user_id = $1::uuid AND game_id = $2::uuid AND list <> $3`, userID, gameID, list); err != nil {
				return fmt.Errorf("move listed game: %w", err)
			}
			// The target list has no gaps here, so the next position is its
			// length, and a sixth favorite fails the database's cap. A game
			// already in the list is skipped before the cap is checked.
			_, err := tx.Exec(ctx, `
				INSERT INTO user_games (user_id, game_id, list, position)
				SELECT $1::uuid, $2::uuid, $3, (SELECT COUNT(*) FROM user_games WHERE user_id = $1::uuid AND list = $3)
				WHERE NOT EXISTS (SELECT 1 FROM user_games WHERE user_id = $1::uuid AND game_id = $2::uuid)
			`, userID, gameID, list)
			var pgErr *pgconn.PgError
			if errors.As(err, &pgErr) && pgErr.ConstraintName == "user_games_favorite_cap" {
				return ErrFavoritesFull
			}
			if err != nil {
				return fmt.Errorf("add listed game: %w", err)
			}
		}
		return nil
	})
}

// RemoveFromLists takes a game off whichever of the user's lists holds it.
func (r *PostgresRepository) RemoveFromLists(ctx context.Context, userID, gameID string) error {
	return r.changeLists(ctx, userID, func(tx pgx.Tx) error {
		tag, err := tx.Exec(ctx, `DELETE FROM user_games WHERE user_id = $1::uuid AND game_id = $2::uuid`, userID, gameID)
		if err != nil {
			return fmt.Errorf("remove listed game: %w", err)
		}
		if tag.RowsAffected() == 0 {
			return ErrListedGameNotFound
		}
		return nil
	})
}

// MoveInList moves a listed game to a position in its list, counted from 0.
// A position past the end moves it to the end.
func (r *PostgresRepository) MoveInList(ctx context.Context, userID, gameID string, position int) error {
	if position < 0 {
		return apperror.Validation("invalid game list position")
	}
	return r.changeLists(ctx, userID, func(tx pgx.Tx) error {
		var list List
		var current, length int
		err := tx.QueryRow(ctx, `
			SELECT ug.list, ug.position,
				(SELECT COUNT(*) FROM user_games other WHERE other.user_id = ug.user_id AND other.list = ug.list)
			FROM user_games ug
			WHERE ug.user_id = $1::uuid AND ug.game_id = $2::uuid
		`, userID, gameID).Scan(&list, &current, &length)
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrListedGameNotFound
		}
		if err != nil {
			return fmt.Errorf("find listed game: %w", err)
		}
		position = min(position, length-1)
		// Shift the games between the old and new positions by one. Positions
		// are unique only at commit, so the moved game may overlap meanwhile.
		if _, err := tx.Exec(ctx, `
			UPDATE user_games
			SET position = position + CASE WHEN $4 < $3 THEN 1 ELSE -1 END
			WHERE user_id = $1::uuid AND list = $2
			  AND position BETWEEN LEAST($3::int, $4::int) AND GREATEST($3::int, $4::int)
			  AND position <> $3
		`, userID, list, current, position); err != nil {
			return fmt.Errorf("shift listed games: %w", err)
		}
		if _, err := tx.Exec(ctx, `UPDATE user_games SET position = $3 WHERE user_id = $1::uuid AND game_id = $2::uuid`, userID, gameID, position); err != nil {
			return fmt.Errorf("move listed game: %w", err)
		}
		return nil
	})
}

// changeLists runs one change to a user's lists with the user's row locked,
// so concurrent changes apply one at a time. It first drops games the catalog
// has deleted, which no list shows, and afterwards closes any gaps the change
// left in the positions.
func (r *PostgresRepository) changeLists(ctx context.Context, userID string, change func(pgx.Tx) error) error {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	var locked bool
	err = tx.QueryRow(ctx, `SELECT TRUE FROM users WHERE id = $1::uuid AND deleted_at IS NULL FOR NO KEY UPDATE`, userID).Scan(&locked)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrListUserNotFound
	}
	if err != nil {
		return fmt.Errorf("lock user: %w", err)
	}
	if _, err := tx.Exec(ctx, `
		DELETE FROM user_games ug USING games g
		WHERE ug.user_id = $1::uuid AND g.id = ug.game_id AND g.deleted_at IS NOT NULL
	`, userID); err != nil {
		return fmt.Errorf("drop deleted listed games: %w", err)
	}
	if err := renumberLists(ctx, tx, userID); err != nil {
		return err
	}
	if err := change(tx); err != nil {
		return err
	}
	if err := renumberLists(ctx, tx, userID); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// renumberLists numbers each of a user's lists from 0 in its current order.
// Positions only decrease, so the favorite cap holds throughout.
func renumberLists(ctx context.Context, tx pgx.Tx, userID string) error {
	if _, err := tx.Exec(ctx, `
		UPDATE user_games ug
		SET position = ranked.position
		FROM (
			SELECT game_id, (ROW_NUMBER() OVER (PARTITION BY list ORDER BY position, created_at, game_id) - 1)::int AS position
			FROM user_games WHERE user_id = $1::uuid
		) ranked
		WHERE ug.user_id = $1::uuid AND ug.game_id = ranked.game_id AND ug.position <> ranked.position
	`, userID); err != nil {
		return fmt.Errorf("renumber listed games: %w", err)
	}
	return nil
}
