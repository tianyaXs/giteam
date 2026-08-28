mod auth;
mod clients;
mod config;
mod error;
mod ids;
mod proxy;
mod routes;
mod state;
mod tunnel;

use axum::Router;
use sqlx::postgres::PgPoolOptions;
use std::net::SocketAddr;
use std::path::PathBuf;
use tower_http::cors::CorsLayer;
use tower_http::services::{ServeDir, ServeFile};
use tower_http::trace::TraceLayer;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

use crate::config::Config;
use crate::state::AppState;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::registry()
        .with(tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| {
            "info,giteam_cloud_gateway=debug,tower_http=info".into()
        }))
        .with(tracing_subscriber::fmt::layer())
        .init();

    let config = Config::from_env()?;
    let pool = PgPoolOptions::new()
        .max_connections(10)
        .connect(&config.database_url)
        .await?;

    sqlx::raw_sql(include_str!("../migrations/001_init.sql"))
        .execute(&pool)
        .await?;
    sqlx::raw_sql(include_str!("../migrations/002_access_keys.sql"))
        .execute(&pool)
        .await?;
    sqlx::raw_sql(include_str!("../migrations/003_shares.sql"))
        .execute(&pool)
        .await?;
    sqlx::raw_sql(include_str!("../migrations/004_shares_split.sql"))
        .execute(&pool)
        .await?;
    sqlx::raw_sql(include_str!("../migrations/005_dingtalk.sql"))
        .execute(&pool)
        .await?;

    let state = AppState::new(config.clone(), pool);
    tokio::fs::create_dir_all(&config.share_storage_dir).await?;
    tokio::spawn(routes::share::sweeper(state.clone()));
    let mut app = Router::new()
        .merge(routes::router())
        .layer(CorsLayer::permissive())
        .layer(TraceLayer::new_for_http())
        .with_state(state);

    if let Some(dir) = config.static_dir.clone() {
        let index = PathBuf::from(&dir).join("index.html");
        tracing::info!(%dir, "serving Giteam Cloud console from STATIC_DIR");
        let spa = ServeDir::new(&dir).not_found_service(ServeFile::new(index));
        app = app.fallback_service(spa);
    }

    let addr: SocketAddr = config.listen_addr.parse()?;
    tracing::info!(%addr, public = %config.public_base_url, "giteam cloud gateway listening");
    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;
    Ok(())
}
