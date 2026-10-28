//! Word 读写：docx-rs 写 / zip+quick-xml 提取文本。
//!
//! 与 xlsx 同管道：分阶段 `on_update` 进度（tool.progress），每完成一个内容块
//! 重建并落盘检查点——前端 docx-preview 按 dataBase64 重渲染，用户看着段落
//! 逐段出现。

use super::{emit_progress, error_output, output_with_details, resolve_path, text_output};
use async_trait::async_trait;
use pi::sdk::{Result, Tool, ToolOutput, ToolUpdate};
use pi::tools::ToolEffects;
use serde_json::{json, Value};
use std::path::PathBuf;

/// 段落数护栏：超出引导分批（模型单次输出预算内足够）。
const MAX_BLOCKS: usize = 2_000;
/// read_docx 默认/上限段落数。
const READ_DEFAULT_PARAS: usize = 200;
const READ_MAX_PARAS: usize = 2_000;

// ---------- write_docx ----------

pub struct WriteDocxTool {
    cwd: PathBuf,
}

impl WriteDocxTool {
    #[must_use]
    pub fn new(cwd: PathBuf) -> Self {
        Self { cwd }
    }
}

#[async_trait]
impl Tool for WriteDocxTool {
    fn name(&self) -> &str {
        "write_docx"
    }

    fn label(&self) -> &str {
        "写 Word 文档"
    }

    fn description(&self) -> &str {
        "创建 Word (.docx) 文档。blocks 按序为内容块：heading1/heading2/heading3（标题）/\
         paragraph（正文）/bullet（项目符号）。适合报告/纪要类文档；复杂排版（目录、页眉脚、\
         嵌套表格）请改用 bash + Python。"
    }

    fn parameters(&self) -> serde_json::Value {
        json!({
            "type": "object",
            "properties": {
                "path": {
                    "type": "string",
                    "description": "目标 .docx 路径（相对当前工作目录或绝对路径）"
                },
                "blocks": {
                    "type": "array",
                    "description": "内容块（按序写入）",
                    "items": {
                        "type": "object",
                        "properties": {
                            "type": {
                                "type": "string",
                                "enum": ["heading1", "heading2", "heading3", "paragraph", "bullet"],
                                "description": "块类型（默认 paragraph）"
                            },
                            "text": { "type": "string", "description": "块文本" }
                        },
                        "required": ["text"]
                    }
                }
            },
            "required": ["path", "blocks"]
        })
    }

    async fn execute(
        &self,
        _tool_call_id: &str,
        input: serde_json::Value,
        on_update: Option<Box<dyn Fn(ToolUpdate) + Send + Sync>>,
    ) -> Result<ToolOutput> {
        let Some(path_raw) = input.get("path").and_then(Value::as_str) else {
            return Ok(error_output("缺少 path 参数".to_string()));
        };
        let target = resolve_path(&self.cwd, path_raw);
        if target
            .extension()
            .and_then(|e| e.to_str())
            .map(|e| e.eq_ignore_ascii_case("docx"))
            != Some(true)
        {
            return Ok(error_output(format!("path 应指向 .docx 文件（收到 {path_raw}）")));
        }
        let Some(blocks) = input.get("blocks").and_then(Value::as_array) else {
            return Ok(error_output("缺少 blocks 参数".to_string()));
        };
        if blocks.is_empty() {
            return Ok(error_output("blocks 不能为空".to_string()));
        }
        if blocks.len() > MAX_BLOCKS {
            return Ok(error_output(format!(
                "共 {} 个内容块，超过上限 {MAX_BLOCKS}；请分批生成",
                blocks.len()
            )));
        }
        // 历史版本快照：覆盖既有文件时先备份。
        if target.is_file() {
            if let Ok(previous) = std::fs::read(&target) {
                super::push_version(&target, &previous);
            }
        }
        if let Some(parent) = target.parent() {
            if !parent.as_os_str().is_empty() {
                let _ = std::fs::create_dir_all(parent);
            }
        }

        emit_progress(
        &on_update,
        "parse",
        5.0,
        format!("解析 {} 个内容块…", blocks.len()),
        &target,
        None,
        None,
        );

        // 分段检查点：每写完一块重建并落盘（文档小，重建开销可忽略），
        // 前端 docx-preview 按 dataBase64 重渲染 → 用户看着段落逐段出现。
        for (idx, _block) in blocks.iter().enumerate() {
            let written = &blocks[..=idx];
            if let Err(error) = write_docx_to_disk(written, &target) {
                return Ok(error_output(format!(
                    "写入 {} 失败：{error}（文件可能被 Word/WPS 占用，请关闭后重试）",
                    target.display()
                )));
            }
            let done = 10.0 + 80.0 * (idx + 1) as f32 / blocks.len() as f32;
            let kind = written[idx].get("type").and_then(Value::as_str).unwrap_or("paragraph");
            emit_progress(
            &on_update,
            "render",
            done,
            format!("已写入第 {} 个内容块（{kind}）", idx + 1),
            &target,
            Some((format!("块 {}/{}", idx + 1, blocks.len()), None)),
            None,
            );
        }

        emit_progress(
        &on_update,
        "write",
        95.0,
        format!("落盘 {}…", target.display()),
        &target,
        None,
        None,
        );
        let size = std::fs::metadata(&target).map(|m| m.len()).unwrap_or(0);
        Ok(output_with_details(
            format!("已创建 {}（{} 个内容块，{} 字节）", target.display(), blocks.len(), size),
            &target,
            json!({ "bytes": size, "blocks": blocks.len() }),
        ))
    }
}

