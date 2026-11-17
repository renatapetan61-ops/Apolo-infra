package store

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"path/filepath"

	_ "modernc.org/sqlite"
)

type Store struct { DB *sql.DB }

func Open(ctx context.Context, path string) (*Store, error) {
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil { return nil, fmt.Errorf("create database directory: %w", err) }
	db, err := sql.Open("sqlite", path)
	if err != nil { return nil, fmt.Errorf("open sqlite: %w", err) }
	db.SetMaxOpenConns(1)
	if _, err := db.ExecContext(ctx, `PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;`); err != nil { db.Close(); return nil, fmt.Errorf("configure sqlite: %w", err) }
	const schema = `CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS infrastructures (
 id TEXT PRIMARY KEY, name TEXT NOT NULL, public_port INTEGER UNIQUE, internal_port INTEGER,
 target_address TEXT, status TEXT NOT NULL DEFAULT 'created', config_json TEXT NOT NULL DEFAULT '{}',
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS port_reservations (
 port INTEGER PRIMARY KEY, infrastructure_id TEXT, purpose TEXT NOT NULL, reserved_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY(infrastructure_id) REFERENCES infrastructures(id) ON DELETE CASCADE
);
INSERT OR IGNORE INTO schema_migrations(version) VALUES (1);`
	if _, err := db.ExecContext(ctx, schema); err != nil { db.Close(); return nil, fmt.Errorf("apply schema: %w", err) }
	if err := db.PingContext(ctx); err != nil { db.Close(); return nil, fmt.Errorf("ping sqlite: %w", err) }
	return &Store{DB: db}, nil
}

func (s *Store) Close() error { return s.DB.Close() }
