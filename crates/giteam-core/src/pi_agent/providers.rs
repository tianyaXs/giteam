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
    /// 显示名（来自 models.json `name`；缺省等于 provider id）。
    #[serde(default)]
    pub name: String,
    pub model_count: usize,
    pub has_credential: bool,
    /// 是否可从 models.json 整项删除（自定义 openai-compatible.* / 纯自定义实例）。
    /// 内置供应商仅有端点覆盖时为 false。
    #[serde(default)]
    pub removable: bool,
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
        // 修复历史错误配置：openai-codex 等 OAuth 原生 provider 被写成自定义
        // baseUrl 后若仍保留 openai-codex-responses，会校验 chatgpt_account_id。
        // 此处原地把非官方端点的 api 修正为 openai-completions，保持原 provider id。
        let _ = self.repair_oauth_native_custom_endpoints();
        let display_names = self.provider_display_names();
        let models_json_ids = self.models_json_provider_ids();
        let mut providers: Vec<AgentProviderInfo> = Vec::new();
        for model in self.list_models()? {
            if let Some(existing) = providers
                .iter_mut()
                .find(|provider| provider.provider.eq_ignore_ascii_case(&model.provider))
            {
                existing.has_credential |= model.has_credential;
                existing.models.push(model);
            } else {
                let name = display_names
                    .get(&model.provider)
                    .cloned()
                    .unwrap_or_else(|| model.provider.clone());
                let removable = is_removable_custom_provider_id(&model.provider)
                    && models_json_ids
                        .iter()
                        .any(|id| id.eq_ignore_ascii_case(&model.provider));
                providers.push(AgentProviderInfo {
                    provider: model.provider.clone(),
                    name,
                    model_count: 0,
                    has_credential: model.has_credential,
                    removable,
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
            if provider.name.trim().is_empty() {
                provider.name = provider.provider.clone();
            }
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
        // 密钥绝不写入 models.json；provider 级 apiKey 由 vault（auth.json）解析。
        entry.remove("apiKey");
        // provider 显示名：勿用裸 id 覆盖已有品牌名（refresh 常传 name=provider id）。
        let incoming_provider_name = input.name.trim();
        let existing_provider_name = entry
            .get("name")
            .and_then(|value| value.as_str())
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or("");
        let provider_display = if !incoming_provider_name.is_empty()
            && !incoming_provider_name.eq_ignore_ascii_case(provider)
        {
            incoming_provider_name.to_string()
        } else if !existing_provider_name.is_empty() {
            existing_provider_name.to_string()
        } else if !incoming_provider_name.is_empty() {
            incoming_provider_name.to_string()
        } else {
            provider.to_string()
        };
        entry.insert(
            "name".to_string(),
            serde_json::Value::String(provider_display),
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
        let models = entry
            .entry("models")
            .or_insert_with(|| serde_json::json!([]));
        let models = models.as_array_mut().ok_or_else(|| {
            PiAgentError::Provider(format!("models.json provider {provider} models must be an array"))
        })?;
        let existing_model_name = models
            .iter()
            .find(|model| model.get("id").and_then(serde_json::Value::as_str) == Some(model_id))
            .and_then(|model| model.get("name").and_then(serde_json::Value::as_str))
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string);
        // model 显示名：显式传入 > 保留已有品牌名 > 才回退 id（避免 refresh 抹掉 GPT-5.3 Codex）。
        let model_name = input
            .model_name
            .as_deref()
            .map(str::trim)
            .filter(|name| !name.is_empty())
            .map(str::to_string)
            .or(existing_model_name)
            .unwrap_or_else(|| model_id.to_string());
        let new_model = serde_json::json!({ "id": model_id, "name": model_name });
        if let Some(existing) = models.iter_mut().find(|model| {
            model.get("id").and_then(serde_json::Value::as_str) == Some(model_id)
        }) {
            if let Some(obj) = existing.as_object_mut() {
                obj.insert("id".to_string(), serde_json::Value::String(model_id.to_string()));
                obj.insert("name".to_string(), serde_json::Value::String(model_name));
            } else {
                *existing = new_model;
            }
        } else {
            models.push(new_model);
        }
        write_models_json(&path, &root)?;
        if let Some(key) = input.api_key.as_deref().map(str::trim).filter(|key| !key.is_empty()) {
            self.secrets.set_api_key(provider, key)?;
        }
        Ok(())
    }

    /// 删除自定义供应商：从 models.json 移除整项，并清除 vault 凭据。
    /// 仅允许 `openai-compatible.*` 或非内置的纯自定义实例；内置供应商的端点覆盖不可由此删除。
    pub fn remove_custom_provider(&self, provider: &str) -> Result<bool, PiAgentError> {
        let provider = provider.trim();
        if provider.is_empty() {
            return Err(PiAgentError::Provider("provider is required".to_string()));
        }
        if provider == "openai-compatible" {
            return Err(PiAgentError::Provider(
                "openai-compatible is a template entry and cannot be deleted".to_string(),
            ));
        }
        if !is_removable_custom_provider_id(provider) {
            return Err(PiAgentError::Provider(format!(
                "{provider} is not a removable custom provider"
            )));
        }
        let path = self.models_json_path()?;
        let mut root = read_models_json(&path)?;
        let root_obj = root.as_object_mut().ok_or_else(|| {
            PiAgentError::Provider("models.json root must be an object".to_string())
        })?;
        let Some(providers) = root_obj
            .get_mut("providers")
            .and_then(|value| value.as_object_mut())
        else {
            return Err(PiAgentError::Provider(format!(
                "custom provider {provider} not found in models.json"
            )));
        };
        let key = providers
            .keys()
            .find(|id| id.eq_ignore_ascii_case(provider))
            .cloned()
            .ok_or_else(|| {
                PiAgentError::Provider(format!(
                    "custom provider {provider} not found in models.json"
                ))
            })?;
        providers.remove(&key);
        write_models_json(&path, &root)?;
        let _ = self.secrets.remove(&key)?;
        if !key.eq_ignore_ascii_case(provider) {
            let _ = self.secrets.remove(provider)?;
        }
        Ok(true)
    }

    /// 连接 OpenAI Completions 兼容端点：校验 baseUrl、拉 `/models`、写入
    /// models.json 并保存 api key。
    ///
    /// - `provider` 为空或为模板 id `openai-compatible`：新建
    ///   `openai-compatible.<slug>` 实例（名称必填，便于多端点区分）。
    /// - `provider` 为已有 `openai-compatible.*`：更新该实例。
    /// 返回 `(provider_id, model_ids)`。
    pub fn connect_openai_compatible(
        &self,
        base_url: &str,
        api_key: &str,
        name: &str,
        provider: Option<&str>,
    ) -> Result<(String, Vec<String>), PiAgentError> {
        let base_url = base_url.trim().trim_end_matches('/');
        let api_key = api_key.trim();
        let display_name = name.trim();
        if base_url.is_empty() || api_key.is_empty() {
            return Err(PiAgentError::Provider(
                "baseUrl and apiKey are required".to_string(),
            ));
        }
        if display_name.is_empty() {
            return Err(PiAgentError::Provider(
                "provider name is required".to_string(),
            ));
        }
        let Some(models_url) = openai_compat_models_url(base_url) else {
            return Err(PiAgentError::Provider(
                "baseUrl is not an OpenAI-compatible endpoint".to_string(),
            ));
        };
        let mut ids = match fetch_openai_compat_model_ids(&models_url, api_key, true) {
            Ok(ids) if !ids.is_empty() => ids,
            _ => fetch_openai_compat_model_ids(&models_url, api_key, false)?,
        };
        ids.retain(|id| {
            let lower = id.to_ascii_lowercase();
            !["embedding", "embed", "rerank", "tts", "whisper", "speech"]
                .iter()
                .any(|needle| lower.contains(needle))
        });
        if ids.is_empty() {
            return Err(PiAgentError::Provider(
                "endpoint returned no usable chat models".to_string(),
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

        let requested = provider.map(str::trim).filter(|value| !value.is_empty());
        let provider_id = match requested {
            Some(id) if id != "openai-compatible" && id.starts_with("openai-compatible.") => {
                id.to_string()
            }
            _ => allocate_openai_compatible_provider_id(display_name, providers),
        };

        // 重连合并：保留已有模型的品牌 name，并保留本次未返回但仍在列表中的条目。
        let previous = providers.get(&provider_id).cloned();
        let mut name_by_id = std::collections::HashMap::<String, String>::new();
        let mut kept: Vec<serde_json::Value> = Vec::new();
        if let Some(prev_models) = previous
            .as_ref()
            .and_then(|entry| entry.get("models"))
            .and_then(|value| value.as_array())
        {
            for model in prev_models {
                let Some(id) = model.get("id").and_then(|value| value.as_str()).map(str::trim) else {
                    continue;
                };
                if id.is_empty() {
                    continue;
                }
                if let Some(name) = model
                    .get("name")
                    .and_then(|value| value.as_str())
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                {
                    name_by_id.insert(id.to_string(), name.to_string());
                }
                if !ids.iter().any(|live| live == id) {
                    kept.push(model.clone());
                }
            }
        }
        let mut models = ids
            .iter()
            .map(|id| {
                let name = name_by_id
                    .get(id)
                    .cloned()
                    .unwrap_or_else(|| id.clone());
                serde_json::json!({ "id": id, "name": name })
            })
            .collect::<Vec<_>>();
        models.extend(kept);
        providers.insert(
            provider_id.clone(),
            serde_json::json!({
                "name": display_name,
                "baseUrl": base_url,
                "api": "openai-completions",
                "models": models,
            }),
        );
        write_models_json(&path, &root)?;
        self.secrets.set_api_key(&provider_id, api_key)?;
        Ok((provider_id, ids))
    }

    /// models.json 中各 provider 的显示名。
    fn provider_display_names(&self) -> std::collections::HashMap<String, String> {
        let mut names = std::collections::HashMap::new();
        let Ok(path) = self.models_json_path() else {
            return names;
        };
        let Ok(root) = read_models_json(&path) else {
            return names;
        };
        let Some(providers) = root.get("providers").and_then(|value| value.as_object()) else {
            return names;
        };
        for (provider_id, entry) in providers {
            if let Some(name) = entry
                .get("name")
                .and_then(|value| value.as_str())
                .map(str::trim)
                .filter(|value| !value.is_empty())
            {
                names.insert(provider_id.clone(), name.to_string());
            }
        }
        names
    }

    /// models.json 中已登记的 provider id 集合。
    fn models_json_provider_ids(&self) -> std::collections::HashSet<String> {
        let mut ids = std::collections::HashSet::new();
        let Ok(path) = self.models_json_path() else {
            return ids;
        };
        let Ok(root) = read_models_json(&path) else {
            return ids;
        };
        let Some(providers) = root.get("providers").and_then(|value| value.as_object()) else {
            return ids;
        };
        for provider_id in providers.keys() {
            ids.insert(provider_id.clone());
        }
        ids
    }

    /// 更新已有 provider 的 baseUrl（及可选 api），保留 models 列表。
    /// 用于内置供应商自定义端点（代理 / 自托管）；若 models.json 尚无该
    /// provider 条目，则从当前 registry 拷贝模型 id 再写入。
    ///
    /// `openai-codex` 等 OAuth 原生供应商填写非官方 Base URL 时，必须同时把
    /// api 写成 `openai-completions`（否则 pi 仍走 Codex OAuth Responses，
    /// 校验 chatgpt_account_id）。官方地址则保持/恢复 `openai-codex-responses`。
    /// 始终原地更新原 provider id，不另存为 openai-compatible.*。
    pub fn update_provider_endpoint(
        &self,
        provider: &str,
        base_url: &str,
        api: Option<&str>,
    ) -> Result<(), PiAgentError> {
        let provider = provider.trim();
        let base_url = base_url.trim();
        if provider.is_empty() || base_url.is_empty() {
            return Err(PiAgentError::Provider(
                "provider and baseUrl are required".to_string(),
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

        let registry = self.registry()?;
        let catalog_models: Vec<(String, String)> = registry
            .models()
            .iter()
            .filter(|entry| providers_equivalent(&entry.model.provider, provider))
            .map(|entry| (entry.model.id.clone(), entry.model.name.clone()))
            .collect();
        let catalog_provider = catalog_models
            .first()
            .and_then(|_| {
                registry
                    .models()
                    .iter()
                    .find(|entry| providers_equivalent(&entry.model.provider, provider))
                    .map(|entry| entry.model.provider.clone())
            })
            .unwrap_or_else(|| provider.to_string());
        let default_api = registry
            .models()
            .iter()
            .find(|entry| providers_equivalent(&entry.model.provider, provider))
            .map(|entry| entry.model.api.clone())
            .filter(|value| !value.trim().is_empty())
            .or_else(|| {
                pi::provider_metadata::provider_routing_defaults(provider)
                    .or_else(|| pi::provider_metadata::provider_routing_defaults(&catalog_provider))
                    .map(|defaults| defaults.api.to_string())
            })
            .unwrap_or_else(|| "openai-completions".to_string());

        // OAuth 原生供应商：非官方地址强制 Completions，避免仍走 Codex OAuth。
        let effective_api = if is_oauth_native_api_locked_provider(provider) {
            if is_official_openai_codex_base(base_url) {
                api.map(str::trim)
                    .filter(|value| !value.is_empty())
                    .unwrap_or("openai-codex-responses")
                    .to_string()
            } else {
                "openai-completions".to_string()
            }
        } else {
            api.map(str::trim)
                .filter(|value| !value.is_empty())
                .unwrap_or(default_api.as_str())
                .to_string()
        };

        let entry = providers
            .entry(catalog_provider.clone())
            .or_insert_with(|| serde_json::json!({}));
        let entry = entry.as_object_mut().ok_or_else(|| {
            PiAgentError::Provider(format!(
                "models.json provider {catalog_provider} must be an object"
            ))
        })?;
        let builtin_display = pi::provider_metadata::provider_metadata(&catalog_provider)
            .and_then(|meta| meta.display_name)
            .unwrap_or(catalog_provider.as_str());
        entry.insert(
            "name".to_string(),
            serde_json::Value::String(
                entry
                    .get("name")
                    .and_then(|value| value.as_str())
                    .map(str::trim)
                    .filter(|name| {
                        !name.is_empty()
                            // 历史误迁移产生的「openai-codex · host」显示名，恢复成内置名。
                            && !name.contains('·')
                    })
                    .unwrap_or(builtin_display)
                    .to_string(),
            ),
        );
        entry.insert(
            "baseUrl".to_string(),
            serde_json::Value::String(base_url.to_string()),
        );
        entry.insert(
            "api".to_string(),
            serde_json::Value::String(effective_api),
        );
        entry.remove("apiKey");
        let models = entry
            .entry("models")
            .or_insert_with(|| serde_json::json!([]));
        let models = models.as_array_mut().ok_or_else(|| {
            PiAgentError::Provider(format!(
                "models.json provider {catalog_provider} models must be an array"
            ))
        })?;
        if models.is_empty() {
            for (model_id, model_name) in catalog_models {
                models.push(serde_json::json!({ "id": model_id, "name": model_name }));
            }
        }
        if models.is_empty() {
            return Err(PiAgentError::Provider(format!(
                "provider {provider} has no models to attach endpoint override"
            )));
        }
        write_models_json(&path, &root)?;
        Ok(())
    }

    /// 修复 OAuth 原生供应商上的错误端点覆盖：
    /// 1) 非官方 baseUrl 时原地把 api 写成 `openai-completions`，恢复内置显示名；
    /// 2) 收回历史误迁移的 `openai-compatible.*`（名称/ id 来自 openai-codex）回到
    ///    原 provider id，避免列表里出现「openai-codex · host」新条目。
    pub fn repair_oauth_native_custom_endpoints(&self) -> Result<Vec<String>, PiAgentError> {
        const NATIVE: &[&str] = &["openai-codex"];
        let path = self.models_json_path()?;
        let mut root = read_models_json(&path)?;
        let Some(providers) = root
            .as_object_mut()
            .and_then(|root| root.get_mut("providers"))
            .and_then(|value| value.as_object_mut())
        else {
            return Ok(Vec::new());
        };

        let mut repaired = Vec::new();

        // 收回误迁移的 openai-compatible.* → 原 openai-codex。
        let mut reclaim: Vec<(String, String, serde_json::Value)> = Vec::new();
        for (provider_id, entry) in providers.iter() {
            if !provider_id.starts_with("openai-compatible.") {
                continue;
            }
            let name = entry
                .get("name")
                .and_then(|value| value.as_str())
                .unwrap_or("")
                .to_ascii_lowercase();
            let id_lower = provider_id.to_ascii_lowercase();
            let looks_like_codex = id_lower.contains("openai-codex")
                || name.starts_with("openai-codex")
                || name.contains("openai-codex ·");
            if !looks_like_codex {
                continue;
            }
            reclaim.push((
                provider_id.clone(),
                "openai-codex".to_string(),
                entry.clone(),
            ));
        }
        for (from_id, to_id, entry) in reclaim {
            let base_url = entry
                .get("baseUrl")
                .and_then(|value| value.as_str())
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .unwrap_or("")
                .to_string();
            if base_url.is_empty() {
                providers.remove(&from_id);
                let _ = self.secrets.remove(&from_id);
                repaired.push(from_id);
                continue;
            }
            let models = entry
                .get("models")
                .cloned()
                .unwrap_or_else(|| serde_json::json!([]));
            let builtin_display = pi::provider_metadata::provider_metadata(&to_id)
                .and_then(|meta| meta.display_name)
                .unwrap_or(to_id.as_str());
            let key = self
                .api_key_for_provider(&from_id)?
                .or(self.api_key_for_provider(&to_id)?);
            providers.insert(
                to_id.clone(),
                serde_json::json!({
                    "name": builtin_display,
                    "baseUrl": base_url,
                    "api": "openai-completions",
                    "models": models,
                }),
            );
            providers.remove(&from_id);
            if let Some(api_key) = key.as_deref() {
                self.secrets.set_api_key(&to_id, api_key)?;
            }
            let _ = self.secrets.remove(&from_id);
            repaired.push(to_id);
        }

        for provider_id in NATIVE {
            let Some(entry) = providers.get_mut(*provider_id) else {
                continue;
            };
            let Some(entry_obj) = entry.as_object_mut() else {
                continue;
            };
            let base_url = entry_obj
                .get("baseUrl")
                .and_then(|value| value.as_str())
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .unwrap_or("")
                .to_string();
            if base_url.is_empty() || is_official_openai_codex_base(&base_url) {
                continue;
            }
            let current_api = entry_obj
                .get("api")
                .and_then(|value| value.as_str())
                .unwrap_or("")
                .trim()
                .to_string();
            let current_name = entry_obj
                .get("name")
                .and_then(|value| value.as_str())
                .unwrap_or("")
                .trim()
                .to_string();
            let builtin_display = pi::provider_metadata::provider_metadata(provider_id)
                .and_then(|meta| meta.display_name)
                .unwrap_or(*provider_id);
            let mut changed = false;
            if current_api != "openai-completions" {
                entry_obj.insert(
                    "api".to_string(),
                    serde_json::Value::String("openai-completions".to_string()),
                );
                changed = true;
            }
            if current_name.is_empty() || current_name.contains('·') {
                entry_obj.insert(
                    "name".to_string(),
                    serde_json::Value::String(builtin_display.to_string()),
                );
                changed = true;
            }
            if changed {
                repaired.push((*provider_id).to_string());
            }
        }

        if !repaired.is_empty() {
            write_models_json(&path, &root)?;
        }
        Ok(repaired)
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
        // 内置/已写入 models.json 的条目均可作路由模板；纯自定义在保存后也会进 registry。
        let Some(template_entry) = template_entry else {
            return Ok(Vec::new());
        };
        let catalog_provider = template_entry.model.provider.clone();
        let routing = pi::provider_metadata::provider_routing_defaults(provider)
            .or_else(|| pi::provider_metadata::provider_routing_defaults(&catalog_provider));
        // 候选 base_url：models.json / 静态条目优先；若无法推导 /models（如 legacy
        // `https://api.kimi.com/coding` 无 /v1），再回退到 ProviderRoutingDefaults。
        let mut base_candidates: Vec<String> = Vec::new();
        let from_model = template_entry.model.base_url.trim();
        if !from_model.is_empty() {
            base_candidates.push(from_model.to_string());
        }
        if let Some(defaults) = routing.as_ref() {
            let from_routing = defaults.base_url.trim();
            if !from_routing.is_empty()
                && !base_candidates
                    .iter()
                    .any(|existing| existing.eq_ignore_ascii_case(from_routing))
            {
                base_candidates.push(from_routing.to_string());
            }
        }
        let Some((base_url, models_url)) = base_candidates.into_iter().find_map(|candidate| {
            openai_compat_models_url(&candidate).map(|url| (candidate, url))
        }) else {
            return Ok(Vec::new());
        };
        // kimi-for-coding：auth_header=false → x-api-key；其它默认 Bearer。
        let use_auth_header = routing.as_ref().map(|defaults| defaults.auth_header).unwrap_or(true);
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

        let live = self.fetch_live_model_ids(provider, &base_url, &models_url, &key, use_auth_header)?;
        let existing: std::collections::HashSet<String> = registry
            .models()
            .iter()
            .filter(|entry| providers_equivalent(&entry.model.provider, provider))
            .map(|entry| entry.model.id.to_ascii_lowercase())
            .collect();

        // 首次写入 models.json 前先种子完整内置目录，避免 Pi「有 models 数组就整表覆盖」
        // 只留下一条 live 新模型、冲掉其余内置条目与品牌名。
        self.seed_provider_catalog_models_if_needed(
            &catalog_provider,
            &base_url,
            &api,
            if headers.is_empty() {
                None
            } else {
                Some(&headers)
            },
            template_entry,
        )?;

        let mut added = Vec::new();
        // provider 显示名：优先内置 metadata / 已有 models.json，禁止用裸 id 覆盖。
        let provider_display = self
            .provider_display_names()
            .get(&catalog_provider)
            .cloned()
            .or_else(|| {
                pi::provider_metadata::provider_metadata(&catalog_provider)
                    .and_then(|meta| meta.display_name)
                    .map(str::to_string)
            })
            .unwrap_or_else(|| catalog_provider.clone());
        for model_id in live {
            let model_id = model_id.trim().to_string();
            if model_id.is_empty() || existing.contains(&model_id.to_ascii_lowercase()) {
                continue;
            }
            self.save_custom_provider(&CustomProviderInput {
                // 写入与目录条目同一 provider id，避免别名分裂成两组。
                provider: catalog_provider.clone(),
                name: provider_display.clone(),
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

    /// 若 models.json 尚无该 provider 或 models 为空，从 registry 种子完整列表（保留品牌 name）。
    fn seed_provider_catalog_models_if_needed(
        &self,
        catalog_provider: &str,
        base_url: &str,
        api: &str,
        headers: Option<&std::collections::HashMap<String, String>>,
        template_entry: &pi::sdk::ModelEntry,
    ) -> Result<(), PiAgentError> {
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
        let needs_seed = match providers.get(catalog_provider) {
            None => true,
            Some(entry) => entry
                .get("models")
                .and_then(|value| value.as_array())
                .map(|models| models.is_empty())
                .unwrap_or(true),
        };
        if !needs_seed {
            return Ok(());
        }
        let registry = self.registry()?;
        let catalog_models: Vec<(String, String)> = registry
            .models()
            .iter()
            .filter(|entry| providers_equivalent(&entry.model.provider, catalog_provider))
            .map(|entry| (entry.model.id.clone(), entry.model.name.clone()))
            .collect();
        let display = pi::provider_metadata::provider_metadata(catalog_provider)
            .and_then(|meta| meta.display_name)
            .unwrap_or(catalog_provider);
        let models = if catalog_models.is_empty() {
            vec![serde_json::json!({
                "id": template_entry.model.id,
                "name": template_entry.model.name
            })]
        } else {
            catalog_models
                .into_iter()
                .map(|(id, name)| serde_json::json!({ "id": id, "name": name }))
                .collect::<Vec<_>>()
        };
        let mut entry = serde_json::json!({
            "name": display,
            "baseUrl": base_url,
            "api": api,
            "models": models,
        });
        if let Some(headers) = headers {
            if !headers.is_empty() {
                if let Ok(value) = serde_json::to_value(headers) {
                    entry
                        .as_object_mut()
                        .map(|obj| obj.insert("headers".to_string(), value));
                }
            }
        }
        providers.insert(catalog_provider.to_string(), entry);
        write_models_json(&path, &root)?;
        Ok(())
    }

    /// 拉取 live 模型 id：优先走可从路由 base_url 推导的 OpenAI 兼容
    /// `/models`（含 `/v1/messages` → `/v1/models`），失败再回退 Pi 的
    /// `model_fetch`（其自身也会在失败时退回静态快照）。
    fn fetch_live_model_ids(
        &self,
        provider: &str,
        _base_url: &str,
        models_url: &str,
        api_key: &str,
        use_auth_header: bool,
    ) -> Result<Vec<String>, PiAgentError> {
        match fetch_openai_compat_model_ids(models_url, api_key, use_auth_header) {
            Ok(ids) if !ids.is_empty() => return Ok(ids),
            Ok(_) | Err(_) => {
                // kimi 等可能只接受 x-api-key；首选空列表或失败时再试另一种鉴权。
                if let Ok(ids) =
                    fetch_openai_compat_model_ids(models_url, api_key, !use_auth_header)
                {
                    if !ids.is_empty() {
                        return Ok(ids);
                    }
                }
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
            // image_input：三轨乐观，避免静默丢图（用户明确要求"默认允许图片"）。
            // ① pi 清单明确标 Image（内置视觉模型如 Claude/GPT-4o）→ 支持；
            // ② 自定义 OpenAI 兼容 provider（openai-compatible.*，is_removable）→ 乐观；
            // ③ 第三方 endpoint（base_url 非官方域名，如 gaccode relay / 内网 IP）→ 乐观。
            // 真根因实测：openai-codex 等「内置 provider id 但 base_url 连第三方 relay」的视觉模型
            // （gpt-5.6-luna），pi 清单不标 Image、is_oauth_native_api_locked 判 true→is_removable=false，
            // 严格判 image_input=false→service.rs 静默丢图+注入"看不到图"提示→模型忽略提示答非所问
            // （截图现象：问"这是什么"+图，agent 答上一轮番茄钟结论）。第三轨按 base_url 是否官方
            // 域名判断，覆盖这类「id 像内置、实连第三方」的 provider。官方纯文本（deepseek
            // api.deepseek.com 等）base_url 在官方白名单→不乐观，按 pi 清单 [Text] 判。
            // 误乐观（端点真不支持图）由 service.rs image 降级兜底（provider 拒收→去图纯文本重试，不报错）。
            image_input: model.input.contains(&pi::sdk::InputType::Image)
                || is_removable_custom_provider_id(&model.provider)
                || is_third_party_endpoint(&model.base_url),
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

/// pi 按 provider id 硬编码走 OAuth Codex Responses 的供应商（不能原地改 baseUrl）。
fn is_oauth_native_api_locked_provider(provider: &str) -> bool {
    matches!(
        provider.trim().to_ascii_lowercase().as_str(),
        "openai-codex" | "github-copilot"
    )
}

/// 是否允许整项删除的自定义供应商（非内置端点覆盖）。
fn is_removable_custom_provider_id(provider: &str) -> bool {
    let provider = provider.trim();
    if provider.is_empty() || provider == "openai-compatible" {
        return false;
    }
    if provider.starts_with("openai-compatible.") {
        return true;
    }
    if is_oauth_native_api_locked_provider(provider) {
        return false;
    }
    // 内置快照供应商有 routing / canonical 元数据；纯自定义实例没有。
    if pi::provider_metadata::provider_routing_defaults(provider).is_some() {
        return false;
    }
    if pi::provider_metadata::canonical_provider_id(provider).is_some() {
        return false;
    }
    true
}

/// base_url 是否指向第三方/自建 endpoint（非官方域名）。
/// 用于 image_input 第三轨乐观：内置 provider id（如 openai-codex）但 base_url 连第三方 relay
/// 或内网时，按第三方对待，乐观允许图片，避免 pi 清单不标 Image 而静默丢图。官方域名白名单
/// 内的（api.openai.com / api.deepseek.com / api.z.ai 等）视为官方，不乐观（按 pi 清单 [Text] 判）。
fn is_third_party_endpoint(base_url: &str) -> bool {
    let url = base_url.trim().to_ascii_lowercase();
    if url.is_empty() {
        return false;
    }
    // 官方域名标记（base_url 含任一即视为官方 endpoint，不触发乐观）。
    const OFFICIAL_MARKERS: &[&str] = &[
        "chatgpt.com",
        "api.openai.com",
        "api.anthropic.com",
        "api.deepseek.com",
        "api.z.ai",
        "api.kimi.com",
        "api.moonshot.cn",
        "generativelanguage.googleapis.com",
        "api.groq.com",
        "api.mistral.ai",
    ];
    !OFFICIAL_MARKERS.iter().any(|marker| url.contains(marker))
}

fn is_official_openai_codex_base(url: &str) -> bool {
    let lower = url.trim().to_ascii_lowercase();
    lower.contains("chatgpt.com") || lower.contains("api.openai.com")
}

/// 从显示名生成 `openai-compatible.<slug>`，冲突时追加短后缀。
fn allocate_openai_compatible_provider_id(
    display_name: &str,
    existing: &serde_json::Map<String, serde_json::Value>,
) -> String {
    let mut slug = String::new();
    for ch in display_name.chars() {
        if ch.is_ascii_alphanumeric() {
            slug.push(ch.to_ascii_lowercase());
        } else if !slug.is_empty() && !slug.ends_with('-') {
            slug.push('-');
        }
    }
    let slug = slug.trim_matches('-');
    let slug = if slug.is_empty() {
        format!(
            "custom-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_millis())
                .unwrap_or(0)
        )
    } else {
        slug.chars().take(32).collect::<String>()
    };
    let base = format!("openai-compatible.{slug}");
    if !existing.contains_key(&base) {
        return base;
    }
    for index in 2..1000 {
        let candidate = format!("{base}-{index}");
        if !existing.contains_key(&candidate) {
            return candidate;
        }
    }
    format!(
        "{base}-{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or(0)
    )
}

/// 从路由 base_url 推导 OpenAI 兼容的 `/models` 地址。
///
/// 与 Pi `model_fetch::openai_compat_models_url` 不同：这里**允许**
/// `…/v1/messages` —— 剥掉 `/messages` 后请求 `…/v1/models`。Kimi Coding
/// 等 Anthropic-messages 路由 provider 实际仍暴露该列表端点。
/// 也兼容 legacy `https://api.kimi.com/coding`（无 `/v1`）。
fn openai_compat_models_url(base_url: &str) -> Option<String> {
    let base = base_url.trim().trim_end_matches('/');
    if base.is_empty() {
        return None;
    }
    if base.contains("/v1beta") || base.contains("googleapis.com") {
        return None;
    }
    let root = base.strip_suffix("/messages").unwrap_or(base).trim_end_matches('/');
    if root.contains("/v1") {
        return Some(format!("{root}/models"));
    }
    // kimi-coding 静态快照常用 `https://api.kimi.com/coding`（无 /v1）；
    // 其它 OpenAI 兼容端点（含自定义供应商）统一补 `/v1/models`。
    Some(format!("{root}/v1/models"))
}

#[derive(Debug, serde::Deserialize)]
struct OpenAiModelsResponse {
    data: Vec<OpenAiModelRow>,
}

#[derive(Debug, serde::Deserialize)]
struct OpenAiModelRow {
    id: String,
}

fn fetch_openai_compat_model_ids(
    url: &str,
    api_key: &str,
    use_auth_header: bool,
) -> Result<Vec<String>, PiAgentError> {
    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|error| PiAgentError::Provider(error.to_string()))?;
    let key = api_key.trim();
    let mut request = client.get(url).header("Accept", "application/json");
    // Pi：auth_header=true → Authorization Bearer；false（kimi-for-coding）→ x-api-key。
    request = if use_auth_header {
        request.header("Authorization", format!("Bearer {key}"))
    } else {
        request.header("x-api-key", key)
    };
    let response = request
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

        let providers = catalog.list_providers().expect("list providers");
        let acme = providers
            .iter()
            .find(|provider| provider.provider == "acme")
            .expect("acme provider");
        assert!(acme.removable);

        assert!(catalog
            .remove_custom_provider("acme")
            .expect("remove custom"));
        assert!(!catalog.has_credential("acme"));
        let raw = std::fs::read_to_string(&models_path).expect("read models.json after remove");
        assert!(!raw.contains("\"acme\""));
        assert!(catalog
            .list_models()
            .expect("list models")
            .iter()
            .all(|model| model.provider != "acme"));

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
            openai_compat_models_url("https://api.kimi.com/coding"),
            Some("https://api.kimi.com/coding/v1/models".to_string())
        );
        assert_eq!(
            openai_compat_models_url("http://127.0.0.1:8000"),
            Some("http://127.0.0.1:8000/v1/models".to_string())
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
