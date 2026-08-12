//! In-memory presence for mobile (HTTP/JWT) clients attached to a desktop device.

use serde::Serialize;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;

const ONLINE_TTL_MS: i64 = 90_000;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientSessionView {
    pub jti: String,
    pub workspace_id: String,
    pub device_id: String,
    pub client_name: String,
    pub connected_at: i64,
    pub last_seen_at: i64,
    pub expires_at: i64,
}

#[derive(Debug, Clone)]
struct ClientSession {
    workspace_id: String,
    device_id: String,
    client_name: String,
    connected_at: i64,
    last_seen_at: i64,
    expires_at: i64,
}

#[derive(Default)]
pub struct ClientHub {
    by_jti: RwLock<HashMap<String, ClientSession>>,
}

impl ClientHub {
    pub fn new() -> Self {
        Self::default()
    }

    pub async fn register(
        &self,
        jti: &str,
        workspace_id: &str,
        device_id: &str,
        client_name: &str,
        expires_at: i64,
    ) {
        let now = chrono::Utc::now().timestamp_millis();
        let name = {
            let trimmed = client_name.trim();
            if trimmed.is_empty() {
                "移动设备".to_string()
            } else {
                trimmed.to_string()
            }
        };
        let mut guard = self.by_jti.write().await;
        guard.insert(
            jti.to_string(),
            ClientSession {
                workspace_id: workspace_id.to_string(),
                device_id: device_id.to_string(),
                client_name: name,
                connected_at: now,
                last_seen_at: now,
                expires_at,
            },
        );
    }

    pub async fn touch(&self, jti: &str) {
        let now = chrono::Utc::now().timestamp_millis();
        let mut guard = self.by_jti.write().await;
        if let Some(row) = guard.get_mut(jti) {
            row.last_seen_at = now;
        }
    }

    pub async fn remove(&self, jti: &str) -> bool {
        self.by_jti.write().await.remove(jti).is_some()
    }

    pub async fn list_for_device(&self, device_id: &str) -> Vec<ClientSessionView> {
        let now = chrono::Utc::now().timestamp_millis();
        let guard = self.by_jti.read().await;
        let mut out: Vec<ClientSessionView> = guard
            .iter()
            .filter(|(_, s)| {
                s.device_id == device_id
                    && s.expires_at * 1000 > now
                    && now - s.last_seen_at <= ONLINE_TTL_MS
            })
            .map(|(jti, s)| ClientSessionView {
                jti: jti.clone(),
                workspace_id: s.workspace_id.clone(),
                device_id: s.device_id.clone(),
                client_name: s.client_name.clone(),
                connected_at: s.connected_at,
                last_seen_at: s.last_seen_at,
                expires_at: s.expires_at,
            })
            .collect();
        out.sort_by(|a, b| b.last_seen_at.cmp(&a.last_seen_at));
        out
    }

    pub async fn get(&self, jti: &str) -> Option<ClientSessionView> {
        let guard = self.by_jti.read().await;
        guard.get(jti).map(|s| ClientSessionView {
            jti: jti.to_string(),
            workspace_id: s.workspace_id.clone(),
            device_id: s.device_id.clone(),
            client_name: s.client_name.clone(),
            connected_at: s.connected_at,
            last_seen_at: s.last_seen_at,
            expires_at: s.expires_at,
        })
    }
}

pub type SharedClientHub = Arc<ClientHub>;
