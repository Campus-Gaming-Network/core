package httpapi

import (
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"
)

func TestEventRoutesRejectWrongMethodsAndUnknownPaths(t *testing.T) {
	type answer struct {
		Status int
		Allow  string
		Body   string
	}
	const (
		notFound   = "404 page not found"
		notAllowed = `{"error":"method_not_allowed"}`
		badSlug    = `{"error":"invalid_event_slug"}`
		noStore    = `{"error":"database_unavailable"}`
	)
	allEvents := "GET, PATCH, DELETE"
	for _, test := range []struct {
		name   string
		method string
		path   string
		want   answer
	}{
		{"event with a wrong method", http.MethodPut, "/events/chess", answer{405, allEvents, notAllowed}},
		{"event with a bad slug", http.MethodGet, "/events/%25zz", answer{400, "", badSlug}},
		{"event with a trailing slash", http.MethodPut, "/events/chess/", answer{405, allEvents, notAllowed}},
		{"events root with a slash", http.MethodGet, "/events/", answer{404, "", notFound}},
		{"unlock with a wrong method", http.MethodGet, "/events/chess/unlock", answer{405, "POST", notAllowed}},
		{"rsvp with a wrong method", http.MethodGet, "/events/chess/rsvp", answer{405, "POST", notAllowed}},
		{"rsvp with a wrong method and a bad slug", http.MethodGet, "/events/%25zz/rsvp", answer{405, "POST", notAllowed}},
		{"rsvp with a bad slug", http.MethodPost, "/events/%25zz/rsvp", answer{400, "", badSlug}},
		{"rsvp with a trailing slash", http.MethodGet, "/events/chess/rsvp/", answer{405, "POST", notAllowed}},
		{"interest with a wrong method", http.MethodGet, "/events/chess/interest", answer{405, "POST, DELETE", notAllowed}},
		{"report with a wrong method", http.MethodGet, "/events/chess/report", answer{405, "POST", notAllowed}},
		{"organizer invites with a wrong method", http.MethodPut, "/events/chess/organizer-invites", answer{405, "GET, POST", notAllowed}},
		{"organizer invites with a bad slug and a wrong method", http.MethodPut, "/events/%25zz/organizer-invites", answer{400, "", badSlug}},
		{"organizer invite with a wrong method", http.MethodGet, "/events/chess/organizer-invites/abc", answer{405, "DELETE", notAllowed}},
		{"organizer with a wrong method", http.MethodGet, "/events/chess/organizers/abc", answer{405, "DELETE", notAllowed}},
		{"creator transfer with a wrong method", http.MethodGet, "/events/chess/organizers/abc/creator", answer{405, "POST", notAllowed}},
		{"activity with a wrong method", http.MethodPost, "/events/chess/activity", answer{405, "GET", notAllowed}},
		{"activity with a bad slug and a wrong method", http.MethodPost, "/events/%25zz/activity", answer{400, "", badSlug}},
		{"attendees with a bad slug", http.MethodGet, "/events/%25zz/attendees", answer{400, "", badSlug}},
		{"unknown sub-resource", http.MethodGet, "/events/chess/nope", answer{404, "", notFound}},
		{"organizers without an ID", http.MethodGet, "/events/chess/organizers", answer{404, "", notFound}},
		{"organizers path too deep", http.MethodGet, "/events/chess/organizers/abc/creator/more", answer{404, "", notFound}},
		{"organizer sub-resource that is not creator", http.MethodPost, "/events/chess/organizers/abc/other", answer{404, "", notFound}},
		{"organizer invite path too deep", http.MethodGet, "/events/chess/organizer-invites/abc/more", answer{404, "", notFound}},
		{"rsvp path too deep", http.MethodPost, "/events/chess/rsvp/more", answer{404, "", notFound}},
	} {
		t.Run(test.name, func(t *testing.T) {
			router := &Router{events: &fakeEventRepository{}}
			response := httptest.NewRecorder()
			router.eventRoutes().ServeHTTP(response, httptest.NewRequest(test.method, test.path, nil))
			got := answer{response.Code, response.Header().Get("Allow"), strings.TrimSpace(response.Body.String())}
			if !reflect.DeepEqual(got, test.want) {
				t.Fatalf("%s %s = %+v, want %+v", test.method, test.path, got, test.want)
			}
		})
	}

	for _, path := range []string{"/events/chess", "/events/chess/rsvp", "/events/chess/organizers/abc", "/events/chess/unknown", "/events/chess/rsvp/"} {
		response := httptest.NewRecorder()
		(&Router{}).eventRoutes().ServeHTTP(response, httptest.NewRequest(http.MethodGet, path, nil))
		if got, want := (answer{response.Code, "", strings.TrimSpace(response.Body.String())}), (answer{503, "", noStore}); got != want {
			t.Errorf("GET %s without an event store = %+v, want %+v", path, got, want)
		}
	}
}
