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
        })
    }
}
