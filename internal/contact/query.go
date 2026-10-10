package contact

// The read side of the store. Save (store.go) is everything the public
// forms need; everything here exists for the admin portal, which is the
// only caller. It lives in this package rather than next to the portal's
// handlers so that all the SQL touching `submissions` stays in one place
// — the handlers deal in Submissions and never in query strings.

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
)

// ErrNotFound is returned by Get and by the mutating calls when no row
// has the requested id, which in a portal with triage buttons mostly
// means the submission was deleted in another tab rather than that
// anything is broken. Callers turn it into a 404.
var ErrNotFound = errors.New("submission not found")

// ListFilter narrows a List call. A zero ListFilter (beyond Limit) means
// "everything, newest first": each field is skipped when empty, so the
// portal can pass whatever subset of the filter bar the user actually
// filled in without branching on the combinations.
type ListFilter struct {
	// Kind limits results to KindInquiry or KindBug. Empty means both.
	Kind string
	// Status limits results to one triage state. Empty means all of them
	// — note this includes archived submissions, so the portal passes
	// StatusNew/StatusRead explicitly rather than relying on a default,
	// and has no "everything except archived" mode because two clicks of
	// a visible filter beat a hidden rule nobody can see.
	Status string
	// Query is free text matched case-insensitively against name, email
	// and message. Not the other columns: a search for "chrome" should
	// find someone writing about Chrome, not every bug report that
	// happened to carry a Chrome user-agent string, which would be most
	// of them.
	Query string
	// Limit and Offset page the results. Limit <= 0 is treated as
	// unlimited, which no caller wants but is less surprising than
	// silently returning nothing.
	Limit, Offset int
}

// List returns one page of submissions matching f, newest first, along
// with the total number of matches ignoring Limit/Offset — the portal
// needs that second number to know whether to draw a "next page" link,
// and getting it in the same call keeps the two from disagreeing.
//
// Ordering is by created_at, with id as a tiebreaker. For submissions
// that actually arrived through the forms, ordering by id alone would
// give the identical answer and be marginally cheaper, since id is
// AUTOINCREMENT and rises with insertion time. It stops being identical
// the moment a row's created_at doesn't match its insertion order —
// seeded test data, an import, or a restored backup — and then the list
// renders in one order while displaying timestamps that say another,
// which reads as the sort being broken.
//
// Sorting by the column the page shows removes that whole class of
// confusion. The id tiebreaker is what keeps pagination stable: two rows
// sharing a timestamp could otherwise swap places between page 1 and
// page 2 and let a submission hide in the seam.
func (s *Store) List(ctx context.Context, f ListFilter) ([]Submission, int, error) {
	where, args := f.where()

	var total int
	if err := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM submissions`+where, args...).Scan(&total); err != nil {
		return nil, 0, fmt.Errorf("count submissions: %w", err)
	}

	query := `
SELECT id, kind, name, email, message, topic, effect, site, link, browser, status, created_at
FROM submissions` + where + `
ORDER BY created_at DESC, id DESC`
	if f.Limit > 0 {
		query += `
LIMIT ? OFFSET ?`
		args = append(args, f.Limit, max(f.Offset, 0))
	}

	rows, err := s.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, 0, fmt.Errorf("list submissions: %w", err)
	}
	defer rows.Close()

	var subs []Submission
	for rows.Next() {
		sub, err := scanSubmission(rows)
		if err != nil {
			return nil, 0, err
		}
		subs = append(subs, sub)
	}
	if err := rows.Err(); err != nil {
		return nil, 0, fmt.Errorf("list submissions: %w", err)
	}
	return subs, total, nil
}

// StatusCounts is how many submissions of one kind sit in each triage
// state. The admin portal shows these constantly — as the unread badges
// in its nav, the numbers on its dashboard, and the counts on its filter
// tabs — so they come back in one struct from one grouped query rather
// than as four separate COUNT(*) round trips.
type StatusCounts struct {
	New, Read, Archived, Total int
}

// CountsByStatus counts one kind's submissions per triage state.
//
// A status with no rows simply stays zero: the GROUP BY returns no row
// for it, which is the same answer. Any status in the table that isn't
// one of the three known ones is folded into Total but nothing else —
// it can't happen through SetStatus (which validates), so the only way
// to get one is editing the database by hand, and silently dropping such
// a row from Total would make the dashboard disagree with the list.
func (s *Store) CountsByStatus(ctx context.Context, kind string) (StatusCounts, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT status, COUNT(*) FROM submissions WHERE kind = ? GROUP BY status`, kind)
	if err != nil {
		return StatusCounts{}, fmt.Errorf("count by status: %w", err)
	}
	defer rows.Close()

	var counts StatusCounts
	for rows.Next() {
		var status string
		var n int
		if err := rows.Scan(&status, &n); err != nil {
			return StatusCounts{}, fmt.Errorf("count by status: %w", err)
		}
		switch status {
		case StatusNew:
			counts.New = n
		case StatusRead:
			counts.Read = n
		case StatusArchived:
			counts.Archived = n
		}
		counts.Total += n
	}
	if err := rows.Err(); err != nil {
		return StatusCounts{}, fmt.Errorf("count by status: %w", err)
	}
	return counts, nil
}

