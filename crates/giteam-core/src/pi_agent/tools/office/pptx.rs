//! PPT 读写：手写最小 OOXML（zip + 固定模板）生成 .pptx；quick-xml 读文本。
//!
//! 没有成熟的 Rust pptx 生成库，直接构造 Open Packaging Conventions 包：
//! 必需的 9 类部件（content-types / rels / presentation / presProps / theme /
//! slideMaster / slideLayout / slideN）全部用最小合法模板，文本框用显式格式
//! （sz/b），不依赖占位符继承。读侧只提取 <a:t> 文本（预览/模型理解够用）。
//!
//! 与 xlsx/docx 同管道：分阶段 on_update 进度 + 每页落盘检查点。

use super::{emit_progress, error_output, output_with_details, resolve_path};
use async_trait::async_trait;
use pi::sdk::{Result, Tool, ToolOutput, ToolUpdate};
use pi::tools::ToolEffects;
use serde_json::{json, Value};
use std::path::PathBuf;

/// 页数护栏。
const MAX_SLIDES: usize = 500;
/// read_pptx 默认/上限页数。
const READ_DEFAULT_SLIDES: usize = 50;
const READ_MAX_SLIDES: usize = 500;

const NS_A: &str = "http://schemas.openxmlformats.org/drawingml/2006/main";
const NS_R: &str = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const NS_P: &str = "http://schemas.openxmlformats.org/presentationml/2006/main";

fn slide_xml(title: &str, bullets: &[String]) -> String {
    let mut shapes = String::new();
    shapes.push_str(&format!(
        r#"<p:sp><p:nvSpPr><p:cNvPr id="2" name="标题"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="457200" y="274638"/><a:ext cx="8229600" cy="1143000"/></a:xfrm></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="zh-CN" sz="3200" b="1"/><a:t>{}</a:t></a:r></a:p></p:txBody></p:sp>"#,
        super::xml_escape(title)
    ));
    if !bullets.is_empty() {
        let mut paras = String::new();
        for bullet in bullets {
            paras.push_str(&format!(
                r#"<a:p><a:pPr marL="342900" indent="-342900"><a:buFont typeface="Arial"/><a:buChar char="•"/></a:pPr><a:r><a:rPr lang="zh-CN" sz="2200"/><a:t>{}</a:t></a:r></a:p>"#,
                super::xml_escape(bullet)
            ));
        }
        shapes.push_str(&format!(
            r#"<p:sp><p:nvSpPr><p:cNvPr id="3" name="内容"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="457200" y="1600200"/><a:ext cx="8229600" cy="4800000"/></a:xfrm></p:spPr><p:txBody><a:bodyPr wrap="square"/><a:lstStyle/>{paras}</p:txBody></p:sp>"#
        ));
    }
    format!(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="{NS_A}" xmlns:r="{NS_R}" xmlns:p="{NS_P}"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>{shapes}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>"#
    )
}

const RELS_ROOT: &str = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>"#;

const SLIDE_MASTER: &str = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldMaster xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree></p:cSld><p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/><p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst></p:sldMaster>"#;

const SLIDE_MASTER_RELS: &str = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/></Relationships>"#;

const SLIDE_LAYOUT: &str = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldLayout xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" type="blank" preserve="1"><p:cSld name="空白"><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>"#;

const SLIDE_LAYOUT_RELS: &str = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/></Relationships>"#;

const PRES_PROPS: &str = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentationPr xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"/>"#;

const APP_PROPS: &str = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>Giteam</Application></Properties>"#;

const THEME: &str = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Giteam"><a:themeElements><a:clrScheme name="Giteam"><a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="1F2937"/></a:dk2><a:lt2><a:srgbClr val="F3F4F6"/></a:lt2><a:accent1><a:srgbClr val="2563EB"/></a:accent1><a:accent2><a:srgbClr val="10B981"/></a:accent2><a:accent3><a:srgbClr val="F59E0B"/></a:accent3><a:accent4><a:srgbClr val="EF4444"/></a:accent4><a:accent5><a:srgbClr val="8B5CF6"/></a:accent5><a:accent6><a:srgbClr val="06B6D4"/></a:accent6><a:hlink><a:srgbClr val="0000FF"/></a:hlink><a:folHlink><a:srgbClr val="800080"/></a:folHlink></a:clrScheme><a:fontScheme name="Office"><a:majorFont><a:latin typeface="Calibri Light"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme><a:fmtScheme name="Office"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst><a:lnStyleLst><a:ln w="6350" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/></a:ln><a:ln w="12700" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/></a:ln><a:ln w="19050" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/></a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>"#;

