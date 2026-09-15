// Command server runs the whole site: it serves the embedded static
// site (see package web) and the contact form API (see package contact)
// from a single binary, configured entirely through env vars.
package main

import (
	"context"
	"io/fs"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"

	"github.com/lsimone/web-concept-portfolio/internal/contact"
	"github.com/lsimone/web-concept-portfolio/internal/httpserver"
	"github.com/lsimone/web-concept-portfolio/internal/render"
	"github.com/lsimone/web-concept-portfolio/web"
)

func main() {
	// PORT and DB_PATH are the only two knobs today. Both have sane
	// defaults so `go run ./cmd/server` works with zero setup.
	port := envOr("PORT", "8080")
	dbPath := envOr("DB_PATH", "data/contact.db")

	// Make sure the SQLite file's parent directory exists (e.g. "data/"
	// on a fresh checkout, or "/data" in the Docker volume) before we
	// try to open it. MkdirAll no-ops safely when the dir already exists
	// (including "." when dbPath has no directory component).
	if err := os.MkdirAll(filepath.Dir(dbPath), 0o755); err != nil {
		log.Fatalf("create db directory: %v", err)
	}

	store, err := contact.OpenStore(dbPath)
	if err != nil {
		log.Fatalf("open contact store: %v", err)
	}
	defer store.Close()

	// web.FS embeds everything under web/static/ with that prefix intact;
	// fs.Sub strips it so paths served at "/" match the source tree, e.g.
	// web/static/shared/site.css -> served at /shared/site.css.
	staticFS, err := fs.Sub(web.FS, "static")
	if err != nil {
		log.Fatalf("load embedded static assets: %v", err)
	}

	// Renders each page's *.head.html/*.body.html/*.controls.html
	// fragments into full HTML once at startup, so request handling stays
	// plain byte-serving (see internal/render).
	renderedFS, err := render.Render(staticFS)
	if err != nil {
		log.Fatalf("render pages: %v", err)
	}

	srv := &http.Server{
		Addr:         ":" + port,
		Handler:      httpserver.New(renderedFS, store),
		ReadTimeout:  10 * time.Second,
		WriteTimeout: 10 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	// Listen for Ctrl+C (local dev) and SIGTERM (Docker/systemd stop) so we
	// can shut down gracefully instead of dropping in-flight requests.
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	go func() {
		log.Printf("listening on :%s", port)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("serve: %v", err)
		}
	}()

	<-ctx.Done()
	log.Println("shutting down")

	// Give in-flight requests up to 5s to finish before forcing the
	// process to exit.
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := srv.Shutdown(shutdownCtx); err != nil {
		log.Printf("shutdown: %v", err)
	}
}

// envOr returns the environment variable named key, or fallback if it's
// unset or empty.
func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
