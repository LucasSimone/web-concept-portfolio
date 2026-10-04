// Package contact implements the backend for the site's two forms — the
// services inquiry form (web/static/contact/) and the bug report form
// (web/static/bug-report/) — validating submissions from either and
// storing them in one table.
package contact

import (
	"context"
	"database/sql"
	"fmt"

	_ "modernc.org/sqlite"
)

// Store persists contact submissions to a SQLite database.
type Store struct {
	db *sql.DB
}

// OpenStore opens (creating if necessary) the SQLite database at path and
// ensures the submissions table exists and is up to date.
func OpenStore(path string) (*Store, error) {
	db, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, fmt.Errorf("open sqlite: %w", err)
	}
	// SQLite only supports one writer at a time; a single connection avoids
	// "database is locked" errors under concurrent requests.
	db.SetMaxOpenConns(1)

	const schema = `
CREATE TABLE IF NOT EXISTS submissions (
	id         INTEGER PRIMARY KEY AUTOINCREMENT,
	kind       TEXT NOT NULL DEFAULT 'inquiry',
	name       TEXT NOT NULL,
	email      TEXT NOT NULL,
	message    TEXT NOT NULL,
	topic      TEXT NOT NULL DEFAULT '',
	effect     TEXT NOT NULL DEFAULT '',
	site       TEXT NOT NULL DEFAULT '',
	link       TEXT NOT NULL DEFAULT '',
	browser    TEXT NOT NULL DEFAULT '',
	created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);`
	if _, err := db.Exec(schema); err != nil {
		db.Close()
		return nil, fmt.Errorf("create schema: %w", err)
	}

	if err := addMissingColumns(db); err != nil {
		db.Close()
		return nil, err
	}

	return &Store{db: db}, nil
}

// laterColumns are the columns added to `submissions` after the table
// first shipped. CREATE TABLE above only ever runs on a brand-new
// database, so a database an earlier build already created still has the
// original four columns and needs these added to it. Each one has a
// default, so existing rows (all of them inquiries) stay valid.
var laterColumns = []struct{ name, definition string }{
	{"kind", "TEXT NOT NULL DEFAULT 'inquiry'"},
	{"topic", "TEXT NOT NULL DEFAULT ''"},
	{"effect", "TEXT NOT NULL DEFAULT ''"},
	{"site", "TEXT NOT NULL DEFAULT ''"},
	{"link", "TEXT NOT NULL DEFAULT ''"},
	{"browser", "TEXT NOT NULL DEFAULT ''"},
}

// addMissingColumns adds whichever of laterColumns the table doesn't have
// yet, and does nothing at all on a database created by this build.
func addMissingColumns(db *sql.DB) error {
	rows, err := db.Query(`SELECT name FROM pragma_table_info('submissions')`)
	if err != nil {
		return fmt.Errorf("read table info: %w", err)
	}
	defer rows.Close()

	have := make(map[string]bool)
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			return fmt.Errorf("read table info: %w", err)
		}
		have[name] = true
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("read table info: %w", err)
	}

	for _, col := range laterColumns {
		if have[col.name] {
			continue
		}
		// Column names here are our own constants, never user input.
		if _, err := db.Exec(`ALTER TABLE submissions ADD COLUMN ` + col.name + ` ` + col.definition); err != nil {
			return fmt.Errorf("add column %s: %w", col.name, err)
		}
	}
	return nil
}

// Close closes the underlying database connection.
func (s *Store) Close() error {
	return s.db.Close()
}

// Save inserts a new submission.
func (s *Store) Save(ctx context.Context, sub Submission) error {
	_, err := s.db.ExecContext(ctx,
		`INSERT INTO submissions (kind, name, email, message, topic, effect, site, link, browser)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		sub.Kind, sub.Name, sub.Email, sub.Message,
		sub.Topic, sub.Effect, sub.Site, sub.Link, sub.Browser,
	)
	if err != nil {
		return fmt.Errorf("insert submission: %w", err)
	}
	return nil
}
