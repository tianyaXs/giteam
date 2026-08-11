-- Cloud relay schema (Phase 1)

CREATE TABLE IF NOT EXISTS workspaces (
    id              TEXT PRIMARY KEY,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    access_key_hash TEXT NOT NULL,
    access_key_id   TEXT NOT NULL,
    default_device_id TEXT,
    status          TEXT NOT NULL DEFAULT 'active'
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_workspaces_access_key_id
    ON workspaces (access_key_id);

CREATE TABLE IF NOT EXISTS devices (
    id               TEXT PRIMARY KEY,
    workspace_id     TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    device_token_hash TEXT,
    name             TEXT NOT NULL DEFAULT '',
    client_version   TEXT NOT NULL DEFAULT '',
    last_seen_at     TIMESTAMPTZ,
    status           TEXT NOT NULL DEFAULT 'pending',
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_devices_workspace
    ON devices (workspace_id);

CREATE TABLE IF NOT EXISTS link_tickets (
    ticket           TEXT PRIMARY KEY,
    workspace_id     TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    device_id        TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    expires_at       TIMESTAMPTZ NOT NULL,
    consumed_at      TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS jwt_blacklist (
    jti          TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    expires_at   TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_jwt_blacklist_expires
    ON jwt_blacklist (expires_at);

CREATE TABLE IF NOT EXISTS audit_events (
    id           BIGSERIAL PRIMARY KEY,
    workspace_id TEXT,
    event_type   TEXT NOT NULL,
    meta_json    JSONB NOT NULL DEFAULT '{}',
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
