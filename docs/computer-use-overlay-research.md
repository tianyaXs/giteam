# Agent 操作电脑 + 引导模式：技术调研与实现基础评估

> 调研日期：2026-11-09。三路并行调研（Rust 组件层 / 开源 agent 架构 / Tauri 覆盖层），所有 star、版本、issue 状态均来自当日实际打开 GitHub / crates.io / docs.rs / 源码的核实结果。
>
> 目标形态：
> 1. **自动挡**：agent 截屏→视觉决策→注入键鼠操作电脑，全程可视化（虚拟光标移动动画 + 点击涟漪）；
> 2. **引导挡**：agent 在屏幕上打 spotlight 高亮 / 气泡 / 序号标记，用户跟随指引亲手操作（社区无完整实现，差异化机会）。

---

## 1. 选型结论

| 能力 | 选型 | 版本/方式 | 关键证据 |
|---|---|---|---|
| 键鼠注入 | **enigo** | 钉 git main 锁 rev，勿用 crates.io 0.6.1 | 1804★，活跃；0.6.1（2025-08-28）已 15 个月未发版，Tauri 崩溃修复 [PR#510](https://github.com/enigo-rs/enigo/pull/510)（2025-11-30 合并）只在 main；催版 issue [#538](https://github.com/enigo-rs/enigo/issues/538)。macOS 用 objc2 系 CGEvent、Windows 用 SendInput；权限检测 `has_permission(bool)` 内建；事件打标（`event_source_user_data`）防注入回环 |
| 截屏 | **xcap ≥ 0.9.x** | crates.io | 1033★，发版勤（0.9.9 = 2026-11-09）；`scale_factor()` 语义清晰；风险：macOS 后端 `CGWindowListCreateImage` 在 Sequoia 15.1+ 弹系统警告（[#160](https://github.com/nashaofu/xcap/issues/160) open），中期盯 [zed-industries/scap](https://github.com/zed-industries/scap) 的 ScreenCaptureKit 迁移 |
| macOS 元素定位 | **accessibility-sys 0.2 + 自封安全层** | 参照 agent-desktop 用法 | 高层 `accessibility` crate 自述 "spotty"；objc2 系无现成 AX 绑定；[vercel-labs/agent-desktop](https://github.com/vercel-labs/agent-desktop) 即 accessibility-sys + core-foundation + core-graphics 自写层 |
| Windows 元素定位 | **uiautomation 0.25.x** | crates.io | [leexgone/uiautomation-rs](https://github.com/leexgone/uiautomation-rs)：204★、0 open issues、发版密集；mediar-ai/terminator 生产依赖背书 |
| 光标位置 | **enigo `location()`** | 不引入新依赖 | device_query **仓库已归档**（archived: true），不选 |
| macOS 权限检测 | **tauri-plugin-macos-permissions**（或抄 extern 声明自实现） | 插件或三行 FFI | [ayangweb/tauri-plugin-macos-permissions](https://github.com/ayangweb/tauri-plugin-macos-permissions)：172★，覆盖辅助功能 / 屏幕录制 / 输入监控；`CGPreflightScreenCaptureAccess` / `AXIsProcessTrustedWithOptions` 的 extern 声明就三行 |
| 覆盖层窗口 | **Tauri 透明窗口；macOS 必须 tauri-nspanel 转 NSPanel** | 见 §3 | [keyviz](https://github.com/mulaRahul/keyviz)（9.7k★）主分支已重写为 Tauri v2 + React，即活样本 |
| 覆盖层渲染 | **单 WebView + 少量 DOM + CSS transform/opacity 动画** | 前端栈现成 | 勿每元素一个 WebView（[#13070](https://github.com/tauri-apps/tauri/issues/13070)：300MB 教训）；勿全屏 canvas/WebGL（[#15947](https://github.com/tauri-apps/tauri/issues/15947) Win10 黑块竞态） |

### 标杆项目（可借鉴分级）

| 项目 | 规模 | 借鉴价值 |
|---|---|---|
| [vercel-labs/agent-desktop](https://github.com/vercel-labs/agent-desktop) | 19,920★（9 个月），纯 Rust | **最高**：AXTree ref 级点击 + STALE_REF 失效生命周期；`cursor_overlay` Rust 完整视觉词汇表（涟漪 108/19、指针 32×40、高亮 2.5/8/5）+ HandPath 弧形颤动轨迹 + travel→hold→rest→fade 时序机；headless（不动真实鼠标）/ headed 双模式；`permissions --guide` 权限引导 |
| [mediar-ai/terminator](https://github.com/mediar-ai/terminator) | 1,667★，Rust | 生产背书 xcap + uiautomation 组合 |
| [mulaRahul/keyviz](https://github.com/mulaRahul/keyviz) | 9.7k★，Tauri v2 + React | 透明悬浮窗窗口配置、rdev 全局监听、Windows HWND_TOPMOST 重钉 |
| [bytedance/UI-TARS-desktop](https://github.com/bytedance/UI-TARS-desktop) | 39,585★，Electron（对照） | `parseBoxToScreenCoords` + factors 归一化坐标协议；ScreenMarker 的 `setContentProtection(true)`（标注不进截图）技巧；GUIAgent 循环工程细节（pause/resume、截图失败熔断、`call_user`） |
| [simular-ai/Agent-S](https://github.com/simular-ai/Agent-S) | 12,912★ | grounding 解耦（主模型出意图、定位模型出坐标） |
| [microsoft/OmniParser](https://github.com/microsoft/OmniParser) | 25,615★ | SoM 编号框提示法（重资产，仅参考） |

### 落选说明

- **inputbot**：无 macOS，出局；**mouse-rs / autogui**：停滞 3 年+；**scrap**：crates.io 0.5.0 停在 2018，rustdesk 在自己 monorepo 维护 fork；**rdev**：仅考虑做输入监听不做注入（crates.io 停在 2023-06）；**screenshots**：官方描述 "Move to XCap"；**autopilot**：备胎，API 能力不如 enigo。

---

## 2. 坐标系统一规则（第一杀手）

```
xcap 截图          = 物理像素
macOS enigo        = 逻辑点    →  像素 ÷ xcap.scale_factor()
Windows enigo      = 物理像素  →  直接用像素
```

- 两端规则**不同**，禁止共享换算常量；以 xcap `scale_factor()` 为唯一真相。enigo 自己的 `main_display()` 在 macOS 返回物理像素而坐标是逻辑点（源码含 `// TODO: Check the bounds`），不要用它换算。
- 模型输出统一走 **UI-TARS 归一化协议**：模型吐 0~1000 坐标，`parseBoxToScreenCoords` + factors 抽象做成纯函数 + 单测。
- **反例**：[UI-TARS#1964](https://github.com/bytedance/UI-TARS-desktop/issues/1964) —— `if (!clickX)` 把 0 坐标当 falsy 丢弃，屏幕顶边/左边点击全部失效。判 `null`，不判 falsy。
- DPI 三段式链路每步显式化：物理截图 → 显式 scaleFactor → 模型坐标空间 → 执行坐标空间。

---

## 3. 覆盖层实现要点

```rust
// 窗口基线（双平台）
// transparent + decorations:false + alwaysOnTop + skipTaskbar
// + shadow:false + focus:false + focusable:false + visible:false
// 运行时
// set_content_protected(true)   // 标注不进截图，模型看不见自己的标记
// set_ignore_cursor_events(true) // 全穿透，不挡用户操作
```

- **macOS 硬边界**：普通 NSWindow 在 release 打包后置顶失效（dev 有效）、盖不住全屏空间（[tauri#9556](https://github.com/tauri-apps/tauri/issues/9556)、[#5566](https://github.com/tauri-apps/tauri/issues/5566)）。治本 = [tauri-nspanel](https://github.com/ahkohd/tauri-nspanel) 转 NSPanel + `NonActivatingPanel` + `CanJoinAllSpaces | FullScreenAuxiliary`，配方见 [tauri-macos-spotlight-example](https://github.com/ahkohd/tauri-macos-spotlight-example) / EcoPaste PR#728。**直接按 NSPanel 做，不留"先普通窗口后补"的弯路。**
- **Windows**：显示后 `SetWindowPos(HWND_TOPMOST)` 重钉（keyviz）；独占全屏游戏盖不上是平台行为；Win10 穿透切换有 DWM 竞态（#15947），只在状态翻转时调用。
- **macOS `focusable:false` 不生效**（[#9065](https://github.com/tauri-apps/tauri/issues/9065) open）：退出按钮**放托盘**（giteam 已有 `build_tray`），不进覆盖层，绕开整套"光标流+命中测试+动态穿透切换"复杂度。
- **Tauri 无 Electron 式 `forward:true`**（[#6164](https://github.com/tauri-apps/tauri/issues/6164) open）：穿透后收不到任何鼠标事件，是架构前提。
- 渲染：spotlight 挖洞用 CSS `mask-image: radial-gradient` 或 SVG evenodd path + 四周半透明暗罩；动画只用 transform/opacity（与启动屏"纯 CSS 合成器动画"结论一致）；气泡文本普通 div。
- 多显示器：简化版先只铺主屏（keyviz 现状）；完整版每屏一个覆盖窗（`available_monitors()`）。

---

## 4. 定位精度：三条路线

| 路线 | 做法 | 精度 | 阶段 |
|---|---|---|---|
| A. 视觉坐标 | 截图→VLM→0-1000 归一化坐标 | ±10px 起 | P0 baseline |
| B. 无障碍树 | AXTree/UIA 输出元素 ref，按 ref 点击，界面变了返回 STALE_REF 要求重拍 | 元素级 | P2 主力（agent-desktop 路线） |
| C. grounding 解耦 | 主模型只说意图，专用定位模型出坐标（Agent-S3）；轻量版 = SoM 编号框 | 高 | 精度不够时升级 |

参考：agent-desktop 默认 **headless**（AX 注入，不动物理鼠标不抢焦点），`--headed` 才物理输入——双模式设计值得进工具设计。

---

## 5. giteam 实现基础评估

### 5.1 已具备（关键通路全部现成）

| 基础 | 位置 | 说明 |
|---|---|---|
| 工具 + controller 抽象模式 | `browser_controller.rs:65` `trait BrowserController: Send + Sync`，返回 `BrowserActionResult { text, image }` | `OsController` 完全照抄；desktop 注入 Some，CLI/control None → 降级提示（`control.rs:1739` 同款模式已存在） |
| controller 跨热切/重建复用 | `main.rs:273-278` `set_browser_controller` 全局注入 | browser_use 已踩平"热切后 controller 丢失"缺陷，OsController 直接复用该机制 |
| 审批与放行体系 | `interactions.rs:48` `InteractionRisk{Read,Write,Execute,Network}` + `for_tool` + `always_rule_key` 细粒度键 | 加 `System` 变体是纯增量；`permissions.json` 跨会话放行现成 |
| 截图→模型图片通路 | `tools/browser_use.rs:157-161` dataURL → `pi::sdk::ContentBlock::Image` | computer_use 截屏直接复用；纯文本模型自动去图降级逻辑已有（image_degraded_retry） |
| 运行时 | desktop Cargo.toml：tokio rt-multi-thread 全 features | CGEvent 注入/截屏可 spawn_blocking；control server 无 tokio 的坑已在别处治过 |
| objc2 现代生态 | desktop Cargo.toml `[target.'cfg(target_os = "macos")']` objc2 0.6.4 + app-kit/foundation | 加 `objc2-core-graphics`（CGEvent / CGPreflightScreenCaptureAccess）顺路，无版本混用 |
| 前端动画栈 | React 19 + motion 12；启动屏纯 CSS 经验 | 覆盖层动画零新技术 |
| 托盘 | `main.rs` `build_tray` | 覆盖层退出/模式开关落点 |
| 稳定 bundle id | `tauri.conf.json` `io.giteam.desktop` | TCC 授权绑定前提；release 已走 Developer ID 签名链路 |
| Tauri `unstable` feature | desktop Cargo.toml `features = ["tray-icon", "unstable"]` | 多 webview/子窗口能力已开（browser panel 已用） |
| capabilities 权限模型 | `capabilities/default.json` 按 window 粒度 | overlay 窗口加条目即可 |
| untrusted 围栏 | web 工具 `fence` | 屏幕内容防 prompt injection 直接复用 |

### 5.2 缺口清单（需新增）

| # | 缺口 | 动作 | 阻塞 P0？ |
|---|---|---|---|
| 1 | tauri 缺 `macos-private-api` feature | Cargo.toml features 加一项（macOS 透明窗口硬前置，keyviz 同款） | **是** |
| 2 | 无覆盖层窗口 | 新增 overlay 窗口（tauri.conf.json 或运行时创建）+ macOS 走 tauri-nspanel 转 NSPanel（新插件依赖） | **是** |
| 3 | Rust 侧无 enigo / xcap | giteam-core 或 desktop 加依赖；enigo 钉 git main 锁 rev | **是** |
| 4 | 无 `InteractionRisk::System` | interactions.rs 加变体 + for_tool 映射 + always_rule_key 策略（单次点击建议不持久放行，仅会话内 always） | 否 |
| 5 | 无 macOS 权限预检模块 | 三权限预检（granted/denied/suggestion 三态）+ 失败显式反馈；可抄 tauri-plugin-macos-permissions 或 agent-desktop 的纯 Rust FFI | **是**（P0 第一步） |
| 6 | Windows 侧无 windows crate 依赖 | `SetCursorPos` 负坐标旁路 + 未来 UIA 需要；按需加 | 否（P2） |
| 7 | TCC 签名一致性验证 | 确认 Developer ID Team ID 固定、升级不换签名（tauri#11085 教训：否则每次更新重授权） | 否（发布前验证） |

### 5.3 结论

**基础具备度约 70%，P0 无阻塞性架构缺口**——工具模式、审批体系、图片回传、热切复用、托盘、运行时全部现成，剩余 3 个硬前置（macos-private-api、overlay 窗口 + nspanel、enigo/xcap 依赖）和权限预检模块都是增量接线，不动现有架构。

---

## 6. 接线设计（对齐现有模式）

```
crates/giteam-core/src/pi_agent/
  tools/computer_use.rs     // 动作解析：click/double_click/right_click/move/type/key/scroll/screenshot
  tools/guide.rs            // 引导挡：guide_step {step_no, instruction, target:{x,y,w,h}}
  os_controller.rs          // trait OsController: Send + Sync（照 BrowserController）
interactions.rs             // + InteractionRisk::System；for_tool: "computer_use"|"guide" => System
                            // always_rule_key：computer_use 默认工具名粒度（会话内 always），
                            // 不做跨会话 persist 放行（OS 控制风险高于域名浏览）
```

风险分级（套 ApprovalTool）：

| 动作 | 风险 | 审批策略 |
|---|---|---|
| move / hover / screenshot | 低危 | 免审（screenshot 是读操作） |
| click / scroll / key | 中危 | 逐次审批；「总是允许」仅会话内 |
| type | 中偏高 | 逐次审批（文本可能含敏感内容） |
| drag / 组合键 | 中偏高 | 逐次审批 |

desktop 侧：`commands/os_controller.rs` 实现 OsController（enigo + xcap + 权限预检 + 事件 emit 给覆盖层窗口），`main.rs` setup 里 `set_os_controller(Some(...))`（照 browser controller 注入位置）。

覆盖层事件流：Rust controller 执行动作 → emit `overlay://pose`（目标点/相位/标签）→ overlay WebView 渲染 HandPath 动画（抄 agent-desktop 参数：弧形 5.5%、颤动 7 周期、涟漪 108/19、travel→hold→rest→fade）。

---

## 7. 分期计划

- **P0 自动挡最小闭环**：权限预检状态机 → xcap 截屏 → enigo 点击/输入 → 归一化坐标解析（factors 纯函数 + falsy-zero 单测）→ 全穿透覆盖层（虚拟光标 + 涟漪 + content_protected）→ System 风险审批接线
- **P1 引导挡**：guide_step 工具 → spotlight 挖洞 + 气泡 + 序号 → 完成校验（enigo `location()` 轮询光标入目标矩形）→ Esc/托盘退出。**社区无完整实现，无现成轮子**
- **P2 精度与覆盖**：AXTree/UIA ref 级定位（agent-desktop 路线 + STALE_REF）→ Windows `SetCursorPos` 负坐标旁路 → 多显示器（每屏一窗）→ 坐标链路显式三段化

## 8. 风险登记

| 风险 | 等级 | 缓解 |
|---|---|---|
| enigo 发版滞后（0.6.1 缺 Tauri 崩溃修复） | 高 | 钉 git main 锁 rev；盯 [#538](https://github.com/enigo-rs/enigo/issues/538) 发 0.7 后切回 |
| xcap macOS 旧 API Sequoia 警告 | 中 | 短期可用；备选 zed-scap（SCK 路线）；xcap Monitor API 层薄，替换成本低 |
| enigo Windows 负坐标显示器（[#40](https://github.com/enigo-rs/enigo/issues/40) open） | 中 | `SetCursorPos` 旁路（物理像素、支持负坐标） |
| UAC/提权窗口不可注入（UIPI，Windows 无解） | 产品约束 | 文案声明"操作管理员窗口请以管理员运行"；`SendInput` 失败静默，需超时探测反馈 |
| TCC 授权绑签名，签名变则重授权 | 中（发布期） | 固定 Developer ID + bundle id；升级包验证签名一致（tauri#11085） |
| accessibility-sys 半活跃（4 年一发版） | 低 | API 面小、sys 层自述 complete，可 fork 自维护 |
| macOS `focusable:false` 不生效 | 低 | 交互控件全放托盘/主窗口，覆盖层零交互 |
| 权限被拒静默失败（OpenAdapt 反例） | 中 | 启动三权限预检 + 每次动作前 fail-closed 显式报错 |

## 9. 参考链接汇总

- enigo：https://github.com/enigo-rs/enigo （源码 `src/macos/macos_impl.rs`、`src/win/win_impl.rs`、`Permissions.md`；issues #40/#174/#324/#510/#538）
- xcap：https://github.com/nashaofu/xcap （issues #160/#176/#194）
- accessibility：https://github.com/eiz/accessibility ｜ uiautomation：https://github.com/leexgone/uiautomation-rs
- 标杆：https://github.com/vercel-labs/agent-desktop （`crates/core/src/cursor_overlay/`、`crates/macos/src/system/permissions/`）｜ https://github.com/mediar-ai/terminator ｜ https://github.com/bytedance/UI-TARS-desktop （`apps/ui-tars/src/main/window/ScreenMarker.ts`、`packages/ui-tars/sdk/src/`）｜ https://github.com/simular-ai/Agent-S ｜ https://github.com/microsoft/OmniParser
- 覆盖层：https://github.com/mulaRahul/keyviz （`src-tauri/src/app/window.rs`）｜ https://github.com/ahkohd/tauri-nspanel ｜ https://github.com/ahkohd/tauri-macos-spotlight-example ｜ EcoPaste PR#728 ｜ tauri#9556/#5566/#9065/#6164/#2090/#13070/#15947/#11085/#14102
- 权限：https://github.com/ayangweb/tauri-plugin-macos-permissions ｜ OpenAdapt `legacy/permissions_in_macOS.md`
- 循环参考：anthropics/claude-quickstarts `computer-use-demo`（滑动图片窗口、zoom action）｜ OthersideAI/self-operating-computer（百分比坐标 + SoM）
- 追踪清单：https://github.com/wjhou/awesome-computer-use-agents
