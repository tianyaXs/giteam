mod admin;
mod auth_routes;
mod device;
mod dingtalk;
mod health;
mod proxy_routes;
pub mod share;
mod tunnel_ws;
mod workspace;

use crate::state::AppState;
use axum::Router;

pub fn router() -> Router<AppState> {
    Router::new()
        .merge(health::router())
        .merge(device::router())
        .merge(auth_routes::router())
        .merge(workspace::router())
        .merge(admin::router())
        .merge(tunnel_ws::router())
        .merge(proxy_routes::router())
        .merge(share::router())
        .merge(dingtalk::router())
}
