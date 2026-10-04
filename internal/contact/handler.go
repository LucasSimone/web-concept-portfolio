package contact

import (
	"encoding/json"
	"log"
	"net/http"
	"net/mail"
	"strings"
)

const (
	maxMessageLen = 5000
	// Every other field is a name, an email, or a dropdown value, so a
	// generous single cap covers them all. The user-agent string is the
	// longest of them by far and still comes nowhere near this.
	maxFieldLen = 500
)

// Handler serves POST /api/contact: decode -> validate -> store. Both the
// contact form and the bug report form post here; the body's "kind" says
// which, and that decides what's required.
type Handler struct {
	store *Store
}

// NewHandler builds a Handler that persists valid submissions to store.
func NewHandler(store *Store) *Handler {
	return &Handler{store: store}
}

func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	var req request
	// Cap the body at 1MiB so a malicious/broken client can't make us
	// buffer an unbounded request into memory.
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	sub := req.Submission
	sub.Name = strings.TrimSpace(sub.Name)
	sub.Email = strings.TrimSpace(sub.Email)
	sub.Message = strings.TrimSpace(sub.Message)
	sub.Topic = strings.TrimSpace(sub.Topic)
	sub.Effect = strings.TrimSpace(sub.Effect)
	sub.Site = strings.TrimSpace(sub.Site)
	sub.Link = strings.TrimSpace(sub.Link)
	sub.Browser = strings.TrimSpace(sub.Browser)

	// Honeypot: real visitors never fill this hidden field. Report success
	// without touching storage so bots don't learn their submission failed.
	if req.Honeypot != "" {
		writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
		return
	}

	if msg, ok := validate(&sub); !ok {
		writeError(w, http.StatusBadRequest, msg)
		return
	}

	if err := h.store.Save(r.Context(), sub); err != nil {
		log.Printf("contact: save submission: %v", err)
		writeError(w, http.StatusInternalServerError, "failed to save submission")
		return
	}

	writeJSON(w, http.StatusCreated, map[string]bool{"ok": true})
}

// validate checks sub (filling in a missing Kind) and returns a message
// to send back to the browser when something's wrong.
func validate(sub *Submission) (string, bool) {
	if sub.Kind == "" {
		sub.Kind = KindInquiry
	}

	switch sub.Kind {
	case KindInquiry:
		// An inquiry is a request for a reply, so it needs somewhere to
		// send one.
		if sub.Name == "" {
			return "name is required", false
		}
		if _, err := mail.ParseAddress(sub.Email); err != nil {
			return "a valid email address is required", false
		}
	case KindBug:
		// A bug report only needs the bug. Nobody has to identify
		// themselves to tell us something is broken — but an address
		// they do leave still has to be a real one.
		if sub.Email != "" {
			if _, err := mail.ParseAddress(sub.Email); err != nil {
				return "that email address doesn't look valid", false
			}
		}
	default:
		return "unknown submission kind", false
	}

	if sub.Message == "" {
		return "message is required", false
	}
	if len(sub.Message) > maxMessageLen {
		return "message is too long", false
	}
	for _, field := range []string{sub.Name, sub.Email, sub.Topic, sub.Effect, sub.Site, sub.Link, sub.Browser} {
		if len(field) > maxFieldLen {
			return "one of the fields is too long", false
		}
	}

	return "", true
}

// writeJSON writes v as the JSON response body with the given status code.
func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

// writeError writes {"error": msg} with the given status code.
func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}
