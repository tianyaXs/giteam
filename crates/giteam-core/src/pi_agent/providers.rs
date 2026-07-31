//! Giteam Provider/Model catalog。
//!
//! 基于 Pi `ModelRegistry` 构建 provider-neutral 的目录视图：前端与 Control
//! API 只消费本模块定义的 `AgentProviderInfo`/`AgentModelInfo`，不接触 Pi 的
//! `ModelEntry`/`Model` 类型。凭据标注（`has_credential`）只暴露布尔值，
//! 凭据本身永远留在 [`SecretStore`] 内。

use std::path::PathBuf;

use serde::{Deserialize, Serialize};

use super::{PiAgentError, SecretStore};

/// provider-neutral 的模型目录条目。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentModelInfo {
    pub provider: String,
    pub model_id: String,
    pub name: String,
    pub api: String,
    pub base_url: String,
    pub reasoning: bool,
    /// 是否支持 xhigh 推理档（与 Pi `ModelEntry::supports_xhigh` 对齐）。
    pub supports_xhigh: bool,
    pub image_input: bool,
    pub context_window: u32,
    pub max_tokens: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cost: Option<AgentModelCost>,
    /// 是否已配置凭据（不暴露凭据本身）。
    pub has_credential: bool,
}

/// 每百万 token 的价格（美元）。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentModelCost {
    pub input: f64,
    pub output: f64,
    pub cache_read: f64,
    pub cache_write: f64,
}

/// provider 聚合视图，按 provider 分组携带其模型列表。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentProviderInfo {
    pub provider: String,
    pub model_count: usize,
    pub has_credential: bool,
    pub models: Vec<AgentModelInfo>,
}

/// 自定义 provider 输入（OpenAI 兼容端点为主）。
/// api key 永远只写 vault（auth.json），不进入 models.json（迁移计划 §8.3）。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomProviderInput {
    pub provider: String,
    pub name: String,
    pub base_url: String,
    /// Pi api 适配器 id（如 openai-completions/openai-responses/anthropic-messages），
    /// 缺省 openai-completions。
    pub api: Option<String>,
    pub model_id: String,
    pub model_name: Option<String>,
    pub headers: Option<std::collections::HashMap<String, String>>,
    pub api_key: Option<String>,
}

/// Giteam Provider/Model catalog。每次查询从 vault 与 models 配置重建，
/// 保证凭据变更立即生效且不在内存中长期持有敏感解析结果。
pub struct ProviderCatalog {
    secrets: SecretStore,
    models_path: Option<PathBuf>,
}

impl std::fmt::Debug for ProviderCatalog {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("ProviderCatalog")
            .field("auth_file", &self.secrets.auth_file_path())
            .field("models_path", &self.models_path)
            .finish_non_exhaustive()
    }
}

impl ProviderCatalog {
    #[must_use]
    pub fn new(secrets: SecretStore) -> Self {
        Self {
            secrets,
            models_path: None,
        }
    }

    #[must_use]
    pub fn with_models_path(mut self, models_path: PathBuf) -> Self {
        self.models_path = Some(models_path);
        self
    }

    /// 列出全部目录模型（catalog 视角，含凭据标注）。注意这里刻意使用
    /// `ModelRegistry::models()` 而非 `available_models()`：后者只返回已配置
    /// 凭据的模型，而设置页需要展示全量可选模型供用户配置。
    pub fn list_models(&self) -> Result<Vec<AgentModelInfo>, PiAgentError> {
        let registry = self.registry()?;
        Ok(registry
            .models()
            .iter()
            .map(|entry| self.to_model_info(entry))
            .collect())
    }

    /// 按 provider 聚合的目录视图，供设置页与选择器使用。
    pub fn list_providers(&self) -> Result<Vec<AgentProviderInfo>, PiAgentError> {
        let mut providers: Vec<AgentProviderInfo> = Vec::new();
        for model in self.list_models()? {
            if let Some(existing) = providers
                .iter_mut()
                .find(|provider| provider.provider.eq_ignore_ascii_case(&model.provider))
            {
                existing.has_credential |= model.has_credential;
                existing.models.push(model);
            } else {
                providers.push(AgentProviderInfo {
                    provider: model.provider.clone(),
                    model_count: 0,
                    has_credential: model.has_credential,
                    models: vec![model],
                });
            }
        }
        for provider in &mut providers {
            provider.models.sort_by(|left, right| {
                left.model_id
                    .cmp(&right.model_id)
                    .then_with(|| left.name.cmp(&right.name))
            });
            provider.model_count = provider.models.len();
        }
        providers.sort_by(|left, right| left.provider.cmp(&right.provider));
        Ok(providers)
    }

