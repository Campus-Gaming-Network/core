// Package igdb is a small client for the IGDB game database. It authenticates
// with Twitch application credentials and never runs in a browser.
package igdb

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"sync"
	"time"
)

const (
	DefaultAPIURL   = "https://api.igdb.com/v4"
	DefaultTokenURL = "https://id.twitch.tv/oauth2/token"
	DefaultImageURL = "https://images.igdb.com/igdb/image/upload"

	// MaxCoverBytes matches the size check on game_covers.bytes.
	MaxCoverBytes = 100 << 10

	// coverSize is about twice the largest size a cover is displayed at.
	coverSize       = "t_cover_big"
	searchLimit     = 20
	maxResponseSize = 1 << 20
	requestTimeout  = 10 * time.Second
	// tokenRefreshMargin replaces a token shortly before Twitch expires it.
	tokenRefreshMargin = 5 * time.Minute
)

var (
	ErrNotFound         = errors.New("igdb: game not found")
	ErrRateLimited      = errors.New("igdb: rate limited")
	ErrUnavailable      = errors.New("igdb: unavailable")
	ErrCoverTooLarge    = errors.New("igdb: cover exceeds the size limit")
	ErrCoverUnsupported = errors.New("igdb: cover is not a supported image")
)

var imageIDPattern = regexp.MustCompile(`^[a-z0-9_]{1,64}$`)

// Game is the part of an IGDB game the catalog stores.
type Game struct {
	ID   int64
	Name string
	Slug string
	// CoverImageID is empty when IGDB has no cover for the game.
	CoverImageID string
	// ReleaseYear is zero when IGDB has no release date.
	ReleaseYear int
}

// Cover is a downloaded cover image.
type Cover struct {
	ImageID     string
	ContentType string
	Bytes       []byte
}

// Config holds the Twitch application credentials. The URLs default to the
// IGDB and Twitch services; tests point them at a fake server.
type Config struct {
	ClientID     string
	ClientSecret string
	APIURL       string
	TokenURL     string
	ImageURL     string
	HTTPClient   *http.Client
	Now          func() time.Time
}

// Client queries IGDB. It is safe for concurrent use.
type Client struct {
	config Config

	// An application may hold only 25 live tokens, so one token is cached and
	// reused until it nears expiry or IGDB rejects it.
	mu           sync.Mutex
	token        string
	tokenExpires time.Time
}

// NewClient returns a client for the configured application.
func NewClient(config Config) *Client {
	if config.APIURL == "" {
		config.APIURL = DefaultAPIURL
	}
	if config.TokenURL == "" {
		config.TokenURL = DefaultTokenURL
	}
	if config.ImageURL == "" {
		config.ImageURL = DefaultImageURL
	}
	if config.HTTPClient == nil {
		config.HTTPClient = &http.Client{Timeout: requestTimeout}
	}
	if config.Now == nil {
		config.Now = time.Now
	}
	return &Client{config: config}
}

