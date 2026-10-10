// Command server runs the whole site: it serves the embedded static
// site (see package web) and the contact form API (see package contact)
// from a single binary, configured entirely through env vars.
package main

import (
	"bufio"
	"context"
	"io/fs"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"github.com/lsimone/web-concept-portfolio/internal/admin"
	"github.com/lsimone/web-concept-portfolio/internal/contact"
	"github.com/lsimone/web-concept-portfolio/internal/httpserver"
	"github.com/lsimone/web-concept-portfolio/internal/render"
	"github.com/lsimone/web-concept-portfolio/web"
)

func main() {
	// .env is gitignored and only present on dev machines; it's how DEV=1
	// (see below) ends up being the default for local development without
	// making it the default for the Docker/production build, which has no
	// .env file and so falls back to real env vars only.
	loadDotEnv(".env")

	// PORT and DB_PATH both have sane defaults so `go run ./cmd/server`
	// works with zero setup. DEV=1 trades the embedded, compiled-in static
	// site for one read live off disk, so editing HTML/CSS/JS shows up on
	// refresh without a rebuild.
	port := envOr("PORT", "8080")
	dbPath := envOr("DB_PATH", "data/contact.db")
	dev := os.Getenv("DEV") != ""

	// ADMIN_PASSWORD_HASH enables the submissions portal at /admin, and
	// its absence disables it — see below. Generate one with
	// `make admin-password`. ADMIN_USER is optional and defaults to
	// "admin".
	adminUser := os.Getenv("ADMIN_USER")
	adminHash := os.Getenv("ADMIN_PASSWORD_HASH")

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
	// web/static/shared/site.css -> served at /shared/site.css. In dev mode
	// we read the same tree straight off disk instead, so edits don't need
	// a rebuild to take effect.
	var staticFS fs.FS
	if dev {
		staticFS = os.DirFS("web/static")
	} else {
		staticFS, err = fs.Sub(web.FS, "static")
		if err != nil {
			log.Fatalf("load embedded static assets: %v", err)
		}
	}

	// Renders each page's *.head.html/*.body.html/*.controls.html
	// fragments into full HTML. In dev mode this happens fresh on every
	// request (render.Live) so fragment edits show up on refresh too;
	// otherwise it happens once at startup so request handling stays plain
	// byte-serving (see internal/render).
	var renderedFS fs.FS
	if dev {
		renderedFS = render.Live(staticFS)
		log.Print("dev mode: serving static assets live from disk")
	} else {
		renderedFS, err = render.Render(staticFS)
		if err != nil {
			log.Fatalf("render pages: %v", err)
		}
	}

	// The admin portal is opt-in and fails closed: a bad or missing
	// ADMIN_PASSWORD_HASH leaves adminCred nil, and httpserver.New then
	// never registers /admin at all. The alternative — starting with a
	// portal that accepts any password, or none — would turn one missing
	// env var on a deploy into a publicly readable inbox, so the error
	// is logged loudly and the site serves on without the portal.
	//
	// Note this runs before the server starts listening, so the warning
	// is the last thing in the log before "listening on ..." and is hard
	// to miss when wondering why /admin 404s.
	adminCred, err := admin.ParseCredential(adminUser, adminHash)
	if err != nil {
		log.Printf("admin portal disabled: %v", err)
	}

	srv := &http.Server{
		Addr:         ":" + port,
		Handler:      httpserver.New(renderedFS, store, dev, adminCred),
		ReadTimeout:  10 * time.Second,
		WriteTimeout: 10 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	// Listen for Ctrl+C (local dev) and SIGTERM (Docker/systemd stop) so we
	// can shut down gracefully instead of dropping in-flight requests.
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	go func() {
		log.Printf("listening on http://localhost:%s", port)
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

// loadDotEnv reads simple KEY=VALUE lines from path into the process
// environment, skipping blank lines and lines starting with '#'. It never
// overrides a variable already set in the real environment, so `DEV=0 go
// run ./cmd/server` still wins over a .env that sets DEV=1. Missing file is
// not an error — .env is optional and gitignored.
func loadDotEnv(path string) {
	f, err := os.Open(path)
	if err != nil {
		return
	}
	defer f.Close()

	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		key, value, ok := strings.Cut(line, "=")
		if !ok {
			continue
		}
		key = strings.TrimSpace(key)
		if _, set := os.LookupEnv(key); set {
			continue
		}
		os.Setenv(key, strings.TrimSpace(value))
	}
}