// Get returns the submission with the given id, or ErrNotFound.
func (s *Store) Get(ctx context.Context, id int64) (Submission, error) {
	row := s.db.QueryRowContext(ctx, `
SELECT id, kind, name, email, message, topic, effect, site, link, browser, status, created_at
FROM submissions WHERE id = ?`, id)

	sub, err := scanSubmission(row)
	if errors.Is(err, sql.ErrNoRows) {
		return Submission{}, ErrNotFound
	}
	if err != nil {
		return Submission{}, err
	}
	return sub, nil
}

// SetStatus moves one submission to a new triage state. It returns an
// error for a status outside Statuses rather than writing it: the column
// is plain TEXT with no CHECK constraint, so a typo'd value would be
// stored happily and then never match a filter again.
func (s *Store) SetStatus(ctx context.Context, id int64, status string) error {
	if !ValidStatus(status) {
		return fmt.Errorf("set status %q: %w", status, errors.New("unknown status"))
	}
	return s.affectOne(ctx, `UPDATE submissions SET status = ? WHERE id = ?`, status, id)
}

// Delete removes one submission permanently. There's no soft delete and
// no undo — StatusArchived already covers "get this out of my way but
// keep it", so the only thing left for Delete to mean is spam the owner
// never wants to see again.
func (s *Store) Delete(ctx context.Context, id int64) error {
	return s.affectOne(ctx, `DELETE FROM submissions WHERE id = ?`, id)
}

// affectOne runs a statement expected to touch exactly one row by id and
// reports ErrNotFound when it touched none, so SetStatus and Delete both
// answer a stale id the same way Get does instead of reporting success
// for having updated nothing.
func (s *Store) affectOne(ctx context.Context, query string, args ...any) error {
	result, err := s.db.ExecContext(ctx, query, args...)
	if err != nil {
		return fmt.Errorf("update submission: %w", err)
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("update submission: %w", err)
	}
	if affected == 0 {
		return ErrNotFound
	}
	return nil
}

// where builds the shared WHERE clause (and its arguments) for both of
// List's queries, so the count and the page can't drift apart in what
// they consider a match.
func (f ListFilter) where() (string, []any) {
	var clauses []string
	var args []any

	if f.Kind != "" {
		clauses = append(clauses, `kind = ?`)
		args = append(args, f.Kind)
	}
	if f.Status != "" {
		clauses = append(clauses, `status = ?`)
		args = append(args, f.Status)
	}
	if f.Query != "" {
		// SQLite's LIKE is already case-insensitive for ASCII, which is
		// what makes this a usable search without a LOWER() call or a
		// full-text index. The ESCAPE clause is the important part: see
		// escapeLike.
		clauses = append(clauses, `(name LIKE ? ESCAPE '\' OR email LIKE ? ESCAPE '\' OR message LIKE ? ESCAPE '\')`)
		pattern := "%" + escapeLike(f.Query) + "%"
		args = append(args, pattern, pattern, pattern)
	}

	if len(clauses) == 0 {
		return "", nil
	}
	return " WHERE " + strings.Join(clauses, " AND "), args
}

// escapeLike neutralizes the characters that are wildcards to LIKE but
// ordinary text to the person typing them. Without this, searching for
// "100%" matches every submission (the % swallows everything) and
// searching an email for "a_b" quietly also matches "axb" — surprising
// in a way that reads as the search being broken rather than as the
// search being powerful. The backslash is escaped first, since otherwise
// this function's own escape characters would be escaped again.
func escapeLike(s string) string {
	s = strings.ReplaceAll(s, `\`, `\\`)
	s = strings.ReplaceAll(s, `%`, `\%`)
	s = strings.ReplaceAll(s, `_`, `\_`)
	return s
}

// scanner is the overlap between *sql.Row and *sql.Rows, so
// scanSubmission can serve Get and List from one column list. Keeping it
// to one list is the point: the columns, their order, and the struct
// fields they land in all have to agree, and they only have to agree
// once.
type scanner interface {
	Scan(dest ...any) error
}

func scanSubmission(s scanner) (Submission, error) {
	var sub Submission
	err := s.Scan(
		&sub.ID, &sub.Kind, &sub.Name, &sub.Email, &sub.Message,
		&sub.Topic, &sub.Effect, &sub.Site, &sub.Link, &sub.Browser,
		&sub.Status, &sub.CreatedAt,
	)
	if err != nil {
		// sql.ErrNoRows has to survive unwrapped-looking to Get, which
		// checks for it with errors.Is — %w keeps that working.
		return Submission{}, fmt.Errorf("scan submission: %w", err)
	}
	return sub, nil
}