    /// 精确查找 provider+model，供 session 创建与模型切换校验。
    pub fn find_model(
        &self,
        provider: &str,
        model_id: &str,
    ) -> Result<Option<AgentModelInfo>, PiAgentError> {
        let registry = self.registry()?;
        Ok(registry
            .find(provider, model_id)
            .map(|entry| self.to_model_info(&entry)))
    }

    /// 当前 provider 是否已配置凭据。
    ///
    /// 语义刻意限定为"用户在统一 vault（auth.json）中显式配置"，不纳入 pi
    /// 运行时的环境变量解析（`OPENAI_API_KEY` 等）：env key 在请求时仍然有效，
    /// 但设置页"已连接"只应反映用户在本应用内的配置行为，否则会出现
    /// "没配置过却显示已连接"的误导。别名（如 kimi-coding ↔ kimi-for-coding）
    /// 视为同一凭据槽。
    pub fn has_credential(&self, provider: &str) -> bool {
        if self.secrets.has_credential(provider) {
            return true;
        }
        self.secrets
            .providers()
            .ok()
            .map(|ids| ids.iter().any(|id| providers_equivalent(id, provider)))
            .unwrap_or(false)
    }

    /// 保存/更新自定义 provider（写入 models.json，原子写；同 provider 重复保存
    /// 时按 model id 合并模型列表）。api key 只写 vault，不落 models.json。
    pub fn save_custom_provider(&self, input: &CustomProviderInput) -> Result<(), PiAgentError> {
        let provider = input.provider.trim();
        let model_id = input.model_id.trim();
        if provider.is_empty() || model_id.is_empty() || input.base_url.trim().is_empty() {
            return Err(PiAgentError::Provider(
                "provider, modelId and baseUrl are required".to_string(),
            ));
        }
        let path = self.models_json_path()?;
        let mut root = read_models_json(&path)?;
        let root_obj = root.as_object_mut().ok_or_else(|| {
            PiAgentError::Provider("models.json root must be an object".to_string())
        })?;
        let providers = root_obj
            .entry("providers")
            .or_insert_with(|| serde_json::json!({}));
        let providers = providers.as_object_mut().ok_or_else(|| {
            PiAgentError::Provider("models.json providers must be an object".to_string())
        })?;
        let entry = providers
            .entry(provider.to_string())
            .or_insert_with(|| serde_json::json!({}));
        let entry = entry.as_object_mut().ok_or_else(|| {
            PiAgentError::Provider(format!("models.json provider {provider} must be an object"))
        })?;
        entry.insert(
            "name".to_string(),
            serde_json::Value::String(if input.name.trim().is_empty() {
                provider.to_string()
            } else {
                input.name.trim().to_string()
            }),
        );
        entry.insert(
            "baseUrl".to_string(),
            serde_json::Value::String(input.base_url.trim().to_string()),
        );
        entry.insert(
            "api".to_string(),
            serde_json::Value::String(
                input
                    .api
                    .as_deref()
                    .map(str::trim)
                    .filter(|api| !api.is_empty())
                    .unwrap_or("openai-completions")
                    .to_string(),
            ),
        );
        if let Some(headers) = &input.headers {
            if !headers.is_empty() {
                entry.insert(
                    "headers".to_string(),
                    serde_json::to_value(headers)
                        .map_err(|error| PiAgentError::Provider(error.to_string()))?,
                );
            }
        }
        // 密钥绝不写入 models.json；provider 级 apiKey 由 vault（auth.json）解析。
        entry.remove("apiKey");
        let model_name = input
            .model_name
            .as_deref()
            .map(str::trim)
            .filter(|name| !name.is_empty())
            .unwrap_or(model_id)
            .to_string();
        let models = entry
            .entry("models")
            .or_insert_with(|| serde_json::json!([]));
        let models = models.as_array_mut().ok_or_else(|| {
            PiAgentError::Provider(format!("models.json provider {provider} models must be an array"))
        })?;
        let new_model = serde_json::json!({ "id": model_id, "name": model_name });
        if let Some(existing) = models.iter_mut().find(|model| {
            model.get("id").and_then(serde_json::Value::as_str) == Some(model_id)
        }) {
            *existing = new_model;
        } else {
            models.push(new_model);
        }
        write_models_json(&path, &root)?;
        if let Some(key) = input.api_key.as_deref().map(str::trim).filter(|key| !key.is_empty()) {
            self.secrets.set_api_key(provider, key)?;
        }
        Ok(())
    }

