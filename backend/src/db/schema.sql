-- F004: Manager Router - Simplified state machine
-- State: RUNNING (active discussion) | DONE (report generated)

CREATE TABLE IF NOT EXISTS rooms (
  id          TEXT PRIMARY KEY,
  topic       TEXT NOT NULL,
  state       TEXT NOT NULL DEFAULT 'RUNNING'
              CHECK (state IN ('RUNNING','DONE')),
  report      TEXT,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
  id              TEXT PRIMARY KEY,
  room_id         TEXT NOT NULL,
  agent_role      TEXT NOT NULL
                  CHECK (agent_role IN ('MANAGER','WORKER','USER')),
  agent_name      TEXT NOT NULL,
  content         TEXT NOT NULL,
  timestamp       INTEGER NOT NULL,
  type            TEXT NOT NULL
                  CHECK (type IN ('system','statement','question','rebuttal','summary','report','user_action')),
  thinking        TEXT,
  duration_ms     INTEGER,
  total_cost_usd  REAL,
  input_tokens    INTEGER,
  output_tokens   INTEGER,
  temp_msg_id     TEXT,
  FOREIGN KEY (room_id) REFERENCES rooms(id)
);

CREATE TABLE IF NOT EXISTS agents (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  role          TEXT NOT NULL,
  role_label    TEXT NOT NULL,
  provider      TEXT NOT NULL,
  provider_opts TEXT NOT NULL DEFAULT '{}',
  system_prompt TEXT NOT NULL,
  enabled       INTEGER NOT NULL DEFAULT 1,
  tags          TEXT NOT NULL DEFAULT '[]'
);

-- ⚠️ api_key stored in plaintext; production should use KMS or env-var injection
CREATE TABLE IF NOT EXISTS providers (
  name              TEXT PRIMARY KEY,
  label             TEXT NOT NULL,
  cli_path          TEXT NOT NULL,
  default_model     TEXT NOT NULL,
  api_key           TEXT NOT NULL DEFAULT '',
  base_url          TEXT NOT NULL DEFAULT '',
  timeout           INTEGER NOT NULL DEFAULT 90,
  thinking          INTEGER NOT NULL DEFAULT 1,
  last_tested       INTEGER,
  last_test_result  TEXT
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id         TEXT PRIMARY KEY,
  timestamp  INTEGER NOT NULL,
  agent_id   TEXT,
  action     TEXT NOT NULL,
  detail     TEXT,
  metadata   TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
  agent_id    TEXT NOT NULL,
  room_id     TEXT NOT NULL,
  session_id  TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (agent_id, room_id),
  FOREIGN KEY (room_id) REFERENCES rooms(id)
);

-- Indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_messages_room_id ON messages(room_id);
CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp);
CREATE INDEX IF NOT EXISTS idx_audit_logs_timestamp ON audit_logs(timestamp);
CREATE INDEX IF NOT EXISTS idx_sessions_room_id ON sessions(room_id);
