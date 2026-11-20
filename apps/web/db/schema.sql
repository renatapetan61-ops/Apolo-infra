PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS workers (
  worker_id TEXT PRIMARY KEY,
  engine TEXT NOT NULL DEFAULT 'unknown',
  hostname TEXT NOT NULL DEFAULT '',
  gateway_url TEXT,
  status TEXT NOT NULL DEFAULT 'offline' CHECK (status IN ('online','offline')),
  last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS infrastructures (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL,
  image TEXT NOT NULL DEFAULT '',
  public_port INTEGER UNIQUE,
  internal_port INTEGER,
  container_port INTEGER NOT NULL DEFAULT 8080 CHECK (container_port BETWEEN 1 AND 65535),
  target_address TEXT,
  config_json TEXT NOT NULL DEFAULT '{}',
  hostname TEXT NOT NULL DEFAULT '',
  https_enabled INTEGER NOT NULL DEFAULT 0,
  certificate_path TEXT NOT NULL DEFAULT '',
  private_key_path TEXT NOT NULL DEFAULT '',
  nginx_config_path TEXT NOT NULL DEFAULT '',
  engine TEXT NOT NULL DEFAULT '',
  container_id TEXT NOT NULL DEFAULT '',
  host_port INTEGER,
  status TEXT NOT NULL DEFAULT 'created',
  last_result TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(name)
);

CREATE TABLE IF NOT EXISTS port_reservations (
  port INTEGER PRIMARY KEY,
  infrastructure_id TEXT,
  purpose TEXT NOT NULL,
  reserved_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (infrastructure_id) REFERENCES infrastructures(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  infrastructure_id TEXT REFERENCES infrastructures(id) ON DELETE SET NULL,
  action TEXT NOT NULL CHECK (action IN ('create','delete','inspect')),
  payload TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','succeeded','failed')),
  worker_id TEXT REFERENCES workers(worker_id) ON DELETE SET NULL,
  result TEXT,
  error TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  started_at TEXT,
  heartbeat_at TEXT,
  finished_at TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS jobs_queue_idx ON jobs(status, created_at) WHERE status='queued';
CREATE INDEX IF NOT EXISTS jobs_owner_idx ON jobs(owner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS infrastructures_owner_idx ON infrastructures(owner_id, created_at DESC);
