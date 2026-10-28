//! Excel 读写：rust_xlsxwriter 写 / calamine 读。

use super::{
    emit_progress, error_output, output_with_details, resolve_path, text_output,
};
use async_trait::async_trait;
use calamine::Reader;
use pi::sdk::{ContentBlock, Result, TextContent, Tool, ToolOutput, ToolUpdate};
use pi::tools::ToolEffects;
use serde_json::{json, Value};
use std::path::PathBuf;


/// 0 基列号 → Excel 字母列名（0→A, 25→Z, 26→AA）。
fn column_letter(column: usize) -> String {
    let mut letters = Vec::new();
    let mut column = column;
    loop {
        letters.push(b'A' + u8::try_from(column % 26).unwrap_or(0));
        if column < 26 {
            break;
        }
        column = column / 26 - 1;
    }
    letters.reverse();
    String::from_utf8(letters).unwrap_or_else(|_| "A".to_string())
}
/// 数据区选区字符串（1 基行列，A1 锚定）：前端高亮"正在写的区域"。
fn selection_range(max_row: usize, max_col: usize) -> Option<String> {
    if max_row == 0 || max_col == 0 {
        return None;
    }
    Some(format!("A1:{}{}", column_letter(max_col - 1), max_row))
}
/// 统计输入规模（护栏用）。
fn count_cells(sheets: &[Value]) -> usize {
    sheets
        .iter()
        .filter_map(|sheet| sheet.get("rows").and_then(Value::as_array))
        .map(|rows| {
            rows.iter()
                .filter_map(Value::as_array)
                .map(Vec::len)
                .sum::<usize>()
        })
        .sum()
}

/// 输入规模护栏：总 cell 数超过即报错（引导分批），避免一次性生成巨型工作簿。
const MAX_TOTAL_CELLS: usize = 500_000;
/// 单个工作表行数上限（xlsx 硬限 1,048,576；工具层再收紧防误用）。
const MAX_SHEET_ROWS: usize = 500_000;
/// read_xlsx 默认/上限行列。
const READ_DEFAULT_ROWS: usize = 200;
const READ_MAX_ROWS: usize = 2_000;
const READ_DEFAULT_COLS: usize = 50;
const READ_MAX_COLS: usize = 200;

// ---------- write_xlsx ----------

pub struct WriteXlsxTool {
    cwd: PathBuf,
}

impl WriteXlsxTool {
    #[must_use]
    pub fn new(cwd: PathBuf) -> Self {
        Self { cwd }
    }
}

#[async_trait]
impl Tool for WriteXlsxTool {
    fn name(&self) -> &str {
        "write_xlsx"
    }

    fn label(&self) -> &str {
        "写 Excel 文件"
    }

    fn description(&self) -> &str {
        "创建 Excel (.xlsx) 工作簿。多工作表；单元格支持字符串/数字/布尔/null，\
         以 \"=\" 开头的字符串按公式写入（如 \"=SUM(A1:A10)\"）。\
         header=true 时首行加粗。适合结构化表格数据；复杂图表/透视表请改用 bash + Python。"
    }

