package admin

import (
	"errors"
	"log"
	"net/http"
	"net/url"
	"strconv"
	"time"

	"github.com/lsimone/web-concept-portfolio/internal/contact"
)

// pageSize is how many submissions a list page shows. Small enough that
// the page stays scannable, large enough that this site's volume rarely
// needs a second page.
const pageSize = 25

// kindView is the per-form presentation: where its list lives and what
// to call it on screen. Two values for the two forms that exist, written
// out rather than derived, because every one of these strings is a
// judgement about wording that no rule could generate ("Bug reports" but
// "Report #4"; "Who reported it" but "Who's asking").
//
// This is not a registry to add forms to. A third form would mean a
// third form page, a third set of columns and a third set of words, and
// the honest way to get one is to write it.
type kindView struct {
	Kind string
	// Path is this form's list page.
	Path string
	// Title heads the list page; Short labels the nav and the dashboard
	// card; One names a single submission on the detail page.
	Title, Short, One string
	// Blurb is the one line under the dashboard card's heading, there to
	// say what the form is rather than to decorate the card.
	Blurb string
	// Empty is what the list says when there's nothing in it.
	Empty string
}

var (
	inquiryView = kindView{
		Kind:  contact.KindInquiry,
		Path:  "/admin/inquiries",
		Title: "Contact inquiries",
		Short: "Inquiries",
		One:   "Inquiry",
		Blurb: "People asking about work, through the contact form.",
		Empty: "No one has sent an inquiry yet.",
	}
	bugView = kindView{
		Kind:  contact.KindBug,
		Path:  "/admin/bugs",
		Title: "Bug reports",
		Short: "Bugs",
		One:   "Bug report",
		Blurb: "Problems people hit with the effects, here or on their own sites.",
		Empty: "No bug reports yet.",
	}
	// views is the dashboard's order, and the only place that order is
	// decided.
	views = []kindView{inquiryView, bugView}
)

func viewFor(kind string) kindView {
	if kind == contact.KindBug {
		return bugView
	}
	return inquiryView
}

// basePage is what base.html needs on every page: who's signed in, which
// nav item is lit, and the unread counts the nav badges show. Those
// counts are why it's assembled by a method (see chrome) rather than
// written out at each call site — they come from the database.
type basePage struct {
	Title    string
	CSRF     string
	SignedIn bool
	// Nav is the active nav item: "home", or a kindView's Path.
	Nav string
	// InquiryUnread and BugUnread drive the nav badges, so the count of
	// what's waiting is visible from every page without going looking
	// for it.
	InquiryUnread, BugUnread int
}

// chrome fills in the shell every signed-in page shares. The two count
// queries it runs on every page render are a deliberate trade: they're
// trivial against a table this size, and they buy a nav that's always
// telling the truth about what's unread instead of a number that goes
// stale the moment something is triaged.
func (h *Handler) chrome(r *http.Request, nav, title string, sess *session) (basePage, error) {
	inquiries, err := h.store.CountsByStatus(r.Context(), contact.KindInquiry)
	if err != nil {
		return basePage{}, err
	}
	bugs, err := h.store.CountsByStatus(r.Context(), contact.KindBug)
	if err != nil {
		return basePage{}, err
	}
	return basePage{
		Title:         title,
		CSRF:          sess.csrf,
		SignedIn:      true,
		Nav:           nav,
		InquiryUnread: inquiries.New,
		BugUnread:     bugs.New,
	}, nil
}

// --- Dashboard -----------------------------------------------------------

type homePage struct {
	basePage
	Cards []homeCard
}

// homeCard is one form's summary: how much is waiting, and the few most
// recent so the dashboard answers "anything new?" on its own rather than
// only pointing at the page that would.
type homeCard struct {
	View   kindView
	Counts contact.StatusCounts
	Recent []contact.Submission
	// UnreadPath links the card's unread number straight to the filtered
	// list, which is the click someone actually wants after reading it.
	UnreadPath string
}

// homeRecent is how many recent submissions each dashboard card previews.
// Three fits the card without scrolling and is enough to recognize
// whether anything needs attention.
const homeRecent = 3

