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
	db, err := sql.Open("sqlite", path); if err != nil { return nil, fmt.Errorf("open sqlite: %w", err) }
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
	var version int
	if err := db.QueryRowContext(ctx, `SELECT MAX(version) FROM schema_migrations`).Scan(&version); err != nil { db.Close(); return nil, err }
	if version < 2 {
		for _, stmt := range []string{
			`ALTER TABLE infrastructures ADD COLUMN engine TEXT NOT NULL DEFAULT ''`,
			`ALTER TABLE infrastructures ADD COLUMN container_id TEXT NOT NULL DEFAULT ''`,
			`ALTER TABLE infrastructures ADD COLUMN image TEXT NOT NULL DEFAULT ''`,
			`CREATE INDEX IF NOT EXISTS idx_infrastructures_status ON infrastructures(status)`,
			`CREATE INDEX IF NOT EXISTS idx_ports_infrastructure ON port_reservations(infrastructure_id)`,
		} { if _, err := db.ExecContext(ctx, stmt); err != nil { db.Close(); return nil, fmt.Errorf("apply schema migration 2: %w", err) } }
		if _, err := db.ExecContext(ctx, `INSERT INTO schema_migrations(version) VALUES (2)`); err != nil { db.Close(); return nil, err }
		version = 2
	}
	if version < 3 {
		for _, stmt := range []string{
			`ALTER TABLE infrastructures ADD COLUMN hostname TEXT NOT NULL DEFAULT ''`,
			`ALTER TABLE infrastructures ADD COLUMN https_enabled INTEGER NOT NULL DEFAULT 0`,
			`ALTER TABLE infrastructures ADD COLUMN certificate_path TEXT NOT NULL DEFAULT ''`,
			`ALTER TABLE infrastructures ADD COLUMN private_key_path TEXT NOT NULL DEFAULT ''`,
			`ALTER TABLE infrastructures ADD COLUMN nginx_config_path TEXT NOT NULL DEFAULT ''`,
			`CREATE UNIQUE INDEX IF NOT EXISTS idx_infrastructures_hostname ON infrastructures(hostname) WHERE hostname <> ''`,
		} { if _, err := db.ExecContext(ctx, stmt); err != nil { db.Close(); return nil, fmt.Errorf("apply schema migration 3: %w", err) } }
		if _, err := db.ExecContext(ctx, `INSERT INTO schema_migrations(version) VALUES (3)`); err != nil { db.Close(); return nil, err }
	}

	if version < 4 {
		for _, stmt := range []string{
			`ALTER TABLE infrastructures ADD COLUMN owner_id TEXT NOT NULL DEFAULT ''`,
			`ALTER TABLE infrastructures ADD COLUMN host_port INTEGER`,
			`ALTER TABLE infrastructures ADD COLUMN last_result TEXT`,
			`ALTER TABLE infrastructures ADD COLUMN last_error TEXT`,
			`CREATE INDEX IF NOT EXISTS idx_infrastructures_owner ON infrastructures(owner_id, created_at DESC)`,
			`CREATE TABLE IF NOT EXISTS workers (
				 worker_id TEXT PRIMARY KEY, engine TEXT NOT NULL DEFAULT 'unknown',
				 hostname TEXT NOT NULL DEFAULT '', gateway_url TEXT,
				 status TEXT NOT NULL DEFAULT 'offline' CHECK(status IN ('online','offline')),
				 last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
			)`,
			`CREATE TABLE IF NOT EXISTS jobs (
				 id TEXT PRIMARY KEY, owner_id TEXT NOT NULL,
				 infrastructure_id TEXT REFERENCES infrastructures(id) ON DELETE SET NULL,
				 action TEXT NOT NULL CHECK(action IN ('create','delete','inspect')),
				 payload TEXT NOT NULL DEFAULT '{}',
				 status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','running','succeeded','failed')),
				 worker_id TEXT REFERENCES workers(worker_id) ON DELETE SET NULL,
				 result TEXT, error TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
				 started_at TEXT, heartbeat_at TEXT, finished_at TEXT,
				 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
			)`,
			`CREATE INDEX IF NOT EXISTS jobs_queue_idx ON jobs(status, created_at) WHERE status='queued'`,
			`CREATE INDEX IF NOT EXISTS jobs_owner_idx ON jobs(owner_id, created_at DESC)`,
		} {
			if _, err := db.ExecContext(ctx, stmt); err != nil { db.Close(); return nil, fmt.Errorf("apply schema migration 4: %w", err) }
		}
		if _, err := db.ExecContext(ctx, `INSERT INTO schema_migrations(version) VALUES (4)`); err != nil { db.Close(); return nil, err }
	}

	if version < 5 {
		if _, err := db.ExecContext(ctx, `ALTER TABLE infrastructures ADD COLUMN container_port INTEGER NOT NULL DEFAULT 8080`); err != nil {
			db.Close(); return nil, fmt.Errorf("apply schema migration 5: %w", err)
		}
		if _, err := db.ExecContext(ctx, `UPDATE infrastructures SET container_port=internal_port WHERE internal_port IS NOT NULL AND internal_port BETWEEN 1 AND 65535`); err != nil {
			db.Close(); return nil, fmt.Errorf("backfill container port migration 5: %w", err)
		}
		if _, err := db.ExecContext(ctx, `INSERT INTO schema_migrations(version) VALUES (5)`); err != nil { db.Close(); return nil, err }
	}
	if err := db.PingContext(ctx); err != nil { db.Close(); return nil, fmt.Errorf("ping sqlite: %w", err) }
	return &Store{DB: db}, nil
}
func (s *Store) Close() error { return s.DB.Close() }
