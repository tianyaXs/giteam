-- Named access keys (provider-style). Multiple active keys per workspace.
-- Plaintext is never stored; only hash + access_key_id (prefix id).

CREATE TABLE IF NOT EXISTS access_keys (
    id              TEXT PRIMARY KEY,
    workspace_id    TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    name            TEXT NOT NULL DEFAULT '',
    key_hash        TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'active',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    revoked_at      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_access_keys_workspace
    ON access_keys (workspace_id);

CREATE INDEX IF NOT EXISTS idx_access_keys_workspace_active
    ON access_keys (workspace_id)
    WHERE status = 'active';

-- Backfill legacy single workspace key as named "默认".
INSERT INTO access_keys (id, workspace_id, name, key_hash, status, created_at)
SELECT
    w.access_key_id,
    w.id,
    '默认',
    w.access_key_hash,
    'active',
    w.created_at
FROM workspaces w
WHERE w.access_key_id IS NOT NULL
  AND w.access_key_id <> ''
  AND w.access_key_hash IS NOT NULL
  AND w.access_key_hash <> ''
ON CONFLICT (id) DO NOTHING;
