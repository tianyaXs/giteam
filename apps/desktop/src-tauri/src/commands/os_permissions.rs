//! macOS 系统权限预检：agent 操作电脑（键鼠注入 / 截屏 / 输入监听）的硬前置。
//!
//! 三项权限，检测 FFI 全部零参数、零第三方依赖（签名与枚举值已对照本机 SDK 头文件
//! 核实，并经探针程序链接验证）：
//! - 辅助功能 `AXIsProcessTrusted()`（ApplicationServices）：键鼠注入前提；
//!   MacTypes Boolean（unsigned char）返回，非零即已授权。
//! - 屏幕录制 `CGPreflightScreenCaptureAccess()`（CoreGraphics）：截屏前提，C99 bool。
//! - 输入监听 `IOHIDCheckAccess(kIOHIDRequestTypeListenEvent=1)`（IOKit）：返回
//!   IOHIDAccessType 枚举（Granted=0 / Denied=1 / Unknown=2，SDK IOHIDLib.h），
//!   仅 Granted 视为已授权；全局监听用户输入（引导挡完成校验）的前提。
//!
//! TCC 语义（改动前必读）：
//! - 权限记在宿主 app 头上：`tauri dev` 下主体是终端 app（iTerm/Terminal），换终端要
//!   重新授权；正式包绑代码签名，签名变则重授权（tauri#11085 教训），发布必须固定
//!   Developer ID + bundle id（io.giteam.desktop）。
//! - 权限状态无法区分「未决定」与「明确拒绝」，统一报 granted=false（fail-closed），
//!   由前端引导去系统设置开启。
//! - 辅助功能没有实用的程序化弹窗（`AXIsProcessTrustedWithOptions` 的 prompt 需构造
//!   CFDictionary 且只在未决定态弹一次），直接跳系统设置面板。
//! - 屏幕录制 `CGRequestScreenCaptureAccess()` 触发系统弹窗；被明确拒绝后弹窗不再
//!   出现，届时走 `open_os_permission_settings`。
//! - 输入监听 `IOHIDRequestAccess()` 可程序化弹窗（10.15+，SDK IOHIDLib.h）。
//!
//! Windows 侧无系统级授权项（注入受 UIPI 运行时约束，无预检 API），全报 granted。
//! 调研与选型依据见 docs/computer-use-overlay-research.md。

use serde::Serialize;

/// 权限项。前端传字符串（snake_case），见 `parse_permission_kind`。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PermissionKind {
    Accessibility,
    ScreenRecording,
    InputMonitoring,
}

/// 解析前端传入的 kind；仅接受 snake_case，统一入口便于测试与报错。
fn parse_permission_kind(kind: &str) -> Option<PermissionKind> {
    match kind {
        "accessibility" => Some(PermissionKind::Accessibility),
        "screen_recording" => Some(PermissionKind::ScreenRecording),
        "input_monitoring" => Some(PermissionKind::InputMonitoring),
        _ => None,
    }
}

/// 三权限快照。`platform` 供前端区分「无门槛平台」与「未授权」。
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OsPermissionsReport {
    pub platform: &'static str,
    pub accessibility: bool,
    pub screen_recording: bool,
    pub input_monitoring: bool,
}

#[cfg(target_os = "macos")]
mod ffi {
    // AXIsProcessTrusted 返回 MacTypes Boolean（unsigned char），非 C99 bool，
    // 故按 u8 接、非零即已授权（声明见 SDK HIServices/AXUIElement.h）。
    #[link(name = "ApplicationServices", kind = "framework")]
    extern "C" {
        pub fn AXIsProcessTrusted() -> u8;
    }

    // 两个函数头文件均为 C99 bool，Rust bool 是官方 ABI 映射。
    #[link(name = "CoreGraphics", kind = "framework")]
    extern "C" {
        pub fn CGPreflightScreenCaptureAccess() -> bool;
        pub fn CGRequestScreenCaptureAccess() -> bool;
    }

    // 私有但长期稳定的 IOKit 符号（10.15+）：实参 1 = kIOHIDRequestTypeListenEvent；
    // 返回值 0 = kIOHIDAccessTypeGranted（SDK IOHIDLib.h:173-177）。
    #[link(name = "IOKit", kind = "framework")]
    extern "C" {
        pub fn IOHIDCheckAccess(request: u32) -> u32;
        pub fn IOHIDRequestAccess(request: u32) -> bool;
    }
}

#[cfg(target_os = "macos")]
fn platform_report() -> OsPermissionsReport {
    unsafe {
        OsPermissionsReport {
            platform: "macos",
            accessibility: ffi::AXIsProcessTrusted() != 0,
            screen_recording: ffi::CGPreflightScreenCaptureAccess(),
            input_monitoring: ffi::IOHIDCheckAccess(1) == 0,
        }
    }
}