func (h *Handler) showHome(w http.ResponseWriter, r *http.Request, sess *session) {
	base, err := h.chrome(r, "home", "Overview", sess)
	if err != nil {
		h.fail(w, "dashboard counts", err)
		return
	}

	data := homePage{basePage: base}
	for _, view := range views {
		counts, err := h.store.CountsByStatus(r.Context(), view.Kind)
		if err != nil {
			h.fail(w, "dashboard counts", err)
			return
		}
		recent, _, err := h.store.List(r.Context(), contact.ListFilter{
			Kind: view.Kind, Limit: homeRecent,
		})
		if err != nil {
			h.fail(w, "dashboard recent", err)
			return
		}
		data.Cards = append(data.Cards, homeCard{
			View:       view,
			Counts:     counts,
			Recent:     recent,
			UnreadPath: view.Path + "?status=" + contact.StatusNew,
		})
	}

	h.render(w, "home", data)
}

// --- List ----------------------------------------------------------------

type listPage struct {
	basePage
	View        kindView
	Submissions []contact.Submission
	// Tabs are the status filters. They replaced a <select> plus a
	// submit button: one click instead of three, and the counts sit on
	// them so the filter doubles as the summary.
	Tabs []statusTab
	// Query is the current search text, echoed back into the box.
	Query string
	// Paging. Page is 1-based; FirstShown/LastShown are the row numbers
	// at either end of this page.
	Page, Pages           int
	FirstShown, LastShown int
	Total                 int
	PrevQuery, NextQuery  string
	HasPrev, HasNext      bool
	// BackQuery is this view's own query string, hung on every link to a
	// detail page so triage returns here rather than to an unfiltered
	// page 1.
	BackQuery string
	// Filtered is true when a status tab or a search is narrowing the
	// list, which changes what an empty result means and so what the
	// empty state should say.
	Filtered bool
}

type statusTab struct {
	Label  string
	Count  int
	URL    string
	Active bool
}

func (h *Handler) showInquiries(w http.ResponseWriter, r *http.Request, sess *session) {
	h.showKind(w, r, sess, inquiryView)
}

func (h *Handler) showBugs(w http.ResponseWriter, r *http.Request, sess *session) {
	h.showKind(w, r, sess, bugView)
}

// showKind renders one form's list. The kind comes from which route was
// matched rather than from a query parameter, which is the whole reason
// the filter bar lost a control: the page you're on already says which
// form you're looking at.
func (h *Handler) showKind(w http.ResponseWriter, r *http.Request, sess *session, view kindView) {
	base, err := h.chrome(r, view.Path, view.Title, sess)
	if err != nil {
		h.fail(w, "nav counts", err)
		return
	}

	status, query, page := listStateOf(r)

	counts, err := h.store.CountsByStatus(r.Context(), view.Kind)
	if err != nil {
		h.fail(w, "status counts", err)
		return
	}

	storeFilter := contact.ListFilter{
		Kind:   view.Kind,
		Status: status,
		Query:  query,
		Limit:  pageSize,
		Offset: (page - 1) * pageSize,
	}
	subs, total, err := h.store.List(r.Context(), storeFilter)
	if err != nil {
		h.fail(w, "list submissions", err)
		return
	}

	pages := (total + pageSize - 1) / pageSize
	data := listPage{
		basePage:    base,
		View:        view,
		Submissions: subs,
		Tabs:        tabsFor(view, counts, status, query),
		Query:       query,
		Page:        page,
		Pages:       pages,
		Total:       total,
		HasPrev:     page > 1,
		HasNext:     page < pages,
		PrevQuery:   listQuery(status, query, page-1),
		NextQuery:   listQuery(status, query, page+1),
		BackQuery:   listQuery(status, query, page),
		Filtered:    status != "" || query != "",
	}
	if len(subs) > 0 {
		data.FirstShown = storeFilter.Offset + 1
		data.LastShown = storeFilter.Offset + len(subs)
	}

	h.render(w, "list", data)
}