/// 渲染 + 落盘分离：checkpoint 循环里复用。
fn write_docx_to_disk(blocks: &[Value], target: &std::path::Path) -> std::result::Result<(), String> {
    let mut document = docx_rs::Docx::new();
    for block in blocks {
        let kind = block.get("type").and_then(Value::as_str).unwrap_or("paragraph");
        let text = block.get("text").and_then(Value::as_str).unwrap_or_default();
        let run = docx_rs::Run::new();
        let paragraph = docx_rs::Paragraph::new();
        let styled = match kind {
            "heading1" => paragraph.add_run(run.add_text(text).size(36).bold()),
            "heading2" => paragraph.add_run(run.add_text(text).size(30).bold()),
            "heading3" => paragraph.add_run(run.add_text(text).size(26).bold()),
            "bullet" => paragraph.add_run(run.add_text(format!("• {text}"))),
            _ => paragraph.add_run(run.add_text(text)),
        };
        document = document.add_paragraph(styled);
    }
    let mut buffer = std::io::Cursor::new(Vec::new());
    document
        .build()
        .pack(&mut buffer)
        .map_err(|error| format!("构建文档失败：{error}"))?;
    std::fs::write(target, buffer.into_inner()).map_err(|error| format!("写盘失败：{error}"))
}

// ---------- read_docx ----------

pub struct ReadDocxTool {
    cwd: PathBuf,
}

impl ReadDocxTool {
    #[must_use]
    pub fn new(cwd: PathBuf) -> Self {
        Self { cwd }
    }
}

/// 按文档顺序提取一个 w:p 块内的文本（w:t 内容 + w:tab → \t + w:br → \n）。
fn extract_ordered_docx_text(block: &str) -> String {
    let mut out = String::new();
    let mut i = 0usize;
    while i < block.len() {
        let rest = &block[i..];
        if rest.starts_with("<w:t>") {
            let inner = &rest["<w:t>".len()..];
            let Some(end) = inner.find("</w:t>") else { break };
            out.push_str(&super::xml_unescape(&inner[..end]));
            i += "<w:t>".len() + end + "</w:t>".len();
            continue;
        }
        if rest.starts_with("<w:t ") {
            let Some(gt) = rest.find('>') else { break };
            let inner = &rest[gt + 1..];
            let Some(end) = inner.find("</w:t>") else { break };
            out.push_str(&super::xml_unescape(&inner[..end]));
            i += gt + 1 + end + "</w:t>".len();
            continue;
        }
        if rest.starts_with("<w:tab") {
            out.push('\t');
            i += "<w:tab".len();
            continue;
        }
        if rest.starts_with("<w:br") {
            out.push('\n');
            i += "<w:br".len();
            continue;
        }
        let ch_len = rest.chars().next().map(|c| c.len_utf8()).unwrap_or(1);
        i += ch_len;
    }
    out
}

