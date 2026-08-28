-- DingTalk custom robot Outgoing bindings (workspace → device + secret).

CREATE TABLE IF NOT EXISTS dingtalk_bindings (
    workspace_id     TEXT PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
    device_id        TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    outgoing_secret  TEXT NOT NULL DEFAULT '',
    enabled          BOOLEAN NOT NULL DEFAULT FALSE,
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dingtalk_bindings_device
    ON dingtalk_bindings (device_id);
