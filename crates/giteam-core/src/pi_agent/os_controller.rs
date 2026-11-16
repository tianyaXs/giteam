//! OsController：agent 操作电脑的执行层抽象（键鼠注入 / 截屏 / 引导标记）。
//!
//! 与 [`super::browser_controller::BrowserController`] 同构：trait 落在本 crate，
//! desktop 注入实现，CLI/control 为 None（computer_use / guide 工具返回
//! 「仅桌面端可用」）。controller 不可持久化，经 `PiSessionConfig` 穿层注入
//! `GiteamToolFactory`，由 `PiAgentService::set_os_controller` 全局槽跨热切/重建复用。
//!
//! 坐标协议：trait 层统一收 **0~1000 归一化坐标**（模型输出空间，对齐 UI-TARS/
//! CUA 协议）；到真实屏幕的换算（逻辑点 / 物理像素 / scale_factor / 显示器原点）
//! 全部封装在实现侧。两端规则不同，不可共享换算常量（见
//! docs/computer-use-overlay-research.md §2）：macOS enigo 走 CGEvent 全局逻辑点
//! （xcap 截图像素 ÷ scale_factor = 逻辑点），Windows enigo 要物理像素。
//!
//! 反例（UI-TARS#1964）：坐标判 0 必须判 NaN/越界，不能当 falsy 丢弃——屏幕
//! 顶边/左边的 0 是合法坐标。

use std::sync::Arc;

use async_trait::async_trait;

/// 单次动作结果：text 摘要（可选），image 为 dataURL 截图（仅 screenshot）。
/// 与 browser_controller::BrowserActionResult 同形。
pub struct OsActionResult {
    pub ok: bool,
    pub text: Option<String>,
    pub image: Option<String>,
    pub error: Option<String>,
}

impl OsActionResult {
    pub fn ok_text(text: impl Into<String>) -> Self {
        Self {
            ok: true,
            text: Some(text.into()),
            image: None,
            error: None,
        }
    }

    pub fn err(message: impl Into<String>) -> Self {
        Self {
            ok: false,
            text: None,
            image: None,
            error: Some(message.into()),
        }
    }
}

#[async_trait]
pub trait OsController: Send + Sync {
    /// 全屏截图（dataURL PNG）。text 附显示器逻辑尺寸/缩放信息供模型定位。
    async fn screenshot(&self) -> Result<OsActionResult, String>;

    /// 在归一化坐标 (0~1000) 点击。`button`: "left"/"right"/"middle"；
    /// `double` = 双击。
    async fn click(
        &self,
        x: f64,
        y: f64,
        button: &str,
        double: bool,
    ) -> Result<OsActionResult, String>;

    /// 移动鼠标到归一化坐标（不点击）。
    async fn move_mouse(&self, x: f64, y: f64) -> Result<OsActionResult, String>;

    /// 键入文本（Unicode 直输；不走剪贴板）。
    async fn type_text(&self, text: &str) -> Result<OsActionResult, String>;

    /// 按键/组合键，如 ["cmd","s"] / ["enter"]。最后一个键 Click，其余按
    /// Press→最后→Release 顺序处理。
    async fn key(&self, keys: &[String]) -> Result<OsActionResult, String>;

    /// 滚动（格数；正值向上/向左）。
    async fn scroll(&self, dx: i32, dy: i32) -> Result<OsActionResult, String>;

    /// 进展浮窗（覆盖层顶部 HUD）：agent 动作前推一句现在时描述（用户语言），
    /// 用户在目标应用里不用切回主窗口也能看到 agent 正在做什么。
    /// 默认 no-op（CLI/control 无覆盖层）。
    async fn notify(&self, _text: &str) {}

    /// run 终态（完成/失败/中止统一）清理覆盖层：进展浮窗消失、关可视化、
    /// 结束执行层会话。默认 no-op（CLI/control 无覆盖层）。
    async fn notify_clear(&self) {}

    /// agent-desktop CLI 通道（AX 树语义操作主引擎）：执行一条白名单命令，
    /// 返回 stdout 的 JSON envelope 原文（模型可读 ok/data/error 结构）。
    /// `stdin` 传文本载荷（set-value 的值），None 即无管道输入。
    /// 命令白名单与参数校验在实现层（fail-closed）。默认不可用（CLI/control）。
    async fn ad_command(
        &self,
        _command: &str,
        _args: &[String],
        _stdin: Option<&str>,
    ) -> Result<String, String> {
        Err("agent-desktop 仅桌面端可用".to_string())
    }
}

pub type SharedOsController = Option<Arc<dyn OsController>>;
