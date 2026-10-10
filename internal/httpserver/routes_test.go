package httpserver

// These tests exist for one reason: the static file server is mounted at
// "/" (see New), so it matches every path on the site, and the admin
// portal's safety depends on it never getting the chance to answer for a
// path under /admin — and on no file in web/static ever being servable
// through one. Both are properties of http.ServeMux's precedence rules
// rather than of code written here, which is exactly the kind of thing
// that quietly stops being true when a route is added or reordered.
//
// They use a fake static FS containing a planted admin/ directory,
// because the real web/static doesn't have one and the thing worth
// pinning is what happens if someone ever adds it.

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"

	"github.com/lsimone/web-concept-portfolio/internal/admin"
)

// testCredential is a throwaway credential so the admin routes are
// actually registered. The password is never used — these tests only
// check which handler answers a path, not what it answers with.
func testCredential(t *testing.T) *admin.Credential {
	t.Helper()
	hash, err := admin.HashPassword("not-used")
	if err != nil {
		t.Fatalf("hash test password: %v", err)
	}
	cred, err := admin.ParseCredential("admin", hash)
	if err != nil {
		t.Fatalf("parse test credential: %v", err)
	}
	return cred
}

// staticWithPlantedAdmin is a static tree that contains exactly the
// files an attacker would want served: an admin/ directory sitting where
// the portal's URLs live.
func staticWithPlantedAdmin() fstest.MapFS {
	return fstest.MapFS{
		"index.html":       {Data: []byte("public home")},
		"admin/index.html": {Data: []byte("PLANTED")},
		"admin/style.css":  {Data: []byte("PLANTED")},
		"admin/login":      {Data: []byte("PLANTED")},
	}
}

func TestAdminRoutesBeatStaticFileServer(t *testing.T) {
	handler := New(staticWithPlantedAdmin(), nil, false, testCredential(t))

	tests := []struct {
		name     string
		path     string
		wantCode int
		// wantLoginRedirect marks the paths that should reach the portal
		// and be bounced to its login page, which is proof the portal —
		// not the file server — answered.
		wantLoginRedirect bool
	}{
		{
			name:              "list page reaches the portal, not the planted index.html",
			path:              "/admin/",
			wantCode:          http.StatusSeeOther,
			wantLoginRedirect: true,
		},
		{
			// 307, not 301: this is ServeMux's own subtree redirect,
			// which it issues as a temporary one.
			name:     "bare /admin redirects to the subtree rather than 404ing on the file server",
			path:     "/admin",
			wantCode: http.StatusTemporaryRedirect,
		},
		{
			name:     "login page is served by the portal",
			path:     "/admin/login",
			wantCode: http.StatusOK,
		},
		{
			name:              "a detail URL reaches the portal's auth check",
			path:              "/admin/submission/1",
			wantCode:          http.StatusSeeOther,
			wantLoginRedirect: true,
		},
		{
			name:     "an unknown admin path 404s inside the portal instead of hitting the file server",
			path:     "/admin/nope.html",
			wantCode: http.StatusNotFound,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			rec := httptest.NewRecorder()
			handler.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, tt.path, nil))

			if rec.Code != tt.wantCode {
				t.Errorf("GET %s: status = %d, want %d", tt.path, rec.Code, tt.wantCode)
			}
			if body := rec.Body.String(); strings.Contains(body, "PLANTED") {
				t.Errorf("GET %s: served a file from the static tree: %q", tt.path, body)
			}
			if tt.wantLoginRedirect {
				if got := rec.Header().Get("Location"); got != "/admin/login" {
					t.Errorf("GET %s: Location = %q, want /admin/login", tt.path, got)
				}
			}
		})
	}
}

// TestAdminStylesheetIsNotTheStaticFile pins that the one unauthenticated
// asset the portal serves comes from the portal's own embedded templates
// and not from a same-named file in the static tree, which would let
// anyone who can write to web/static serve content under /admin.
func TestAdminStylesheetIsNotTheStaticFile(t *testing.T) {
	handler := New(staticWithPlantedAdmin(), nil, false, testCredential(t))

	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/admin/style.css", nil))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	if body := rec.Body.String(); strings.Contains(body, "PLANTED") {
		t.Errorf("served the planted static file instead of the embedded stylesheet")
	}
}

// TestAdminDisabledWithoutCredential is the fail-closed half: with no
// credential configured the portal's routes are never registered, so
// /admin has nothing behind it. The planted files make the failure mode
// visible — if precedence ever changed, this is where a 200 full of
// "PLANTED" would show up.
func TestAdminDisabledWithoutCredential(t *testing.T) {
	handler := New(staticWithPlantedAdmin(), nil, false, nil)

	for _, path := range []string{"/admin/", "/admin/login", "/admin/style.css"} {
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, path, nil))

		if rec.Code != http.StatusNotFound {
			t.Errorf("GET %s with no credential: status = %d, want 404", path, rec.Code)
		}
		if body := rec.Body.String(); strings.Contains(body, "PLANTED") {
			t.Errorf("GET %s: served a file from the static tree: %q", path, body)
		}
	}
}

// TestPublicSiteStillServed guards the other direction: none of the
// admin wiring may change what "/" does.
//
// It asks for "/" rather than "/index.html" because http.ServeFileFS
// answers an explicit index.html request with a 301 to "./" — stock
// behavior that predates any of this and is not what this test is about.
func TestPublicSiteStillServed(t *testing.T) {
	handler := New(staticWithPlantedAdmin(), nil, false, testCredential(t))

	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/", nil))

	if rec.Code != http.StatusOK {
		t.Fatalf("GET /: status = %d, want 200", rec.Code)
	}
	if body := rec.Body.String(); !strings.Contains(body, "public home") {
		t.Errorf("GET /: body = %q, want the static file's contents", body)
	}
}
