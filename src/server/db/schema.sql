-- Moonpool schema. Applied idempotently at boot by src/server/db/index.ts.
-- Everything lives in one local SQLite file on the Pi — no external services.

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name          TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('owner','family','guest')),
  password_hash TEXT NOT NULL,
  disabled      INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  token_hash TEXT NOT NULL UNIQUE,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

-- Free-form app-wide settings (pool volume, cost per kWh, VAPID keys, location, …)
CREATE TABLE IF NOT EXISTS app_settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL -- JSON
);

-- Per-user preferences: theme, units, clock, notification prefs, dashboard layout.
CREATE TABLE IF NOT EXISTS user_prefs (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  prefs   TEXT NOT NULL -- JSON
);

-- Owner customization of equipment naming/visibility (keyed by njsPC circuit id).
CREATE TABLE IF NOT EXISTS circuit_meta (
  circuit_id    INTEGER PRIMARY KEY,
  display_name  TEXT,
  icon          TEXT,
  guest_visible INTEGER NOT NULL DEFAULT 0,
  hidden        INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS body_meta (
  body_id      INTEGER PRIMARY KEY,
  display_name TEXT
);

CREATE TABLE IF NOT EXISTS scenes (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,
  icon          TEXT NOT NULL DEFAULT 'sparkles',
  description   TEXT NOT NULL DEFAULT '',
  actions       TEXT NOT NULL, -- JSON PoolAction[]
  guest_visible INTEGER NOT NULL DEFAULT 0,
  position      INTEGER NOT NULL DEFAULT 0,
  created_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS automations (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  trigger     TEXT NOT NULL, -- JSON AutomationTrigger
  actions     TEXT NOT NULL, -- JSON PoolAction[]
  enabled     INTEGER NOT NULL DEFAULT 1,
  created_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_via TEXT NOT NULL DEFAULT 'ui' CHECK (created_via IN ('ui','copilot')),
  created_at  INTEGER NOT NULL,
  last_run_at INTEGER,
  last_result TEXT
);

-- One-shot future actions ("turn heater off at midnight").
CREATE TABLE IF NOT EXISTS scheduled_jobs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  label       TEXT NOT NULL DEFAULT '',
  actions     TEXT NOT NULL, -- JSON PoolAction[]
  fire_at     INTEGER NOT NULL,
  created_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  source      TEXT NOT NULL DEFAULT 'ui',
  status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','done','error','cancelled')),
  created_at  INTEGER NOT NULL,
  executed_at INTEGER,
  result      TEXT
);
CREATE INDEX IF NOT EXISTS idx_jobs_pending ON scheduled_jobs(status, fire_at);

-- Every state-changing action, whoever/whatever initiated it.
CREATE TABLE IF NOT EXISTS audit_log (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  at        INTEGER NOT NULL,
  user_id   INTEGER,
  user_name TEXT NOT NULL DEFAULT 'system',
  source    TEXT NOT NULL, -- ui | copilot | automation | scene | schedule | system
  action    TEXT NOT NULL,
  target    TEXT NOT NULL,
  old_value TEXT,
  new_value TEXT,
  ok        INTEGER NOT NULL DEFAULT 1,
  detail    TEXT
);
CREATE INDEX IF NOT EXISTS idx_audit_at ON audit_log(at DESC);

-- Manual water test log (+ IntelliChem snapshots when present).
CREATE TABLE IF NOT EXISTS chemistry_readings (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  at      INTEGER NOT NULL,
  body_id INTEGER NOT NULL DEFAULT 1,
  ph      REAL,
  orp     REAL,
  fc      REAL,
  ta      REAL,
  cya     REAL,
  ch      REAL,
  salt    REAL,
  notes   TEXT NOT NULL DEFAULT '',
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_chem_at ON chemistry_readings(at DESC);

-- Generic time series sampled by the runtime (temps, watts, salt, ph, orp…).
CREATE TABLE IF NOT EXISTS history_samples (
  at     INTEGER NOT NULL,
  metric TEXT NOT NULL,   -- e.g. temp:body:1, temp:air, pump:1:watts, chlor:1:salt
  value  REAL NOT NULL,
  PRIMARY KEY (at, metric)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS idx_hist_metric ON history_samples(metric, at);

-- Daily rollups so charts over long ranges stay cheap on the Pi.
CREATE TABLE IF NOT EXISTS history_rollups (
  day    TEXT NOT NULL,   -- YYYY-MM-DD local
  metric TEXT NOT NULL,
  min    REAL NOT NULL,
  max    REAL NOT NULL,
  avg    REAL NOT NULL,
  count  INTEGER NOT NULL,
  PRIMARY KEY (day, metric)
) WITHOUT ROWID;

-- Equipment runtime + energy per local day.
CREATE TABLE IF NOT EXISTS equipment_runtime (
  day     TEXT NOT NULL,
  key     TEXT NOT NULL,  -- e.g. pump:1, heater:body:1, circuit:3
  seconds INTEGER NOT NULL DEFAULT 0,
  wh      REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (day, key)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint   TEXT NOT NULL UNIQUE,
  keys       TEXT NOT NULL, -- JSON {p256dh, auth}
  created_at INTEGER NOT NULL
);

-- Edge-trigger bookkeeping for alerts (avoid re-notifying every tick).
CREATE TABLE IF NOT EXISTS alert_state (
  key           TEXT PRIMARY KEY,
  active        INTEGER NOT NULL DEFAULT 0,
  since         INTEGER,
  last_notified INTEGER
);

CREATE TABLE IF NOT EXISTS copilot_threads (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title      TEXT NOT NULL DEFAULT 'New chat',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS copilot_messages (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  thread_id  INTEGER NOT NULL REFERENCES copilot_threads(id) ON DELETE CASCADE,
  role       TEXT NOT NULL CHECK (role IN ('user','assistant')),
  content    TEXT NOT NULL,
  -- Pending/executed tool plan attached to an assistant message (JSON).
  plan       TEXT,
  plan_state TEXT CHECK (plan_state IN ('pending','confirmed','cancelled','executed','error')),
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_copilot_msgs ON copilot_messages(thread_id, id);
