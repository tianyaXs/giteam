-- Project Share P2: 代码 (repo.bundle → repo.git) 与上下文 (context.tar.zst) 分存。
-- content_sha256 / size_bytes 继续表示「代码包」摘要与大小；
-- 上下文摘要落在独立列，便于下载校验与配额合计。

ALTER TABLE shares
    ADD COLUMN IF NOT EXISTS context_sha256 TEXT NOT NULL DEFAULT '';

ALTER TABLE shares
    ADD COLUMN IF NOT EXISTS context_size_bytes BIGINT NOT NULL DEFAULT 0;
