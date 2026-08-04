use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
    process::Command,
};
use tauri::{AppHandle, Manager, Theme, Window};

const ATTACHMENT_SAMPLE_BYTES: usize = 4096;

/// Windows GUI 进程拉起 console 子系统子进程时，必须带 CREATE_NO_WINDOW，
/// 否则每次 spawn 都会闪一个 cmd/PowerShell 窗口（通知、打开链接等路径都会踩）。
#[cfg(windows)]
fn hide_console_window(cmd: &mut Command) {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    cmd.creation_flags(CREATE_NO_WINDOW);
}

#[cfg(not(windows))]
fn hide_console_window(_cmd: &mut Command) {}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UiAgentAttachment {
    pub id: String,
    pub kind: String,
    pub filename: String,
    pub mime: String,
    pub data_url: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_path: Option<String>,
}

/// 兼容旧前端类型名。
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UiAttachmentPreview {
    pub original: String,
    pub modified: String,
    pub preview_supported: bool,
    pub preview_reason: Option<String>,
    pub preview_kind: Option<String>,
    pub mime: Option<String>,
    pub data_base64: Option<String>,
}

fn attachment_ext(path: &Path) -> String {
    path.extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .trim()
        .to_ascii_lowercase()
}

fn image_mime_from_ext(ext: &str) -> Option<&'static str> {
    match ext {
        "gif" => Some("image/gif"),
        "jpeg" | "jpg" => Some("image/jpeg"),
        "png" => Some("image/png"),
        "webp" => Some("image/webp"),
        _ => None,
    }
}

fn file_mime_from_ext(ext: &str) -> Option<&'static str> {
    match ext {
        "doc" => Some("application/msword"),
        "docx" => Some("application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
        "md" | "markdown" => Some("text/markdown"),
        "mdx" => Some("text/mdx"),
        "pdf" => Some("application/pdf"),
        "ppt" => Some("application/vnd.ms-powerpoint"),
        "pptx" => Some("application/vnd.openxmlformats-officedocument.presentationml.presentation"),
        "xls" => Some("application/vnd.ms-excel"),
        "xlsx" => Some("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
        _ => None,
    }
}

#[cfg(target_os = "macos")]
fn extract_office_text(path: &Path) -> Option<String> {
    let ext = attachment_ext(path);
    if ext != "doc" && ext != "docx" {
        return None;
    }
    let output = Command::new("textutil")
        .args(["-convert", "txt", "-stdout"])
        .arg(path)
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if text.is_empty() {
        return None;
    }
    Some(text)
}

#[cfg(not(target_os = "macos"))]
fn extract_office_text(_path: &Path) -> Option<String> {
    None
}

fn looks_like_text_bytes(bytes: &[u8]) -> bool {
    if bytes.is_empty() {
        return true;
    }
    let mut control_count = 0usize;
    for byte in bytes {
        if *byte == 0 {
            return false;
        }
        if *byte < 9 || (*byte > 13 && *byte < 32) {
            control_count += 1;
        }
    }
    control_count * 10 <= bytes.len() * 3
}

fn detect_unsupported_preview_reason(bytes: &[u8]) -> Option<&'static str> {
    let sample = &bytes[..bytes.len().min(ATTACHMENT_SAMPLE_BYTES)];
    if sample.is_empty() {
        return None;
    }
    if std::str::from_utf8(sample).is_err() {
        return Some("该文件包含不可解析内容，暂不支持文本预览。");
    }
    let control_bytes = sample
        .iter()
        .filter(|byte| matches!(**byte, 0x01..=0x08 | 0x0B | 0x0C | 0x0E..=0x1F | 0x7F))
        .count();
    if control_bytes * 100 / sample.len().max(1) >= 8 {
        return Some("该文件可能是二进制文件，暂不支持文本预览。");
    }
    None
}

fn decode_preview_text(bytes: Vec<u8>) -> Result<String, &'static str> {
    if let Some(reason) = detect_unsupported_preview_reason(&bytes) {
        return Err(reason);
    }
    String::from_utf8(bytes).map_err(|_| "该文件包含不可解析内容，暂不支持文本预览。")
}

