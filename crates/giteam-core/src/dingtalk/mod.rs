//! 钉钉群自定义机器人：配置、加签、发消息、入站触发。

mod config;
mod send;
mod sign;
mod trigger;

pub use config::{
    clear_outgoing_secret, clear_sign_secret, get_settings, has_outgoing_secret, has_sign_secret,
    load_outgoing_secret, load_sign_secret, save_settings, set_outgoing_secret, set_sign_secret,
    DingTalkSettings, SessionMode,
};
pub use send::{send_markdown, send_message, send_text, SendMessageRequest, SendMessageResult};
pub use sign::{build_signed_webhook_url, sign_payload, verify_outgoing_sign};
pub use trigger::{
    execute_outgoing, handle_outgoing_async, parse_outgoing_body, OutgoingPayload,
    OutgoingTriggerResult,
};
