package httpserver

import (
	"bytes"
	"io/fs"
	"net/http"
	"path"
	"strings"
	"time"

	"github.com/lsimone/web-concept-portfolio/internal/jsprint"
)

// Stamp configures per-download stamping of JavaScript: every .js
// response, plain or bundled, is served with a notice naming Owner and the
// download time, and the same information hidden in its comments (see
// package jsprint). A nil *Stamp serves scripts untouched.
type Stamp struct {
	Key   jsprint.Key
	Owner string
	Build byte // first byte of the build's commit, 0 if unknown
}

// apply stamps src as served in response to r. Done per request, so each
// download carries its own time; stamping is only ever added to comments,
// so the stamped script runs exactly like the original.
func (s *Stamp) apply(src []byte, r *http.Request) []byte {
	if s == nil {
		return src
	}
	ref := jsprint.Ref{Time: time.Now().UTC().Truncate(time.Minute), Build: s.Build}
	return s.Key.Stamp(src, s.Owner, r.Host+r.URL.Path, ref)
}

// serveJS writes a script response. http.ServeContent handles HEAD and
// Range like the file server would; with no modification time it sends
// no Last-Modified, so browsers don't cache a stamped copy heuristically
// and a later download gets a fresh stamp.
func serveJS(w http.ResponseWriter, r *http.Request, name string, src []byte) {
	w.Header().Set("Content-Type", "text/javascript; charset=utf-8")
	http.ServeContent(w, r, name, time.Time{}, bytes.NewReader(src))
}

// stampScripts serves *.js files from staticFS stamped, and hands
// everything else - and any script it can't read, so a missing one gets
// the file server's normal 404 - to next.
func stampScripts(staticFS fs.FS, s *Stamp, next http.Handler) http.Handler {
	if s == nil {
		return next
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasSuffix(r.URL.Path, ".js") {
			next.ServeHTTP(w, r)
			return
		}
		src, err := fs.ReadFile(staticFS, strings.TrimPrefix(path.Clean(r.URL.Path), "/"))
		if err != nil {
			next.ServeHTTP(w, r)
			return
		}
		serveJS(w, r, path.Base(r.URL.Path), s.apply(src, r))
	})
}
