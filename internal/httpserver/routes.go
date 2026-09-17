// Package httpserver wires together the site's HTTP routes: static file
// serving, the contact form API, a health check, and the middleware
// (logging, panic recovery, rate limiting) that wraps them.
package httpserver

import (
	"io/fs"
	"net/http"
	"time"

	"github.com/lsimone/web-concept-portfolio/internal/contact"
)

// New builds the site's top-level http.Handler:
//   - "/"             serves staticFS (the embedded site) as plain files.
//   - "POST /api/contact" saves a contact form submission, rate-limited
//     per IP to 5 requests/hour to blunt naive spam.
//   - "GET /healthz"  a trivial liveness check for Docker/load balancers.
//
// dev disables static-asset caching (see noCache): in dev mode staticFS is
// already being re-read from disk on every request (main.go's DEV=1 path),
// so a browser serving an edited file from its own cache instead of asking
// again is a footgun during local iteration, not a feature worth its own
// bug reports. Leave it in place for the real embedded-asset build.
func New(staticFS fs.FS, contactStore *contact.Store, dev bool) http.Handler {
	mux := http.NewServeMux()

	static := http.FileServerFS(staticFS)
	if dev {
		static = noCache(static)
	}
	mux.Handle("/", static)

	// Rolodex and Type Pan's source is split into three shared building
	// blocks (shared/hover-scroll-source.js, shared/sequence-stepper.js,
	// shared/scroll-progress.js - in that order, since scroll-progress.js
	// calls SequenceStepper.clamp) plus each effect's own file, but the URL
	// every page loads and every "Download JS" button links to still needs
	// to serve one self-contained script - see bundle.go.
	bundled := map[string]http.HandlerFunc{
		"/text-effects/rolodex/rolodex.js": bundledScript(staticFS,
			"shared/hover-scroll-source.js", "shared/sequence-stepper.js", "shared/scroll-progress.js",
			"text-effects/rolodex/rolodex.js"),
		"/text-effects/type-pan/type-pan.js": bundledScript(staticFS,
			"shared/hover-scroll-source.js", "shared/sequence-stepper.js", "shared/scroll-progress.js",
			"text-effects/type-pan/type-pan.js"),
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

	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("ok"))
	})

	// logging outermost so it still records the request line even when the
	// handler panics and recoverPanic converts that into a 500.
	return logging(recoverPanic(mux))
}
