# Giteam 后端实现深度解析：模型供应商

## 1. 一句话概括

Giteam 不维护模型供应商列表，也不保存 API Key。所有供应商和模型的真实数据都来自本地 OpenCode 服务。Giteam 后端负责启动 OpenCode、代理供应商相关的 API、以及把用户在前端选择的模型格式化成 OpenCode 能识别的请求。

## 2. 为什么要这么做？

### 2.1 OpenCode 已经管理了供应商生态

OpenCode 支持很多大模型供应商：OpenAI、Anthropic、Google、OpenRouter、xAI、Mistral、Groq、Azure 等等。它已经实现了：

- 供应商发现
- 模型列表
- API Key 认证
- 请求路由
- 自定义 OpenAI 兼容供应商

Giteam 如果自己做一套，会永远追不上 OpenCode 的更新速度。

### 2.2 为什么不自己存 API Key？

API Key 是敏感信息。如果 Giteam 自己存：

- 需要额外做加密；
- 用户会担心泄露；
- 跨平台同步更复杂。

让 OpenCode 管理 API Key，Giteam 只通过 OpenCode 的 `/auth/{provider}` 端点设置或删除，是最安全的做法。

## 3. 后端具体怎么做？

### 3.1 启动 OpenCode 服务

和对话保存、MCP 一样，模型供应商功能的前提是 OpenCode 服务已经启动。后端为每个仓库启动独立的 `opencode serve`，cwd 设为仓库根目录。

### 3.2 获取供应商目录

后端通过 OpenCode 的 `/provider` 端点获取供应商列表。

```
GET http://127.0.0.1:4098/provider
```

返回类似：

```json
{
  "providers": [
    { "id": "anthropic", "name": "Anthropic", "models": ["claude-3-5-sonnet", "claude-3-opus"] },
    { "id": "openai", "name": "OpenAI", "models": ["gpt-4o", "gpt-4o-mini"] }
  ],
  "connected": ["anthropic"]
}
```

如果 `/provider` 返回的模型只有 ID 没有显示名，后端还会再调用 `/config/providers` 补充。

### 3.3 获取配置

OpenCode 有两级配置：

- `/global/config`：全局配置，包括默认模型、禁用的供应商、自定义供应商；
- `/config`：项目级配置，可以覆盖全局。

后端会合并这两级配置，返回给前端。合并规则是项目级覆盖全局级。

### 3.4 设置供应商配置

用户添加自定义供应商时，后端构造一个 provider 节点，然后 PATCH `/global/config`。

例如添加一个 OpenAI 兼容供应商：

```json
{
  "provider": {
    "my-provider": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "My Provider",
      "options": {
        "baseURL": "https://api.example.com/v1",
        "apiKey": "sk-xxx"
      },
      "models": {
        "model-1": { "name": "Model One" }
      }
    }
  }
}
```

### 3.5 发送消息时指定模型

用户在 UI 中选择模型后，Giteam 不会立即修改 OpenCode 配置。而是在发送 prompt 时，把模型作为请求 body 的一部分传给 OpenCode：

```json
{
  "parts": [...],
  "model": {
    "providerID": "anthropic",
    "modelID": "claude-3-5-sonnet"
  }
}
```

OpenCode 收到后，用这个模型处理本次请求。如果没有指定，就回退到 `/config.model`。

## 4. 遇到过什么难题？

### 4.1 难题一：供应商/模型显示名缺失

**现象**：`/provider` 端点有时只返回模型 ID，没有友好名称，前端显示成 `anthropic/claude-3-5-sonnet` 这种不直观的形式。

**根因**：OpenCode 不同版本或不同配置下，返回的字段可能不完整。

**解决**：

- 后端在获取 `/provider` 后，检查是否所有模型都有显示名；
- 如果有缺失，再调用 `/config/providers` 补充；
- 最后合并成完整的供应商目录返回给前端。

### 4.2 难题二：模型选择优先级复杂

**现象**：用户可能通过多种方式选择模型：composer 下拉框、provider manager、每个会话单独选择。最终发送时不知道用哪个。

**根因**：Giteam 前端有好几个模型选择入口，各自持久化在不同地方。

**解决**：

- 后端不关心优先级，只负责把前端最终决定的模型传过去；
- 前端维护一套优先级：会话级 > 草稿 > 配置文件 > 最近使用 > 首个可用模型；
- 发送前再读一次服务器当前模型，如果本地和服务器不一致，以本地为准并打日志。

### 4.3 难题三：自定义供应商格式多样

**现象**：Azure、AWS Bedrock、OpenAI 兼容等供应商需要的字段各不相同，有的要 `region`，有的要 `resourceName`，有的要 `endpoint`。

**根因**：各家云厂商的 API 形态差异很大。

**解决**：

- 后端 `set_opencode_provider_config` 接收很多可选字段；
- 根据供应商 ID 和传入字段，构造不同的 provider 节点；
- 前端用 provider preset 提示用户该填什么字段。

### 4.4 难题四：API Key 不能直接显示

**现象**：前端设置面板需要显示已配置的 API Key，但又不能真的明文展示。

**根因**：安全性和可用性的矛盾。

**解决**：

- Giteam 自己不存储 Key；
- 从 OpenCode 读取配置时，OpenCode 可能返回_masked_或不返回完整 Key；
- 前端只显示“已设置”状态，用户修改时重新输入。

## 5. 数据流总结

```
用户打开 provider manager
  ↓
前端 invoke get_opencode_server_provider_state
  ↓
后端调用 OpenCode GET /provider
  ↓
如果需要，再调用 /config/providers 补充显示名
  ↓
合并全局配置 /global/config 和项目配置 /config
  ↓
返回供应商列表、已连接供应商、模型列表给前端

用户发送消息
  ↓
前端根据优先级 resolve 出最终模型
  ↓
POST /session/{id}/prompt_async
  ↓
body 里带 { providerID, modelID }
  ↓
OpenCode 用指定模型处理请求
```

## 6. 面试可以怎么讲

> Giteam 的模型供应商功能完全依赖本地 OpenCode。后端不维护供应商列表，也不存 API Key。当用户打开模型选择器时，后端调用 OpenCode 的 `/provider` 端点获取供应商和模型，如果模型只有 ID 没有显示名，还会再调 `/config/providers` 补充。
>
> 配置层面，OpenCode 有 `/global/config` 和 `/config` 两级，后端会把它们合并后返回给前端。用户添加自定义供应商时，后端构造 provider 节点 PATCH 到 `/global/config`。
>
> 发送消息时，Giteam 不会提前改 OpenCode 的默认模型，而是把 `{ providerID, modelID }` 直接放在 prompt body 里。这样每个请求都可以独立指定模型，更灵活。我们曾经遇到模型显示名缺失的问题，后来做了补充拉取和合并逻辑。
