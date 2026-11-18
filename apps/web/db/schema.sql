CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS workers (
  worker_id text PRIMARY KEY,
  engine text NOT NULL DEFAULT 'unknown',
  hostname text NOT NULL DEFAULT '',
  gateway_url text,
  status text NOT NULL DEFAULT 'offline' CHECK (status IN ('online','offline')),
  last_seen_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS infrastructures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id text NOT NULL,
  name text NOT NULL,
  image text NOT NULL,
  container_port integer NOT NULL CHECK (container_port BETWEEN 1 AND 65535),
  hostname text,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','deleting','deleted','error')),
  engine text,
  container_id text,
  host_port integer,
  last_result jsonb,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(name)
);

CREATE TABLE IF NOT EXISTS jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id text NOT NULL,
  infrastructure_id uuid REFERENCES infrastructures(id) ON DELETE SET NULL,
  action text NOT NULL CHECK (action IN ('create','delete','inspect')),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','succeeded','failed')),
  worker_id text REFERENCES workers(worker_id) ON DELETE SET NULL,
  result jsonb,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  heartbeat_at timestamptz,
  finished_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS jobs_queue_idx ON jobs(status,created_at) WHERE status='queued';
CREATE INDEX IF NOT EXISTS jobs_owner_idx ON jobs(owner_id,created_at DESC);
CREATE INDEX IF NOT EXISTS infrastructures_owner_idx ON infrastructures(owner_id,created_at DESC);