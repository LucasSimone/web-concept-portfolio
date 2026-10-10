// Package httpserver wires together the site's HTTP routes: static file
// serving, the contact form API, a health check, and the middleware
// (logging, panic recovery, rate limiting) that wraps them.
package httpserver

import (
	"io/fs"
	"net/http"
	"time"

	"github.com/lsimone/web-concept-portfolio/internal/admin"
	"github.com/lsimone/web-concept-portfolio/internal/contact"
)

// New builds the site's top-level http.Handler:
//   - "/"             serves staticFS (the embedded site) as plain files.
//   - "POST /api/contact" saves a contact form submission, rate-limited
//     per IP to 5 requests/hour to blunt naive spam.
//   - "/admin/"       the owner's submissions portal, when adminCred is
//     non-nil (see below).
//   - "GET /healthz"  a trivial liveness check for Docker/load balancers.
//
// dev disables static-asset caching (see noCache): in dev mode staticFS is
// already being re-read from disk on every request (main.go's DEV=1 path),
// so a browser serving an edited file from its own cache instead of asking
// again is a footgun during local iteration, not a feature worth its own
// bug reports. Leave it in place for the real embedded-asset build.
//
// adminCred nil means the admin portal isn't configured, and its routes
// are then never registered at all — /admin/* falls through to the static
// handler and 404s like any other unknown path. That's the fail-closed
// half of the decision made in cmd/server: a deploy missing
// ADMIN_PASSWORD_HASH serves no portal rather than an unprotected one.
func New(staticFS fs.FS, contactStore *contact.Store, dev bool, adminCred *admin.Credential) http.Handler {
	mux := http.NewServeMux()

	static := http.FileServerFS(staticFS)
	if dev {
		static = noCache(static)
	}
	mux.Handle("/", static)

	// Several effects' source is split across shared building blocks plus
	// the effect's own file, but the URL every page loads and every
	// "Download JS" button links to still needs to serve one
	// self-contained script - see bundle.go. Order matters within each
	// entry: the shared blocks come first, since the effect's own file
	// reads them at load.
	//
	// Rolodex and Type Pan take three blocks each
	// (shared/hover-scroll-source.js, shared/sequence-stepper.js,
	// shared/scroll-progress.js - in that order, since scroll-progress.js
	// calls SequenceStepper.clamp). Outer Worlds takes the reusable map
	// generator (shared/world-map.js) plus its real-Earth stand-in
	// (shared/earth-map.js). All four carousels take shared/carousel-kit.js
	// for the wrap-around arithmetic, the per-tab position memory and the
	// initAll/get/getAll surface they have in common, and Sweep
	// additionally takes shared/hover-delegate.js for its pointer-hover
	// tracking.
	bundled := map[string]http.HandlerFunc{
		"/text-effects/rolodex/rolodex.js": bundledScript(staticFS,
			"shared/hover-scroll-source.js", "shared/sequence-stepper.js", "shared/scroll-progress.js",
			"text-effects/rolodex/rolodex.js"),
		"/text-effects/type-pan/type-pan.js": bundledScript(staticFS,
			"shared/hover-scroll-source.js", "shared/sequence-stepper.js", "shared/scroll-progress.js",
			"text-effects/type-pan/type-pan.js"),
		"/background/outer-worlds/outer-worlds.js": bundledScript(staticFS,
			"shared/world-map.js", "shared/earth-map.js", "background/outer-worlds/outer-worlds.js"),
		"/carousel/sweep/sweep.js": bundledScript(staticFS,
			"shared/carousel-kit.js", "shared/hover-delegate.js", "carousel/sweep/sweep.js"),
		"/carousel/reel/reel.js": bundledScript(staticFS,
			"shared/carousel-kit.js", "carousel/reel/reel.js"),
		"/carousel/deck/deck.js": bundledScript(staticFS,
			"shared/carousel-kit.js", "carousel/deck/deck.js"),
		"/carousel/dial/dial.js": bundledScript(staticFS,
			"shared/carousel-kit.js", "carousel/dial/dial.js"),
	}
	for path, handler := range bundled {
		h := handler
		if dev {
			h = noCache(h).ServeHTTP
		}
		mux.HandleFunc("GET "+path, h)
	}

	contactLimiter := newIPRateLimiter(time.Hour, 5)
	mux.Handle("POST /api/contact", contactLimiter.middleware(contact.NewHandler(contactStore)))

	// The portal mounts as one subtree and routes its own paths
	// internally (see internal/admin). Registering "/admin/" is what
	// gives it precedence over the static file server on "/": Go's
	// ServeMux matches the most specific pattern, and a literal prefix
	// beats the catch-all for every path beneath it. That's also why no
	// static file can shadow a portal URL, and why a file planted at
	// web/static/admin/... can't be served through the portal's prefix.
	// It additionally earns "/admin" (no trailing slash) ServeMux's
	// automatic 307 to "/admin/" instead of a file-server 404.
	//
	// Note the registration happens whether or not the portal is
	// configured, and this is the point: when adminCred is nil the
	// prefix is claimed by a handler that 404s everything. Leaving it
	// unregistered instead would hand /admin/* back to the static file
	// server, so the guarantee that nothing under /admin is ever served
	// off disk would hold only for as long as nobody creates a
	// web/static/admin/ directory. Claiming the prefix unconditionally
	// makes it a property of the routing table rather than of what
	// happens to exist in the static tree. routes_test.go pins all of
	// this, including the disabled case.
	if adminCred == nil {
		mux.Handle("/admin/", http.NotFoundHandler())
	} else {
		// Login attempts are limited to 10 per 15 minutes per IP, which
		// is generous for someone who knows their password and useless
		// for anyone guessing. The limiter is the same implementation
		// the contact form uses, consulted through a function rather
		// than its middleware: a bare text/plain 429 is the right answer
		// for a spammed JSON API and the wrong one for a person
		// mistyping a password, so the portal asks and then renders the
		// lockout on its own login page.
		loginLimiter := newIPRateLimiter(15*time.Minute, 10)
		mux.Handle("/admin/", admin.New(admin.Config{
			Store:         contactStore,
			Cred:          adminCred,
			SecureCookies: !dev,
			AllowLogin:    func(r *http.Request) bool { return loginLimiter.allow(clientIP(r)) },
		}))
	}

	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("ok"))
	})

	// logging outermost so it still records the request line even when the
	// handler panics and recoverPanic converts that into a 500.
	return logging(recoverPanic(mux))
}
