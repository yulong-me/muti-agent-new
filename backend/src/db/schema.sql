-- F004: Manager Router - Simplified state machine
-- State: RUNNING (active discussion) | DONE (task completed)

-- Team — teams and team_versions for versioned team templates
CREATE TABLE IF NOT EXISTS teams (
  id                TEXT PRIMARY KEY,
  name              TEXT NOT NULL,
  description       TEXT,
  builtin           INTEGER NOT NULL DEFAULT 0,
  active_version_id TEXT NOT NULL,
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS team_versions (
  id                 TEXT PRIMARY KEY,
  team_id            TEXT NOT NULL,
  version_number     INTEGER NOT NULL,
  name               TEXT NOT NULL,
  description        TEXT,
  member_ids_json    TEXT NOT NULL DEFAULT '[]',
  member_snapshots_json TEXT NOT NULL DEFAULT '[]',
  workflow_prompt    TEXT NOT NULL,
  routing_policy_json TEXT NOT NULL DEFAULT '{}',
  team_memory_json   TEXT NOT NULL DEFAULT '[]',
  max_a2a_depth      INTEGER DEFAULT 5 NOT NULL,
  created_at         INTEGER NOT NULL,
  created_from       TEXT NOT NULL,
  FOREIGN KEY (team_id) REFERENCES teams(id),
  UNIQUE(team_id, version_number)
);

-- F053: Team Evolution PR — user-reviewed proposals that merge into new TeamVersions
CREATE TABLE IF NOT EXISTS evolution_proposals (
  id                    TEXT PRIMARY KEY,
  room_id               TEXT NOT NULL,
  team_id               TEXT NOT NULL,
  base_version_id       TEXT NOT NULL,
  target_version_number INTEGER NOT NULL,
  status                TEXT NOT NULL
                        CHECK (status IN ('draft','pending','in-review','applied','rejected','expired')),
  summary               TEXT NOT NULL,
  feedback              TEXT,
  created_at            INTEGER NOT NULL,
  updated_at            INTEGER NOT NULL,
  preflight_checked_at  INTEGER,
  applied_version_id    TEXT,
  FOREIGN KEY (room_id) REFERENCES rooms(id),
  FOREIGN KEY (team_id) REFERENCES teams(id),
  FOREIGN KEY (base_version_id) REFERENCES team_versions(id),
  FOREIGN KEY (applied_version_id) REFERENCES team_versions(id)
);

CREATE TABLE IF NOT EXISTS evolution_proposal_changes (
  id                        TEXT PRIMARY KEY,
  proposal_id               TEXT NOT NULL,
  ordinal                   INTEGER NOT NULL,
  kind                      TEXT NOT NULL
                            CHECK (kind IN ('add-agent','edit-agent-prompt','edit-team-workflow','edit-routing-policy','add-team-memory','add-validation-case')),
  title                     TEXT NOT NULL,
  why                       TEXT NOT NULL,
  evidence_message_ids_json TEXT NOT NULL DEFAULT '[]',
  target_layer              TEXT NOT NULL,
  before_json               TEXT NOT NULL DEFAULT 'null',
  after_json                TEXT NOT NULL DEFAULT 'null',
  impact                    TEXT NOT NULL,
  decision                  TEXT
                            CHECK (decision IS NULL OR decision IN ('accepted','rejected')),
  decided_at                INTEGER,
  FOREIGN KEY (proposal_id) REFERENCES evolution_proposals(id) ON DELETE CASCADE,
  UNIQUE(proposal_id, ordinal)
);

CREATE TABLE IF NOT EXISTS team_validation_cases (
  id                        TEXT PRIMARY KEY,
  team_id                   TEXT NOT NULL,
  proposal_id               TEXT,
  change_id                 TEXT,
  source_room_id            TEXT,
  base_version_id           TEXT,
  created_version_id        TEXT,
  title                     TEXT NOT NULL,
  failure_summary           TEXT NOT NULL DEFAULT '',
  input_snapshot_json       TEXT NOT NULL DEFAULT 'null',
  expected_behavior         TEXT NOT NULL DEFAULT '',
  assertion_type            TEXT NOT NULL DEFAULT 'checklist'
                            CHECK (assertion_type IN ('checklist','replay')),
  status                    TEXT NOT NULL DEFAULT 'active'
                            CHECK (status IN ('active','archived')),
  prompt                    TEXT NOT NULL,
  expected_outcome          TEXT NOT NULL,
  evidence_message_ids_json TEXT NOT NULL DEFAULT '[]',
  created_at                INTEGER NOT NULL,
  FOREIGN KEY (team_id) REFERENCES teams(id),
  FOREIGN KEY (base_version_id) REFERENCES team_versions(id),
  FOREIGN KEY (created_version_id) REFERENCES team_versions(id)
);

CREATE TABLE IF NOT EXISTS team_validation_preflight_results (
  id                  TEXT PRIMARY KEY,
  proposal_id         TEXT NOT NULL,
  validation_case_id  TEXT NOT NULL,
  target_version_id   TEXT NOT NULL,
  result              TEXT NOT NULL
                      CHECK (result IN ('pass','fail','needs-review')),
  reason              TEXT NOT NULL,
  checked_at          INTEGER NOT NULL,
  FOREIGN KEY (proposal_id) REFERENCES evolution_proposals(id) ON DELETE CASCADE,
  FOREIGN KEY (validation_case_id) REFERENCES team_validation_cases(id)
);

CREATE TABLE IF NOT EXISTS rooms (
  id          TEXT PRIMARY KEY,
  topic       TEXT NOT NULL,
  state       TEXT NOT NULL DEFAULT 'RUNNING'
              CHECK (state IN ('RUNNING','DONE')),
  report      TEXT,
  agent_ids   TEXT NOT NULL DEFAULT '[]',
  workspace   TEXT,
  max_a2a_depth INTEGER,
  team_id     TEXT,
  team_version_id TEXT,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  deleted_at  INTEGER
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
  tool_calls_json TEXT,
  duration_ms     INTEGER,
  total_cost_usd  REAL,
  input_tokens    INTEGER,
  output_tokens   INTEGER,
  session_id      TEXT,
  invocation_usage_json TEXT,
  context_health_json   TEXT,
  temp_msg_id     TEXT,
  -- F0042: 直接路由的接收人 agentId（USER 消息用于显示；可空，兼容旧数据）
  to_agent_id     TEXT,
  -- F014: persisted structured agent error for reconnect/poll recovery
  run_error_json  TEXT,
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

CREATE TABLE IF NOT EXISTS skills (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL UNIQUE,
  description     TEXT NOT NULL DEFAULT '',
  source_type     TEXT NOT NULL CHECK (source_type IN ('managed', 'workspace')),
  source_path     TEXT NOT NULL,
  enabled         INTEGER NOT NULL DEFAULT 1,
  read_only       INTEGER NOT NULL DEFAULT 0,
  builtin         INTEGER NOT NULL DEFAULT 0,
  provider_compat TEXT NOT NULL DEFAULT '["claude-code","opencode","codex"]',
  updated_at      INTEGER NOT NULL,
  checksum        TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS agent_skill_bindings (
  agent_id     TEXT NOT NULL,
  skill_id     TEXT NOT NULL,
  mode         TEXT NOT NULL CHECK (mode IN ('auto', 'required')),
  enabled      INTEGER NOT NULL DEFAULT 1,
  created_at   INTEGER NOT NULL,
  PRIMARY KEY (agent_id, skill_id),
  FOREIGN KEY (agent_id) REFERENCES agents(id),
  FOREIGN KEY (skill_id) REFERENCES skills(id)
);

CREATE TABLE IF NOT EXISTS room_skill_bindings (
  room_id      TEXT NOT NULL,
  skill_id     TEXT NOT NULL,
  mode         TEXT NOT NULL CHECK (mode IN ('auto', 'required')),
  enabled      INTEGER NOT NULL DEFAULT 1,
  created_at   INTEGER NOT NULL,
  PRIMARY KEY (room_id, skill_id),
  FOREIGN KEY (room_id) REFERENCES rooms(id),
  FOREIGN KEY (skill_id) REFERENCES skills(id)
);

-- ⚠️ api_key stored in plaintext; production should use KMS or env-var injection
CREATE TABLE IF NOT EXISTS providers (
  name              TEXT PRIMARY KEY,
  label             TEXT NOT NULL,
  cli_path          TEXT NOT NULL,
  default_model     TEXT NOT NULL,
  context_window    INTEGER NOT NULL DEFAULT 200000,
  api_key           TEXT NOT NULL DEFAULT '',
  base_url          TEXT NOT NULL DEFAULT '',
  timeout           INTEGER NOT NULL DEFAULT 1800,
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
  telemetry_json TEXT,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (agent_id, room_id),
  FOREIGN KEY (room_id) REFERENCES rooms(id)
);

CREATE TABLE IF NOT EXISTS agent_runs (
  id                      TEXT PRIMARY KEY,
  room_id                 TEXT NOT NULL,
  agent_instance_id       TEXT NOT NULL,
  agent_config_id         TEXT NOT NULL,
  agent_name              TEXT NOT NULL,
  agent_role              TEXT NOT NULL
                          CHECK (agent_role IN ('MANAGER','WORKER')),
  trigger_message_id      TEXT,
  output_message_id       TEXT,
  parent_run_id           TEXT,
  session_id              TEXT,
  provider                TEXT NOT NULL,
  model                   TEXT,
  status                  TEXT NOT NULL
                          CHECK (status IN ('running','succeeded','failed','stopped')),
  started_at              INTEGER NOT NULL,
  ended_at                INTEGER,
  duration_ms             INTEGER,
  input_tokens            INTEGER,
  output_tokens           INTEGER,
  total_cost_usd          REAL,
  invocation_usage_json   TEXT,
  context_health_json     TEXT,
  tool_calls_json         TEXT,
  workspace_changes_json  TEXT,
  error_json              TEXT,
  FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE,
  FOREIGN KEY (trigger_message_id) REFERENCES messages(id) ON DELETE SET NULL,
  FOREIGN KEY (output_message_id) REFERENCES messages(id) ON DELETE SET NULL,
  FOREIGN KEY (parent_run_id) REFERENCES agent_runs(id) ON DELETE SET NULL
);

-- Indexes for common query patterns
-- Seed-once meta table — tracks whether builtin data has been seeded.
-- Once seeded, system never auto-overwrites user data on restart.
CREATE TABLE IF NOT EXISTS app_meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_messages_room_id ON messages(room_id);
CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp);
CREATE INDEX IF NOT EXISTS idx_audit_logs_timestamp ON audit_logs(timestamp);
CREATE INDEX IF NOT EXISTS idx_sessions_room_id ON sessions(room_id);
CREATE INDEX IF NOT EXISTS idx_agent_runs_room_id ON agent_runs(room_id);
CREATE INDEX IF NOT EXISTS idx_agent_runs_status ON agent_runs(status);
CREATE INDEX IF NOT EXISTS idx_agent_runs_agent_config_id ON agent_runs(agent_config_id);
CREATE INDEX IF NOT EXISTS idx_skills_name ON skills(name);
CREATE INDEX IF NOT EXISTS idx_agent_skill_bindings_agent_id ON agent_skill_bindings(agent_id);
CREATE INDEX IF NOT EXISTS idx_room_skill_bindings_room_id ON room_skill_bindings(room_id);
CREATE INDEX IF NOT EXISTS idx_teams_active_version_id ON teams(active_version_id);
CREATE INDEX IF NOT EXISTS idx_team_versions_team_id ON team_versions(team_id);
CREATE INDEX IF NOT EXISTS idx_rooms_team_version_id ON rooms(team_version_id);
CREATE INDEX IF NOT EXISTS idx_evolution_proposals_room_id ON evolution_proposals(room_id);
CREATE INDEX IF NOT EXISTS idx_evolution_proposals_team_id ON evolution_proposals(team_id);
CREATE INDEX IF NOT EXISTS idx_evolution_proposal_changes_proposal_id ON evolution_proposal_changes(proposal_id);
CREATE INDEX IF NOT EXISTS idx_team_validation_cases_team_id ON team_validation_cases(team_id);
CREATE INDEX IF NOT EXISTS idx_team_validation_cases_proposal_id ON team_validation_cases(proposal_id);
CREATE INDEX IF NOT EXISTS idx_team_validation_preflight_proposal_id ON team_validation_preflight_results(proposal_id);
