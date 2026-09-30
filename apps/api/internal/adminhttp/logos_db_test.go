package adminhttp

import (
	"bytes"
	"context"
	"encoding/binary"
	"errors"
	"hash/crc32"
	"image"
	"image/jpeg"
	"image/png"
	"io"
	"log/slog"
	"maps"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"net/textproto"
	"reflect"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/Campus-Gaming-Network/core/apps/api/internal/adminaudit"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/logoimage"
	"github.com/Campus-Gaming-Network/core/apps/api/internal/schools"
)

const logoAssetOrigin = "https://assets.example.test"

// memoryObjects is an ObjectStore that can be made to fail.
type memoryObjects struct {
	mu         sync.Mutex
	objects    map[string]string
	failPut    bool
	failDelete bool
}

func (store *memoryObjects) Put(_ context.Context, key, contentType string, _ []byte) error {
	store.mu.Lock()
	defer store.mu.Unlock()
	if store.failPut {
		return errors.New("storage unavailable")
	}
	store.objects[key] = contentType
	return nil
}

func (store *memoryObjects) Delete(_ context.Context, key string) error {
	store.mu.Lock()
	defer store.mu.Unlock()
	if store.failDelete {
		return errors.New("storage unavailable")
	}
	delete(store.objects, key)
	return nil
}

func (store *memoryObjects) snapshot() map[string]string {
	store.mu.Lock()
	defer store.mu.Unlock()
	return maps.Clone(store.objects)
}

func newLogoFixture(t *testing.T) (catalogFixture, *memoryObjects, *schools.LogoRepository) {
	t.Helper()
	f := newCatalogFixture(t)
	objects := &memoryObjects{objects: map[string]string{}}
	logos := schools.NewLogoRepository(f.pool, objects, logoAssetOrigin, slog.New(slog.DiscardHandler))
	f.handler.dependencies.Catalog.Logos = logos
	return f, objects, logos
}

type logoPart struct {
	name, filename, contentType string
	body                        []byte
}

