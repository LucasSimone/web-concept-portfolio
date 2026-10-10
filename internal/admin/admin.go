// Package admin serves the site owner's portal at /admin: a login, a
// filterable list of the form submissions package contact has stored,
// a detail view per submission, and triage (read/unread/archive/delete).
//
// It is deliberately a one-off for this site rather than a reusable
// admin framework. There's one account, two known form kinds whose
// columns it queries directly, and no plug-in points — a future site
// needing a portal is expected to pay a migration cost then rather than
// a design cost here now. The shape that follows from that: a handful of
// handlers over package contact's read methods, plain html/template, and
// no JavaScript at all.
//
// It does NOT go through internal/render, which composes the public
// site's pages from head/body/controls fragments and is built for
// demo-heavy pages carrying effect scripts and a controls panel. The
// templates here live in this package's own embedded templates/ directory
// instead, which also keeps them from being reachable as raw files: the
// static file server is mounted at "/" over web/static, and anything
// living in that tree is downloadable by anyone who guesses the path.
//
// Adding a page later (the planned statistics and SEO views) means one
// route in newMux and one template beside the others. That's a
// consequence of there being no machinery here, not an extension point
// built in advance.
package admin

import (
	"bytes"
	"embed"
	"html/template"
	"log"
	"net/http"

	"github.com/lsimone/web-concept-portfolio/internal/contact"
)

// Config is everything the portal needs from the rest of the program.
type Config struct {
	// Store is where submissions are read from and triaged. The portal
	// never writes a new submission — only the public form handler does.
	Store *contact.Store
	// Cred is the single admin account (see ParseCredential). Required:
	// New panics on a nil Cred, since a portal with no credential is the
	// one outcome that must never be reachable, and cmd/server already
	// declines to build this at all when the hash is missing.
	Cred *Credential
	// SecureCookies sets the Secure flag on the session cookie, which
	// stops the browser from ever sending it over plain HTTP. True in
	// production; false in dev, because local development is http://
	// localhost and a Secure cookie there would simply never come back,
	// making login appear to silently fail.
	SecureCookies bool
	// AllowLogin reports whether a login attempt from this request's IP
	// is allowed through, or has hit the lockout. Supplied by
	// internal/httpserver, which owns the rate limiter this consults —
	// passed in as a function rather than imported so that the limiter
	// stays one shared implementation and this package stays unaware of
	// how requests are counted. Nil disables the lockout, which only
	// tests should want.
	AllowLogin func(*http.Request) bool
}

//go:embed templates
var templateFS embed.FS

// pages is one parsed template set per page, each the shared base plus
// that page's own content. They're separate sets because every page
// defines a template named "content" — parsed into one set they would
// collide, with the last one winning for everybody. Parsed once at
// startup: unlike the public site there's no dev-mode live reload here,
// so an edit to these templates needs a restart. That's the simpler
// thing and the portal's markup changes far less often than a demo's.
var pages = map[string]*template.Template{
	"login":  parsePage("login.html"),
	"home":   parsePage("home.html"),
	"list":   parsePage("list.html"),
	"detail": parsePage("detail.html"),
}

func parsePage(name string) *template.Template {
	return template.Must(template.New("base.html").Funcs(funcs).ParseFS(
		templateFS, "templates/base.html", "templates/"+name,
	))
}

// Handler serves everything under /admin/.
type Handler struct {
	store      *contact.Store
	cred       *Credential
	sessions   *sessions
	secure     bool
	allowLogin func(*http.Request) bool
	mux        *http.ServeMux
}

// New builds the portal's handler. The returned handler expects to be
// mounted as the "/admin/" subtree and matches on full paths (it does no
// prefix stripping), so the patterns it registers read the same as the
// URLs they serve.
func New(cfg Config) *Handler {
	if cfg.Cred == nil {
		panic("admin: New called with a nil Credential")
	}

	h := &Handler{
		store:      cfg.Store,
		cred:       cfg.Cred,
		sessions:   newSessions(),
		secure:     cfg.SecureCookies,
		allowLogin: cfg.AllowLogin,
	}
	h.mux = h.newMux()
	return h
}

func (h *Handler) newMux() *http.ServeMux {
	mux := http.NewServeMux()

	// Unauthenticated: the login form itself, and the stylesheet (which
	// the login page needs before anyone is logged in, and which is
	// three kilobytes of layout rules worth nobody's protection).
	mux.HandleFunc("GET /admin/login", h.showLogin)
	mux.HandleFunc("POST /admin/login", h.doLogin)
	mux.HandleFunc("GET /admin/style.css", h.style)

	// Authenticated. Every mutation is a POST behind requireSession and
	// checkCSRF; every read is a GET behind requireSession.
	//
	// The two forms get a page each rather than one list with a "which
	// form" filter on it. Inquiries and bug reports are read for
	// different reasons and carry different fields, so a shared page had
	// to either show the union of both (mostly empty columns) or hide
	// the differences — and it put a control in the filter bar to answer
	// a question the URL can answer for free.
	mux.Handle("GET /admin/{$}", h.requireSession(h.showHome))
	mux.Handle("GET /admin/inquiries", h.requireSession(h.showInquiries))
	mux.Handle("GET /admin/bugs", h.requireSession(h.showBugs))
	mux.Handle("GET /admin/submission/{id}", h.requireSession(h.showDetail))
	mux.Handle("POST /admin/submission/{id}/status", h.requireSession(h.checkCSRF(h.setStatus)))
	mux.Handle("POST /admin/submission/{id}/delete", h.requireSession(h.checkCSRF(h.deleteSubmission)))
	mux.Handle("POST /admin/logout", h.requireSession(h.checkCSRF(h.doLogout)))

	return mux
}

