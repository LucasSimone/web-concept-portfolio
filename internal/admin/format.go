package admin

// Display helpers for the templates. They exist so the handlers can hand
// templates the stored values unchanged and the templates can stay free
// of logic — the alternative is either formatting in the handler (which
// then has to know what the page looks like) or expressions in the
// template (which html/template is bad at on purpose).

import (
	"strings"
	"time"
	"unicode"
)

// storedTimeLayout is how SQLite writes created_at — see the schema's
// strftime('%Y-%m-%dT%H:%M:%fZ', 'now') in internal/contact/store.go.
// The %f gives fractional seconds, hence .000 rather than plain seconds.
const storedTimeLayout = "2006-01-02T15:04:05.000Z"

// prettyTime renders a stored timestamp as "2 Jan 2006, 15:04" in local
// time. Local rather than the stored UTC because the only person reading
// this is the site owner, for whom "yesterday evening" is a more useful
// fact about a submission than its UTC instant.
//
// Unparseable input comes back unchanged rather than blank: a row with a
// strange-looking timestamp is a puzzle, but a row with an empty date
// cell reads as a rendering bug and hides that the submission is there.
func prettyTime(stored string) string {
	t, err := time.Parse(storedTimeLayout, stored)
	if err != nil {
		return stored
	}
	return t.Local().Format("2 Jan 2006, 15:04")
}

// summarizeLen is where a list-view snippet gets cut. Long enough to
// tell two inquiries apart at a glance, short enough that every row
// stays one line in the table.
const summarizeLen = 110

// summarize flattens a message to one line for the list view: newlines
// and runs of whitespace collapse to single spaces, and anything past
// summarizeLen becomes an ellipsis. Cutting on a rune boundary (via the
// []rune conversion) rather than a byte one keeps a truncated message
// from ending in half a multi-byte character, which renders as a
// replacement glyph.
func summarize(message string) string {
	flat := strings.Join(strings.Fields(message), " ")
	runes := []rune(flat)
	if len(runes) <= summarizeLen {
		return flat
	}
	return strings.TrimRight(string(runes[:summarizeLen]), " ") + "…"
}

// lower is strings.ToLower, exposed to templates so a label written for
// a heading ("Inquiries") can be reused mid-sentence ("See all
// inquiries") without storing the same word twice in two cases.
func lower(s string) string { return strings.ToLower(s) }

// titleCase capitalizes the first letter, for rendering a stored
// lowercase enum ("inquiry", "archived") as a label. strings.Title is
// deprecated and does more than this (it capitalizes every word, with
// Unicode word-boundary rules), and the values here are single lowercase
// ASCII words, so the whole job is the first rune.
func titleCase(s string) string {
	if s == "" {
		return s
	}
	runes := []rune(s)
	runes[0] = unicode.ToUpper(runes[0])
	return string(runes)
}