    /// 用 provider 的实时 `/v1/models` 接口刷新目录（pi gh #92 的 live
    /// discovery）：把静态目录中缺失的模型 id 通过 models.json override
    /// 机制合并进目录，返回新增的模型 id。
    ///
    /// 这是对抗内置快照过期的机制（如 deepseek-chat/reasoner 退役、
    /// v4-pro/v4-flash 上线）：快照由 pi 版本钉死，而 live 列表始终来自
    /// provider 当前 API。无凭据或非 OpenAI 兼容端点时返回空，不报错。
    ///
    /// 注意：部分 provider（如 kimi-coding）路由 `base_url` 以 `/v1/messages`
    /// 结尾。Pi 的 `model_fetch` 会把这类端点当成非 OpenAI 兼容而直接
    /// fallback 到静态快照，导致永远拉不到最新模型。本方法会先尝试把
    /// `/messages` 剥掉再请求 `/models`，成功后再走合并。
    pub fn refresh_live_models(&self, provider: &str) -> Result<Vec<String>, PiAgentError> {
        let provider = provider.trim();
        if provider.is_empty() {
            return Err(PiAgentError::Provider(
                "provider id must not be empty".to_string(),
            ));
        }
        let Some(key) = self.api_key_for_provider(provider)? else {
            return Ok(Vec::new());
        };

        let registry = self.registry()?;
        // 取该 provider 的静态条目作为路由模板（baseUrl/api/headers），
        // 保证新模型 id 走与既有模型完全相同的适配器。别名（如
        // kimi-coding ↔ kimi-for-coding）一并匹配。
        //
        // 部分内置条目（kimi-coding）的 model.base_url 为空，实际路由靠
        // ProviderRoutingDefaults 注入；合并新模型时必须把 defaults 填回去，
        // 否则 save_custom_provider 会因空 baseUrl 失败，且无法推导 /models。
        let template_entry = registry
            .models()
            .iter()
            .find(|entry| providers_equivalent(&entry.model.provider, provider));
        let Some(template_entry) = template_entry else {
            // 静态目录中没有该 provider（纯自定义 provider 由用户显式维护）。
            return Ok(Vec::new());
        };
        let catalog_provider = template_entry.model.provider.clone();
        let routing = pi::provider_metadata::provider_routing_defaults(provider)
            .or_else(|| pi::provider_metadata::provider_routing_defaults(&catalog_provider));
        let base_url = {
            let from_model = template_entry.model.base_url.trim();
            if !from_model.is_empty() {
                from_model.to_string()
            } else {
                routing
                    .as_ref()
                    .map(|defaults| defaults.base_url.trim().to_string())
                    .filter(|url| !url.is_empty())
                    .unwrap_or_default()
            }
        };
        if base_url.is_empty() {
            return Ok(Vec::new());
        }
        let api = {
            let from_model = template_entry.model.api.trim();
            if !from_model.is_empty() {
                from_model.to_string()
            } else {
                routing
                    .as_ref()
                    .map(|defaults| defaults.api.trim().to_string())
                    .filter(|api| !api.is_empty())
                    .unwrap_or_else(|| "openai-completions".to_string())
            }
        };
        let headers = template_entry.model.headers.clone();

        let live = self.fetch_live_model_ids(provider, &base_url, &key)?;
        let existing: std::collections::HashSet<String> = registry
            .models()
            .iter()
            .filter(|entry| providers_equivalent(&entry.model.provider, provider))
            .map(|entry| entry.model.id.to_ascii_lowercase())
            .collect();

        let mut added = Vec::new();
        for model_id in live {
            let model_id = model_id.trim().to_string();
            if model_id.is_empty() || existing.contains(&model_id.to_ascii_lowercase()) {
                continue;
            }
            self.save_custom_provider(&CustomProviderInput {
                // 写入与目录条目同一 provider id，避免别名分裂成两组。
                provider: catalog_provider.clone(),
                name: catalog_provider.clone(),
                base_url: base_url.clone(),
                api: Some(api.clone()),
                model_id: model_id.clone(),
                model_name: None,
                headers: if headers.is_empty() {
                    None
                } else {
                    Some(headers.clone())
                },
                api_key: None,
            })?;
            added.push(model_id);
        }
        Ok(added)
    }

