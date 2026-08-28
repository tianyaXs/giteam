//! Cloud relay client: link workspace, maintain outbound tunnel to Gateway.

mod config;
mod http;
mod tunnel;

pub use config::{
    forget_access_key_local, get_cloud_link_settings, remember_access_key, set_cloud_link_settings,
    CloudAccessKeyRecord, CloudLinkSettings, DEFAULT_CLOUD_BASE_URL, rename_access_key_local,
};
pub use http::{
    disconnect_mobile_client, link_begin, link_complete, link_device, link_device_with_opts,
    list_mobile_clients, LinkBeginResponse, LinkCompleteResponse, LinkDeviceOptions,
    MobileClientSession,
};
pub use tunnel::{
    start_cloud_tunnel_and_wait, start_cloud_tunnel_background, stop_cloud_tunnel,
    tunnel_connected, tunnel_running, wait_until_tunnel_connected,
};
