package httpserver

import (
	"io/fs"
	"net/http"
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
func bundledScript(staticFS fs.FS, paths ...string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var contents [][]byte
		for _, p := range paths {
			b, err := fs.ReadFile(staticFS, p)
			if err != nil {
				http.Error(w, "internal server error", http.StatusInternalServerError)
				return
			}
			contents = append(contents, b)
		}
		w.Header().Set("Content-Type", "text/javascript; charset=utf-8")
		for _, b := range contents {
			w.Write(b)
			w.Write([]byte("\n"))
		}
	}
}