/// 提取 word/document.xml 的段落文本（w:p 边界 + w:t 内容 + w:tab/w:br）。
fn extract_docx_paragraphs(xml: &str) -> Vec<String> {
    let mut paragraphs: Vec<String> = Vec::new();
    let mut cursor = 0usize;
    while cursor < xml.len() {
        // <w:p> 与 <w:p attr>（前缀均 5 字节）；<w:p/> 自闭合空段无文本，跳过。
        let rel_open = xml[cursor..].find("<w:p>").map(|r| (r, 5));
        let rel_open_attr = xml[cursor..].find("<w:p ").map(|r| (r, 5));
        let Some((rel, prefix_len)) = [rel_open, rel_open_attr]
            .into_iter()
            .flatten()
            .min_by_key(|(r, _)| *r)
        else {
            break;
        };
        let abs = cursor + rel;
        let Some(close_rel) = xml[abs..].find("</w:p>") else { break };
        let block = &xml[abs..abs + close_rel];
        let text = extract_ordered_docx_text(block);
        let trimmed = text.trim();
        if !trimmed.is_empty() {
            paragraphs.push(trimmed.to_string());
        }
        cursor = abs + close_rel + 6;
    }
    paragraphs
}

#[async_trait]
impl Tool for ReadDocxTool {
    fn name(&self) -> &str {
        "read_docx"
    }

    fn label(&self) -> &str {
        "读 Word 文档"
    }

    fn description(&self) -> &str {
        "读取 Word (.docx) 文档：返回段落文本数组（默认前 200 段，可调上限 2000）。\
         表格/图片不提取；复杂结构请用 bash + Python。"
    }

    fn parameters(&self) -> serde_json::Value {
        json!({
            "type": "object",
            "properties": {
                "path": { "type": "string", "description": ".docx 文件路径（相对当前工作目录或绝对路径）" },
                "max_paragraphs": { "type": "integer", "description": "最多读取段落数（默认 200，上限 2000）" }
            },
            "required": ["path"]
        })
    }

    fn effects(&self) -> ToolEffects {
        ToolEffects::read()
    }

