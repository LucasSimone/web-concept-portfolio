// Package web embeds the static site (everything under static/) so it
// ships inside the compiled binary instead of being deployed as loose
// files alongside it.
package web

import "embed"

// FS is the embedded static site, rooted at static/. Callers that want
// URL paths to match the source tree (e.g. static/shared/site.css served
// at /shared/site.css) should strip that prefix with fs.Sub(FS, "static")
// before handing this to an http.Handler.
//
//go:embed all:static
var FS embed.FS