fn guess_attachment_mime(path: &Path, bytes: &[u8]) -> Option<String> {
    let ext = attachment_ext(path);
    if let Some(image_mime) = image_mime_from_ext(&ext) {
        return Some(image_mime.to_string());
    }
    if let Some(file_mime) = file_mime_from_ext(&ext) {
        return Some(file_mime.to_string());
    }
    let sample = &bytes[..bytes.len().min(ATTACHMENT_SAMPLE_BYTES)];
    if looks_like_text_bytes(sample) {
        return Some("text/plain".to_string());
    }
    None
}

fn attachment_from_path(path: &Path) -> Result<Option<UiAgentAttachment>, String> {
    if !path.is_file() {
        return Ok(None);
    }
    let filename = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .trim()
        .to_string();
    if filename.is_empty() {
        return Ok(None);
    }
    let bytes = fs::read(path).map_err(|e| format!("failed to read attachment: {e}"))?;
    let Some(source_mime) = guess_attachment_mime(path, &bytes) else {
        return Ok(None);
    };
    let ext = attachment_ext(path);
    let converted_text = if ext == "doc" || ext == "docx" {
        extract_office_text(path)
    } else {
        None
    };
    let (mime, data_url) = if let Some(text) = converted_text {
        (
            "text/plain".to_string(),
            format!(
                "data:text/plain;base64,{}",
                BASE64_STANDARD.encode(text.as_bytes())
            ),
        )
    } else {
        (
            source_mime.clone(),
            format!(
                "data:{source_mime};base64,{}",
                BASE64_STANDARD.encode(&bytes)
            ),
        )
    };
    let kind = if mime.starts_with("image/") {
        "image"
    } else {
        "file"
    };
    Ok(Some(UiAgentAttachment {
        id: format!("{kind}-{}", fastrand::u64(..)),
        kind: kind.to_string(),
        filename,
        mime,
        data_url,
        source_path: Some(path.to_string_lossy().to_string()),
    }))
}

fn attachments_from_paths(
    paths: impl IntoIterator<Item = PathBuf>,
) -> Result<Vec<UiAgentAttachment>, String> {
    let mut out = Vec::new();
    for path in paths {
        if let Some(attachment) = attachment_from_path(&path)? {
            out.push(attachment);
        }
    }
    Ok(out)
}

fn parse_theme(theme: &str) -> Result<Option<Theme>, String> {
    let normalized = theme.trim().to_ascii_lowercase();
    match normalized.as_str() {
        "dark" => Ok(Some(Theme::Dark)),
        "light" => Ok(Some(Theme::Light)),
        "system" | "auto" | "" => Ok(None),
        other => Err(format!("unsupported theme: {other}")),
    }
}

fn persist_theme(app: &AppHandle, theme: &str) {
    let _ = app;
    let Some(config_dir) = giteam_core::pi_agent::ensure_data_dir() else {
        return;
    };
    let _ = fs::write(config_dir.join("theme"), theme.trim().to_ascii_lowercase());
}

pub fn apply_saved_window_theme(app: &AppHandle) {
    giteam_core::pi_agent::migrate_legacy_tauri_data_into_canonical();
    let theme = giteam_core::pi_agent::default_data_dir()
        .and_then(|dir| fs::read_to_string(dir.join("theme")).ok())
        .and_then(|value| parse_theme(&value).ok())
        .unwrap_or(Some(Theme::Dark));

    if let Some(window) = app.get_webview_window("main") {
        let _ = window.set_theme(theme);
    }
}

#[tauri::command]
pub fn set_window_theme(app: AppHandle, window: Window, theme: &str) -> Result<(), String> {
    let value = parse_theme(theme)?;
    window
        .set_theme(value)
        .map_err(|e| format!("failed to set window theme: {e}"))?;
    persist_theme(&app, theme);
    Ok(())
}

#[tauri::command]
pub fn open_external_url(url: &str) -> Result<(), String> {
    let trimmed = url.trim();
    if !(trimmed.starts_with("https://") || trimmed.starts_with("http://")) {
        return Err("only http(s) URLs are supported".to_string());
    }
    #[cfg(target_os = "macos")]
    let mut cmd = {
        let mut c = Command::new("open");
        c.arg(trimmed);
        c
    };
    #[cfg(target_os = "windows")]
    let mut cmd = {
        let mut c = Command::new("cmd");
        c.args(["/C", "start", "", trimmed]);
        hide_console_window(&mut c);
        c
    };
    #[cfg(all(unix, not(target_os = "macos")))]
    let mut cmd = {
        let mut c = Command::new("xdg-open");
        c.arg(trimmed);
        c
    };
    cmd.spawn()
        .map(|_| ())
        .map_err(|e| format!("failed to open URL: {e}"))
}

