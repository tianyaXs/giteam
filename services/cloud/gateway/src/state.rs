use crate::clients::ClientHub;
use crate::config::Config;
use crate::tunnel::TunnelHub;
use sqlx::PgPool;
use std::sync::Arc;

#[derive(Clone)]
pub struct AppState {
    pub config: Arc<Config>,
    pub pool: PgPool,
    pub tunnels: Arc<TunnelHub>,
    pub clients: Arc<ClientHub>,
}

impl AppState {
    pub fn new(config: Config, pool: PgPool) -> Self {
        Self {
            config: Arc::new(config),
            pool,
            tunnels: Arc::new(TunnelHub::new()),
            clients: Arc::new(ClientHub::new()),
        }
    }
}
