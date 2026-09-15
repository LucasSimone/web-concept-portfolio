package contact

import (
	"encoding/json"
	"log"
	"net/http"
	"net/mail"
	"strings"
)

const maxMessageLen = 5000

// Handler serves POST /api/contact: decode -> validate -> store.
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

	req.Name = strings.TrimSpace(req.Name)
	req.Email = strings.TrimSpace(req.Email)
	req.Message = strings.TrimSpace(req.Message)

	// Honeypot: real visitors never fill this hidden field. Report success
	// without touching storage so bots don't learn their submission failed.
	if req.Honeypot != "" {
		writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
		return
	}

	if req.Name == "" || req.Message == "" {
		writeError(w, http.StatusBadRequest, "name and message are required")
		return
	}
	if len(req.Message) > maxMessageLen {
		writeError(w, http.StatusBadRequest, "message is too long")
		return
	}
	if _, err := mail.ParseAddress(req.Email); err != nil {
		writeError(w, http.StatusBadRequest, "a valid email address is required")
		return
	}

	if err := h.store.Save(r.Context(), req.Name, req.Email, req.Message); err != nil {
		log.Printf("contact: save submission: %v", err)
		writeError(w, http.StatusInternalServerError, "failed to save submission")
		return
	}

	writeJSON(w, http.StatusCreated, map[string]bool{"ok": true})
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
