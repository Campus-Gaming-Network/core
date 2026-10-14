package main

import (
	"context"
	"net"
	"net/http"
	"sync"
	"testing"
	"time"
)

type serveFixture struct {
	cancel   context.CancelFunc
	url      string
	started  chan struct{}
	release  chan struct{}
	workers  *sync.WaitGroup
	workerOK chan struct{}
	result   chan error
}

func startServeFixture(t *testing.T, timeout time.Duration) *serveFixture {
	t.Helper()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	fixture := &serveFixture{
		url:      "http://" + listener.Addr().String(),
		started:  make(chan struct{}),
		release:  make(chan struct{}),
		workers:  &sync.WaitGroup{},
		workerOK: make(chan struct{}),
		result:   make(chan error, 1),
	}
	t.Cleanup(func() {
		select {
		case <-fixture.release:
		default:
			close(fixture.release)
		}
	})
	ctx, cancel := context.WithCancel(context.Background())
	fixture.cancel = cancel
	t.Cleanup(cancel)

	fixture.workers.Go(func() {
		<-ctx.Done()
		close(fixture.workerOK)
	})
	server := &http.Server{Handler: http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		close(fixture.started)
		<-fixture.release
		w.WriteHeader(http.StatusNoContent)
	})}
	go func() { fixture.result <- serve(ctx, server, listener, fixture.workers, timeout) }()
	return fixture
}

func TestServeDrainsInFlightRequestsAndStopsWorkers(t *testing.T) {
	fixture := startServeFixture(t, time.Minute)

	status := make(chan int, 1)
	go func() {
		response, err := http.Get(fixture.url)
		if err != nil {
			status <- 0
			return
		}
		response.Body.Close()
		status <- response.StatusCode
	}()
	<-fixture.started
	fixture.cancel()
	close(fixture.release)

	if got := <-status; got != http.StatusNoContent {
		t.Fatalf("in-flight status = %d, want %d", got, http.StatusNoContent)
	}
	if err := <-fixture.result; err != nil {
		t.Fatalf("serve() error = %v, want nil", err)
	}
	select {
	case <-fixture.workerOK:
	default:
		t.Fatal("serve() returned before the background worker stopped")
	}
	if _, err := http.Get(fixture.url); err == nil {
		t.Fatal("server still accepts connections after shutdown")
	}
}

func TestServeReportsRequestsThatOutlastTheShutdownTimeout(t *testing.T) {
	fixture := startServeFixture(t, 50*time.Millisecond)

	go func() {
		if response, err := http.Get(fixture.url); err == nil {
			response.Body.Close()
		}
	}()
	<-fixture.started
	fixture.cancel()

	if err := <-fixture.result; err == nil {
		t.Fatal("serve() error = nil, want a shutdown timeout error")
	}
}
