//! Office 文档工具面：Excel / Word / PPT 读写。
//!
//! 市面 agent（Claude Code skills / ChatGPT Code Interpreter / Manus）的共识
//! 模式是「代码执行 + Python 生态」，但桌面端不能假设用户装了 Python。本模块
//! 用纯 Rust 生成器覆盖最高频的文档需求：
//!
//! - `xlsx`：rust_xlsxwriter 写 / calamine 读。
//! - `docx`：docx-rs 写 / zip+quick-xml 提取文本。
//! - `pptx`：手写最小 OOXML 生成（zip），quick-xml 读。
//!
//! 实时进度：pi `Tool::execute` 的 `on_update` 原生支持流式增量——经
//! `AgentEvent::ToolExecutionUpdate` 翻译为 `tool.progress` 事件直达前端工具卡。
//! 本模块按阶段发 `{ stage, percent, message, path }`（details），
//! 写类工具每完成一个单元（工作表/段落块/幻灯片）落盘检查点，前端实时预览。

mod docx;
mod pptx;
mod xlsx;
mod versions;

pub use docx::{EditDocxTool, ReadDocxTool, WriteDocxTool};
pub use pptx::{EditPptxTool, ReadPptxTool, WritePptxTool};
pub use versions::{previous_version_count, restore_previous_version};
pub(crate) use versions::push_version;
pub use xlsx::{EditXlsxTool, ReadXlsxTool, WriteXlsxTool};

use pi::sdk::{ContentBlock, TextContent, ToolOutput, ToolUpdate};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
/// XML 转义（写 OOXML 文本用）。
pub(crate) fn xml_escape(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for ch in text.chars() {
        match ch {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&apos;"),
            _ => out.push(ch),
        }
    }
    out
}

/// Excel 列字母 → 1 基列号（A→1, Z→26, AA→27）。
pub(crate) fn column_number(letters: &str) -> Option<usize> {
    let mut number = 0usize;
    for ch in letters.chars() {
        let upper = ch.to_ascii_uppercase();
        if !upper.is_ascii_uppercase() {
            return None;
        }
        number = number * 26 + usize::from(upper as u8 - b'A') + 1;
    }
    Some(number)
}

/// "B3" → (列号 2, 行号 3)；非法返回 None。
pub(crate) fn parse_cell_ref(cell: &str) -> Option<(usize, usize)> {
    let split = cell
        .char_indices()
        .find(|(_, ch)| ch.is_ascii_digit())
        .map(|(idx, _)| idx)?;
    let (letters, row) = cell.split_at(split);
    Some((column_number(letters)?, row.parse::<usize>().ok()?))
}

/// 解包 zip → 仅替换指定条目（其余逐字节原样复制，保样式/公式/编号无损）→ 重打包字节。
pub(crate) fn rebuild_zip_with_replacements(
    source: &Path,
    replacements: &[(String, Vec<u8>)],
    additions: &[(String, Vec<u8>)],
) -> std::result::Result<Vec<u8>, String> {
    use std::io::Read;
    let file = std::fs::File::open(source).map_err(|e| format!("打开文件失败：{e}"))?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| format!("读取 zip 失败：{e}"))?;
    let mut buffer = std::io::Cursor::new(Vec::new());
    {
        let mut writer = zip::ZipWriter::new(&mut buffer);
        let options = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated);
        use std::io::Write as _;
        for index in 0..archive.len() {
            let mut entry = archive
                .by_index(index)
                .map_err(|e| format!("读取 zip 条目失败：{e}"))?;
            let name = match entry.name() {
                Ok(cow) => cow.into_owned(),
                Err(_) => String::new(),
            };
            if entry.is_dir() {
                writer
                    .add_directory(&name, options)
                    .map_err(|e| format!("写入 zip 目录 {name} 失败：{e}"))?;
                continue;
            }
            let mut bytes = Vec::with_capacity(entry.size() as usize);
            entry
                .read_to_end(&mut bytes)
                .map_err(|e| format!("读取 zip 条目 {name} 失败：{e}"))?;
            let content = replacements
                .iter()
                .find(|(target, _)| *target == name)
                .map(|(_, content)| content.as_slice())
                .unwrap_or(&bytes);
            writer
                .start_file(&name, options)
                .map_err(|e| format!("写入 zip 条目 {name} 失败：{e}"))?;
            writer
                .write_all(content)
                .map_err(|e| format!("写入 zip 条目 {name} 失败：{e}"))?;
        }
        for (name, content) in additions {
            writer
                .start_file(name, options)
                .map_err(|e| format!("写入 zip 条目 {name} 失败：{e}"))?;
            writer
                .write_all(content)
                .map_err(|e| format!("写入 zip 条目 {name} 失败：{e}"))?;
        }
        writer
            .finish()
            .map_err(|e| format!("完成 zip 写入失败：{e}"))?;
    }
    Ok(buffer.into_inner())
}