    /// 拉取 live 模型 id：优先走可从路由 base_url 推导的 OpenAI 兼容
    /// `/models`（含 `/v1/messages` → `/v1/models`），失败再回退 Pi 的
    /// `model_fetch`（其自身也会在失败时退回静态快照）。
    fn fetch_live_model_ids(
        &self,
        provider: &str,
        base_url: &str,
        api_key: &str,
    ) -> Result<Vec<String>, PiAgentError> {
        if let Some(url) = openai_compat_models_url(base_url) {
            match fetch_openai_compat_model_ids(&url, api_key) {
                Ok(ids) if !ids.is_empty() => return Ok(ids),
                Ok(_) => {}
                Err(_) => {}
            }
        }
        futures::executor::block_on(pi::providers::model_fetch::refresh_provider_models(
            provider, api_key,
        ))
        .map_err(|error| PiAgentError::Provider(error.to_string()))
    }

    /// vault 取 key；若精确 id 没有，再试 Pi 规范 id 及其别名。
    fn api_key_for_provider(&self, provider: &str) -> Result<Option<String>, PiAgentError> {
        if let Some(key) = self.secrets.api_key(provider)? {
            return Ok(Some(key));
        }
        let Some(meta) = pi::provider_metadata::provider_metadata(provider) else {
            return Ok(None);
        };
        let mut candidates = vec![meta.canonical_id.to_string()];
        candidates.extend(meta.aliases.iter().map(|alias| (*alias).to_string()));
        for candidate in candidates {
            if candidate.eq_ignore_ascii_case(provider) {
                continue;
            }
            if let Some(key) = self.secrets.api_key(&candidate)? {
                return Ok(Some(key));
            }
        }
        Ok(None)
    }

    /// models.json 路径：显式配置优先，否则与 vault 同目录（Pi agent dir）。
    fn models_json_path(&self) -> Result<PathBuf, PiAgentError> {
        self.effective_models_path()
            .ok_or_else(|| PiAgentError::Provider("models.json path is unavailable".to_string()))
    }

    /// 读写共用的有效 models.json 路径。registry 加载也必须走这里：
    /// pi 只在 models_path 为 Some 时应用 models.json override，传 None
    /// 会导致自定义/实时刷新的模型对 catalog 不可见（写入与读取不一致）。
    fn effective_models_path(&self) -> Option<PathBuf> {
        self.models_path.clone().or_else(|| {
            self.secrets
                .auth_file_path()
                .parent()
                .map(|dir| dir.join("models.json"))
        })
    }

    fn registry(&self) -> Result<pi::sdk::ModelRegistry, PiAgentError> {
        let auth = pi::auth::AuthStorage::load(self.secrets.auth_file_path().to_path_buf())
            .map_err(|error| PiAgentError::Provider(error.to_string()))?;
        Ok(pi::sdk::ModelRegistry::load_for_listing(
            &auth,
            self.effective_models_path(),
        ))
    }

    fn to_model_info(&self, entry: &pi::sdk::ModelEntry) -> AgentModelInfo {
        let model = &entry.model;
        // 与 has_credential() 同语义：只认 vault 显式配置，不认 env 解析结果。
        let has_credential = self.has_credential(&model.provider);
        AgentModelInfo {
            provider: model.provider.clone(),
            model_id: model.id.clone(),
            name: model.name.clone(),
            api: model.api.clone(),
            base_url: model.base_url.clone(),
            reasoning: model.reasoning,
            supports_xhigh: entry.supports_xhigh(),
            image_input: model.input.contains(&pi::sdk::InputType::Image),
            context_window: model.context_window,
            max_tokens: model.max_tokens,
            cost: Some(AgentModelCost {
                input: model.cost.input,
                output: model.cost.output,
                cache_read: model.cost.cache_read,
                cache_write: model.cost.cache_write,
            }),
            has_credential,
        }
    }
}