func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	// Set on every response including errors and redirects, which is why
	// it's here and not in a template or a per-handler call.
	//
	// X-Robots-Tag is the only noindex signal available: the site has no
	// robots.txt, and a Disallow line would be a published list of the
	// paths worth attacking anyway. Cache-Control stops a shared or
	// borrowed browser from keeping someone's inquiry in its disk cache
	// after logout. The other two are cheap and standard: no sniffing a
	// response into a different content type, no framing the portal
	// inside another page to click-jack its triage buttons.
	w.Header().Set("X-Robots-Tag", "noindex, nofollow")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("X-Frame-Options", "DENY")

	h.mux.ServeHTTP(w, r)
}

// sessionCookie is the login cookie's name. Path is /admin, so it's
// never sent with a request for the public site or for any of the demo
// assets — most requests this server handles have no business carrying
// it.
const sessionCookie = "admin_session"

// requireSession rejects anyone without a live session, and hands the
// session to the handler so page templates can get the CSRF token
// without a second lookup.
//
// An unauthenticated GET redirects to the login page, which is the
// friendly answer for a bookmarked URL opened the next morning. An
// unauthenticated POST gets a plain 403: it's either a cross-site
// forgery or a form submitted after the session timed out, and
// redirecting the second one to a login page would lose what was typed
// while telling the first one that the endpoint exists.
func (h *Handler) requireSession(next func(http.ResponseWriter, *http.Request, *session)) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		cookie, err := r.Cookie(sessionCookie)
		if err == nil {
			if sess, ok := h.sessions.lookup(cookie.Value); ok {
				next(w, r, sess)
				return
			}
		}
		if r.Method == http.MethodGet {
			http.Redirect(w, r, "/admin/login", http.StatusSeeOther)
			return
		}
		http.Error(w, "not signed in", http.StatusForbidden)
	})
}

// checkCSRF requires a form's csrf field to match the session's token.
//
// This is the second of two independent defenses; the first is the
// session cookie's SameSite=Lax, which already stops a cross-site POST
// from carrying the cookie at all. Both are here because SameSite is
// enforced by the browser — an old or unusual one that doesn't implement
// it leaves the token as the only thing standing, and the token is five
// lines.
//
// ParseForm is called here rather than in each handler so a mutation
// handler can read r.FormValue knowing the body is already parsed.
func (h *Handler) checkCSRF(next func(http.ResponseWriter, *http.Request, *session)) func(http.ResponseWriter, *http.Request, *session) {
	return func(w http.ResponseWriter, r *http.Request, sess *session) {
		if err := r.ParseForm(); err != nil {
			http.Error(w, "malformed form submission", http.StatusBadRequest)
			return
		}
		if !sameToken(r.PostFormValue("csrf"), sess.csrf) {
			http.Error(w, "this form expired — go back, reload the page and try again", http.StatusForbidden)
			return
		}
		next(w, r, sess)
	}
}

// style serves the portal's stylesheet out of the embedded templates
// directory. It's one file served by one handler rather than another
// mount of http.FileServerFS, which would also expose the .html
// templates sitting next to it.
func (h *Handler) style(w http.ResponseWriter, r *http.Request) {
	css, err := templateFS.ReadFile("templates/style.css")
	if err != nil {
		http.Error(w, "internal server error", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "text/css; charset=utf-8")
	w.Write(css)
}

// render writes a page, or a 500 if the template fails.
//
// It renders into a buffer first and only then writes. Executing
// straight to the ResponseWriter would send a 200 and the top half of a
// page before hitting the error, leaving no way to report it except a
// truncated page that looks like a network failure.
func (h *Handler) render(w http.ResponseWriter, page string, data any) {
	tmpl, ok := pages[page]
	if !ok {
		log.Printf("admin: no such page template %q", page)
		http.Error(w, "internal server error", http.StatusInternalServerError)
		return
	}

	var buf bytes.Buffer
	if err := tmpl.Execute(&buf, data); err != nil {
		log.Printf("admin: render %s: %v", page, err)
		http.Error(w, "internal server error", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Write(buf.Bytes())
}

// funcs are the template helpers — the three things that are genuinely
// awkward to express in a template and have no business in a handler.
// See format.go.
var funcs = template.FuncMap{
	"prettyTime": prettyTime,
	"summarize":  summarize,
	"titleCase":  titleCase,
	"lower":      lower,
}