fn content_types_xml(slide_count: usize) -> String {
    let mut overrides = String::new();
    for i in 1..=slide_count {
        overrides.push_str(&format!(
            r#"<Override PartName="/ppt/slides/slide{i}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>"#
        ));
    }
    format!(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/presProps.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presProps+xml"/><Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/><Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/><Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>{overrides}<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>"#
    )
}

fn presentation_xml(slide_count: usize) -> String {
    let mut sld_id_lst = String::new();
    for i in 1..=slide_count {
        sld_id_lst.push_str(&format!(r#"<p:sldId id="{}" r:id="rId{}"/>"#, 255 + i, i + 1));
    }
    format!(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:a="{NS_A}" xmlns:r="{NS_R}" xmlns:p="{NS_P}"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst>{sld_id_lst}</p:sldIdLst><p:sldSz cx="9144000" cy="6858000"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>"#
    )
}

fn presentation_rels_xml(slide_count: usize) -> String {
    let mut rels = String::new();
    for i in 1..=slide_count {
        rels.push_str(&format!(
            r#"<Relationship Id="rId{}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide{i}.xml"/>"#,
            i + 1
        ));
    }
    format!(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/>{rels}<Relationship Id="rId{}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/presProps" Target="presProps.xml"/></Relationships>"#,
        slide_count + 1
    )
}

const SLIDE_RELS: &str = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/></Relationships>"#;

fn core_props_xml(title: &str) -> String {
    format!(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>{}</dc:title><dc:creator>Giteam</dc:creator><cp:lastModifiedBy>Giteam</cp:lastModifiedBy></cp:coreProperties>"#,
        super::xml_escape(title)
    )
}

/// 把 slides 构建为完整 .pptx 字节（全量重建——页数少，检查点语义简单）。
fn build_pptx_buffer(slides: &[Value]) -> std::result::Result<Vec<u8>, String> {
    let mut buffer = std::io::Cursor::new(Vec::new());
    {
        let mut archive = zip::ZipWriter::new(&mut buffer);
        let options = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated);
        let mut put = |name: &str, content: &str| -> std::result::Result<(), String> {
            archive
                .start_file(name, options)
                .map_err(|error| format!("写入 zip 条目 {name} 失败：{error}"))?;
            std::io::Write::write_all(&mut archive, content.as_bytes())
                .map_err(|error| format!("写入 zip 条目 {name} 失败：{error}"))
        };
        put("[Content_Types].xml", &content_types_xml(slides.len()))?;
        put("_rels/.rels", RELS_ROOT)?;
        put("docProps/core.xml", &core_props_xml(
            slides
                .first()
                .and_then(|s| s.get("title"))
                .and_then(Value::as_str)
                .unwrap_or("Giteam 演示文稿"),
        ))?;
        put("docProps/app.xml", APP_PROPS)?;
        put("ppt/presentation.xml", &presentation_xml(slides.len()))?;
        put("ppt/_rels/presentation.xml.rels", &presentation_rels_xml(slides.len()))?;
        put("ppt/presProps.xml", PRES_PROPS)?;
        put("ppt/theme/theme1.xml", THEME)?;
        put("ppt/slideMasters/slideMaster1.xml", SLIDE_MASTER)?;
        put("ppt/slideMasters/_rels/slideMaster1.xml.rels", SLIDE_MASTER_RELS)?;
        put("ppt/slideLayouts/slideLayout1.xml", SLIDE_LAYOUT)?;
        put("ppt/slideLayouts/_rels/slideLayout1.xml.rels", SLIDE_LAYOUT_RELS)?;
        for (idx, slide) in slides.iter().enumerate() {
            let title = slide.get("title").and_then(Value::as_str).unwrap_or_default();
            let bullets: Vec<String> = slide
                .get("bullets")
                .and_then(Value::as_array)
                .map(|items| {
                    items
                        .iter()
                        .filter_map(|item| item.as_str().map(str::to_string))
                        .collect()
                })
                .unwrap_or_default();
            let n = idx + 1;
            put(&format!("ppt/slides/slide{n}.xml"), &slide_xml(title, &bullets))?;
            put(&format!("ppt/slides/_rels/slide{n}.xml.rels"), SLIDE_RELS)?;
        }
        archive
            .finish()
            .map_err(|error| format!("完成 zip 写入失败：{error}"))?;
    }
    Ok(buffer.into_inner())
}

// ---------- write_pptx ----------

pub struct WritePptxTool {
    cwd: PathBuf,
}

impl WritePptxTool {
    #[must_use]
    pub fn new(cwd: PathBuf) -> Self {
        Self { cwd }
    }
}

#[async_trait]
impl Tool for WritePptxTool {
    fn name(&self) -> &str {
        "write_pptx"
    }

    fn label(&self) -> &str {
        "写 PPT 演示文稿"
    }

    fn description(&self) -> &str {
        "创建 PowerPoint (.pptx) 演示文稿。slides 按序为页面：title（标题）+ bullets（要点列表）。\
         空白布局 + 显式字号；复杂母版/图表/图片请改用 bash + Python（python-pptx）。"
    }

    fn parameters(&self) -> serde_json::Value {
        json!({
            "type": "object",
            "properties": {
                "path": {
                    "type": "string",
                    "description": "目标 .pptx 路径（相对当前工作目录或绝对路径）"
                },
                "slides": {
                    "type": "array",
                    "description": "页面列表（按序写入）",
                    "items": {
                        "type": "object",
                        "properties": {
                            "title": { "type": "string", "description": "页面标题" },
                            "bullets": {
                                "type": "array",
                                "description": "要点列表（每项一行）",
                                "items": { "type": "string" }
                            }
                        },
                        "required": ["title"]
                    }
                }
            },
            "required": ["path", "slides"]
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
            .map(|e| e.eq_ignore_ascii_case("pptx"))
            != Some(true)
        {
            return Ok(error_output(format!("path 应指向 .pptx 文件（收到 {path_raw}）")));
        }
        let Some(slides) = input.get("slides").and_then(Value::as_array) else {
            return Ok(error_output("缺少 slides 参数".to_string()));
        };
        if slides.is_empty() {
            return Ok(error_output("slides 不能为空".to_string()));
        }
        if slides.len() > MAX_SLIDES {
            return Ok(error_output(format!(
                "共 {} 页，超过上限 {MAX_SLIDES}；请分批生成",
                slides.len()
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
        format!("解析 {} 页幻灯片…", slides.len()),
        &target,
        None,
        None,
        );

        // 分页检查点：每写完一页重建并落盘，前端预览跟随到该页（slide:N）。
        for idx in 0..slides.len() {
            let written = &slides[..=idx];
            let buffer = match build_pptx_buffer(written) {
                Ok(buffer) => buffer,
                Err(error) => return Ok(error_output(format!("构建演示文稿失败：{error}"))),
            };
            if let Err(error) = std::fs::write(&target, buffer) {
                return Ok(error_output(format!(
                    "写入 {} 失败：{error}（文件可能被 PowerPoint/WPS 占用，请关闭后重试）",
                    target.display()
                )));
            }
            let done = 10.0 + 80.0 * (idx + 1) as f32 / slides.len() as f32;
            let title = written[idx].get("title").and_then(Value::as_str).unwrap_or_default();
            emit_progress(
            &on_update,
            "render",
            done,
            format!("已写入第 {} 页「{title}」", idx + 1),
            &target,
            Some((format!("slide:{}", idx + 1), None)),
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
            format!("已创建 {}（{} 页，{} 字节）", target.display(), slides.len(), size),
            &target,
            json!({
                "bytes": size,
                "slides": slides.len(),
                "sheet": format!("slide:{}", slides.len()),
            }),
        ))
    }
}

// ---------- read_pptx ----------

pub struct ReadPptxTool {
    cwd: PathBuf,
}

impl ReadPptxTool {
    #[must_use]
    pub fn new(cwd: PathBuf) -> Self {
        Self { cwd }
    }
}

/// 提取一个 slide XML 的 <a:t> 文本（按文档顺序，实体反转义）。
pub(crate) fn extract_slide_texts(xml: &str) -> Vec<String> {
    let mut texts: Vec<String> = Vec::new();
    let mut i = 0usize;
    while i < xml.len() {
        let rest = &xml[i..];
        let Some(open_rel) = rest.find("<a:t>") else { break };
        let inner = &rest[open_rel + "<a:t>".len()..];
        let Some(end) = inner.find("</a:t>") else { break };
        let unescaped = super::xml_unescape(&inner[..end]);
        let trimmed = unescaped.trim();
        if !trimmed.is_empty() {
            texts.push(trimmed.to_string());
        }
        i += open_rel + "<a:t>".len() + end + "</a:t>".len();
    }
    texts
}

#[async_trait]
impl Tool for ReadPptxTool {
    fn name(&self) -> &str {
        "read_pptx"
    }

    fn label(&self) -> &str {
        "读 PPT 演示文稿"
    }

    fn description(&self) -> &str {
        "读取 PowerPoint (.pptx)：返回每页的文本内容（标题 + 要点，默认前 50 页）。\
         图片/形状坐标不提取；复杂结构请用 bash + Python。"
    }

    fn parameters(&self) -> serde_json::Value {
        json!({
            "type": "object",
            "properties": {
                "path": { "type": "string", "description": ".pptx 文件路径（相对当前工作目录或绝对路径）" },
                "max_slides": { "type": "integer", "description": "最多读取页数（默认 50，上限 500）" }
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
        let max_slides = input
            .get("max_slides")
            .and_then(Value::as_u64)
            .map(|v| (v as usize).clamp(1, READ_MAX_SLIDES))
            .unwrap_or(READ_DEFAULT_SLIDES);

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
                    "{} 不是有效的 .pptx（{error}）",
                    target.display()
                )))
            }
        };
        // slideN.xml 按数字排序（slide10 不能排在 slide2 前）。
        let mut slide_entries: Vec<(usize, String)> = archive
            .file_names()
            .filter_map(|name| {
                let name = name.ok()?;
                let digits = name
                    .strip_prefix("ppt/slides/slide")?
                    .strip_suffix(".xml")?;
                let index: usize = digits.parse().ok()?;
                Some((index, name.to_string()))
            })
            .collect();
        slide_entries.sort_by_key(|(index, _)| *index);
        if slide_entries.is_empty() {
            return Ok(error_output("该演示文稿没有幻灯片".to_string()));
        }
        emit_progress(
        &on_update,
        "read",
        60.0,
        format!("读取 {} 页…", slide_entries.len()),
        &target,
        None,
        None,
        );
        let mut slides: Vec<Value> = Vec::new();
        let total = slide_entries.len();
        let truncated = total > max_slides;
        for (index, name) in slide_entries.into_iter().take(max_slides) {
            use std::io::Read;
            let mut xml = String::new();
            if archive
                .by_name(&name)
                .and_then(|mut entry| {
                    std::io::Read::read_to_string(&mut entry, &mut xml)
                        .map_err(zip::result::ZipError::from)
                })
                .is_err()
            {
                continue;
            }
            let texts = extract_slide_texts(&xml);
            slides.push(json!({ "index": index, "texts": texts }));
        }
        let hint = if truncated {
            Value::String(format!(
                "仅返回前 {max_slides} 页（共 {total}）；继续读请加大 max_slides 或用 bash+Python"
            ))
        } else {
            Value::Null
        };
        emit_progress(
            &on_update,
            "done",
            100.0,
            format!("读取完成（{} 页）", slides.len()),
            &target,
            None,
            None,
        );
        Ok(output_with_details(
            json!({
                "file": target.display().to_string(),
                "slides": slides,
                "totalSlides": total,
                "truncated": truncated,
                "hint": hint,
            })
            .to_string(),
            &target,
            json!({ "slides": slides.len() }),
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[tokio::test]
    async fn write_then_read_pptx_round_trip() {
        let dir = tempfile::tempdir().expect("tempdir");
        let writer = WritePptxTool::new(dir.path().to_path_buf());
        let output = writer
            .execute(
                "c1",
                json!({
                    "path": "deck.pptx",
                    "slides": [
                        { "title": "年度报告", "bullets": ["增长 12%", "三个里程碑"] },
                        { "title": "展望", "bullets": ["Q1 计划"] }
                    ]
                }),
                None,
            )
            .await
            .expect("execute");
        assert!(!output.is_error, "write 失败：{:?}", output.content);
        assert!(dir.path().join("deck.pptx").is_file());

        let reader = ReadPptxTool::new(dir.path().to_path_buf());
        let read = reader
            .execute("c2", json!({ "path": "deck.pptx" }), None)
            .await
            .expect("read execute");
        assert!(!read.is_error);
        let text = match read.content.first() {
            Some(pi::sdk::ContentBlock::Text(text)) => text.text.clone(),
            other => panic!("期望文本输出，收到 {other:?}"),
        };
        let payload: Value = serde_json::from_str(&text).expect("JSON");
        let slides = payload["slides"].as_array().expect("slides");
        assert_eq!(slides.len(), 2);
        assert_eq!(slides[0]["texts"][0], "年度报告");
        assert_eq!(slides[0]["texts"][1], "增长 12%");
        assert_eq!(slides[1]["texts"][0], "展望");
    }

    #[tokio::test]
    async fn write_escapes_xml_and_read_missing_file() {
        let dir = tempfile::tempdir().expect("tempdir");
        let writer = WritePptxTool::new(dir.path().to_path_buf());
        let output = writer
            .execute(
                "c1",
                json!({
                    "path": "special.pptx",
                    "slides": [{ "title": "A & B <对比>", "bullets": ["含 \"引号\" 与 <标签>"] }]
                }),
                None,
            )
            .await
            .expect("execute");
        assert!(!output.is_error);
        let reader = ReadPptxTool::new(dir.path().to_path_buf());
        let read = reader
            .execute("c2", json!({ "path": "special.pptx" }), None)
            .await
            .expect("read");
        let text = match read.content.first() {
            Some(pi::sdk::ContentBlock::Text(text)) => text.text.clone(),
            other => panic!("期望文本输出，收到 {other:?}"),
        };
        let payload: Value = serde_json::from_str(&text).expect("JSON");
        assert_eq!(payload["slides"][0]["texts"][0], "A & B <对比>");

        let missing = reader
            .execute("c3", json!({ "path": "nope.pptx" }), None)
            .await
            .expect("execute");
        assert!(missing.is_error);
    }
}

// ---------- edit_pptx ----------

pub struct EditPptxTool {
    cwd: PathBuf,
}

impl EditPptxTool {
    #[must_use]
    pub fn new(cwd: PathBuf) -> Self {
        Self { cwd }
    }
}

#[async_trait]
impl Tool for EditPptxTool {
    fn name(&self) -> &str {
        "edit_pptx"
    }

    fn label(&self) -> &str {
        "改 PPT 页面"
    }

    fn description(&self) -> &str {
        "就地修改既有 PowerPoint (.pptx) 的某一页：重写该页的标题/要点（其他页与母版样式\
         原样保留）。slide = 页号（1 基）；slide = 总页数+1 时在末尾追加新页（仅限本工具\
         生成的文件）。只改目标页，不要重发全部页面。"
    }

    fn parameters(&self) -> serde_json::Value {
        json!({
            "type": "object",
            "properties": {
                "path": { "type": "string", "description": ".pptx 文件路径（相对当前工作目录或绝对路径）" },
                "slide": { "type": "integer", "description": "页号（1 基；总页数+1 = 末尾追加）" },
                "title": { "type": "string", "description": "新标题（缺省保留原标题）" },
                "bullets": {
                    "type": "array",
                    "description": "新要点列表（缺省保留原要点）",
                    "items": { "type": "string" }
                }
            },
            "required": ["path", "slide"]
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
        let Some(slide_number) = input.get("slide").and_then(Value::as_u64) else {
            return Ok(error_output("缺少 slide 参数（页号，1 基）".to_string()));
        };
        let slide_number = usize::try_from(slide_number).unwrap_or(0);
        if slide_number == 0 {
            return Ok(error_output("slide 页号从 1 开始".to_string()));
        }
        let has_title = input.get("title").and_then(Value::as_str).is_some();
        let has_bullets = input.get("bullets").and_then(Value::as_array).is_some();

        emit_progress(
            &on_update,
            "parse",
            10.0,
            format!("定位第 {slide_number} 页…"),
            &target,
            Some((format!("slide:{slide_number}"), None)),
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
                    "{} 不是有效的 .pptx（{error}）",
                    target.display()
                )))
            }
        };
        let mut slide_entries: Vec<(usize, String)> = archive
            .file_names()
            .filter_map(|name| {
                let name = name.ok()?;
                let digits = name.strip_prefix("ppt/slides/slide")?.strip_suffix(".xml")?;
                Some((digits.parse::<usize>().ok()?, name.to_string()))
            })
            .collect();
        slide_entries.sort_by_key(|(index, _)| *index);
        let count = slide_entries.len();
        if count == 0 {
            return Ok(error_output("该演示文稿没有幻灯片".to_string()));
        }

        // 追加到末尾：只支持本工具生成的包（其他来源的母版结构未知，模板重建有损坏风险）。
        let appending = slide_number == count + 1;
        if appending {
            let mut app = String::new();
            if archive
                .by_name("docProps/app.xml")
                .and_then(|mut entry| {
                    std::io::Read::read_to_string(&mut entry, &mut app)
                        .map_err(zip::result::ZipError::from)
                })
                .is_err()
            {
                return Ok(error_output("读取 docProps/app.xml 失败".to_string()));
            }
            if !app.contains("<Application>Giteam</Application>") {
                return Ok(error_output(
                    "追加页面仅支持本工具生成的演示文稿；外部文件请改用 bash + Python（python-pptx）"
                        .to_string(),
                ));
            }
        } else if slide_number > count {
            return Ok(error_output(format!(
                "slide={slide_number} 超出范围（共 {count} 页；追加请用 {count}+1）"
            )));
        }

        // 目标页现有文本：未提供的字段回落到原值。
        let (mut title, mut bullets) = (None, None);
        if slide_number <= count {
            let name = &slide_entries
                .iter()
                .find(|(index, _)| *index == slide_number)
                .expect("checked")
                .1;
            let mut xml = String::new();
            if archive
                .by_name(name)
                .and_then(|mut entry| {
                    std::io::Read::read_to_string(&mut entry, &mut xml)
                        .map_err(zip::result::ZipError::from)
                })
                .is_err()
            {
                xml = String::new();
            }
            let texts = extract_slide_texts(&xml);
            if !has_title {
                title = texts.first().cloned();
            }
            if !has_bullets {
                bullets = if texts.len() > 1 {
                    Some(texts[1..].to_vec())
                } else {
                    Some(Vec::new())
                };
            }
        }
        let title = title
            .or_else(|| input.get("title").and_then(Value::as_str).map(str::to_string))
            .unwrap_or_else(|| format!("第 {slide_number} 页"));
        let bullets = bullets.unwrap_or_else(|| {
            input
                .get("bullets")
                .and_then(Value::as_array)
                .map(|items| {
                    items
                        .iter()
                        .filter_map(|item| item.as_str().map(str::to_string))
                        .collect()
                })
                .unwrap_or_default()
        });

        emit_progress(
            &on_update,
            "render",
            55.0,
            format!("重写第 {slide_number} 页…"),
            &target,
            Some((format!("slide:{slide_number}"), None)),
            None,
        );

        let new_slide = slide_xml(&title, &bullets);
        if appending {
            // 追加：包结构（content-types/presentation/rels）按 count+1 重建，新页作为新增条目。
            let part = format!("ppt/slides/slide{slide_number}.xml");
            let rels_part = format!("ppt/slides/_rels/slide{slide_number}.xml.rels");
            let bytes = match super::rebuild_zip_with_replacements(
                &target,
                &[
                    ("[Content_Types].xml".to_string(), content_types_xml(count + 1).into_bytes()),
                    ("ppt/presentation.xml".to_string(), presentation_xml(count + 1).into_bytes()),
                    (
                        "ppt/_rels/presentation.xml.rels".to_string(),
                        presentation_rels_xml(count + 1).into_bytes(),
                    ),
                ],
                &[
                    (part.clone(), new_slide.into_bytes()),
                    (rels_part, SLIDE_RELS.as_bytes().to_vec()),
                ],
            ) {
                Ok(bytes) => bytes,
                Err(message) => return Ok(error_output(message)),
            };
            if let Err(error) = std::fs::write(&target, bytes) {
                return Ok(error_output(format!("写盘失败：{error}")));
            }
        } else {
            let name = format!("ppt/slides/slide{slide_number}.xml");
            let bytes = match super::rebuild_zip_with_replacements(
                &target,
                &[(name.clone(), new_slide.into_bytes())],
                &[],
            ) {
                Ok(bytes) => bytes,
                Err(message) => return Ok(error_output(message)),
            };
            if let Err(error) = std::fs::write(&target, bytes) {
                return Ok(error_output(format!("写盘失败：{error}")));
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
        let size = std::fs::metadata(&target).map(|m| m.len()).unwrap_or(0);
        let action = if appending { "已追加" } else { "已修改" };
        Ok(output_with_details(
            format!(
                "{action} {} 第 {slide_number} 页（{title}，{} 字节）",
                target.display(),
                size
            ),
            &target,
            json!({ "bytes": size, "sheet": format!("slide:{slide_number}"), "slides": if appending { count + 1 } else { count } }),
        ))
    }
}

#[cfg(test)]
mod edit_tests {
    use super::*;
    use serde_json::json;

    #[tokio::test]
    async fn edit_slide_and_append() {
        let dir = tempfile::tempdir().expect("tempdir");
        let cwd = dir.path().to_path_buf();
        let writer = WritePptxTool::new(cwd.clone());
        writer
            .execute(
                "c1",
                json!({
                    "path": "deck.pptx",
                    "slides": [
                        { "title": "封面", "bullets": ["2024"] },
                        { "title": "数据", "bullets": ["增长"] }
                    ]
                }),
                None,
            )
            .await
            .expect("write");

        let editor = EditPptxTool::new(cwd.clone());
        // 改第 1 页标题（只给 title，bullets 应回落保留）。
        let edit = editor
            .execute(
                "c2",
                json!({ "path": "deck.pptx", "slide": 1, "title": "2024 年度报告" }),
                None,
            )
            .await
            .expect("edit");
        assert!(!edit.is_error, "edit 失败：{:?}", edit.content);
        // 追加第 3 页。
        let append = editor
            .execute(
                "c3",
                json!({ "path": "deck.pptx", "slide": 3, "title": "展望", "bullets": ["Q1"] }),
                None,
            )
            .await
            .expect("append");
        assert!(!append.is_error);

        let reader = ReadPptxTool::new(cwd);
        let read = reader.execute("c4", json!({ "path": "deck.pptx" }), None).await.expect("read");
        let text = match read.content.first() {
            Some(pi::sdk::ContentBlock::Text(text)) => text.text.clone(),
            other => panic!("期望文本输出，收到 {other:?}"),
        };
        let payload: Value = serde_json::from_str(&text).expect("JSON");
        let slides = payload["slides"].as_array().expect("slides");
        assert_eq!(slides.len(), 3, "追加后应 3 页");
        assert_eq!(slides[0]["texts"][0], "2024 年度报告", "标题已改");
        assert_eq!(slides[0]["texts"][1], "2024", "未提供的 bullets 保留");
        assert_eq!(slides[1]["texts"][0], "数据", "未触碰页原样");
        assert_eq!(slides[2]["title"]  , Value::Null, "占位");
        assert_eq!(slides[2]["texts"][0], "展望");
    }

    #[tokio::test]
    async fn edit_out_of_range_is_error() {
        let dir = tempfile::tempdir().expect("tempdir");
        let cwd = dir.path().to_path_buf();
        let writer = WritePptxTool::new(cwd.clone());
        writer
            .execute("c1", json!({ "path": "a.pptx", "slides": [{ "title": "S" }] }), None)
            .await
            .expect("write");
        let editor = EditPptxTool::new(cwd.clone());
        let edit = editor
            .execute("c2", json!({ "path": "a.pptx", "slide": 5, "title": "x" }), None)
            .await
            .expect("edit");
        assert!(edit.is_error);
    }
}
