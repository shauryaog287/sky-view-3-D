-- Track history for replay (2 h rolling window, pruned by cron).
CREATE TABLE IF NOT EXISTS track_points (
  hex   TEXT    NOT NULL,
  ts    INTEGER NOT NULL,          -- epoch ms of the position fix
  lat   REAL    NOT NULL,
  lon   REAL    NOT NULL,
  alt   INTEGER,                   -- feet; NULL on ground
  gs    REAL,                      -- knots
  track REAL,                      -- degrees true
  vrate INTEGER,                   -- feet/minute
  PRIMARY KEY (hex, ts)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS idx_track_points_ts ON track_points (ts);

-- Flight alerts ("tell me when 6E-2134 starts descending into DEL").
CREATE TABLE IF NOT EXISTS alerts (
  id          TEXT PRIMARY KEY,
  device_id   TEXT NOT NULL,
  user_id     TEXT,
  hex         TEXT,
  callsign    TEXT,
  label       TEXT NOT NULL,
  condition   TEXT NOT NULL,       -- takeoff | descent | approach | landed
  airport     TEXT,                -- optional ICAO filter (destination)
  push_sub    TEXT,                -- JSON PushSubscription, NULL = in-app only
  last_phase  TEXT,
  last_alt    INTEGER,
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL,
  fired_at    INTEGER,
  active      INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_alerts_active ON alerts (active, expires_at);
CREATE INDEX IF NOT EXISTS idx_alerts_device ON alerts (device_id);

-- Daily counters for cost guardrails (Google 3D Tiles root sessions per subject/day).
CREATE TABLE IF NOT EXISTS quota_counters (
  day     TEXT    NOT NULL,        -- YYYY-MM-DD (UTC)
  subject TEXT    NOT NULL,        -- "user:<id>", "device:<id>", "ip:<hash>", or "global"
  kind    TEXT    NOT NULL,        -- "tiles_session"
  count   INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, subject, kind)
) WITHOUT ROWID;

-- Privacy-friendly, aggregated feature usage (no user ids, no IPs).
CREATE TABLE IF NOT EXISTS feature_usage (
  day     TEXT    NOT NULL,
  feature TEXT    NOT NULL,
  event   TEXT    NOT NULL,        -- view | use | locked | upsell_click
  count   INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, feature, event)
) WITHOUT ROWID;