#[tauri::command]
pub fn pick_agent_attachments() -> Result<Vec<UiAgentAttachment>, String> {
    let picked = rfd::FileDialog::new()
        .set_title("选择附件")
        .pick_files()
        .unwrap_or_default();
    attachments_from_paths(picked)
}

#[tauri::command]
pub fn read_agent_attachments_from_paths(
    paths: Vec<String>,
) -> Result<Vec<UiAgentAttachment>, String> {
    let normalized = paths
        .into_iter()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .collect::<Vec<_>>();
    attachments_from_paths(normalized)
}

#[cfg(target_os = "macos")]
fn macos_clipboard_file_paths() -> Vec<String> {
    let output = Command::new("osascript")
        .args([
            "-e",
            "try",
            "-e",
            "set theFile to the clipboard as «class furl»",
            "-e",
            "POSIX path of theFile",
            "-e",
            "on error",
            "-e",
            "return \"\"",
            "-e",
            "end try",
        ])
        .output();
    let Ok(output) = output else {
        return Vec::new();
    };
    if !output.status.success() {
        return Vec::new();
    }
    String::from_utf8_lossy(&output.stdout)
        .lines()
        .map(|line| line.trim().to_string())
        .filter(|line| line.starts_with('/'))
        .collect()
}

#[cfg(not(target_os = "macos"))]
fn macos_clipboard_file_paths() -> Vec<String> {
    Vec::new()
}

#[tauri::command]
pub fn read_clipboard_file_paths() -> Result<Vec<String>, String> {
    Ok(macos_clipboard_file_paths())
}

#[cfg(target_os = "macos")]
fn macos_clipboard_image_path() -> Option<PathBuf> {
    let target = std::env::temp_dir().join(format!("giteam-clipboard-{}.png", fastrand::u64(..)));
    let target_text = target
        .to_string_lossy()
        .replace('\\', "\\\\")
        .replace('"', "\\\"");
    let script = format!(
        r#"
use framework "AppKit"
use framework "Foundation"
set pb to current application's NSPasteboard's generalPasteboard()
set imageData to pb's dataForType:(current application's NSPasteboardTypePNG)
if imageData is missing value then
  set imageValue to current application's NSImage's alloc()'s initWithPasteboard:pb
  if imageValue is missing value then return ""
  set tiffData to imageValue's TIFFRepresentation()
  if tiffData is missing value then return ""
  set bitmapValue to current application's NSBitmapImageRep's imageRepWithData:tiffData
  if bitmapValue is missing value then return ""
  set imageData to bitmapValue's representationUsingType:4 |properties|:(current application's NSDictionary's dictionary())
end if
if imageData is missing value then return ""
set outPath to "{target_text}"
set didWrite to imageData's writeToFile:outPath atomically:true
if didWrite as boolean then return outPath
return ""
"#
    );
    let output = Command::new("osascript")
        .arg("-e")
        .arg(script)
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if path.is_empty() {
        return None;
    }
    Some(PathBuf::from(path))
}

#[cfg(not(target_os = "macos"))]
fn macos_clipboard_image_path() -> Option<PathBuf> {
    None
}

