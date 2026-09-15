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
func New(staticFS fs.FS, contactStore *contact.Store) http.Handler {
	mux := http.NewServeMux()

	mux.Handle("/", http.FileServerFS(staticFS))

	contactLimiter := newIPRateLimiter(time.Hour, 5)
	mux.Handle("POST /api/contact", contactLimiter.middleware(contact.NewHandler(contactStore)))

	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("ok"))
	})

	// logging outermost so it still records the request line even when the
	// handler panics and recoverPanic converts that into a 500.
	return logging(recoverPanic(mux))
}
