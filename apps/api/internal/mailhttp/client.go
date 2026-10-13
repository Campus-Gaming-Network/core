// Package mailhttp provides the bounded HTTP transport used by email providers.
package mailhttp

import (
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"regexp"
	"time"
)

// ResponseError preserves enough status information for the outbox dispatcher
// to distinguish permanent recipient/request failures from transient provider
// failures without coupling the HTTP client package to the worker package.
type ResponseError struct {
	StatusCode int
	Status     string
	Detail     string
}

func (e *ResponseError) Error() string {
	return fmt.Sprintf("email provider returned %s: %s", e.Status, e.Detail)
}

// errorNamePattern limits a provider's error name to an identifier, so a
// response that puts free text there cannot reach the logs.
var errorNamePattern = regexp.MustCompile(`^[a-z0-9_]{1,64}$`)

// ErrorName returns the provider's machine-readable error name, such as
// Resend's "validation_error". It is empty when the response carries none.
func (e *ResponseError) ErrorName() string {
	var body struct {
		Name string `json:"name"`
	}
	if err := json.Unmarshal([]byte(e.Detail), &body); err != nil {
		return ""
	}
	if !errorNamePattern.MatchString(body.Name) {
		return ""
	}
	return body.Name
}

func (e *ResponseError) Permanent() bool {
	return e.StatusCode >= http.StatusBadRequest && e.StatusCode < http.StatusInternalServerError &&
		e.StatusCode != http.StatusRequestTimeout && e.StatusCode != http.StatusTooManyRequests
}

const (
	ConnectTimeout        = 3 * time.Second
	ResponseHeaderTimeout = 5 * time.Second
	OverallTimeout        = 10 * time.Second
)

// NewClient bounds connection establishment, response headers, TLS setup, and
// the entire request. Callers still add a per-message context deadline.
func NewClient() *http.Client {
	return &http.Client{
		Timeout: OverallTimeout,
		Transport: &http.Transport{
			Proxy: http.ProxyFromEnvironment,
			DialContext: (&net.Dialer{
				Timeout:   ConnectTimeout,
				KeepAlive: 30 * time.Second,
			}).DialContext,
			ForceAttemptHTTP2:     true,
			ResponseHeaderTimeout: ResponseHeaderTimeout,
			TLSHandshakeTimeout:   ConnectTimeout,
			IdleConnTimeout:       90 * time.Second,
		},
	}
}