// tabsFor builds the status filter row. "All" comes first and carries no
// status parameter at all, so it's the plain list URL rather than a
// filter that happens to match everything — which keeps the common case
// a clean link someone can bookmark.
//
// The current search is carried through each tab: switching from Unread
// to Archived while searching should narrow the same search, not throw
// it away.
func tabsFor(view kindView, counts contact.StatusCounts, active, query string) []statusTab {
	rows := []struct {
		label  string
		status string
		count  int
	}{
		{"All", "", counts.Total},
		{"Unread", contact.StatusNew, counts.New},
		{"Read", contact.StatusRead, counts.Read},
		{"Archived", contact.StatusArchived, counts.Archived},
	}

	tabs := make([]statusTab, 0, len(rows))
	for _, row := range rows {
		tabs = append(tabs, statusTab{
			Label:  row.label,
			Count:  row.count,
			URL:    view.Path + listQuery(row.status, query, 1),
			Active: row.status == active,
		})
	}
	return tabs
}

// listQuery builds a list URL's query string. Page 1 and empty filters
// are left out entirely, so the unfiltered first page is just the path.
func listQuery(status, query string, page int) string {
	v := url.Values{}
	if status != "" {
		v.Set("status", status)
	}
	if query != "" {
		v.Set("q", query)
	}
	if page > 1 {
		v.Set("page", strconv.Itoa(page))
	}
	if len(v) == 0 {
		return ""
	}
	return "?" + v.Encode()
}

// listStateOf recovers a list view's filter state from a request —
// either a GET's query string or a POST's hidden form fields, which is
// what r.FormValue papers over. The status is validated against the
// known set and the page coerced to a sane integer, so nothing from the
// caller reaches SQL or a redirect unchecked.
func listStateOf(r *http.Request) (status, query string, page int) {
	status = oneOf(r.FormValue("status"), contact.Statuses...)
	query = r.FormValue("q")
	page, err := strconv.Atoi(r.FormValue("page"))
	if err != nil || page < 1 {
		page = 1
	}
	return status, query, page
}

// oneOf returns got if it's one of allowed, else "". This is what keeps
// a hand-edited ?status=whatever from reaching the store as a filter
// that matches nothing and looks like an empty inbox — an unrecognized
// value falls back to "no filter", the honest reading of a request
// nobody can satisfy.
func oneOf(got string, allowed ...string) string {
	for _, a := range allowed {
		if got == a {
			return got
		}
	}
	return ""
}

// --- Detail and triage ---------------------------------------------------

type detailPage struct {
	basePage
	View       kindView
	Submission contact.Submission
	// Fields is what the page renders: the populated fields for this
	// submission's kind, in display order. Built in the handler rather
	// than branched on in the template, so an inquiry doesn't carry a
	// bug report's empty rows and vice versa.
	Fields []field
	// BackQuery is the list state to return to; BackPath is which list,
	// derived from the submission's own kind rather than passed around,
	// since a bug report's "back" can only ever mean the bugs page.
	BackQuery string
	BackPath  string
	// Status is the filter to carry through a mutation, kept separate
	// from the submission's own status so the two can't be confused.
	Status, Query string
	Page          int
	// Actions are the triage buttons to offer — every state except the
	// one it's already in.
	Actions []statusAction
}

// statusAction is one triage button: the status it sets and what the
// button says, which is a verb rather than the status name ("Mark read",
// not "Read") so the button describes the click.
type statusAction struct {
	Status string
	Label  string
}

// field is one label/value row on the detail page. Link marks a value
// that should render as a link rather than as text.
type field struct {
	Label string
	Value string
	Link  string
}

func (h *Handler) showDetail(w http.ResponseWriter, r *http.Request, sess *session) {
	sub, ok := h.lookupSubmission(w, r)
	if !ok {
		return
	}

	view := viewFor(sub.Kind)
	base, err := h.chrome(r, view.Path, view.One+" #"+strconv.FormatInt(sub.ID, 10), sess)
	if err != nil {
		h.fail(w, "nav counts", err)
		return
	}

	status, query, page := listStateOf(r)
	h.render(w, "detail", detailPage{
		basePage:   base,
		View:       view,
		Submission: sub,
		Fields:     fieldsOf(sub),
		BackQuery:  listQuery(status, query, page),
		BackPath:   view.Path,
		Status:     status,
		Query:      query,
		Page:       page,
		Actions:    actionsFor(sub.Status),
	})
}