    fn parameters(&self) -> serde_json::Value {
        json!({
            "type": "object",
            "properties": {
                "path": {
                    "type": "string",
                    "description": "目标 .xlsx 路径（相对当前工作目录或绝对路径）"
                },
                "sheets": {
                    "type": "array",
                    "description": "工作表列表（按序写入）",
                    "items": {
                        "type": "object",
                        "properties": {
                            "name": { "type": "string", "description": "工作表名" },
                            "rows": {
                                "type": "array",
                                "description": "二维行数据；元素可为 string/number/boolean/null，\"=…\" 字符串按公式写入",
                                "items": { "type": "array" }
                            }
                        },
                        "required": ["name", "rows"]
                    }
                },
                "header": {
                    "type": "boolean",
                    "description": "首行是否加粗（表头样式），默认 false"
                }
            },
            "required": ["path", "sheets"]
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
        if target.extension().and_then(|e| e.to_str()).map(|e| e.eq_ignore_ascii_case("xlsx")) != Some(true) {
            return Ok(error_output(format!(
                "path 应指向 .xlsx 文件（收到 {path_raw}）"
            )));
        }
        let Some(sheets) = input.get("sheets").and_then(Value::as_array) else {
            return Ok(error_output("缺少 sheets 参数".to_string()));
        };
        if sheets.is_empty() {
            return Ok(error_output("sheets 不能为空".to_string()));
        }
        let header = input.get("header").and_then(Value::as_bool).unwrap_or(false);

        // 规模护栏：提前拒绝，别让模型把 prompt 预算烧在巨表上。
        for (idx, sheet) in sheets.iter().enumerate() {
            let rows = sheet.get("rows").and_then(Value::as_array);
            let Some(rows) = rows else {
                return Ok(error_output(format!("sheets[{idx}].rows 缺失或不是数组")));
            };
            if rows.len() > MAX_SHEET_ROWS {
                return Ok(error_output(format!(
                    "sheets[{idx}] 有 {} 行，超过单表上限 {MAX_SHEET_ROWS}；请分批生成",
                    rows.len()
                )));
            }
        }
        let total_cells = count_cells(sheets);
        if total_cells > MAX_TOTAL_CELLS {
            return Ok(error_output(format!(
                "共 {total_cells} 个单元格，超过上限 {MAX_TOTAL_CELLS}；请分批生成或精简数据"
            )));
        }

        // 历史版本快照：覆盖既有文件时先备份（恢复入口见 versions）。
        if target.is_file() {
            if let Ok(previous) = std::fs::read(&target) {
                super::push_version(&target, &previous);
            }
        }
        // 前置建父目录：首个检查点落盘前必须就绪。
        if let Some(parent) = target.parent() {
            if !parent.as_os_str().is_empty() {
                let _ = std::fs::create_dir_all(parent);
            }
        }
        emit_progress(
            &on_update,
            "parse",
            5.0,
            format!("解析 {} 个工作表 / {total_cells} 个单元格…", sheets.len()),
            &target,
            None,
            None,
        );

        let mut workbook = rust_xlsxwriter::Workbook::new();
        let mut last_sheet_name = "";
        let mut last_sheet_range: Option<String> = None;
        for (idx, sheet_value) in sheets.iter().enumerate() {
            let name = sheet_value
                .get("name")
                .and_then(Value::as_str)
                .unwrap_or("Sheet")
                .trim();
            let sheet_name = if name.is_empty() { "Sheet" } else { name };
            let worksheet = workbook.add_worksheet();
            if let Err(error) = worksheet.set_name(sheet_name) {
                return Ok(error_output(format!(
                    "工作表名 {sheet_name:?} 无效（{error}）；避免 : / ? * [ ] 等字符"
                )));
            }
            let bold = rust_xlsxwriter::Format::new().set_bold();
            // 实际写入范围（用于选区高亮；稀疏尾部空值不计入）。
            let mut max_row = 0usize;
            let mut max_col = 0usize;
            for (row_idx, row) in sheet_value
                .get("rows")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .enumerate()
            {
                let Some(cells) = row.as_array() else {
                    continue;
                };
                for (col_idx, cell) in cells.iter().enumerate() {
                    let row_num = u32::try_from(row_idx).unwrap_or(u32::MAX);
                    let col_num = u16::try_from(col_idx).unwrap_or(u16::MAX);
                    let formatted = header && row_idx == 0;
                    match cell {
                        Value::Null => {}
                        Value::Bool(flag) => {
                            let _ = worksheet.write_boolean(row_num, col_num, *flag);
                        }
                        Value::Number(number) => {
                            let _ = worksheet.write_number(row_num, col_num, number.as_f64().unwrap_or_default());
                        }
                        Value::String(text) => {
                            if let Some(_formula) = text.strip_prefix('=') {
                                // rust_xlsxwriter 约定公式带 "=" 前缀，原样透传。
                                let _ = worksheet.write_formula(row_num, col_num, text.as_str());
                            } else if formatted {
                                let _ = worksheet.write_with_format(
                                    row_num,
                                    col_num,
                                    text.as_str(),
                                    &bold,
                                );
                            } else {
                                let _ = worksheet.write_string(row_num, col_num, text.as_str());
                            }
                        }
                        other => {
                            let _ = worksheet.write_string(
                                row_num,
                                col_num,
                                &other.to_string(),
                            );
                        }
                    }
                    if !cell.is_null() {
                        max_row = max_row.max(row_idx + 1);
                        max_col = max_col.max(col_idx + 1);
                    }
                }
            }
            let done = 10.0 + 80.0 * (idx + 1) as f32 / sheets.len() as f32;
            // 检查点落盘：save 可重复调用（内部 reset），右侧面板随 tool.progress
            // 重读文件，用户能实时看到工作表逐个出现。检查点失败不致命（最终
            // save 仍是权威写入并汇报错误）。
            let checkpoint = workbook.save(&target);
            last_sheet_name = sheet_name;
            last_sheet_range = selection_range(max_row, max_col);
            emit_progress(
            &on_update,
            "render",
            done,
            format!("已写入工作表 {sheet_name}（{}/{}）", idx + 1, sheets.len()),
            &target,
            Some((sheet_name.to_string(), last_sheet_range.clone())),
            None,
            );
            if let Err(error) = checkpoint {
                return Ok(error_output(format!(
                    "写入 {} 失败：{error}（文件可能被 Excel/WPS 占用，请关闭后重试）",
                    target.display()
                )));
            }
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
        match workbook.save(&target) {
            Ok(()) => {
                let size = std::fs::metadata(&target).map(|m| m.len()).unwrap_or(0);
                let mut extra = json!({ "bytes": size, "sheets": sheets.len(), "cells": total_cells });
                if !last_sheet_name.is_empty() {
                    extra["sheet"] = json!(last_sheet_name);
                    if let Some(range) = &last_sheet_range {
                        extra["range"] = json!(range);
                    }
                }
                Ok(output_with_details(
                    format!(
                        "已创建 {}（{} 个工作表，{total_cells} 个单元格，{} 字节）",
                        target.display(),
                        sheets.len(),
                        size
                    ),
                    &target,
                    extra,
                ))
            }
            Err(error) => Ok(error_output(format!(
                "写入 {} 失败：{error}（文件可能被 Excel/WPS 占用，请关闭后重试）",
                target.display()
            ))),
        }
    }
}

// ---------- read_xlsx ----------

pub struct ReadXlsxTool {
    cwd: PathBuf,
}

impl ReadXlsxTool {
    #[must_use]
    pub fn new(cwd: PathBuf) -> Self {
        Self { cwd }
    }
}

fn data_to_value(data: &calamine::Data) -> Value {
    use calamine::Data as D;
    match data {
        D::Int(value) => json!(value),
        D::Float(value) => {
            // xlsx 数字一律存 f64；整值归一为整数，模型读到 1 而非 1.0。
            if value.is_finite() && value.fract() == 0.0 && value.abs() < 9.0e15 {
                json!(*value as i64)
            } else {
                json!(value)
            }
        }
        D::String(value) => json!(value),
        D::Bool(value) => json!(value),
        D::DateTime(value) => json!(value.to_string()),
        D::DateTimeIso(value) => json!(value),
        D::DurationIso(value) => json!(value),
        D::Error(_) => json!(null),
        D::Empty => json!(null),
    }
}

#[async_trait]
impl Tool for ReadXlsxTool {
    fn name(&self) -> &str {
        "read_xlsx"
    }

    fn label(&self) -> &str {
        "读 Excel 文件"
    }

    fn description(&self) -> &str {
        "读取 Excel (.xlsx) 工作簿：返回工作表清单与指定表的前 N 行（默认 200 行 × 50 列，\
         可调）。返回 JSON（rows 数组，空单元格为 null）。大表请配合 max_rows 分段读取。"
    }

    fn parameters(&self) -> serde_json::Value {
        json!({
            "type": "object",
            "properties": {
                "path": { "type": "string", "description": ".xlsx 文件路径（相对当前工作目录或绝对路径）" },
                "sheet": { "type": "string", "description": "工作表名（默认第一个）" },
                "max_rows": { "type": "integer", "description": "最多读取行数（默认 200，上限 2000）" },
                "max_cols": { "type": "integer", "description": "最多读取列数（默认 50，上限 200）" }
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
        use calamine::Reader;
        let Some(path_raw) = input.get("path").and_then(Value::as_str) else {
            return Ok(error_output("缺少 path 参数".to_string()));
        };
        let target = resolve_path(&self.cwd, path_raw);
        if !target.is_file() {
            return Ok(error_output(format!("文件不存在：{}", target.display())));
        }
        let max_rows = input
            .get("max_rows")
            .and_then(Value::as_u64)
            .map(|v| (v as usize).clamp(1, READ_MAX_ROWS))
            .unwrap_or(READ_DEFAULT_ROWS);
        let max_cols = input
            .get("max_cols")
            .and_then(Value::as_u64)
            .map(|v| (v as usize).clamp(1, READ_MAX_COLS))
            .unwrap_or(READ_DEFAULT_COLS);

        emit_progress(
            &on_update,
            "parse",
            20.0,
            format!("打开 {}…", target.display()),
            &target,
            None,
            None,
        );
        let mut workbook: calamine::Xlsx<_> = match calamine::open_workbook(&target) {
            Ok(book) => book,
            Err(error) => {
                return Ok(error_output(format!(
                    "打开 {} 失败：{error}",
                    target.display()
                )))
            }
        };
        let sheet_names = workbook.sheet_names().to_vec();
        if sheet_names.is_empty() {
            return Ok(error_output(format!(
                "{} 没有可用工作表",
                target.display()
            )));
        }
        let wanted = input
            .get("sheet")
            .and_then(Value::as_str)
            .map(str::to_string)
            .unwrap_or_else(|| sheet_names[0].clone());
        let Some(sheet_name) = sheet_names.iter().find(|name| **name == wanted).cloned() else {
            return Ok(error_output(format!(
                "工作表 {wanted:?} 不存在；可用：{}",
                sheet_names.join(", ")
            )));
        };

        emit_progress(
            &on_update,
            "read",
            60.0,
            format!("读取工作表 {sheet_name}…"),
            &target,
            Some((sheet_name.clone(), None)),
            None,
        );
        let range = match workbook.worksheet_range(&sheet_name) {
            Ok(range) => range,
            Err(error) => {
                return Ok(error_output(format!(
                    "读取工作表 {sheet_name} 失败：{error}"
                )));
            }
        };
        let total_rows = range.get_size().0;
        let total_cols = range.get_size().1;
        let mut rows: Vec<Vec<Value>> = Vec::with_capacity(max_rows.min(total_rows));
        for (row_idx, row) in range.rows().enumerate() {
            if row_idx >= max_rows {
                break;
            }
            rows.push(
                row.iter()
                    .take(max_cols)
                    .map(data_to_value)
                    .collect::<Vec<_>>(),
            );
        }
        let truncated = total_rows > max_rows;
        let read_range = selection_range(rows.len(), total_cols.max(1));
        emit_progress(
            &on_update,
            "done",
            100.0,
            format!("读取完成（{} 行）", rows.len()),
            &target,
            Some((sheet_name.clone(), read_range.clone())),
            None,
        );
        let hint = if truncated {
            Value::String(format!(
                "仅返回前 {max_rows} 行（共 {total_rows}）；继续读请加大 max_rows 或用 bash+Python"
            ))
        } else {
            Value::Null
        };
        Ok(output_with_details(
            json!({
                "file": target.display().to_string(),
                "sheets": sheet_names,
                "sheet": sheet_name,
                "dimensions": { "rows": total_rows, "cols": total_cols },
                "rows": rows,
                "truncated": truncated,
                "hint": hint,
            })
            .to_string(),
            &target,
            json!({ "rows": rows.len() }),
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::sync::Arc;

    type Updates = Arc<std::sync::Mutex<Vec<ToolUpdate>>>;

    fn progress_sink() -> (Updates, Option<Box<dyn Fn(ToolUpdate) + Send + Sync>>) {
        let updates: Updates = Arc::default();
        let sink = Arc::clone(&updates);
        let callback = Box::new(move |update: ToolUpdate| {
            if let Ok(mut guard) = sink.lock() {
                guard.push(update);
            }
        });
        (updates, Some(callback))
    }

    #[test]
    fn selection_and_column_names() {
        assert_eq!(column_letter(0), "A");
        assert_eq!(column_letter(25), "Z");
        assert_eq!(column_letter(26), "AA");
        assert_eq!(column_letter(701), "ZZ");
        assert_eq!(selection_range(0, 3), None);
        assert_eq!(selection_range(3, 0), None);
        assert_eq!(selection_range(5, 1), Some("A1:A5".to_string()));
        assert_eq!(selection_range(4, 3), Some("A1:C4".to_string()));
    }

    #[tokio::test]
    async fn write_then_read_round_trip() {
        let dir = tempfile::tempdir().expect("tempdir");
        let cwd = dir.path().to_path_buf();
        let writer = WriteXlsxTool::new(cwd.clone());
        let (updates, callback) = progress_sink();
        let output = writer
            .execute(
                "call-1",
                json!({
                    "path": "out/report.xlsx",
                    "header": true,
                    "sheets": [
                        { "name": "数据", "rows": [["名称", "数量", "合计"], ["A", 1, "=B2*2"], ["B", 2.5, true], [null, null, null]] },
                        { "name": "Sheet2", "rows": [["x"]] }
                    ]
                }),
                callback,
            )
            .await
            .expect("execute");
        assert!(!output.is_error, "write 失败：{:?}", output.content);
        let written = dir.path().join("out/report.xlsx");
        assert!(written.is_file());

        // 进度：阶段推进、百分比单调、最终落盘阶段。
        let guard = updates.lock().expect("lock");
        assert!(guard.len() >= 4, "应有 parse/render/write 多阶段进度");
        let mut last = 0.0f64;
        for update in guard.iter() {
            let details = update.details.as_ref().expect("details");
            let percent = details.get("percent").and_then(Value::as_f64).expect("percent");
            assert!(percent >= last, "百分比应单调不减：{percent} < {last}");
            assert!(percent <= 100.0);
            assert!(details.get("stage").and_then(Value::as_str).is_some());
            last = percent;
        }
        assert!((last - 95.0).abs() < f64::EPSILON, "write 最终进度为落盘 95%");

        let reader = ReadXlsxTool::new(cwd);
        let read = reader
            .execute("call-2", json!({ "path": "out/report.xlsx", "sheet": "数据" }), None)
            .await
            .expect("read execute");
        assert!(!read.is_error);
        let text = match read.content.first() {
            Some(ContentBlock::Text(text)) => text.text.clone(),
            other => panic!("期望文本输出，收到 {other:?}"),
        };
        let payload: Value = serde_json::from_str(&text).expect("JSON 输出");
        assert_eq!(payload["sheet"], "数据");
        // 末行全 null 不物化到 xlsx：used range 只有 3 行。
        assert_eq!(payload["dimensions"]["rows"], 3);
        assert_eq!(payload["rows"][0][0], "名称");
        assert_eq!(payload["rows"][1][1], 1);
        assert_eq!(payload["rows"][2][1], 2.5);
        assert_eq!(payload["rows"][2][2], true);
        assert_eq!(payload["truncated"], false);
    }

    #[tokio::test]
    async fn read_truncates_rows() {
        let dir = tempfile::tempdir().expect("tempdir");
        let writer = WriteXlsxTool::new(dir.path().to_path_buf());
        let rows: Vec<Value> = (0..50).map(|i| json!([i, i * 2])).collect();
        let output = writer
            .execute(
                "c",
                json!({ "path": "big.xlsx", "sheets": [{ "name": "S", "rows": rows }] }),
                None,
            )
            .await
            .expect("write");
        assert!(!output.is_error);

        let reader = ReadXlsxTool::new(dir.path().to_path_buf());
        let read = reader
            .execute("c2", json!({ "path": "big.xlsx", "max_rows": 10 }), None)
            .await
            .expect("read");
        let text = match read.content.first() {
            Some(ContentBlock::Text(text)) => text.text.clone(),
            other => panic!("期望文本输出，收到 {other:?}"),
        };
        let payload: Value = serde_json::from_str(&text).expect("JSON");
        assert_eq!(payload["rows"].as_array().expect("rows").len(), 10);
        assert_eq!(payload["truncated"], true);
        assert!(payload["hint"].is_string());
    }

    #[tokio::test]
    async fn rejects_oversized_input_and_bad_names() {
        let dir = tempfile::tempdir().expect("tempdir");
        let writer = WriteXlsxTool::new(dir.path().to_path_buf());
        let big_row: Vec<Value> = vec![json!(0); 400];
        let rows: Vec<Value> = (0..1_400).map(|_| json!(big_row)).collect(); // 56 万 cell
        let output = writer
            .execute(
                "c",
                json!({ "path": "big.xlsx", "sheets": [{ "name": "S", "rows": rows }] }),
                None,
            )
            .await
            .expect("execute");
        assert!(output.is_error, "超过 cell 上限应拒绝");

        let bad_name = writer
            .execute(
                "c2",
                json!({ "path": "bad.xlsx", "sheets": [{ "name": "a:b", "rows": [[1]] }] }),
                None,
            )
            .await
            .expect("execute");
        assert!(bad_name.is_error, "非法工作表名应报错");
    }

    #[tokio::test]
    async fn read_reports_missing_file_and_sheet() {
        let dir = tempfile::tempdir().expect("tempdir");
        let reader = ReadXlsxTool::new(dir.path().to_path_buf());
        let missing = reader
            .execute("c", json!({ "path": "nope.xlsx" }), None)
            .await
            .expect("execute");
        assert!(missing.is_error);

        let writer = WriteXlsxTool::new(dir.path().to_path_buf());
        writer
            .execute(
                "c2",
                json!({ "path": "ok.xlsx", "sheets": [{ "name": "S", "rows": [[1]] }] }),
                None,
            )
            .await
            .expect("write");
        let wrong_sheet = reader
            .execute("c3", json!({ "path": "ok.xlsx", "sheet": "不存在" }), None)
            .await
            .expect("execute");
        assert!(wrong_sheet.is_error);
    }
}

// ---------- edit_xlsx ----------

/// 从 XML 标签串提取属性值（`<sheet name="Q3" r:id="rId5"/>` → tag_attr(tag, "name")）。
fn tag_attr(tag: &str, attr: &str) -> Option<String> {
    let needle = format!("{attr}=\"");
    let start = tag.find(&needle)? + needle.len();
    let end = tag[start..].find('"')? + start;
    Some(tag[start..end].to_string())
}

/// 定位 `<row r="N" ...>...</row>`（含自闭合）范围。
fn find_row_range(xml: &str, row: usize) -> Option<(usize, usize)> {
    let needle = format!(r#"<row r="{row}""#);
    let mut from = 0usize;
    loop {
        let rel = xml.get(from..)?.find(&needle)?;
        let start = from + rel;
        let rest = &xml[start..];
        let Some(gt_rel) = rest.find('>') else { return None };
        if rest[..gt_rel].ends_with('/') {
            return Some((start, start + gt_rel + 1));
        }
        let close_rel = rest.find("</row>")?;
        return Some((start, start + close_rel + "</row>".len()));
    }
}

/// 在 row 块内找 `<c r="REF" ...>...</c>` 范围，并返回除 r/t 外的属性（保样式 s 等）。
fn find_cell_range(row_block: &str, cell_ref: &str) -> Option<(usize, usize, String)> {
    let needle = format!(r#"<c r="{cell_ref}""#);
    let start = row_block.find(&needle)?;
    let rest = &row_block[start..];
    let gt_rel = rest.find('>')?;
    let open_tag = &rest[..gt_rel + 1];
    // 去掉元素名与 r/t 属性，只保留其余属性（如 s="1" 样式引用）。
    let attrs = open_tag
        .trim_end_matches('>')
        .trim_end_matches('/')
        .trim_start_matches("<c")
        .trim_start()
        .split_whitespace()
        .filter(|attr| !attr.starts_with("r=") && !attr.starts_with("t="))
        .collect::<Vec<_>>()
        .join(" ");
    let attrs = if attrs.is_empty() {
        String::new()
    } else {
        format!(" {attrs}")
    };
    if open_tag.ends_with("/>") {
        return Some((start, start + open_tag.len(), attrs));
    }
    let close_rel = rest.find("</c>")?;
    Some((start, start + close_rel + "</c>".len(), attrs))
}

/// 按值类型构造单元格 XML（字符串用 inlineStr，不碰 sharedStrings——零风险）。
fn build_cell_xml(cell_ref: &str, attrs: &str, value: &Value) -> String {
    match value {
        Value::Null => format!(r#"<c r="{cell_ref}"{attrs}/>"#),
        Value::Bool(flag) => {
            format!(r#"<c r="{cell_ref}"{attrs} t="b"><v>{}</v></c>"#, u8::from(*flag))
        }
        Value::Number(number) => {
            format!(r#"<c r="{cell_ref}"{attrs}><v>{}</v></c>"#, number)
        }
        Value::String(text) => {
            if let Some(formula) = text.strip_prefix('=') {
                format!(
                    r#"<c r="{cell_ref}"{attrs}><f>{}</f><v></v></c>"#,
                    super::xml_escape(formula)
                )
            } else {
                format!(
                    r#"<c r="{cell_ref}"{attrs} t="inlineStr"><is><t xml:space="preserve">{}</t></is></c>"#,
                    super::xml_escape(text)
                )
            }
        }
        _ => format!(r#"<c r="{cell_ref}"{attrs}/>"#),
    }
}

/// 把新 cell 按列序插入 row 块（已有格保留原位），返回新 row 块。
fn insert_cell_into_row(row_block: &str, cell_ref: &str, cell_xml: &str) -> Option<String> {
    let (col, _row) = super::parse_cell_ref(cell_ref)?;
    let mut cells: Vec<(usize, usize, usize)> = Vec::new(); // (col, start, end)
    let mut cursor = 0usize;
    while let Some(rel) = row_block[cursor..].find("<c ") {
        let abs = cursor + rel;
        let rest = &row_block[abs..];
        let Some(gt_rel) = rest.find('>') else { break };
        let Some(target) = tag_attr(&rest[..gt_rel + 1], "r") else {
            cursor = abs + 3;
            continue;
        };
        let Some(end) = find_cell_range(row_block, &target).map(|(_, end, _)| end) else {
            break;
        };
        if let Some((col_number, _)) = super::parse_cell_ref(&target) {
            cells.push((col_number, abs, end));
        }
        cursor = end;
    }
    let before = cells
        .iter()
        .find(|(existing_col, _, _)| *existing_col > col)
        .map(|(_, start, _)| *start);
    let mut result = String::with_capacity(row_block.len() + cell_xml.len());
    match before {
        Some(offset) => {
            result.push_str(&row_block[..offset]);
            result.push_str(cell_xml);
            result.push_str(&row_block[offset..]);
        }
        None => {
            // 无更大列：插在 </row> 前（自闭合行展开）。
            if let Some(close_rel) = row_block.rfind("</row>") {
                result.push_str(&row_block[..close_rel]);
                result.push_str(cell_xml);
                result.push_str(&row_block[close_rel..]);
            } else if let Some(slash) = row_block.rfind("/>") {
                // 自闭合行展开：<row r="3"/> → <row r="3">{cell}</row>
                result.push_str(&row_block[..slash]);
                result.push('>');
                result.push_str(cell_xml);
                result.push_str("</row>");
            } else {
                return None;
            }
        }
    }
    Some(result)
}

/// 应用一组单元格编辑（顺序执行字符串手术）。
fn apply_cell_edits(mut sheet_xml: String, edits: &[(String, Value)]) -> std::result::Result<String, String> {
    for (cell_ref, value) in edits {
        let Some((col, row)) = super::parse_cell_ref(cell_ref) else {
            return Err(format!("单元格地址 {cell_ref:?} 无效（如 B3）"));
        };
        let new_xml = {
            let attrs = find_cell_range(&sheet_xml, cell_ref)
                .map(|(_, _, attrs)| attrs)
                .unwrap_or_default();
            build_cell_xml(cell_ref, &attrs, value)
        };
        // 1) 行存在：格在 → 替换；格缺 → 插入。
        if let Some((row_start, row_end)) = find_row_range(&sheet_xml, row) {
            let row_block = sheet_xml[row_start..row_end].to_string();
            let updated = match find_cell_range(&row_block, cell_ref) {
                Some((cell_start, cell_end, _)) => {
                    let mut next = String::with_capacity(row_block.len());
                    next.push_str(&row_block[..cell_start]);
                    next.push_str(&new_xml);
                    next.push_str(&row_block[cell_end..]);
                    next
                }
                None => insert_cell_into_row(&row_block, cell_ref, &new_xml)
                    .ok_or_else(|| format!("插入单元格 {cell_ref} 失败"))?,
            };
            sheet_xml.replace_range(row_start..row_end, &updated);
            continue;
        }
        // 2) 行不存在：构建新行，按行序插入 sheetData。
        let row_xml = format!(r#"<row r="{row}">{new_xml}</row>"#);
        let Some(data_start) = sheet_xml.find("<sheetData>") else {
            return Err("工作表缺少 sheetData".to_string());
        };
        let content_start = data_start + "<sheetData>".len();
        let Some(data_end_rel) = sheet_xml[content_start..].find("</sheetData>") else {
            return Err("工作表缺少 sheetData 结束标记".to_string());
        };
        let data_end = content_start + data_end_rel;
        let body = &sheet_xml[content_start..data_end];
        let mut insert_at = data_end;
        let mut scan = 0usize;
        while let Some(rel) = body[scan..].find("<row r=\"") {
            let abs = scan + rel;
            let rest = &body[abs..];
            let Some(q) = rest[8..].find('"') else { break };
            let Ok(existing_row) = rest[8..8 + q].parse::<usize>() else {
                scan = abs + 8;
                continue;
            };
            if existing_row > row {
                insert_at = abs;
            }
            break;
        }
        let _ = scan;
        sheet_xml.insert_str(insert_at, &row_xml);
    }
    Ok(sheet_xml)
}

pub struct EditXlsxTool {
    cwd: PathBuf,
}

impl EditXlsxTool {
    #[must_use]
    pub fn new(cwd: PathBuf) -> Self {
        Self { cwd }
    }
}

#[async_trait]
impl Tool for EditXlsxTool {
    fn name(&self) -> &str {
        "edit_xlsx"
    }

    fn label(&self) -> &str {
        "改 Excel 单元格"
    }

    fn description(&self) -> &str {
        "就地修改既有 Excel (.xlsx) 的单元格：按地址寻址（如 B3），字符串/数字/布尔/公式（\"=\" 前缀）。\
         只改目标单元格的 XML，其余内容（样式/公式/图表）原样保留——改一个格子不要重发整表。\
         新建文件用 write_xlsx。"
    }

    fn parameters(&self) -> serde_json::Value {
        json!({
            "type": "object",
            "properties": {
                "path": { "type": "string", "description": ".xlsx 文件路径（相对当前工作目录或绝对路径）" },
                "sheet": { "type": "string", "description": "工作表名（默认第一个）" },
                "edits": {
                    "type": "array",
                    "description": "单元格编辑列表",
                    "items": {
                        "type": "object",
                        "properties": {
                            "cell": { "type": "string", "description": "单元格地址（如 B3）" },
                            "value": {
                                "description": "新值：string/number/boolean/null（null 清空）；\"=…\" 字符串按公式写入"
                            }
                        },
                        "required": ["cell", "value"]
                    }
                }
            },
            "required": ["path", "edits"]
        })
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
        let sheet_param = input.get("sheet").and_then(Value::as_str);
        let parsed: std::result::Result<Vec<(String, Value)>, String> = edits
            .iter()
            .map(|edit| {
                let cell = edit
                    .get("cell")
                    .and_then(Value::as_str)
                    .map(str::trim)
                    .map(str::to_string)
                    .unwrap_or_default();
                if cell.is_empty() {
                    return Err("edits[] 缺少 cell".to_string());
                }
                let value = edit.get("value").cloned().unwrap_or(Value::Null);
                Ok((cell, value))
            })
            .collect();
        let edits = match parsed {
            Ok(edits) => edits,
            Err(message) => return Ok(error_output(message)),
        };

        emit_progress(
        &on_update,
        "parse",
        10.0,
        format!("定位工作表（{} 处修改）…", edits.len()),
        &target,
        None,
        None,
        );

        if let Ok(previous) = std::fs::read(&target) {
            super::push_version(&target, &previous);
        }
        let file = match std::fs::File::open(&target) {
            Ok(file) => file,
            Err(error) => return Ok(error_output(format!("打开 {} 失败：{error}", target.display()))),
        };
        let mut archive = match zip::ZipArchive::new(file) {
            Ok(archive) => archive,
            Err(error) => {
                return Ok(error_output(format!(
                    "{} 不是有效的 .xlsx（{error}）",
                    target.display()
                )))
            }
        };
        let mut workbook = String::new();
        if archive
            .by_name("xl/workbook.xml")
            .and_then(|mut entry| {
                std::io::Read::read_to_string(&mut entry, &mut workbook)
                    .map_err(zip::result::ZipError::from)
            })
            .is_err()
        {
            return Ok(error_output("读取 xl/workbook.xml 失败".to_string()));
        }
        // 目标工作表：name 精确匹配（缺省取第一个）→ r:id。
        let mut sheet_rid: Option<String> = None;
        let mut sheet_name: Option<String> = None;
        let mut first_rid: Option<String> = None;
        let mut scan = 0usize;
        while let Some(rel) = workbook[scan..].find("<sheet ") {
            let abs = scan + rel;
            let Some(gt_rel) = workbook[abs..].find('>') else { break };
            let tag = &workbook[abs..abs + gt_rel + 1];
            let rid = tag_attr(tag, "r:id");
            if first_rid.is_none() {
                first_rid = rid.clone();
            }
            if let Some(name) = tag_attr(tag, "name") {
                if sheet_name.is_none() {
                    sheet_name = Some(name.clone());
                }
                if sheet_rid.is_none()
                    && sheet_param
                        .map(|wanted| wanted == name)
                        .unwrap_or(false)
                {
                    sheet_rid = rid;
                    sheet_name = Some(name);
                }
            }
            scan = abs + 7;
        }
        let Some(sheet_rid) = sheet_rid.or(first_rid) else {
            return Ok(error_output("工作簿没有工作表".to_string()));
        };
        let sheet_name = sheet_name.unwrap_or_default();
        let mut rels = String::new();
        if archive
            .by_name("xl/_rels/workbook.xml.rels")
            .and_then(|mut entry| {
                std::io::Read::read_to_string(&mut entry, &mut rels)
                    .map_err(zip::result::ZipError::from)
            })
            .is_err()
        {
            return Ok(error_output("读取 xl/_rels/workbook.xml.rels 失败".to_string()));
        }
        let mut part: Option<String> = None;
        let mut scan = 0usize;
        while let Some(rel) = rels[scan..].find("<Relationship ") {
            let abs = scan + rel;
            let Some(gt_rel) = rels[abs..].find('>') else { break };
            let tag = &rels[abs..abs + gt_rel + 1];
            if tag_attr(tag, "Id").as_deref() == Some(sheet_rid.as_str()) {
                let target_part = tag_attr(tag, "Target").unwrap_or_default();
                part = Some(
                    if target_part.starts_with('/') {
                        target_part[1..].to_string()
                    } else {
                        format!("xl/{target_part}")
                    },
                );
                break;
            }
            scan = abs + 14;
        }
        let Some(part) = part else {
            return Ok(error_output(format!(
                "工作表 {sheet_name:?} 的 XML 部件未找到（rels 损坏？）"
            )));
        };
        let mut sheet_xml = String::new();
        if archive
            .by_name(&part)
            .and_then(|mut entry| {
                std::io::Read::read_to_string(&mut entry, &mut sheet_xml)
                    .map_err(zip::result::ZipError::from)
            })
            .is_err()
        {
            return Ok(error_output(format!("读取 {part} 失败")));
        }

        // 逐格应用（字符串手术），进度随编辑数推进。
        let total = edits.len();
        let mut changes: Vec<Value> = Vec::new();
        for (idx, (cell_ref, value)) in edits.iter().enumerate() {
            sheet_xml = match apply_cell_edits(
                sheet_xml,
                std::slice::from_ref(&(cell_ref.clone(), value.clone())),
            ) {
                Ok(updated) => updated,
                Err(message) => return Ok(error_output(message)),
            };
            changes.push(json!({ "cell": cell_ref, "value": value }));
            let done = 10.0 + 80.0 * (idx + 1) as f32 / total as f32;
            emit_progress(
            &on_update,
            "render",
            done,
            format!("已修改 {cell_ref}（{}/{}）", idx + 1, total),
            &target,
            Some((sheet_name.clone(), None)),
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
        // 只替换目标工作表 part，其余条目逐字节原样（样式/公式/图表无损）。
        let bytes = match super::rebuild_zip_with_replacements(
            &target,
            &[(part.clone(), sheet_xml.into_bytes())],
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
            format!(
                "已修改 {}（工作表 {sheet_name:?}，{} 处单元格变更，{} 字节）",
                target.display(),
                total,
                size
            ),
            &target,
            json!({ "bytes": size, "sheet": sheet_name, "changes": changes }),
        ))
    }
}

#[cfg(test)]
mod edit_tests {
    use super::*;
    use serde_json::json;

    #[tokio::test]
    async fn edit_cells_then_read_back() {
        let dir = tempfile::tempdir().expect("tempdir");
        let cwd = dir.path().to_path_buf();
        let writer = WriteXlsxTool::new(cwd.clone());
        let output = writer
            .execute(
                "c1",
                json!({
                    "path": "book.xlsx",
                    "sheets": [{ "name": "数据", "rows": [["名称", "数量"], ["A", 1], ["B", 2]] }]
                }),
                None,
            )
            .await
            .expect("write");
        assert!(!output.is_error);

        // 编辑已有格 + 新增格（新列 C、新行 4）。
        let editor = EditXlsxTool::new(cwd.clone());
        let edit = editor
            .execute(
                "c2",
                json!({
                    "path": "book.xlsx",
                    "sheet": "数据",
                    "edits": [
                        { "cell": "B2", "value": 120 },
                        { "cell": "C2", "value": "=B2*2" },
                        { "cell": "A4", "value": "汇总" }
                    ]
                }),
                None,
            )
            .await
            .expect("edit");
        assert!(!edit.is_error, "edit 失败：{:?}", edit.content);

        let reader = ReadXlsxTool::new(cwd);
        let read = reader
            .execute("c3", json!({ "path": "book.xlsx", "sheet": "数据" }), None)
            .await
            .expect("read");
        let text = match read.content.first() {
            Some(pi::sdk::ContentBlock::Text(text)) => text.text.clone(),
            other => panic!("期望文本输出，收到 {other:?}"),
        };
        let payload: Value = serde_json::from_str(&text).unwrap_or_else(|error| {
            panic!("JSON 解析失败（{error}）：{text}");
        });
        let rows = payload["rows"].as_array().expect("rows");
        assert_eq!(rows[1][1], 120, "B2 应已更新");
        // C2 是新写公式（<f> 无缓存 <v>）：calamine 读到 Null 属预期，Excel/WPS 打开时重算。
        assert!(rows[1][2].is_null(), "未缓存公式读值应为 null，实际 {:?}", rows[1][2]);
        assert_eq!(rows[3][0], "汇总", "新行 A4 应插入");
    }

    #[tokio::test]
    async fn edit_preserves_other_cells_and_reports_changes() {
        let dir = tempfile::tempdir().expect("tempdir");
        let cwd = dir.path().to_path_buf();
        let writer = WriteXlsxTool::new(cwd.clone());
        writer
            .execute("c1", json!({ "path": "b.xlsx", "sheets": [{ "name": "S", "rows": [["x", "y"]] }] }), None)
            .await
            .expect("write");
        let editor = EditXlsxTool::new(cwd.clone());
        let mut updates = std::sync::Arc::new(std::sync::Mutex::new(Vec::new()));
        let sink = std::sync::Arc::clone(&updates);
        let callback: Option<Box<dyn Fn(ToolUpdate) + Send + Sync>> =
            Some(Box::new(move |update: ToolUpdate| {
                if let Ok(mut guard) = sink.lock() {
                    guard.push(update);
                }
            }));
        let edit = editor
            .execute(
                "c2",
                json!({ "path": "b.xlsx", "sheet": "S", "edits": [{ "cell": "A1", "value": "改好的" }] }),
                callback,
            )
            .await
            .expect("edit");
        assert!(!edit.is_error);
        // details 携带变更集（前端逐格高亮用）。
        let details = edit.details.as_ref().expect("details");
        let changes = details.get("changes").and_then(Value::as_array).expect("changes");
        assert_eq!(changes.len(), 1);
        assert_eq!(changes[0]["cell"], "A1");
        assert_eq!(changes[0]["value"], "改好的");
        // 进度事件同样携带 path/sheet。
        let guard = updates.lock().expect("lock");
        assert!(guard.iter().any(|update| {
            update
                .details
                .as_ref()
                .and_then(|d| d.get("sheet"))
                .map(|sheet| sheet == "S")
                .unwrap_or(false)
        }));

        // 未触碰的 B1 保持原值。
        let reader = ReadXlsxTool::new(cwd);
        let read = reader.execute("c3", json!({ "path": "b.xlsx" }), None).await.expect("read");
        let text = match read.content.first() {
            Some(pi::sdk::ContentBlock::Text(text)) => text.text.clone(),
            other => panic!("期望文本输出，收到 {other:?}"),
        };
        let payload: Value = serde_json::from_str(&text).expect("JSON");
        assert_eq!(payload["rows"][0][1], "y");
    }
}
