//! Cloud relay client: link workspace, maintain outbound tunnel to Gateway.

mod config;
mod http;
mod tunnel;

pub use config::{
    get_cloud_link_settings, set_cloud_link_settings, CloudLinkSettings, DEFAULT_CLOUD_BASE_URL,
};
pub use http::{
    link_begin, link_complete, link_device, LinkBeginResponse, LinkCompleteResponse,
};
pub use tunnel::{start_cloud_tunnel_background, stop_cloud_tunnel, tunnel_running};