// fieldsOf picks the rows to show for one submission. Both forms share
// name/email; everything else belongs to exactly one of them (see
// internal/contact/types.go), and an empty optional field is omitted
// rather than rendered blank — a bug report with no link shouldn't have
// a Link row implying the reporter left one.
//
// Received and Message are not here: the date sits in the page header
// and the message gets its own block, both because they're the two
// things you always want and burying them in a list of labels is what
// made everything look the same.
func fieldsOf(sub contact.Submission) []field {
	var fields []field

	if sub.Name != "" {
		fields = append(fields, field{Label: "Name", Value: sub.Name})
	}
	if sub.Email != "" {
		// mailto: is the single most useful thing on this page —
		// reading an inquiry is nearly always followed by replying.
		fields = append(fields, field{Label: "Email", Value: sub.Email, Link: "mailto:" + sub.Email})
	}

	switch sub.Kind {
	case contact.KindInquiry:
		if sub.Topic != "" {
			fields = append(fields, field{Label: "Looking for", Value: sub.Topic})
		}
	case contact.KindBug:
		if sub.Effect != "" {
			fields = append(fields, field{Label: "Effect", Value: sub.Effect})
		}
		if sub.Site != "" {
			fields = append(fields, field{Label: "Running it", Value: whereRunning(sub.Site)})
		}
		if sub.Link != "" {
			// Linked, but the stored value is the reporter's free text
			// and not necessarily http(s) — see the template, which
			// renders it with rel="noreferrer nofollow" so following one
			// doesn't leak the admin URL in a Referer header.
			fields = append(fields, field{Label: "Link", Value: sub.Link, Link: sub.Link})
		}
		if sub.Browser != "" {
			fields = append(fields, field{Label: "Browser", Value: sub.Browser})
		}
	}

	return fields
}

// whereRunning renders the bug form's "where are you running it" answer
// as a sentence. Note this is the reporter's answer about their own
// environment — contact.SiteOwn means a copy of the script on a site of
// theirs — and has nothing to do with which site this is.
func whereRunning(site string) string {
	switch site {
	case contact.SiteThis:
		return "On this site"
	case contact.SiteOwn:
		return "On a site of their own"
	default:
		return site
	}
}

// actionsFor lists the triage buttons worth offering: every state the
// submission isn't already in. A "Mark read" button on something already
// read does nothing and still has to be read past.
func actionsFor(current string) []statusAction {
	labels := map[string]string{
		contact.StatusNew:      "Mark unread",
		contact.StatusRead:     "Mark read",
		contact.StatusArchived: "Archive",
	}

	var out []statusAction
	for _, s := range contact.Statuses {
		if s != current {
			out = append(out, statusAction{Status: s, Label: labels[s]})
		}
	}
	return out
}

func (h *Handler) setStatus(w http.ResponseWriter, r *http.Request, sess *session) {
	id, ok := parseID(w, r)
	if !ok {
		return
	}

	// The new status is posted as "to", not "status": the same form also
	// carries the list view's filters as hidden fields so the redirect
	// can return there, and one of those filters is itself a status. Two
	// meanings under one name is how a filter silently becomes an action.
	status := r.PostFormValue("to")
	if !contact.ValidStatus(status) {
		http.Error(w, "unknown status", http.StatusBadRequest)
		return
	}

	switch err := h.store.SetStatus(r.Context(), id, status); {
	case errors.Is(err, contact.ErrNotFound):
		http.NotFound(w, r)
		return
	case err != nil:
		h.fail(w, "set status", err)
		return
	}

	// Back to the same submission, so the change is visible and the next
	// step is one click away. See Other (303) rather than 302 so the
	// browser follows with a GET and a refresh doesn't re-post.
	filterStatus, query, page := listStateOf(r)
	http.Redirect(w, r,
		"/admin/submission/"+strconv.FormatInt(id, 10)+listQuery(filterStatus, query, page),
		http.StatusSeeOther)
}

