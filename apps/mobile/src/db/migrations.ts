export const migrations: readonly string[] = [
  `
CREATE TABLE replica (
  entity TEXT NOT NULL,
  id TEXT NOT NULL,
  revision INTEGER,
  pending INTEGER NOT NULL DEFAULT 0,
  deleted INTEGER NOT NULL DEFAULT 0,
  pull_gen INTEGER NOT NULL DEFAULT 0,
  sort_key TEXT,
  json TEXT NOT NULL,
  PRIMARY KEY (entity, id)
);
CREATE INDEX replica_range ON replica (entity, sort_key);

CREATE TABLE outbox (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  client_mutation_id TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL,
  method TEXT NOT NULL,
  path TEXT NOT NULL,
  body TEXT,
  entity TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  server_errors INTEGER NOT NULL DEFAULT 0,
  next_retry_at INTEGER NOT NULL DEFAULT 0,
  last_error TEXT
);

CREATE TABLE dead_letter (
  client_mutation_id TEXT PRIMARY KEY,
  method TEXT NOT NULL,
  path TEXT NOT NULL,
  body TEXT,
  status INTEGER NOT NULL,
  error TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  failed_at INTEGER NOT NULL
);

CREATE TABLE asset_file (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  local_uri TEXT,
  state TEXT NOT NULL,
  sha256 TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_retry_at INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE local_walk (
  id TEXT PRIMARY KEY,
  pet_id TEXT NOT NULL,
  state TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  paused_ms INTEGER NOT NULL DEFAULT 0,
  pause_started_at INTEGER,
  tracking_mode TEXT NOT NULL
);

CREATE TABLE walk_point (
  walk_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  lat REAL NOT NULL,
  lon REAL NOT NULL,
  t INTEGER NOT NULL,
  acc REAL NOT NULL,
  paused INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (walk_id, seq)
);

CREATE TABLE walk_route_cache (
  walk_id TEXT PRIMARY KEY,
  points TEXT NOT NULL
);

CREATE TABLE kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`,
];
