package main

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"
	"sync"
	"time"
)

// serve runs server on listener until ctx is cancelled or the server fails. It
// then stops accepting connections, gives in-flight requests up to timeout to
// finish, and waits for the background workers (which stop on the same ctx) so
// the caller can close the database pool safely.
func serve(ctx context.Context, server *http.Server, listener net.Listener, workers *sync.WaitGroup, timeout time.Duration) error {
	failed := make(chan error, 1)
	go func() { failed <- server.Serve(listener) }()

	var serveErr error
	select {
	case <-ctx.Done():
	case err := <-failed:
		if !errors.Is(err, http.ErrServerClosed) {
			serveErr = fmt.Errorf("serve: %w", err)
		}
	}

	shutdownCtx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	if err := server.Shutdown(shutdownCtx); err != nil {
		_ = server.Close()
		serveErr = errors.Join(serveErr, fmt.Errorf("shutdown: %w", err))
	}

	done := make(chan struct{})
	go func() {
		workers.Wait()
		close(done)
	}()
	select {
	case <-done:
	case <-shutdownCtx.Done():
		serveErr = errors.Join(serveErr, errors.New("background workers did not stop in time"))
	}
	return serveErr
}