// Search returns the games IGDB matches to a name, best match first.
func (c *Client) Search(ctx context.Context, query string) ([]Game, error) {
	escaped := strings.NewReplacer(`\`, `\\`, `"`, `\"`).Replace(strings.TrimSpace(query))
	return c.games(ctx, fmt.Sprintf(`search "%s"; fields name,slug,cover.image_id,first_release_date; limit %d;`, escaped, searchLimit))
}

// Game returns one game by its IGDB ID, or ErrNotFound.
func (c *Client) Game(ctx context.Context, id int64) (Game, error) {
	games, err := c.games(ctx, fmt.Sprintf(`fields name,slug,cover.image_id,first_release_date; where id = %d; limit 1;`, id))
	if err != nil {
		return Game{}, err
	}
	if len(games) == 0 {
		return Game{}, ErrNotFound
	}
	return games[0], nil
}

// Cover downloads a cover image. The type is read from the bytes, not from
// the response header.
func (c *Client) Cover(ctx context.Context, imageID string) (Cover, error) {
	if !imageIDPattern.MatchString(imageID) {
		return Cover{}, ErrCoverUnsupported
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.config.ImageURL+"/"+coverSize+"/"+imageID+".jpg", nil)
	if err != nil {
		return Cover{}, err
	}
	res, err := c.config.HTTPClient.Do(req)
	if err != nil {
		return Cover{}, fmt.Errorf("%w: %v", ErrUnavailable, err)
	}
	defer res.Body.Close()
	if err := statusError(res.StatusCode); err != nil {
		return Cover{}, err
	}
	body, err := io.ReadAll(io.LimitReader(res.Body, MaxCoverBytes+1))
	if err != nil {
		return Cover{}, fmt.Errorf("%w: %v", ErrUnavailable, err)
	}
	if len(body) > MaxCoverBytes {
		return Cover{}, ErrCoverTooLarge
	}
	contentType := http.DetectContentType(body)
	if contentType != "image/jpeg" && contentType != "image/png" && contentType != "image/webp" {
		return Cover{}, ErrCoverUnsupported
	}
	return Cover{ImageID: imageID, ContentType: contentType, Bytes: body}, nil
}

func (c *Client) games(ctx context.Context, query string) ([]Game, error) {
	body, err := c.query(ctx, query, false)
	if err != nil {
		return nil, err
	}
	var rows []struct {
		ID    int64  `json:"id"`
		Name  string `json:"name"`
		Slug  string `json:"slug"`
		Cover struct {
			ImageID string `json:"image_id"`
		} `json:"cover"`
		FirstReleaseDate int64 `json:"first_release_date"`
	}
	if err := json.Unmarshal(body, &rows); err != nil {
		return nil, fmt.Errorf("%w: decode games: %v", ErrUnavailable, err)
	}
	games := make([]Game, 0, len(rows))
	for _, row := range rows {
		game := Game{ID: row.ID, Name: row.Name, Slug: row.Slug, CoverImageID: row.Cover.ImageID}
		if row.FirstReleaseDate != 0 {
			game.ReleaseYear = time.Unix(row.FirstReleaseDate, 0).UTC().Year()
		}
		games = append(games, game)
	}
	return games, nil
}

// query posts one Apicalypse query. A 401 means the cached token was revoked
// early, so the query is retried once with a new token.
func (c *Client) query(ctx context.Context, query string, retried bool) ([]byte, error) {
	token, err := c.accessToken(ctx)
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.config.APIURL+"/games", strings.NewReader(query))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Client-ID", c.config.ClientID)
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Content-Type", "text/plain")
	res, err := c.config.HTTPClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrUnavailable, err)
	}
	defer res.Body.Close()
	if res.StatusCode == http.StatusUnauthorized && !retried {
		c.mu.Lock()
		if c.token == token {
			c.token = ""
		}
		c.mu.Unlock()
		return c.query(ctx, query, true)
	}
	if err := statusError(res.StatusCode); err != nil {
		return nil, err
	}
	body, err := io.ReadAll(io.LimitReader(res.Body, maxResponseSize))
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrUnavailable, err)
	}
	return body, nil
}

func (c *Client) accessToken(ctx context.Context) (string, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.token != "" && c.config.Now().Before(c.tokenExpires.Add(-tokenRefreshMargin)) {
		return c.token, nil
	}
	// The secret travels in the body so it never appears in a logged URL.
	form := url.Values{
		"client_id":     {c.config.ClientID},
		"client_secret": {c.config.ClientSecret},
		"grant_type":    {"client_credentials"},
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.config.TokenURL, bytes.NewBufferString(form.Encode()))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	res, err := c.config.HTTPClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("%w: token request: %v", ErrUnavailable, err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return "", fmt.Errorf("%w: token request returned status %d", ErrUnavailable, res.StatusCode)
	}
	var payload struct {
		AccessToken string `json:"access_token"`
		ExpiresIn   int64  `json:"expires_in"`
	}
	if err := json.NewDecoder(io.LimitReader(res.Body, maxResponseSize)).Decode(&payload); err != nil || payload.AccessToken == "" {
		return "", fmt.Errorf("%w: token response was not usable", ErrUnavailable)
	}
	c.token = payload.AccessToken
	c.tokenExpires = c.config.Now().Add(time.Duration(payload.ExpiresIn) * time.Second)
	return c.token, nil
}

func statusError(status int) error {
	switch {
	case status == http.StatusOK:
		return nil
	case status == http.StatusNotFound:
		return ErrNotFound
	case status == http.StatusTooManyRequests:
		return ErrRateLimited
	default:
		return fmt.Errorf("%w: status %d", ErrUnavailable, status)
	}
}
