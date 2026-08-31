//! Giteam 侧 MCP 服务配置模型与到 `mcpstore::ServerConfig` 的唯一适配层。
//!
//! 配置文件本体由 mcpstore 托管（`mcpstore.json` 的 `mcpServers`，与
//! Claude Desktop 同形），Giteam 不并发手改文件；增删走
//! `ScopeContext::{add_service, remove_service}`。
//!
//! `enabled` 只表达「服务是否应被连接/暴露」：mcpstore 无服务级开关，
//! `enabled == false` 由调用方直接 `remove_service`，不写入 `ServerConfig.extra`。

use std::collections::HashMap;

use mcpstore::ServerConfig;
use serde::{Deserialize, Serialize};

use super::McpError;

/// 桌面端/RPC 提交的 MCP 服务定义（local stdio 或 remote streamable-http）。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpServiceInput {
    pub name: String,
    #[serde(default = "default_enabled")]
    pub enabled: bool,
    pub url: Option<String>,
    pub command: Option<String>,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub env: HashMap<String, String>,
    #[serde(default)]
    pub headers: HashMap<String, String>,
    #[serde(default)]
    pub description: Option<String>,
}

fn default_enabled() -> bool {
    true
}

impl McpServiceInput {
    /// 校验并转换为 mcpstore 服务配置。url 与 command 二选一。
    pub fn to_server_config(&self) -> Result<ServerConfig, McpError> {
        let name = self.name.trim();
        if name.is_empty() {
            return Err(McpError::InvalidConfig("服务名不能为空".to_string()));
        }
        let (url, command) = match (&self.url, &self.command) {
            (Some(_), Some(_)) => {
                return Err(McpError::InvalidConfig(format!(
                    "服务 {name} 同时配置了 url 和 command，只能二选一"
                )));
            }
            (Some(url), None) => (Some(url.clone()), None),
            (None, Some(command)) => (None, Some(command.clone())),
            (None, None) => {
                return Err(McpError::InvalidConfig(format!(
                    "服务 {name} 缺少 url 或 command"
                )));
            }
        };
        if let Some(command) = &command {
            if command.trim().is_empty() {
                return Err(McpError::InvalidConfig(format!(
                    "服务 {name} 的 command 不能为空"
                )));
            }
        }
        Ok(ServerConfig {
            url,
            command,
            args: self.args.clone(),
            env: self.env.clone(),
            headers: self.headers.clone(),
            transport: Some(
                if self.url.is_some() {
                    "streamable-http"
                } else {
                    "stdio"
                }
                .to_string(),
            ),
            description: self.description.clone(),
            ..ServerConfig::default()
        })
    }
}