#[cfg(not(target_os = "macos"))]
fn platform_report() -> OsPermissionsReport {
    OsPermissionsReport {
        platform: "other",
        accessibility: true,
        screen_recording: true,
        input_monitoring: true,
    }
}

/// 供 DesktopOsController 动作前预检（fail-closed）：键鼠注入需辅助功能。
#[cfg(target_os = "macos")]
pub fn accessibility_granted() -> bool {
    unsafe { ffi::AXIsProcessTrusted() != 0 }
}

/// 供 DesktopOsController 截屏前预检（fail-closed）。
#[cfg(target_os = "macos")]
pub fn screen_recording_granted() -> bool {
    unsafe { ffi::CGPreflightScreenCaptureAccess() }
}

#[cfg(not(target_os = "macos"))]
pub fn accessibility_granted() -> bool {
    true
}

#[cfg(not(target_os = "macos"))]
pub fn screen_recording_granted() -> bool {
    true
}

/// 跳系统设置对应面板。辅助功能/输入监听没有可靠程序化弹窗时的统一入口。
#[cfg(target_os = "macos")]
fn open_pane(pane: &str) -> Result<(), String> {
    std::process::Command::new("/usr/bin/open")
        .arg(format!(
            "x-apple.systempreferences:com.apple.preference.security?{pane}"
        ))
        .spawn()
        .map(|_| ())
        .map_err(|err| err.to_string())
}

/// 触发授权流程：能弹系统弹窗的弹弹窗（屏幕录制 / 输入监听），只能手动开的跳面板
/// （辅助功能）。request 弹窗可能阻塞等待用户响应，command 侧走 async 线程池。
#[cfg(target_os = "macos")]
fn trigger_request(kind: PermissionKind) -> Result<(), String> {
    match kind {
        PermissionKind::Accessibility => open_pane("Privacy_Accessibility"),
        // CGRequestScreenCaptureAccess 返回值无法区分「弹窗已显示（未决定）」与
        // 「曾被拒绝」，不据此分支；连续 false 由前端引导走 open_os_permission_settings。
        PermissionKind::ScreenRecording => {
            let _ = unsafe { ffi::CGRequestScreenCaptureAccess() };
            Ok(())
        }
        PermissionKind::InputMonitoring => {
            let _ = unsafe { ffi::IOHIDRequestAccess(1) };
            Ok(())
        }
    }
}

#[cfg(not(target_os = "macos"))]
fn trigger_request(_kind: PermissionKind) -> Result<(), String> {
    Ok(())
}

fn parse_kind_or_err(kind: &str) -> Result<PermissionKind, String> {
    parse_permission_kind(kind.trim()).ok_or_else(|| {
        format!("未知权限类型：{kind}（可选 accessibility / screen_recording / input_monitoring）")
    })
}

/// 查询三权限当前状态。微秒级 FFI 预检，可高频调用。
#[tauri::command]
pub async fn get_os_permissions() -> OsPermissionsReport {
    platform_report()
}

/// 触发对应权限的授权流程，返回触发后的状态快照供 UI 复查（弹窗是异步的，
/// 授权后需再次查询确认）。
#[tauri::command]
pub async fn request_os_permission(kind: String) -> Result<OsPermissionsReport, String> {
    let kind = parse_kind_or_err(&kind)?;
    trigger_request(kind)?;
    Ok(platform_report())
}

/// 直接打开系统设置对应面板（「打开设置」按钮入口，屏幕录制被拒后的兜底通道）。
#[tauri::command]
pub async fn open_os_permission_settings(kind: String) -> Result<(), String> {
    let kind = parse_kind_or_err(&kind)?;
    #[cfg(target_os = "macos")]
    {
        let pane = match kind {
            PermissionKind::Accessibility => "Privacy_Accessibility",
            PermissionKind::ScreenRecording => "Privacy_ScreenCapture",
            PermissionKind::InputMonitoring => "Privacy_ListenEvent",
        };
        open_pane(pane)
    }
    #[cfg(not(target_os = "macos"))]
    {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_permission_kind_accepts_snake_case_only() {
        assert_eq!(
            parse_permission_kind("accessibility"),
            Some(PermissionKind::Accessibility)
        );
        assert_eq!(
            parse_permission_kind("screen_recording"),
            Some(PermissionKind::ScreenRecording)
        );
        assert_eq!(
            parse_permission_kind("input_monitoring"),
            Some(PermissionKind::InputMonitoring)
        );
        assert_eq!(parse_permission_kind("screenRecording"), None);
        assert_eq!(parse_permission_kind("camera"), None);
        assert_eq!(parse_permission_kind("  accessibility  "), None);
    }

    #[test]
    fn parse_kind_or_err_reports_invalid_kind() {
        let err = parse_kind_or_err("camera").unwrap_err();
        assert!(err.contains("camera"));
        assert!(err.contains("accessibility"));
    }
}
