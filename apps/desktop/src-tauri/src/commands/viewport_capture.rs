//! 主窗口 WebView 视口截帧（内容保护折射底板）。
//!
//! 根因：DOM→SVG foreignObject 是布局重绘，不是帧缓冲；Virtuoso 只挂载可视行，
//! 用 scrollTop/margin 启发式无法还原「眼睛停住的那一屏」。
//! 正确做法是让 WebView 自己交出已合成的可视像素：
//! - macOS：`WKWebView.takeSnapshotWithConfiguration`
//! - 其他平台：暂未实现（前端降级为纯遮罩，不假装折射）

use base64::Engine;
use tauri::{AppHandle, Manager};

const SNAPSHOT_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(3);

/// 抓主窗口 WebView 当前可视区，返回 `data:image/png;base64,...`。
#[tauri::command]
pub async fn capture_main_viewport(app: AppHandle) -> Result<String, String> {
    #[cfg(target_os = "macos")]
    {
        capture_macos_viewport(&app).await
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = app;
        Err("viewport snapshot is only implemented on macOS".into())
    }
}

#[cfg(target_os = "macos")]
async fn capture_macos_viewport(app: &AppHandle) -> Result<String, String> {
    use block2::RcBlock;
    use objc2_app_kit::NSImage;
    use objc2_foundation::NSError;
    use objc2_web_kit::WKWebView;
    use std::sync::mpsc;

    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "main window not found".to_string())?;

    let (tx, rx) = mpsc::channel::<Result<Vec<u8>, String>>();

    window
        .with_webview(move |webview| {
            // SAFETY: macOS 上 inner() 即本窗口的 WKWebView；with_webview 在主线程执行。
            let wk: &WKWebView = unsafe { &*webview.inner().cast::<WKWebView>() };
            let handler = RcBlock::new(move |image: *mut NSImage, error: *mut NSError| {
                let _ = tx.send(encode_nsimage_png(image, error));
            });
            unsafe {
                wk.takeSnapshotWithConfiguration_completionHandler(None, &handler);
            }
        })
        .map_err(|e| format!("with_webview failed: {e}"))?;

    let png = tokio::task::spawn_blocking(move || {
        rx.recv_timeout(SNAPSHOT_TIMEOUT)
            .map_err(|_| "webview snapshot timed out".to_string())?
    })
    .await
    .map_err(|e| format!("snapshot join failed: {e}"))??;

    if png.is_empty() {
        return Err("webview snapshot returned empty png".into());
    }

    Ok(format!(
        "data:image/png;base64,{}",
        base64::engine::general_purpose::STANDARD.encode(png)
    ))
}

#[cfg(target_os = "macos")]
fn encode_nsimage_png(
    image: *mut objc2_app_kit::NSImage,
    error: *mut objc2_foundation::NSError,
) -> Result<Vec<u8>, String> {
    use objc2::runtime::AnyObject;
    use objc2_app_kit::{NSBitmapImageFileType, NSBitmapImageRep};
    use objc2_foundation::{NSDictionary, NSString};

    if !error.is_null() {
        // SAFETY: WebKit 在 completion 里保证 error 在回调期间有效。
        let err = unsafe { &*error };
        return Err(err.localizedDescription().to_string());
    }
    if image.is_null() {
        return Err("WKWebView returned no snapshot image".into());
    }

    // SAFETY: 同上，image 在回调期间有效。
    let image = unsafe { &*image };
    let tiff = image
        .TIFFRepresentation()
        .ok_or_else(|| "snapshot TIFFRepresentation failed".to_string())?;
    let rep = NSBitmapImageRep::imageRepWithData(&tiff)
        .ok_or_else(|| "snapshot bitmap decode failed".to_string())?;
    let props = NSDictionary::<NSString, AnyObject>::new();
    // SAFETY: PNG + 空 properties 是 AppKit 常规用法。
    let png = unsafe {
        rep.representationUsingType_properties(NSBitmapImageFileType::PNG, props.as_ref())
    }
    .ok_or_else(|| "snapshot PNG encode failed".to_string())?;
    Ok(png.to_vec())
}