// upload sends a multipart request with an unknown length, as a chunked
// transfer would arrive.
func (f catalogFixture) upload(t *testing.T, parts []logoPart, status int) *httptest.ResponseRecorder {
	t.Helper()
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	for _, part := range parts {
		header := textproto.MIMEHeader{}
		disposition := `form-data; name="` + part.name + `"`
		if part.filename != "" {
			disposition += `; filename="` + part.filename + `"`
		}
		header.Set("Content-Disposition", disposition)
		if part.contentType != "" {
			header.Set("Content-Type", part.contentType)
		}
		field, err := writer.CreatePart(header)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := field.Write(part.body); err != nil {
			t.Fatal(err)
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest(http.MethodPost, "/admin/v1/schools/"+catalogSchoolID+"/logo", io.MultiReader(&body))
	req.ContentLength = -1
	req.Header.Set("Content-Type", writer.FormDataContentType())
	req.Header.Set(ProxySecretHeader, "proxy-secret")
	req.Header.Set("Origin", "https://admin.example.test")
	req.Header.Set(CSRFHeader, f.credential.CSRFToken)
	req.AddCookie(&http.Cookie{Name: "admin_session", Value: f.credential.Token})
	req.AddCookie(&http.Cookie{Name: "admin_csrf", Value: f.credential.CSRFToken})
	response := httptest.NewRecorder()
	f.handler.ServeHTTP(response, req)
	if response.Code != status {
		t.Fatalf("upload: got %d, want %d: %s", response.Code, status, response.Body.String())
	}
	return response
}

func logoParts(version time.Time, file logoPart) []logoPart {
	return []logoPart{
		{name: "expected_updated_at", body: []byte(version.Format(time.RFC3339Nano))},
		{name: "reason", body: []byte("Official logo from the school")},
		file,
	}
}

// paddedPNG returns a valid PNG of exactly size bytes, filled out with a
// private ancillary chunk that decoders skip.
func paddedPNG(t *testing.T, size int) []byte {
	t.Helper()
	var encoded bytes.Buffer
	if err := png.Encode(&encoded, image.NewGray(image.Rect(0, 0, 4, 4))); err != nil {
		t.Fatal(err)
	}
	padding := make([]byte, size-encoded.Len()-12)
	chunk := binary.BigEndian.AppendUint32(nil, uint32(len(padding)))
	chunk = append(append(chunk, "prVt"...), padding...)
	chunk = binary.BigEndian.AppendUint32(chunk, crc32.ChecksumIEEE(chunk[4:]))
	return append(append(bytes.Clone(encoded.Bytes()[:33]), chunk...), encoded.Bytes()[33:]...)
}

func (f catalogFixture) logoRows(t *testing.T) map[string]string {
	t.Helper()
	rows, err := f.pool.Query(t.Context(), `SELECT object_key,state FROM school_logo_objects`)
	if err != nil {
		t.Fatal(err)
	}
	states := map[string]string{}
	for rows.Next() {
		var key, state string
		if err := rows.Scan(&key, &state); err != nil {
			t.Fatal(err)
		}
		states[key] = state
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	return states
}

func TestSchoolLogoHTTPReplacesRemovesAndCleansUp(t *testing.T) {
	f, objects, _ := newLogoFixture(t)
	school, err := f.school.GetAdmin(t.Context(), catalogSchoolID)
	if err != nil {
		t.Fatal(err)
	}
	// The name and declared type are ignored; the bytes are an honest PNG.
	spoofed := logoPart{name: "file", filename: "../../logo.gif", contentType: "text/html", body: paddedPNG(t, 2048)}
	first := decodeCatalog[schools.AdminSchool](t, f.upload(t, logoParts(school.UpdatedAt, spoofed), 200))
	firstKey := strings.TrimPrefix(first.LogoURL, logoAssetOrigin+"/")
	if !strings.HasPrefix(firstKey, "school-logos/"+catalogSchoolID+"/") || !strings.HasSuffix(firstKey, ".png") {
		t.Fatalf("logo URL = %q", first.LogoURL)
	}
	if got := objects.snapshot(); !reflect.DeepEqual(got, map[string]string{firstKey: "image/png"}) {
		t.Fatalf("objects = %v", got)
	}
	publicLogo := func() string {
		t.Helper()
		public, err := schools.NewPostgresRepository(f.pool).GetByID(t.Context(), catalogSchoolID)
		if err != nil {
			t.Fatal(err)
		}
		return public.LogoURL
	}
	if got := publicLogo(); got != first.LogoURL {
		t.Fatalf("public logo = %q, want %q", got, first.LogoURL)
	}

	// A stale form keeps the stored logo and discards the new upload.
	conflict := decodeCatalog[struct {
		Error   string              `json:"error"`
		Current schools.AdminSchool `json:"current"`
	}](t, f.upload(t, logoParts(school.UpdatedAt, spoofed), 409))
	if conflict.Error != "admin_record_conflict" || !reflect.DeepEqual(conflict.Current, first) {
		t.Fatalf("stale upload response: %#v", conflict)
	}

	var photo bytes.Buffer
	if err := jpeg.Encode(&photo, image.NewRGBA(image.Rect(0, 0, 8, 8)), nil); err != nil {
		t.Fatal(err)
	}
	second := decodeCatalog[schools.AdminSchool](t, f.upload(t, logoParts(first.UpdatedAt, logoPart{name: "file", filename: "logo.png", body: photo.Bytes()}), 200))
	secondKey := strings.TrimPrefix(second.LogoURL, logoAssetOrigin+"/")
	if !strings.HasSuffix(secondKey, ".jpg") || secondKey == firstKey {
		t.Fatalf("replacement URL = %q", second.LogoURL)
	}
	if got, want := [2]any{objects.snapshot(), f.logoRows(t)}, [2]any{map[string]string{secondKey: "image/jpeg"}, map[string]string{secondKey: "current"}}; !reflect.DeepEqual(got, want) {
		t.Fatalf("after replacement objects/rows = %v, want %v", got, want)
	}

	command := f.command
	command.ExpectedUpdatedAt = second.UpdatedAt
	removed := decodeCatalog[schools.AdminSchool](t, f.request(t, "DELETE", "/admin/v1/schools/"+catalogSchoolID+"/logo", command, 200))
	if removed.LogoURL != "" || len(objects.snapshot()) != 0 || len(f.logoRows(t)) != 0 {
		t.Fatalf("after removal logo=%q objects=%v rows=%v", removed.LogoURL, objects.snapshot(), f.logoRows(t))
	}
	if got := publicLogo(); got != "" {
		t.Fatalf("public logo after removal = %q", got)
	}
	command.ExpectedUpdatedAt = removed.UpdatedAt
	f.request(t, "DELETE", "/admin/v1/schools/"+catalogSchoolID+"/logo", command, 409)

	audit := decodeCatalog[struct {
		Entries []adminaudit.Entry `json:"audit_entries"`
	}](t, f.request(t, "GET", "/admin/v1/schools/"+catalogSchoolID+"/audit", nil, 200))
	actions := make([]adminaudit.Action, 0, len(audit.Entries))
	for _, entry := range audit.Entries {
		actions = append(actions, entry.Action)
		if err := adminaudit.ValidateSafeDocuments(entry.Before, entry.After, entry.Metadata); err != nil {
			t.Fatal(err)
		}
	}
	if want := []adminaudit.Action{adminaudit.ActionSchoolLogoRemoved, adminaudit.ActionSchoolLogoUpdated, adminaudit.ActionSchoolLogoUpdated}; !reflect.DeepEqual(actions, want) {
		t.Fatalf("audit actions = %v, want %v", actions, want)
	}
}

func TestSchoolLogoRejectionsStoreNothing(t *testing.T) {
	f, objects, _ := newLogoFixture(t)
	school, err := f.school.GetAdmin(t.Context(), catalogSchoolID)
	if err != nil {
		t.Fatal(err)
	}
	file := func(body []byte) []logoPart {
		return logoParts(school.UpdatedAt, logoPart{name: "file", filename: "logo.png", contentType: "image/png", body: body})
	}
	for _, test := range []struct {
		name   string
		parts  []logoPart
		status int
		code   string
	}{
		{name: "SVG", parts: file([]byte(`<svg xmlns="http://www.w3.org/2000/svg"/>`)), status: 415, code: "logo_unsupported_type"},
		{name: "truncated PNG", parts: file(paddedPNG(t, 2048)[:1000]), status: 422, code: "logo_invalid_image"},
		{name: "one byte over the limit", parts: file(paddedPNG(t, logoimage.MaxBytes+1)), status: 413, code: "logo_too_large"},
		{name: "far over the limit", parts: file(make([]byte, 3*logoimage.MaxBytes)), status: 413, code: "logo_too_large"},
		{name: "missing reason", parts: []logoPart{file(nil)[0], file(paddedPNG(t, 2048))[2]}, status: 400, code: "invalid_request"},
		{name: "unexpected field", parts: append(file(paddedPNG(t, 2048)), logoPart{name: "logo_url", body: []byte("https://attacker.example/x.png")}), status: 400, code: "invalid_request"},
	} {
		t.Run(test.name, func(t *testing.T) {
			response := decodeCatalog[map[string]string](t, f.upload(t, test.parts, test.status))
			if response["error"] != test.code {
				t.Fatalf("error = %q, want %q", response["error"], test.code)
			}
			if len(objects.snapshot()) != 0 || len(f.logoRows(t)) != 0 {
				t.Fatalf("rejected upload stored objects=%v rows=%v", objects.snapshot(), f.logoRows(t))
			}
		})
	}
	// Exactly at the limit is accepted.
	f.upload(t, file(paddedPNG(t, logoimage.MaxBytes)), 200)
}

func TestSchoolLogoUploadsAreRateLimitedBeforeReading(t *testing.T) {
	f, objects, _ := newLogoFixture(t)
	svg := logoParts(time.Now(), logoPart{name: "file", body: []byte("<svg/>")})
	for range logoUploadLimit {
		f.upload(t, svg, 415)
	}
	school, err := f.school.GetAdmin(t.Context(), catalogSchoolID)
	if err != nil {
		t.Fatal(err)
	}
	limited := f.upload(t, logoParts(school.UpdatedAt, logoPart{name: "file", body: paddedPNG(t, 2048)}), 429)
	response := decodeCatalog[map[string]string](t, limited)
	if response["error"] != "rate_limited" || limited.Header().Get("Retry-After") != "900" || len(objects.snapshot()) != 0 {
		t.Fatalf("limited upload: %v Retry-After=%q objects=%v", response, limited.Header().Get("Retry-After"), objects.snapshot())
	}
}

func TestSchoolLogoFailuresNeverLeaveAReferencedOrOrphanedObject(t *testing.T) {
	f, objects, logos := newLogoFixture(t)
	ctx := t.Context()
	school, err := f.school.GetAdmin(ctx, catalogSchoolID)
	if err != nil {
		t.Fatal(err)
	}
	logo, err := logoimage.Process(paddedPNG(t, 2048))
	if err != nil {
		t.Fatal(err)
	}
	command := f.command
	command.ExpectedUpdatedAt = school.UpdatedAt

	objects.failPut = true
	if _, err := logos.ReplaceLogo(ctx, catalogSchoolID, command, logo); err == nil {
		t.Fatal("storage failure was ignored")
	}
	objects.failPut = false
	if len(objects.snapshot()) != 0 || len(f.logoRows(t)) != 0 {
		t.Fatalf("storage failure left objects=%v rows=%v", objects.snapshot(), f.logoRows(t))
	}

	if _, err := f.pool.Exec(ctx, `CREATE FUNCTION reject_test_audit() RETURNS TRIGGER LANGUAGE plpgsql AS $$
	BEGIN IF NEW.request_id='forced-audit-failure' THEN RAISE EXCEPTION 'forced audit failure'; END IF; RETURN NEW; END; $$;
	CREATE TRIGGER reject_test_audit BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION reject_test_audit()`); err != nil {
		t.Fatal(err)
	}
	bad := command
	bad.Correlation.RequestID = "forced-audit-failure"
	if _, err := logos.ReplaceLogo(ctx, catalogSchoolID, bad, logo); err == nil {
		t.Fatal("audit failure was ignored")
	}
	if len(objects.snapshot()) != 0 || len(f.logoRows(t)) != 0 {
		t.Fatalf("audit failure left objects=%v rows=%v", objects.snapshot(), f.logoRows(t))
	}

	// When the cleanup delete also fails, the pending row keeps the object
	// traceable until reconciliation removes it.
	objects.failDelete = true
	if _, err := logos.ReplaceLogo(ctx, catalogSchoolID, bad, logo); err == nil {
		t.Fatal("audit failure was ignored")
	}
	objects.failDelete = false
	rows := f.logoRows(t)
	if len(rows) != 1 || len(objects.snapshot()) != 1 {
		t.Fatalf("undeletable object not tracked: objects=%v rows=%v", objects.snapshot(), rows)
	}
	if removed, err := logos.Reconcile(ctx); err != nil || removed != 0 {
		t.Fatalf("recent pending upload reconciled: %d %v", removed, err)
	}
	if _, err := f.pool.Exec(ctx, `UPDATE school_logo_objects SET updated_at=now()-interval '1 hour'`); err != nil {
		t.Fatal(err)
	}
	if removed, err := logos.Reconcile(ctx); err != nil || removed != 1 {
		t.Fatalf("Reconcile() = %d, %v", removed, err)
	}
	unchanged, err := f.school.GetAdmin(ctx, catalogSchoolID)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(unchanged, school) || len(objects.snapshot()) != 0 || len(f.logoRows(t)) != 0 {
		t.Fatalf("after reconciliation school=%#v objects=%v rows=%v", unchanged, objects.snapshot(), f.logoRows(t))
	}
}