    async fn execute(
        &self,
        _tool_call_id: &str,
        input: serde_json::Value,
        on_update: Option<Box<dyn Fn(ToolUpdate) + Send + Sync>>,
    ) -> Result<ToolOutput> {
        let Some(path_raw) = input.get("path").and_then(Value::as_str) else {
            return Ok(error_output("缺少 path 参数".to_string()));
        };
        let target = resolve_path(&self.cwd, path_raw);
        if !target.is_file() {
            return Ok(error_output(format!("文件不存在：{}", target.display())));
        }
        let max_paragraphs = input
            .get("max_paragraphs")
            .and_then(Value::as_u64)
            .map(|v| (v as usize).clamp(1, READ_MAX_PARAS))
            .unwrap_or(READ_DEFAULT_PARAS);

        emit_progress(
            &on_update,
            "parse",
            20.0,
            format!("打开 {}…", target.display()),
            &target,
            None,
            None,
        );
        let file = match std::fs::File::open(&target) {
            Ok(file) => file,
            Err(error) => return Ok(error_output(format!("打开 {} 失败：{error}", target.display()))),
        };
        let mut archive = match zip::ZipArchive::new(file) {
            Ok(archive) => archive,
            Err(error) => {
                return Ok(error_output(format!(
                    "{} 不是有效的 .docx（{error}）",
                    target.display()
                )))
            }
        };
        let document_xml = match archive.by_name("word/document.xml") {
            Ok(mut entry) => {
                use std::io::Read;
                let mut text = String::new();
                if entry.read_to_string(&mut text).is_err() {
                    return Ok(error_output("读取 word/document.xml 失败".to_string()));
                }
                text
            }
            Err(_) => return Ok(error_output("该文件缺少 word/document.xml".to_string())),
        };
        emit_progress(
            &on_update,
            "read",
            60.0,
            "提取段落文本…".to_string(),
            &target,
            None,
            None,
        );
        let paragraphs = extract_docx_paragraphs(&document_xml);
        let total = paragraphs.len();
        let truncated = total > max_paragraphs;
        let shown: Vec<String> = paragraphs.into_iter().take(max_paragraphs).collect();
        let hint = if truncated {
            Value::String(format!(
                "仅返回前 {max_paragraphs} 段（共 {total}）；继续读请加大 max_paragraphs 或用 bash+Python"
            ))
        } else {
            Value::Null
        };
        emit_progress(
        &on_update,
        "write",
        95.0,
        format!("落盘 {}…", target.display()),
        &target,
        None,
        None,
        );
        Ok(output_with_details(
            json!({
                "file": target.display().to_string(),
                "paragraphs": shown,
                "totalParagraphs": total,
                "truncated": truncated,
                "hint": hint,
            })
            .to_string(),
            &target,
            json!({ "paragraphs": shown.len() }),
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[tokio::test]
    async fn write_then_read_docx_round_trip() {
        let dir = tempfile::tempdir().expect("tempdir");
        let writer = WriteDocxTool::new(dir.path().to_path_buf());
        let output = writer
            .execute(
                "c1",
                json!({
                    "path": "report.docx",
                    "blocks": [
                        { "type": "heading1", "text": "季度总结" },
                        { "type": "paragraph", "text": "本季度增长 12%。" },
                        { "type": "bullet", "text": "上线三个功能" }
                    ]
                }),
                None,
            )
            .await
            .expect("execute");
        assert!(!output.is_error, "write 失败：{:?}", output.content);
        assert!(dir.path().join("report.docx").is_file());

        let reader = ReadDocxTool::new(dir.path().to_path_buf());
        let read = reader
            .execute("c2", json!({ "path": "report.docx" }), None)
            .await
            .expect("read execute");
        assert!(!read.is_error);
        let text = match read.content.first() {
            Some(pi::sdk::ContentBlock::Text(text)) => text.text.clone(),
            other => panic!("期望文本输出，收到 {other:?}"),
        };
        let payload: Value = serde_json::from_str(&text).expect("JSON");
        let paragraphs = payload["paragraphs"].as_array().expect("paragraphs");
        assert_eq!(paragraphs[0], "季度总结");
        assert_eq!(paragraphs[1], "本季度增长 12%。");
        assert_eq!(paragraphs[2], "• 上线三个功能");
    }

    #[tokio::test]
    async fn read_docx_missing_file() {
        let dir = tempfile::tempdir().expect("tempdir");
        let reader = ReadDocxTool::new(dir.path().to_path_buf());
        let output = reader
            .execute("c", json!({ "path": "nope.docx" }), None)
            .await
            .expect("execute");
        assert!(output.is_error);
    }

    #[test]
    fn extract_paragraphs_handles_tabs_and_br() {
        let xml = r#"<?xml version="1.0"?><w:document xmlns:w="w"><w:body>
            <w:p><w:r><w:t>第一段</w:t></w:r></w:p>
            <w:p><w:r><w:t>第二</w:t><w:tab/><w:t>段</w:t><w:br/><w:t>折行</w:t></w:r></w:p>
            <w:p></w:p>
        </w:body></w:document>"#;
        let paragraphs = extract_docx_paragraphs(xml);
        assert_eq!(paragraphs, vec!["第一段".to_string(), "第二\t段\n折行".to_string()]);
    }
}

// ---------- edit_docx ----------

/// 文档段落数护栏。
const MAX_DOC_EDITS: usize = 200;

/// 收集 document.xml 中全部 w:p 块的 (start, end, 自闭合)。
fn locate_paragraph_blocks(xml: &str) -> Vec<(usize, usize, bool)> {
    let mut blocks: Vec<(usize, usize, bool)> = Vec::new();
    let mut i = 0usize;
    while i < xml.len() {
        let rest = &xml[i..];
        if rest.starts_with("<w:p>") || rest.starts_with("<w:p ") {
            let Some(gt_rel) = rest.find('>') else { break };
            let Some(close_rel) = rest.find("</w:p>") else { break };
            blocks.push((i, i + close_rel + "</w:p>".len(), false));
            i += close_rel + "</w:p>".len();
            continue;
        }
        if rest.starts_with("<w:p/>") {
            blocks.push((i, i + "<w:p/>".len(), true));
            i += "<w:p/>".len();
            continue;
        }
        let ch_len = rest.chars().next().map(|c| c.len_utf8()).unwrap_or(1);
        i += ch_len;
    }
    blocks
}

/// 重写一个 w:p 块：保留开标签属性与 pPr（段落级格式），运行替换为单 run 文本。
/// 前缀结构保留：原段以「• 」或「N. / N、」开头而新文本没有时，自动补回——
/// write_docx 的项目符号是字面前缀（无 numPr），不补会表现为"丢失项目符号"。
fn rebuild_paragraph_block(original: &str, self_closed: bool, text: &str) -> String {
    let original_text = extract_ordered_docx_text(original);
    let text = match text {
        value if original_text.starts_with("• ") && !value.starts_with("• ") => {
            format!("• {value}")
        }
        value => {
            // 有序列表前缀（1. / 1、）：数字必须一致才算同一条目，避免错配。
            let prefix = original_text
                .split_once(' ')
                .map(|(head, _)| head)
                .filter(|head| {
                    let head = head.strip_suffix('.').or_else(|| head.strip_suffix('、'));
                    head.map(|digits| !digits.is_empty() && digits.chars().all(|ch| ch.is_ascii_digit()))
                        .unwrap_or(false)
                });
            match prefix {
                Some(head) if !value.starts_with(head) => format!("{head} {value}"),
                _ => value.to_string(),
            }
        }
    };
    let open_end = original.find('>').map(|gt| gt + 1).unwrap_or(0);
    let open_tag = &original[..open_end.min(original.len())];
    let ppr = if self_closed {
        String::new()
    } else {
        match (original.find("<w:pPr"), original.find("</w:pPr>")) {
            (Some(start), Some(end_rel)) => {
                let end = end_rel + "</w:pPr>".len();
                original[start..end].to_string()
            }
            _ => String::new(),
        }
    };
    if self_closed {
        format!("<w:p>{ppr}<w:r><w:t xml:space=\"preserve\">{}</w:t></w:r></w:p>", super::xml_escape(&text))
    } else {
        format!("{open_tag}{ppr}<w:r><w:t xml:space=\"preserve\">{}</w:t></w:r></w:p>", super::xml_escape(&text))
    }
}

pub struct EditDocxTool {
    cwd: PathBuf,
}

impl EditDocxTool {
    #[must_use]
    pub fn new(cwd: PathBuf) -> Self {
        Self { cwd }
    }
}

#[async_trait]
impl Tool for EditDocxTool {
    fn name(&self) -> &str {
        "edit_docx"
    }

    fn label(&self) -> &str {
        "改 Word 段落"
    }

    fn description(&self) -> &str {
        "就地修改既有 Word (.docx) 的段落：按「包含文本」定位（推荐）或段序号，整段替换为\
         新文本（保留段落格式）。也可在文末追加段落。只改目标段落的 XML，其余内容与样式\
         原样保留——改一处不要重发全文。新建文件用 write_docx。"
    }

    fn parameters(&self) -> serde_json::Value {
        json!({
            "type": "object",
            "properties": {
                "path": { "type": "string", "description": ".docx 文件路径（相对当前工作目录或绝对路径）" },
                "edits": {
                    "type": "array",
                    "description": "段落编辑列表",
                    "items": {
                        "type": "object",
                        "properties": {
                            "match": { "type": "string", "description": "定位：目标段落当前文本包含此子串（推荐，先到先得）" },
                            "paragraph": { "type": "integer", "description": "定位：1 基段序号（含空段，兜底用）" },
                            "text": { "type": "string", "description": "替换后的整段文本" },
                            "append": { "type": "boolean", "description": "true = 在文末追加新段落（忽略定位）" }
                        },
                        "required": ["text"]
                    }
                }
            },
            "required": ["path", "edits"]
        })
    }

    fn effects(&self) -> ToolEffects {
        ToolEffects::write()
    }

    async fn execute(
        &self,
        _tool_call_id: &str,
        input: serde_json::Value,
        on_update: Option<Box<dyn Fn(ToolUpdate) + Send + Sync>>,
    ) -> Result<ToolOutput> {
        use std::io::Read;
        let Some(path_raw) = input.get("path").and_then(Value::as_str) else {
            return Ok(error_output("缺少 path 参数".to_string()));
        };
        let target = resolve_path(&self.cwd, path_raw);
        if !target.is_file() {
            return Ok(error_output(format!("文件不存在：{}", target.display())));
        }
        let Some(edits) = input.get("edits").and_then(Value::as_array) else {
            return Ok(error_output("缺少 edits 参数".to_string()));
        };
        if edits.is_empty() {
            return Ok(error_output("edits 不能为空".to_string()));
        }
        if edits.len() > MAX_DOC_EDITS {
            return Ok(error_output(format!(
                "共 {} 处编辑，超过上限 {MAX_DOC_EDITS}；请分批",
                edits.len()
            )));
        }

        emit_progress(
            &on_update,
            "done",
            100.0,
            "读取完成".to_string(),
            &target,
            None,
            None,
        );

        let file = match std::fs::File::open(&target) {
            Ok(file) => file,
            Err(error) => return Ok(error_output(format!("打开 {} 失败：{error}", target.display()))),
        };
        let mut archive = match zip::ZipArchive::new(file) {
            Ok(archive) => archive,
            Err(error) => {
                return Ok(error_output(format!(
                    "{} 不是有效的 .docx（{error}）",
                    target.display()
                )))
            }
        };
        let mut document_xml = String::new();
        if archive
            .by_name("word/document.xml")
            .and_then(|mut entry| {
                std::io::Read::read_to_string(&mut entry, &mut document_xml)
                    .map_err(zip::result::ZipError::from)
            })
            .is_err()
        {
            return Ok(error_output("读取 word/document.xml 失败".to_string()));
        }

        let blocks = locate_paragraph_blocks(&document_xml);
        // 解析编辑并换算成 (块范围或插入位置, 新块文本)。
        let mut replacements: Vec<(usize, usize, String)> = Vec::new();
        let mut appends: Vec<String> = Vec::new();
        let mut change_notes: Vec<Value> = Vec::new();
        for (idx, edit) in edits.iter().enumerate() {
            let text = edit.get("text").and_then(Value::as_str).unwrap_or_default();
            if edit.get("append").and_then(Value::as_bool) == Some(true) {
                let kind = edit.get("type").and_then(Value::as_str).unwrap_or("paragraph");
                let (ppr, run_prefix, rpr) = match kind {
                    "heading1" => (String::new(), String::new(), "<w:b/><w:sz w:val=\"36\"/>".to_string()),
                    "heading2" => (String::new(), String::new(), "<w:b/><w:sz w:val=\"30\"/>".to_string()),
                    "heading3" => (String::new(), String::new(), "<w:b/><w:sz w:val=\"26\"/>".to_string()),
                    "bullet" => (
                        "<w:ind w:left=\"420\" w:hanging=\"240\"/>".to_string(),
                        "• ".to_string(),
                        String::new(),
                    ),
                    _ => (String::new(), String::new(), String::new()),
                };
                let run_rpr = if rpr.is_empty() {
                    String::new()
                } else {
                    format!("<w:rPr>{rpr}</w:rPr>")
                };
                let para_ppr = if ppr.is_empty() {
                    String::new()
                } else {
                    format!("<w:pPr>{ppr}</w:pPr>")
                };
                appends.push(format!(
                    "<w:p>{para_ppr}<w:r>{run_rpr}<w:t xml:space=\"preserve\">{}{}</w:t></w:r></w:p>",
                    super::xml_escape(&run_prefix),
                    super::xml_escape(text)
                ));
                change_notes.push(json!({ "append": true, "type": kind, "text": text }));
                continue;
            }
            let text_value = edit.get("text").and_then(Value::as_str).unwrap_or_default();
            let match_text = edit.get("match").and_then(Value::as_str).map(str::trim);
            let ordinal = edit.get("paragraph").and_then(Value::as_u64);
            // 定位：match 优先（文本包含，先到先得），段序号兜底。
            let located = if let Some(needle) = match_text.filter(|n| !n.is_empty()) {
                blocks
                    .iter()
                    .position(|(start, end, _)| {
                        let block = &document_xml[*start..*end];
                        extract_ordered_docx_text(block).contains(needle)
                    })
                    .map(|position| (position, needle.to_string()))
            } else {
                ordinal.and_then(|n| {
                    let index = usize::try_from(n).ok()?.checked_sub(1)?;
                    Some((index, String::new()))
                })
            };
            let Some((position, note)) = located else {
                let hint = match_text
                    .map(|needle| format!("找不到包含 {needle:?} 的段落"))
                    .unwrap_or_else(|| format!("段序号 {ordinal:?} 超出范围（共 {} 段）", blocks.len()));
                return Ok(error_output(format!("edits[{}] 定位失败：{hint}", idx + 1)));
            };
            let Some((start, end, self_closed)) = blocks.get(position) else {
                return Ok(error_output(format!("edits[{}] 段序号越界", idx + 1)));
            };
            replacements.push((*start, *end, rebuild_paragraph_block(
                &document_xml[*start..*end],
                *self_closed,
                text_value,
            )));
            change_notes.push(json!({
                "paragraph": position + 1,
                "text": text_value,
                "match": if note.is_empty() { Value::Null } else { Value::String(note) },
            }));
        }

        emit_progress(
            &on_update,
            "done",
            100.0,
            "读取完成".to_string(),
            &target,
            None,
            None,
        );

        // 替换：按位置倒序应用，避免偏移失效。
        replacements.sort_by(|a, b| b.0.cmp(&a.0));
        for (start, end, new_block) in &replacements {
            document_xml.replace_range(start..end, new_block);
        }
        // 追加：插到 body 末尾（sectPr 之前——节属性必须在最后）。
        if !appends.is_empty() {
            let insert_at = document_xml
                .rfind("<w:sectPr")
                .unwrap_or_else(|| document_xml.rfind("</w:body>").unwrap_or(document_xml.len()));
            let mut insertion = appends.join("");
            insertion.insert_str(0, "");
            document_xml.insert_str(insert_at, &insertion);
        }

        emit_progress(
            &on_update,
            "done",
            100.0,
            "读取完成".to_string(),
            &target,
            None,
            None,
        );
        let bytes = match super::rebuild_zip_with_replacements(
            &target,
            &[("word/document.xml".to_string(), document_xml.into_bytes())],
            &[],
        ) {
            Ok(bytes) => bytes,
            Err(message) => return Ok(error_output(message)),
        };
        if let Err(error) = std::fs::write(&target, bytes) {
            return Ok(error_output(format!("写盘失败：{error}")));
        }
        let size = std::fs::metadata(&target).map(|m| m.len()).unwrap_or(0);
        Ok(output_with_details(
            format!("已修改 {}（{} 处变更，{} 字节）", target.display(), change_notes.len(), size),
            &target,
            json!({ "bytes": size, "changes": change_notes }),
        ))
    }
}

#[cfg(test)]
mod edit_tests {
    use super::*;
    use serde_json::json;

    #[tokio::test]
    async fn edit_paragraph_by_match_and_append() {
        let dir = tempfile::tempdir().expect("tempdir");
        let cwd = dir.path().to_path_buf();
        let writer = WriteDocxTool::new(cwd.clone());
        writer
            .execute(
                "c1",
                json!({
                    "path": "report.docx",
                    "blocks": [
                        { "type": "heading1", "text": "周报" },
                        { "type": "paragraph", "text": "本季度增长 12%。" }
                    ]
                }),
                None,
            )
            .await
            .expect("write");

        let editor = EditDocxTool::new(cwd.clone());
        let edit = editor
            .execute(
                "c2",
                json!({
                    "path": "report.docx",
                    "edits": [
                        { "match": "增长", "text": "本季度增长 18%。" },
                        { "append": true, "text": "备注：数据来自财报。" }
                    ]
                }),
                None,
            )
            .await
            .expect("edit");
        assert!(!edit.is_error, "edit 失败：{:?}", edit.content);
        let details = edit.details.as_ref().expect("details");
        assert_eq!(
            details.get("changes").and_then(Value::as_array).map(Vec::len),
            Some(2)
        );

        let reader = ReadDocxTool::new(cwd);
        let read = reader.execute("c3", json!({ "path": "report.docx" }), None).await.expect("read");
        let text = match read.content.first() {
            Some(pi::sdk::ContentBlock::Text(text)) => text.text.clone(),
            other => panic!("期望文本输出，收到 {other:?}"),
        };
        let payload: Value = serde_json::from_str(&text).expect("JSON");
        let paragraphs = payload["paragraphs"].as_array().expect("paragraphs");
        assert_eq!(paragraphs[0], "周报");
        assert_eq!(paragraphs[1], "本季度增长 18%。", "match 定位替换");
        assert_eq!(paragraphs[2], "备注：数据来自财报。", "文末追加");
    }

    #[tokio::test]
    async fn edit_match_not_found_is_error() {
        let dir = tempfile::tempdir().expect("tempdir");
        let cwd = dir.path().to_path_buf();
        let writer = WriteDocxTool::new(cwd.clone());
        writer
            .execute("c1", json!({ "path": "a.docx", "blocks": [{ "text": "hello" }] }), None)
            .await
            .expect("write");
        let editor = EditDocxTool::new(cwd.clone());
        let edit = editor
            .execute(
                "c2",
                json!({ "path": "a.docx", "edits": [{ "match": "不存在", "text": "x" }] }),
                None,
            )
            .await
            .expect("edit");
        assert!(edit.is_error);
    }
}

#[cfg(test)]
mod edit_prefix_tests {
    use super::*;
    use serde_json::json;

    /// 回归：write_docx 的项目符号是字面「• 」前缀；edit 替换时若新文本不带
    /// 前缀必须自动补回——否则表现为「丢失项目符号样式」。
    #[tokio::test]
    async fn edit_preserves_bullet_and_number_prefix() {
        let dir = tempfile::tempdir().expect("tempdir");
        let cwd = dir.path().to_path_buf();
        let writer = WriteDocxTool::new(cwd.clone());
        writer
            .execute(
                "c1",
                json!({
                    "path": "list.docx",
                    "blocks": [
                        { "type": "bullet", "text": "增长 12%" },
                        { "type": "paragraph", "text": "1. 下一季度计划。" }
                    ]
                }),
                None,
            )
            .await
            .expect("write");

        let editor = EditDocxTool::new(cwd.clone());
        let edit = editor
            .execute(
                "c2",
                json!({
                    "path": "list.docx",
                    "edits": [
                        { "match": "增长", "text": "增长 18%" },
                        { "match": "下一季度", "text": "下一季度再议。" }
                    ]
                }),
                None,
            )
            .await
            .expect("edit");
        assert!(!edit.is_error, "edit 失败：{:?}", edit.content);

        let reader = ReadDocxTool::new(cwd);
        let read = reader.execute("c3", json!({ "path": "list.docx" }), None).await.expect("read");
        let text = match read.content.first() {
            Some(pi::sdk::ContentBlock::Text(text)) => text.text.clone(),
            other => panic!("期望文本输出，收到 {other:?}"),
        };
        let payload: Value = serde_json::from_str(&text).expect("JSON");
        let paragraphs = payload["paragraphs"].as_array().expect("paragraphs");
        assert_eq!(paragraphs[0], "• 增长 18%", "项目符号前缀必须保留");
        assert_eq!(paragraphs[1], "1. 下一季度再议。", "有序列表编号必须保留");
    }
}