/// provider id 是否等价（大小写不敏感，或 Pi 规范 id / 别名相同）。
fn providers_equivalent(left: &str, right: &str) -> bool {
    if left.eq_ignore_ascii_case(right) {
        return true;
    }
    match (
        pi::provider_metadata::canonical_provider_id(left),
        pi::provider_metadata::canonical_provider_id(right),
    ) {
        (Some(left_canonical), Some(right_canonical)) => {
            left_canonical.eq_ignore_ascii_case(right_canonical)
        }
        _ => false,
    }
}

/// 从路由 base_url 推导 OpenAI 兼容的 `/models` 地址。
///
/// 与 Pi `model_fetch::openai_compat_models_url` 不同：这里**允许**
/// `…/v1/messages` —— 剥掉 `/messages` 后请求 `…/v1/models`。Kimi Coding
/// 等 Anthropic-messages 路由 provider 实际仍暴露该列表端点。
fn openai_compat_models_url(base_url: &str) -> Option<String> {
    let base = base_url.trim().trim_end_matches('/');
    if base.is_empty() {
        return None;
    }
    if base.contains("/v1beta") || base.contains("googleapis.com") {
        return None;
    }
    let root = base.strip_suffix("/messages").unwrap_or(base);
    if !root.contains("/v1") {
        return None;
    }
    Some(format!("{}/models", root.trim_end_matches('/')))
}

#[derive(Debug, serde::Deserialize)]
struct OpenAiModelsResponse {
    data: Vec<OpenAiModelRow>,
}

#[derive(Debug, serde::Deserialize)]
struct OpenAiModelRow {
    id: String,
}

fn fetch_openai_compat_model_ids(url: &str, api_key: &str) -> Result<Vec<String>, PiAgentError> {
    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|error| PiAgentError::Provider(error.to_string()))?;
    let response = client
        .get(url)
        .header("Authorization", format!("Bearer {}", api_key.trim()))
        .header("Accept", "application/json")
        .send()
        .map_err(|error| PiAgentError::Provider(error.to_string()))?;
    let status = response.status();
    if !status.is_success() {
        let body = response.text().unwrap_or_default();
        let snippet: String = body.chars().take(200).collect();
        return Err(PiAgentError::Provider(format!(
            "GET {url} returned HTTP {status}: {snippet}"
        )));
    }
    let parsed: OpenAiModelsResponse = response
        .json()
        .map_err(|error| PiAgentError::Provider(format!("parse /models response: {error}")))?;
    let mut ids: Vec<String> = parsed
        .data
        .into_iter()
        .map(|row| row.id)
        .filter(|id| !id.trim().is_empty())
        .collect();
    ids.sort();
    ids.dedup();
    Ok(ids)
}

fn read_models_json(path: &std::path::Path) -> Result<serde_json::Value, PiAgentError> {
    let Ok(bytes) = std::fs::read(path) else {
        return Ok(serde_json::json!({}));
    };
    let value: serde_json::Value = serde_json::from_slice(&bytes)
        .map_err(|error| PiAgentError::Provider(format!("models.json is corrupted: {error}")))?;
    if !value.is_object() {
        return Err(PiAgentError::Provider(
            "models.json root must be an object".to_string(),
        ));
    }
    Ok(value)
}

