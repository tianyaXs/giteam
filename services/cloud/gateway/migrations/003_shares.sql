-- Project Share (P1): immutable snapshot artifacts.
-- Blob 本体落 SHARE_STORAGE_DIR 本地目录（replicas=1 约束下与 Gateway 同机），
-- 本表只存元数据与审计字段；后续迁 S3 时仅需替换 storage_key 解释。

CREATE TABLE IF NOT EXISTS shares (
    id              TEXT PRIMARY KEY,
    workspace_id    TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    name            TEXT NOT NULL DEFAULT '',
    repo_name       TEXT NOT NULL DEFAULT '',
    default_branch  TEXT NOT NULL DEFAULT '',
    head_commit     TEXT NOT NULL DEFAULT '',
    size_bytes      BIGINT NOT NULL DEFAULT 0,
    content_sha256  TEXT NOT NULL DEFAULT '',
    encrypted       BOOLEAN NOT NULL DEFAULT FALSE,
    status          TEXT NOT NULL DEFAULT 'uploading', -- uploading/active/revoked/expired
    storage_key     TEXT NOT NULL DEFAULT '',
    expires_at      TIMESTAMPTZ,
    download_count  BIGINT NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    meta_json       JSONB NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_shares_workspace
    ON shares (workspace_id);

CREATE INDEX IF NOT EXISTS idx_shares_workspace_active
    ON shares (workspace_id)
    WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_shares_expires
    ON shares (expires_at)
    WHERE status = 'active';
