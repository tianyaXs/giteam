use std::{fs, process::Command};
use tauri::{AppHandle, Manager, Theme, Window};

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
    let Ok(config_dir) = app.path().app_config_dir() else {
        return;
    };
    if fs::create_dir_all(&config_dir).is_err() {
        return;
    }
    let _ = fs::write(config_dir.join("theme"), theme.trim().to_ascii_lowercase());
}

pub fn apply_saved_window_theme(app: &AppHandle) {
    let theme = app
        .path()
        .app_config_dir()
        .ok()
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
        c.args(["-NoProfile", "-Command", &script]);
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

    cmd.spawn()
        .map(|_| ())
        .map_err(|e| format!("failed to send notification: {e}"))
}
