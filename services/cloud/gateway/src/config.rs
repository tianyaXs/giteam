use anyhow::{bail, Context};

#[derive(Clone, Debug)]
pub struct Config {
    pub database_url: String,
    pub jwt_secret: String,
    pub admin_token: String,
    pub public_base_url: String,
    pub listen_addr: String,
    pub static_dir: Option<String>,
    pub jwt_ttl_secs: i64,
    pub link_ticket_ttl_secs: i64,
    pub max_body_bytes: usize,
    /// 项目分享产物存储目录（replicas=1 期间落本地盘）。
    pub share_storage_dir: String,
    /// 分享默认有效期（秒）。
    pub share_ttl_secs: i64,
    /// 单 workspace 分享总配额（字节）。
    pub share_quota_bytes: i64,
    /// 单分享体积上限（字节）。
    pub share_max_bytes: usize,
}

impl Config {
    pub fn from_env() -> anyhow::Result<Self> {
        let database_url = std::env::var("DATABASE_URL")
            .context("DATABASE_URL is required")?;
        let jwt_secret = std::env::var("JWT_SECRET").unwrap_or_else(|_| {
            "dev-jwt-secret-change-me-in-production".to_string()
        });
        if jwt_secret.len() < 16 {
            bail!("JWT_SECRET must be at least 16 characters");
        }
        let admin_token = std::env::var("ADMIN_TOKEN").unwrap_or_else(|_| {
            "dev-admin-token-change-me-in-production".to_string()
        });
        let public_base_url = std::env::var("PUBLIC_BASE_URL")
            .unwrap_or_else(|_| "http://127.0.0.1:8787".to_string())
            .trim()
            .trim_end_matches('/')
            .to_string();
        let listen_addr =
            std::env::var("LISTEN_ADDR").unwrap_or_else(|_| "0.0.0.0:8787".to_string());
        let static_dir = std::env::var("STATIC_DIR")
            .ok()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty());

        let share_storage_dir = std::env::var("SHARE_STORAGE_DIR")
            .unwrap_or_else(|_| "./data/shares".to_string());
        let share_ttl_secs = std::env::var("SHARE_TTL_SECS")
            .ok()
            .and_then(|v| v.parse::<i64>().ok())
            .unwrap_or(30 * 24 * 60 * 60);
        let share_quota_bytes = std::env::var("SHARE_QUOTA_BYTES")
            .ok()
            .and_then(|v| v.parse::<i64>().ok())
            .unwrap_or(5 * 1024 * 1024 * 1024);
        let share_max_bytes = std::env::var("SHARE_MAX_BYTES")
            .ok()
            .and_then(|v| v.parse::<usize>().ok())
            .unwrap_or(2 * 1024 * 1024 * 1024);

        Ok(Self {
            database_url,
            jwt_secret,
            admin_token,
            public_base_url,
            listen_addr,
            static_dir,
            jwt_ttl_secs: 24 * 60 * 60,
            link_ticket_ttl_secs: 10 * 60,
            max_body_bytes: 8 * 1024 * 1024,
            share_storage_dir,
            share_ttl_secs,
            share_quota_bytes,
            share_max_bytes,
        })
    }
}