func (h *Handler) deleteSubmission(w http.ResponseWriter, r *http.Request, sess *session) {
	id, ok := parseID(w, r)
	if !ok {
		return
	}

	// Read the kind before deleting: afterwards there's no row left to
	// ask which list to return to.
	sub, err := h.store.Get(r.Context(), id)
	if errors.Is(err, contact.ErrNotFound) {
		http.NotFound(w, r)
		return
	}
	if err != nil {
		h.fail(w, "get submission", err)
		return
	}

	switch err := h.store.Delete(r.Context(), id); {
	case errors.Is(err, contact.ErrNotFound):
		http.NotFound(w, r)
		return
	case err != nil:
		h.fail(w, "delete submission", err)
		return
	}

	log.Printf("admin: deleted submission %d", id)
	status, query, page := listStateOf(r)
	http.Redirect(w, r, viewFor(sub.Kind).Path+listQuery(status, query, page), http.StatusSeeOther)
}

// lookupSubmission loads the submission named by the request path,
// answering 404 for both a non-numeric id and a missing row — from the
// outside those are the same thing, a URL for a submission that isn't
// there.
func (h *Handler) lookupSubmission(w http.ResponseWriter, r *http.Request) (contact.Submission, bool) {
	id, ok := parseID(w, r)
	if !ok {
		return contact.Submission{}, false
	}

	sub, err := h.store.Get(r.Context(), id)
	switch {
	case errors.Is(err, contact.ErrNotFound):
		http.NotFound(w, r)
		return contact.Submission{}, false
	case err != nil:
		h.fail(w, "get submission", err)
		return contact.Submission{}, false
	}
	return sub, true
}

func parseID(w http.ResponseWriter, r *http.Request) (int64, bool) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil || id < 1 {
		http.NotFound(w, r)
		return 0, false
	}
	return id, true
}

// fail logs the real error and shows the visitor a generic one. The
// detail belongs in the log, not on the page: it's the owner's own
// server, but an error string is the kind of thing that ends up
// screenshotted into a bug report.
func (h *Handler) fail(w http.ResponseWriter, what string, err error) {
	log.Printf("admin: %s: %v", what, err)
	http.Error(w, "internal server error", http.StatusInternalServerError)
}

// --- Login ---------------------------------------------------------------

// loginCSRFCookie carries the login form's CSRF token. The login POST is
// the one mutation with no session to hang a token on, so it uses the
// standard double-submit pattern: a random value is set both as this
// cookie and as a hidden field, and they have to match. A cross-site
// page can forge the field but cannot read or set a cookie for this
// host, so it cannot make them agree.
const loginCSRFCookie = "admin_login_csrf"

type loginPage struct {
	basePage
	// Error is shown above the form: a failed attempt, a lockout, or an
	// expired form. Deliberately vague for a failed attempt — see doLogin.
	Error string
	// LockedOut hides the form entirely, since offering inputs that
	// can't be submitted is worse than saying why.
	LockedOut bool
	// SignedOut shows the confirmation after a logout, so the button
	// visibly does something.
	SignedOut bool
}

func (h *Handler) showLogin(w http.ResponseWriter, r *http.Request) {
	// Already signed in: skip the form. Someone reaching /admin/login
	// with a live session almost certainly followed an old bookmark.
	if cookie, err := r.Cookie(sessionCookie); err == nil {
		if _, ok := h.sessions.lookup(cookie.Value); ok {
			http.Redirect(w, r, "/admin/", http.StatusSeeOther)
			return
		}
	}

	token, err := randomToken()
	if err != nil {
		h.fail(w, "mint login csrf", err)
		return
	}
	http.SetCookie(w, h.cookie(loginCSRFCookie, token, time.Hour))

	h.render(w, "login", loginPage{
		basePage:  basePage{Title: "Sign in", CSRF: token},
		SignedOut: r.URL.Query().Has("signed-out"),
	})
}