/// 解析旧 OpenCode 形状（`opencode.jsonc` 的 mcp 条目）为 Giteam 输入模型：
///
/// ```text
/// local  { type, command: [program, ...args], environment }
/// remote { type, url, headers }
/// ```
pub fn parse_opencode_entry(name: &str, value: &serde_json::Value) -> Result<McpServiceInput, McpError> {
    let object = value
        .as_object()
        .ok_or_else(|| McpError::InvalidConfig(format!("服务 {name} 的配置不是对象")))?;
    let entry_type = object
        .get("type")
        .and_then(serde_json::Value::as_str)
        .unwrap_or("local");
    let mut input = McpServiceInput {
        name: name.to_string(),
        enabled: true,
        url: None,
        command: None,
        args: Vec::new(),
        env: HashMap::new(),
        headers: HashMap::new(),
        description: object
            .get("description")
            .and_then(serde_json::Value::as_str)
            .map(str::to_string),
    };
    match entry_type {
        "local" => {
            let command = object
                .get("command")
                .and_then(serde_json::Value::as_array)
                .ok_or_else(|| {
                    McpError::InvalidConfig(format!("服务 {name} 是 local 但缺少 command 数组"))
                })?;
            let mut parts = command.iter().filter_map(serde_json::Value::as_str);
            input.command = parts.next().map(str::to_string);
            input.args = parts.map(str::to_string).collect();
            if let Some(environment) = object.get("environment").and_then(|v| v.as_object()) {
                for (key, val) in environment {
                    if let Some(val) = val.as_str() {
                        input.env.insert(key.clone(), val.to_string());
                    }
                }
            }
        }
        "remote" => {
            input.url = object
                .get("url")
                .and_then(serde_json::Value::as_str)
                .map(str::to_string);
            if let Some(headers) = object.get("headers").and_then(|v| v.as_object()) {
                for (key, val) in headers {
                    if let Some(val) = val.as_str() {
                        input.headers.insert(key.clone(), val.to_string());
                    }
                }
            }
        }
        other => {
            return Err(McpError::InvalidConfig(format!(
                "服务 {name} 的 type 无效：{other}（仅支持 local/remote）"
            )));
        }
    }
    Ok(input)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn local_input_maps_to_stdio() {
        let input = McpServiceInput {
            name: "fs".into(),
            enabled: true,
            url: None,
            command: Some("npx".into()),
            args: vec!["-y".into(), "@modelcontextprotocol/server-filesystem".into()],
            env: HashMap::from([("ROOT".to_string(), "/tmp".to_string())]),
            headers: HashMap::new(),
            description: None,
        };
        let config = input.to_server_config().unwrap();
        assert_eq!(config.transport.as_deref(), Some("stdio"));
        assert_eq!(config.command.as_deref(), Some("npx"));
        assert_eq!(config.args.len(), 2);
        assert_eq!(config.env.get("ROOT").map(String::as_str), Some("/tmp"));
        assert!(config.url.is_none());
    }

    #[test]
    fn remote_input_maps_to_streamable_http() {
        let input = McpServiceInput {
            name: "hub".into(),
            enabled: true,
            url: Some("https://mcp.example.com/sse".into()),
            command: None,
            args: Vec::new(),
            env: HashMap::new(),
            headers: HashMap::from([("Authorization".to_string(), "Bearer x".to_string())]),
            description: Some("remote".into()),
        };
        let config = input.to_server_config().unwrap();
        assert_eq!(config.transport.as_deref(), Some("streamable-http"));
        assert_eq!(config.url.as_deref(), Some("https://mcp.example.com/sse"));
        assert_eq!(config.headers.len(), 1);
    }

    #[test]
    fn rejects_missing_and_conflicting_transport() {
        let base = McpServiceInput {
            name: "bad".into(),
            enabled: true,
            url: None,
            command: None,
            args: Vec::new(),
            env: HashMap::new(),
            headers: HashMap::new(),
            description: None,
        };
        assert!(base.to_server_config().is_err());
        let both = McpServiceInput {
            url: Some("https://x".into()),
            command: Some("sh".into()),
            ..base
        };
        assert!(both.to_server_config().is_err());
    }

    #[test]
    fn parses_opencode_local_and_remote_shapes() {
        let local = serde_json::json!({
            "type": "local",
            "command": ["npx", "-y", "server"],
            "environment": { "A": "1" }
        });
        let parsed = parse_opencode_entry("demo", &local).unwrap();
        assert_eq!(parsed.command.as_deref(), Some("npx"));
        assert_eq!(parsed.args, vec!["-y".to_string(), "server".to_string()]);
        assert_eq!(parsed.env.get("A").map(String::as_str), Some("1"));

        let remote = serde_json::json!({ "type": "remote", "url": "https://x/mcp", "headers": { "k": "v" } });
        let parsed = parse_opencode_entry("r", &remote).unwrap();
        assert_eq!(parsed.url.as_deref(), Some("https://x/mcp"));
        assert_eq!(parsed.headers.get("k").map(String::as_str), Some("v"));

        let bad = serde_json::json!({ "type": "weird" });
        assert!(parse_opencode_entry("b", &bad).is_err());
    }
}