fn write_models_json(path: &std::path::Path, root: &serde_json::Value) -> Result<(), PiAgentError> {
    let parent = path.parent().ok_or_else(|| {
        PiAgentError::Provider("models.json has no parent directory".to_string())
    })?;
    std::fs::create_dir_all(parent).map_err(|error| PiAgentError::Provider(error.to_string()))?;
    let payload = serde_json::to_vec_pretty(root)
        .map_err(|error| PiAgentError::Provider(error.to_string()))?;
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, payload).map_err(|error| PiAgentError::Provider(error.to_string()))?;
    std::fs::rename(&tmp, path).map_err(|error| PiAgentError::Provider(error.to_string()))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_catalog(name: &str) -> (ProviderCatalog, PathBuf) {
        let path = std::env::temp_dir().join(format!(
            "giteam-provider-test-{}-{}-{name}.json",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map_or(0, |duration| duration.as_millis())
        ));
        (ProviderCatalog::new(SecretStore::new(path.clone())), path)
    }

    #[test]
    fn catalog_loads_pi_builtin_models() {
        let (catalog, path) = temp_catalog("load");
        let models = catalog.list_models().expect("list models");

        assert!(!models.is_empty());
        assert!(models.iter().all(|model| !model.provider.is_empty()));
        assert!(models.iter().all(|model| !model.model_id.is_empty()));

        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn providers_are_grouped_and_sorted() {
        let (catalog, path) = temp_catalog("group");
        let providers = catalog.list_providers().expect("list providers");

        assert!(!providers.is_empty());
        for window in providers.windows(2) {
            assert!(window[0].provider <= window[1].provider);
        }
        for provider in &providers {
            assert_eq!(provider.model_count, provider.models.len());
            assert!(!provider.models.is_empty());
        }

        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn credential_flag_never_exposes_the_key_material() {
        let (catalog, path) = temp_catalog("credential");
        catalog
            .secrets
            .set_api_key("openai", "sk-catalog-secret")
            .expect("set key");

        assert!(catalog.has_credential("openai"));
        let json = serde_json::to_string(&catalog.list_providers().expect("providers"))
            .expect("serialize providers");
        assert!(!json.contains("sk-catalog-secret"));

        let debug = format!("{catalog:?}");
        assert!(!debug.contains("sk-catalog-secret"));

        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn custom_provider_round_trips_through_models_json_without_key_material() {
        let (catalog, auth_path) = temp_catalog("custom");
        let dir = auth_path.parent().expect("auth parent").to_path_buf();
        let models_path = dir.join("models.json");
        let catalog = catalog.with_models_path(models_path.clone());
        let input = CustomProviderInput {
            provider: "acme".to_string(),
            name: "Acme".to_string(),
            base_url: "https://acme.example/v1".to_string(),
            api: None,
            model_id: "acme-chat".to_string(),
            model_name: Some("Acme Chat".to_string()),
            headers: None,
            api_key: Some("sk-acme-secret".to_string()),
        };
        catalog.save_custom_provider(&input).expect("save custom");

        let found = catalog
            .find_model("acme", "acme-chat")
            .expect("find model")
            .expect("model should exist");
        assert_eq!(found.base_url, "https://acme.example/v1");
        assert_eq!(found.api, "openai-completions");
        assert!(found.has_credential);
        assert!(catalog.has_credential("acme"));

        let raw = std::fs::read_to_string(&models_path).expect("read models.json");
        assert!(!raw.contains("sk-acme-secret"));
        assert!(!raw.contains("apiKey"));

        // 同 provider 追加第二个模型，合并而非覆盖。
        let second = CustomProviderInput {
            model_id: "acme-reasoner".to_string(),
            model_name: None,
            api_key: None,
            ..input
        };
        catalog.save_custom_provider(&second).expect("save second model");
        let models = catalog.list_models().expect("list models");
        let acme_models: Vec<_> = models.iter().filter(|m| m.provider == "acme").collect();
        assert_eq!(acme_models.len(), 2);

        let _ = std::fs::remove_file(&auth_path);
        let _ = std::fs::remove_file(&models_path);
    }

    #[test]
    fn openai_compat_models_url_strips_messages_suffix() {
        assert_eq!(
            openai_compat_models_url("https://api.kimi.com/coding/v1/messages"),
            Some("https://api.kimi.com/coding/v1/models".to_string())
        );
        assert_eq!(
            openai_compat_models_url("https://api.openai.com/v1"),
            Some("https://api.openai.com/v1/models".to_string())
        );
        assert_eq!(
            openai_compat_models_url("https://generativelanguage.googleapis.com/v1beta"),
            None
        );
    }

    #[test]
    fn kimi_coding_aliases_are_equivalent() {
        assert!(providers_equivalent("kimi-coding", "kimi-for-coding"));
        assert!(providers_equivalent("kimi-code", "kimi-coding"));
        assert!(!providers_equivalent("kimi-coding", "moonshotai"));
    }
}