#[tauri::command]
pub fn read_clipboard_image_attachment() -> Result<Vec<UiAgentAttachment>, String> {
    let Some(path) = macos_clipboard_image_path() else {
        return Ok(Vec::new());
    };
    // 保留临时文件：prompt 侧用 sourcePath 读盘，避免只靠巨大 dataUrl 走 IPC。
    attachments_from_paths([path])
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StageAgentPromptImageInput {
    pub mime: Option<String>,
    pub data_base64: Option<String>,
    pub path: Option<String>,
    pub filename: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StagedAgentPromptImage {
    pub mime_type: String,
    pub path: String,
    /// 相对仓库根的路径，供无视觉模型用 read 工具（Pi 禁止读 cwd 外路径）。
    pub relative_path: String,
}

fn prompt_attachment_dir(repo_path: &str) -> Result<PathBuf, String> {
    let root = PathBuf::from(repo_path.trim());
    if root.as_os_str().is_empty() {
        return Err("repoPath is required to stage prompt images".to_string());
    }
    giteam_core::pi_agent::ensure_workspace_giteam_gitignore(&root);
    let dir = root.join(".giteam").join("prompt-attachments");
    fs::create_dir_all(&dir).map_err(|error| format!("failed to create attachment dir: {error}"))?;
    let ignore = dir.join(".gitignore");
    if !ignore.exists() {
        let _ = fs::write(ignore, "*\n!.gitignore\n");
    }
    Ok(dir)
}

fn relative_to_repo(repo_path: &str, absolute: &Path) -> String {
    let root = PathBuf::from(repo_path.trim());
    absolute
        .strip_prefix(&root)
        .map(|value| value.to_string_lossy().replace('\\', "/"))
        .unwrap_or_else(|_| absolute.to_string_lossy().replace('\\', "/"))
}

/// 将图片落到仓库 `.giteam/prompt-attachments/`，供 multimodal / read 工具使用。
#[tauri::command]
pub fn stage_agent_prompt_images(
    repo_path: String,
    images: Vec<StageAgentPromptImageInput>,
) -> Result<Vec<StagedAgentPromptImage>, String> {
    let dir = prompt_attachment_dir(&repo_path)?;
    let mut out = Vec::new();
    for (index, image) in images.into_iter().enumerate() {
        let mime = image
            .mime
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or("image/png")
            .to_string();
        let ext = match mime.as_str() {
            "image/jpeg" => "jpg",
            "image/gif" => "gif",
            "image/webp" => "webp",
            _ => "png",
        };
        let stem = image
            .filename
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or("attachment");
        let safe_stem = stem
            .chars()
            .map(|ch| {
                if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' {
                    ch
                } else {
                    '_'
                }
            })
            .collect::<String>();
        let target = dir.join(format!(
            "{}-{}-{}.{}",
            safe_stem,
            std::process::id(),
            fastrand::u64(..),
            ext
        ));

        if let Some(path) = image
            .path
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            let source = PathBuf::from(path);
            if !source.is_file() {
                return Err(format!("staged image path not found: {path}"));
            }
            // 已在仓库内可直接用；否则复制进附件目录（/tmp、剪贴板临时文件都不在 cwd）。
            let final_path = if source.starts_with(PathBuf::from(repo_path.trim())) {
                source
            } else {
                fs::copy(&source, &target)
                    .map_err(|error| format!("failed to copy staged image: {error}"))?;
                target.clone()
            };
            out.push(StagedAgentPromptImage {
                mime_type: mime,
                relative_path: relative_to_repo(&repo_path, &final_path),
                path: final_path.to_string_lossy().to_string(),
            });
            continue;
        }

        let raw = image
            .data_base64
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .ok_or_else(|| format!("staged image #{index} missing dataBase64 or path"))?;
        let bytes = BASE64_STANDARD
            .decode(raw)
            .map_err(|error| format!("invalid image base64: {error}"))?;
        if bytes.is_empty() {
            return Err(format!("staged image #{index} is empty"));
        }
        fs::write(&target, bytes).map_err(|error| format!("failed to stage image: {error}"))?;
        out.push(StagedAgentPromptImage {
            mime_type: mime,
            relative_path: relative_to_repo(&repo_path, &target),
            path: target.to_string_lossy().to_string(),
        });
    }
    Ok(out)
}

