package objectstore

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

type recordedRequest struct {
	Method       string
	Path         string
	ContentType  string
	CacheControl string
	Authorized   bool
	Body         string
}

func newRecordingStore(t *testing.T, status int, endpointSuffix string) (*S3Store, *[]recordedRequest) {
	t.Helper()
	var requests []recordedRequest
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		requests = append(requests, recordedRequest{
			Method:       r.Method,
			Path:         r.URL.Path,
			ContentType:  r.Header.Get("Content-Type"),
			CacheControl: r.Header.Get("Cache-Control"),
			Authorized:   strings.Contains(r.Header.Get("Authorization"), "Credential=test-key/"),
			Body:         string(body),
		})
		w.WriteHeader(status)
	}))
	t.Cleanup(server.Close)
	store := NewS3Store(Config{
		Endpoint:        server.URL + endpointSuffix,
		Bucket:          "logos",
		AccessKeyID:     "test-key",
		SecretAccessKey: "test-secret",
	})
	return store, &requests
}

func TestStoreSendsExpectedRequests(t *testing.T) {
	store, requests := newRecordingStore(t, http.StatusOK, "/")
	ctx := context.Background()

	if err := store.Put(ctx, "schools/a.png", "image/png", []byte("png-bytes")); err != nil {
		t.Fatalf("Put() error = %v", err)
	}
	if err := store.Check(ctx); err != nil {
		t.Fatalf("Check() error = %v", err)
	}
	if err := store.Delete(ctx, "schools/a.png"); err != nil {
		t.Fatalf("Delete() error = %v", err)
	}

	want := []recordedRequest{
		{Method: http.MethodPut, Path: "/logos/schools/a.png", ContentType: "image/png", CacheControl: "public, max-age=31536000, immutable", Authorized: true, Body: "png-bytes"},
		{Method: http.MethodHead, Path: "/logos", Authorized: true},
		{Method: http.MethodDelete, Path: "/logos/schools/a.png", Authorized: true},
	}
	got := *requests
	if len(got) != len(want) {
		t.Fatalf("requests = %+v, want %+v", got, want)
	}
	for i := range want {
		// The SDK may stream the body with chunked signing framing; compare
		// the payload by containment and everything else exactly.
		if !strings.Contains(got[i].Body, want[i].Body) {
			t.Errorf("request %d body = %q, want it to contain %q", i, got[i].Body, want[i].Body)
		}
		got[i].Body, want[i].Body = "", ""
		if got[i] != want[i] {
			t.Errorf("request %d = %+v, want %+v", i, got[i], want[i])
		}
	}
}

func TestStoreReturnsErrorOnFailureStatus(t *testing.T) {
	store, _ := newRecordingStore(t, http.StatusForbidden, "")
	ctx := context.Background()

	for name, call := range map[string]func() error{
		"Put":    func() error { return store.Put(ctx, "k", "image/png", []byte("x")) },
		"Check":  func() error { return store.Check(ctx) },
		"Delete": func() error { return store.Delete(ctx, "k") },
	} {
		if err := call(); err == nil {
			t.Errorf("%s() error = nil, want error for 403", name)
		}
	}
}

func TestNewS3StoreDerivesR2Endpoint(t *testing.T) {
	store := NewS3Store(Config{AccountID: "acct123", Bucket: "b"})
	if got, want := *store.client.Options().BaseEndpoint, "https://acct123.r2.cloudflarestorage.com"; got != want {
		t.Errorf("BaseEndpoint = %q, want %q", got, want)
	}
}