/// XML 文本反转义（命名实体 + 十进制/十六进制字符引用）。
pub(crate) fn xml_unescape(text: &str) -> String {
    if !text.contains('&') {
        return text.to_string();
    }
    let mut out = String::with_capacity(text.len());
    let bytes = text.as_bytes();
    let mut i = 0usize;
    while i < text.len() {
        if bytes[i] == b'&' {
            if let Some(semi_rel) = text[i..].find(';') {
                let entity = &text[i + 1..i + semi_rel];
                let numeric = entity
                    .strip_prefix("#x")
                    .or_else(|| entity.strip_prefix("#X"))
                    .and_then(|hex| u32::from_str_radix(hex, 16).ok())
                    .or_else(|| entity.strip_prefix('#').and_then(|dec| dec.parse::<u32>().ok()))
                    .and_then(char::from_u32)
                    .map(|ch| ch.to_string());
                let replacement: Option<&str> = match entity {
                    "amp" => Some("&"),
                    "lt" => Some("<"),
                    "gt" => Some(">"),
                    "quot" => Some("\""),
                    "apos" => Some("'"),
                    _ => None,
                };
                let replacement = replacement
                    .map(|value| value.to_string())
                    .or(numeric);
                if let Some(rep) = replacement {
                    out.push_str(&rep);
                    i += semi_rel + 1;
                    continue;
                }
            }
            out.push('&');
            i += 1;
        } else {
            let ch_len = text[i..].chars().next().map(|c| c.len_utf8()).unwrap_or(1);
            out.push_str(&text[i..i + ch_len]);
            i += ch_len;
        }
    }
    out
}

fn text_output(text: String) -> ToolOutput {
    ToolOutput {
        content: vec![ContentBlock::Text(TextContent::new(text))],
        details: None,
        is_error: false,
    }
}

fn error_output(text: String) -> ToolOutput {
    ToolOutput {
        content: vec![ContentBlock::Text(TextContent::new(text))],
        details: None,
        is_error: true,
    }
}



/// 阶段化进度：`on_update` 为 None 时静默跳过（部分运行时不传回调）。
/// `path` 随 details 下发——前端靠它在右侧面板打开/刷新文件实时预览；
/// `sheet`/`range` 驱动预览跟随正在操作的工作表并高亮选区（L2 人性化）。
fn emit_progress(
    on_update: &Option<Box<dyn Fn(ToolUpdate) + Send + Sync>>,
    stage: &str,
    percent: f32,
    message: String,
    path: &Path,
    focus: Option<(String, Option<String>)>,
    changes: Option<&[Value]>,
) {
    let Some(on_update) = on_update else {
        return;
    };
    let mut details = json!({
        "stage": stage,
        "percent": (percent.clamp(0.0, 100.0) * 10.0).round() / 10.0,
        "message": message,
        "path": path.display().to_string(),
    });
    if let Some((sheet, range)) = focus {
        details["sheet"] = json!(sheet);
        if let Some(range) = range {
            details["range"] = json!(range);
        }
    }
    if let Some(changes) = changes {
        details["changes"] = json!(changes);
    }
    on_update(ToolUpdate {
        content: vec![ContentBlock::Text(TextContent::new(
            details["message"].as_str().unwrap_or_default().to_string(),
        ))],
        details: Some(details),
    });
}

fn output_with_details(text: String, path: &Path, extra: Value) -> ToolOutput {
    let mut details = json!({ "path": path.display().to_string() });
    if let (Some(map), Some(extra_map)) = (details.as_object_mut(), extra.as_object()) {
        for (key, value) in extra_map {
            map.insert(key.clone(), value.clone());
        }
    }
    ToolOutput {
        content: vec![ContentBlock::Text(TextContent::new(text))],
        details: Some(details),
        is_error: false,
    }
}

/// 相对路径锚定工具 cwd；绝对路径原样使用。
fn resolve_path(cwd: &Path, raw: &str) -> PathBuf {
    let trimmed = raw.trim();
    let candidate = Path::new(trimmed);
    if candidate.is_absolute() {
        candidate.to_path_buf()
    } else {
        cwd.join(candidate)
    }
}