#[tauri::command]
pub fn read_local_attachment_preview(path: &str) -> Result<UiAttachmentPreview, String> {
    let normalized = path.trim();
    if normalized.is_empty() {
        return Err("path is empty".to_string());
    }
    let target = PathBuf::from(normalized);
    if !target.is_file() {
        return Err("attachment file not found".to_string());
    }
    let ext = attachment_ext(&target);
    let bytes = fs::read(&target).map_err(|e| format!("failed to read attachment preview: {e}"))?;
    let mime = guess_attachment_mime(&target, &bytes);
    let data_base64 = Some(BASE64_STANDARD.encode(&bytes));
    if matches!(
        ext.as_str(),
        "pdf" | "png" | "jpg" | "jpeg" | "gif" | "webp" | "csv" | "docx" | "xlsx" | "xls"
    ) {
        let preview_kind = match ext.as_str() {
            "docx" => "docx",
            "xlsx" | "xls" | "csv" => "spreadsheet",
            "pdf" => "pdf",
            "png" | "jpg" | "jpeg" | "gif" | "webp" => "image",
            _ => "document",
        };
        return Ok(UiAttachmentPreview {
            original: String::new(),
            modified: extract_office_text(&target).unwrap_or_default(),
            preview_supported: true,
            preview_reason: None,
            preview_kind: Some(preview_kind.to_string()),
            mime,
            data_base64,
        });
    }
    match decode_preview_text(bytes) {
        Ok(text) => Ok(UiAttachmentPreview {
            original: String::new(),
            modified: text,
            preview_supported: true,
            preview_reason: None,
            preview_kind: Some(if matches!(ext.as_str(), "md" | "markdown" | "mdx") {
                "markdown".to_string()
            } else {
                "text".to_string()
            }),
            mime,
            data_base64: None,
        }),
        Err(reason) => Ok(UiAttachmentPreview {
            original: String::new(),
            modified: String::new(),
            preview_supported: false,
            preview_reason: Some(reason.to_string()),
            preview_kind: None,
            mime,
            data_base64,
        }),
    }
}

#[tauri::command]
pub fn open_local_path(path: String) -> Result<(), String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err("path is empty".to_string());
    }
    let target = PathBuf::from(trimmed);
    if !target.exists() {
        return Err("path does not exist".to_string());
    }
    #[cfg(target_os = "macos")]
    let mut command = {
        let mut cmd = Command::new("open");
        cmd.arg(&target);
        cmd
    };
    #[cfg(target_os = "windows")]
    let mut command = {
        let mut cmd = Command::new("explorer");
        cmd.arg(&target);
        hide_console_window(&mut cmd);
        cmd
    };
    #[cfg(all(not(target_os = "macos"), not(target_os = "windows")))]
    let mut command = {
        let mut cmd = Command::new("xdg-open");
        cmd.arg(&target);
        cmd
    };
    command
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("failed to open path: {e}"))
}

fn escape_osascript_text(value: &str) -> String {
    value.replace('\\', "\\\\").replace('"', "\\\"")
}

#[tauri::command]
pub fn send_desktop_notification(title: &str, body: &str) -> Result<(), String> {
    let safe_title = title.trim();
    let safe_body = body.trim();
    if safe_title.is_empty() && safe_body.is_empty() {
        return Ok(());
    }

    #[cfg(target_os = "macos")]
    let mut cmd = {
        let script = format!(
            "display notification \"{}\" with title \"{}\"",
            escape_osascript_text(safe_body),
            escape_osascript_text(if safe_title.is_empty() {
                "Giteam"
            } else {
                safe_title
            })
        );
        let mut c = Command::new("osascript");
        c.args(["-e", &script]);
        c
    };
    #[cfg(target_os = "windows")]
    let mut cmd = {
        let script = format!(
            "[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] > $null; $template = [Windows.UI.Notifications.ToastTemplateType]::ToastText02; $xml = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent($template); $texts = $xml.GetElementsByTagName('text'); $texts.Item(0).AppendChild($xml.CreateTextNode('{}')) > $null; $texts.Item(1).AppendChild($xml.CreateTextNode('{}')) > $null; $toast = [Windows.UI.Notifications.ToastNotification]::new($xml); [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('Giteam').Show($toast)",
            safe_title.replace('"', "'"),
            safe_body.replace('"', "'")
        );
        let mut c = Command::new("powershell");
        // -WindowStyle Hidden  alone is not enough for GUI hosts; CREATE_NO_WINDOW
        // is what stops the console flash when Agent 回复触发系统通知。
        c.args([
            "-NoProfile",
            "-NonInteractive",
            "-WindowStyle",
            "Hidden",
            "-Command",
            &script,
        ]);
        hide_console_window(&mut c);
        c
    };
    #[cfg(all(unix, not(target_os = "macos")))]
    let mut cmd = {
        let mut c = Command::new("notify-send");
        c.arg(if safe_title.is_empty() {
            "Giteam"
        } else {
            safe_title
        })
        .arg(safe_body);
        c
    };

    cmd.stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null());
    cmd.spawn()
        .map(|_| ())
        .map_err(|e| format!("failed to send notification: {e}"))
}
