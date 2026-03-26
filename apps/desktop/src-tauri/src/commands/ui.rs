use tauri::{Theme, Window};

#[tauri::command]
pub fn set_window_theme(window: Window, theme: &str) -> Result<(), String> {
    let normalized = theme.trim().to_ascii_lowercase();
    let value = match normalized.as_str() {
        "dark" => Some(Theme::Dark),
        "light" => Some(Theme::Light),
        "system" | "auto" | "" => None,
        other => return Err(format!("unsupported theme: {other}")),
    };
    window
        .set_theme(value)
        .map_err(|e| format!("failed to set window theme: {e}"))
}
