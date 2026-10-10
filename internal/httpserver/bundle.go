package httpserver

import (
	"io/fs"
	"net/http"
	"path"
)

// bundledScript serves the concatenation of the given staticFS paths as a
// single application/javascript response. It exists so an effect's source
// can be split into a shared building block (e.g. shared/sequence-stepper.js)
// plus the effect's own file for maintainability, while the URL every page
// <script src="">s and every "Download JS" button links to keeps serving one
// self-contained file - nobody downloading or embedding it needs to know the
// shared module exists, let alone fetch it separately.
//
// Reads happen on every request rather than once at startup so this stays
// consistent with how the rest of the site serves staticFS: in dev mode
// that's read straight off disk (see cmd/server/main.go), so editing either
// source file and refreshing picks it up immediately, with no separate build
// step to remember to run.
//
// The bundle is stamped as one file (see Stamp), so the notice sits once
// at the top and the hidden copy spans every part.
func bundledScript(staticFS fs.FS, stamp *Stamp, paths ...string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var bundle []byte
		for _, p := range paths {
			b, err := fs.ReadFile(staticFS, p)
			if err != nil {
				http.Error(w, "internal server error", http.StatusInternalServerError)
				return
			}
			bundle = append(append(bundle, b...), '\n')
		}
		serveJS(w, r, path.Base(r.URL.Path), stamp.apply(bundle, r))
	}
}
