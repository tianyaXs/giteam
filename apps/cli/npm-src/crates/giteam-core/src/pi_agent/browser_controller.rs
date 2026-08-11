//! agent 驱动内置浏览器的抽象层。
//!
//! `giteam-core` 不依赖 Tauri，无法直接操作 src-tauri 的 webview；故定义
//! `BrowserController` trait，由 desktop 端实现（操作子 webview + 注入 JS +
//! 事件回传），经 `PiSessionConfig` 穿层注入 `GiteamToolFactory`。CLI/control
//! 无内置浏览器，传 `None` → `browser_use` 工具返回「仅桌面端可用」。

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use std::sync::Arc;

/// agent 对内置浏览器的操作请求。
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "action", rename_all = "snake_case")]
pub enum BrowserAction {
    /// 导航到 URL（SSRF 防护在工具层完成）。
    Navigate { url: String },
    /// 点击匹配选择器的元素。
    Click { selector: String },
    /// 在匹配选择器的输入框键入文本。
    Type { selector: String, text: String },
    /// 读取元素（或整页）的可见文本。
    ReadDom { selector: Option<String> },
    /// 执行只读 JS 表达式并返回序列化结果（仅用于检查，禁副作用）。
    EvalRead { js: String },
    /// 截取当前可视区为图片。
    Screenshot,
}

/// 操作结果：文本/截图二选一（或错误）。
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct BrowserActionResult {
    pub ok: bool,
    /// 读到的文本 / DOM / eval 结果。
    pub text: Option<String>,
    /// 截图 dataURL（P2c）。
    pub image: Option<String>,
    pub error: Option<String>,
}

impl BrowserActionResult {
    #[must_use]
    pub fn ok_text(text: impl Into<String>) -> Self {
        Self {
            ok: true,
            text: Some(text.into()),
            image: None,
            error: None,
        }
    }

    #[must_use]
    pub fn err(message: impl Into<String>) -> Self {
        Self {
            ok: false,
            text: None,
            image: None,
            error: Some(message.into()),
        }
    }
}

/// 由 desktop 实现：把 `BrowserAction` 落到内置浏览器子 webview。
#[async_trait]
pub trait BrowserController: Send + Sync {
    /// 执行操作并返回结果。实现负责 navigate（webview.navigate）/ 注入 JS（eval +
    /// requestId 配对经 `giteam://browser-event` 回传）/ 截图（html2canvas）。
    async fn execute(&self, action: BrowserAction) -> BrowserActionResult;
}

/// 工具持有的共享引用；`None` 表示当前运行时无内置浏览器（CLI/control）。
pub type SharedBrowserController = Option<Arc<dyn BrowserController>>;
