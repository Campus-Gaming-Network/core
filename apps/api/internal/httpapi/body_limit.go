package httpapi

import "net/http"

// maxRequestBodyBytes is the ceiling for any request body. It sits just above
// the largest accepted upload (a 5 MiB school logo plus form overhead); handlers
// that expect less, such as decodeJSON, wrap the body again with a tighter cap.
const maxRequestBodyBytes = 6 << 20

// withBodyLimit rejects a request that declares a body larger than limit with
// 413, and caps the bytes any handler can read from one that does not declare
// its length, so no route can be made to buffer an unbounded body.
func withBodyLimit(limit int64, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		if req.ContentLength > limit {
			writeError(w, http.StatusRequestEntityTooLarge, "request_too_large")
			return
		}
		req.Body = http.MaxBytesReader(w, req.Body, limit)
		next.ServeHTTP(w, req)
	})
}