func (h *Handler) doLogin(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseForm(); err != nil {
		h.renderLoginError(w, "That form didn't submit properly. Try again.")
		return
	}

	// Lockout first, before the password is hashed: the point is to make
	// a few thousand guesses infeasible, and 600k PBKDF2 iterations per
	// attempt is also a few hundred milliseconds of this server's CPU an
	// attacker shouldn't get to spend for free.
	if h.allowLogin != nil && !h.allowLogin(r) {
		h.render(w, "login", loginPage{
			basePage:  basePage{Title: "Sign in"},
			Error:     "Too many sign-in attempts from this address. Wait a few minutes and try again.",
			LockedOut: true,
		})
		return
	}

	// The login form's CSRF check. Failing this isn't a wrong password,
	// so it says so: the usual cause is a page left open long enough for
	// the cookie to expire.
	cookie, err := r.Cookie(loginCSRFCookie)
	if err != nil || !sameToken(r.PostFormValue("csrf"), cookie.Value) {
		h.renderLoginError(w, "This sign-in page expired. Reload it and try again.")
		return
	}

	if !h.cred.verify(r.PostFormValue("user"), r.PostFormValue("password")) {
		// One message for a wrong username and a wrong password both.
		// Saying which was wrong would confirm a valid username to
		// someone guessing, and the owner — the only person who should
		// see this — knows which of the two they got wrong.
		log.Printf("admin: failed sign-in from %s", r.RemoteAddr)
		h.renderLoginError(w, "Wrong username or password.")
		return
	}

	token, err := h.sessions.create()
	if err != nil {
		h.fail(w, "create session", err)
		return
	}

	// Drop the login CSRF cookie now it's served its purpose, so a
	// signed-in browser isn't carrying a stale token for an hour.
	http.SetCookie(w, h.cookie(loginCSRFCookie, "", -time.Hour))
	http.SetCookie(w, h.cookie(sessionCookie, token, sessionTTL))

	log.Printf("admin: signed in from %s", r.RemoteAddr)
	http.Redirect(w, r, "/admin/", http.StatusSeeOther)
}

// renderLoginError redraws the login form with a message and a fresh
// CSRF token. The token has to be reissued: the POST consumed the page
// the old one was rendered into, and without a new one the retry would
// fail the CSRF check instead of the password check.
func (h *Handler) renderLoginError(w http.ResponseWriter, message string) {
	token, err := randomToken()
	if err != nil {
		h.fail(w, "mint login csrf", err)
		return
	}
	http.SetCookie(w, h.cookie(loginCSRFCookie, token, time.Hour))

	// 401 rather than 200: the accurate status for a rejected
	// credential, and it keeps a failed attempt out of the browser's
	// back/forward cache as a "successful" page.
	w.WriteHeader(http.StatusUnauthorized)
	h.render(w, "login", loginPage{
		basePage: basePage{Title: "Sign in", CSRF: token},
		Error:    message,
	})
}

func (h *Handler) doLogout(w http.ResponseWriter, r *http.Request, sess *session) {
	if cookie, err := r.Cookie(sessionCookie); err == nil {
		h.sessions.destroy(cookie.Value)
	}
	http.SetCookie(w, h.cookie(sessionCookie, "", -time.Hour))
	http.Redirect(w, r, "/admin/login?signed-out=1", http.StatusSeeOther)
}

// cookie builds one of the portal's cookies with the flags they share.
// A negative maxAge deletes the cookie.
//
// Path=/admin keeps these off every request for the public site and its
// demo assets. HttpOnly keeps them out of document.cookie, so a script
// injected anywhere on this origin still can't read the session.
// SameSite=Lax is the CSRF defense that pairs with the token: it lets a
// normal top-level navigation into /admin carry the cookie (so a link or
// bookmark stays signed in) while withholding it from a POST originating
// on another site. Secure is on in production and off in dev — see
// Config.SecureCookies.
func (h *Handler) cookie(name, value string, maxAge time.Duration) *http.Cookie {
	return &http.Cookie{
		Name:     name,
		Value:    value,
		Path:     "/admin",
		MaxAge:   int(maxAge.Seconds()),
		HttpOnly: true,
		Secure:   h.secure,
		SameSite: http.SameSiteLaxMode,
	}
}
