//! Cloud relay client: link workspace, maintain outbound tunnel to Gateway.

mod config;
mod http;
mod tunnel;

pub use config::{
    forget_access_key_local, get_cloud_link_settings, remember_access_key, set_cloud_link_settings,
    CloudAccessKeyRecord, CloudLinkSettings, DEFAULT_CLOUD_BASE_URL,
};
pub use http::{
    link_begin, link_complete, link_device, link_device_with_opts, LinkBeginResponse,
    LinkCompleteResponse, LinkDeviceOptions,
};
pub use tunnel::{start_cloud_tunnel_background, stop_cloud_tunnel, tunnel_running};
