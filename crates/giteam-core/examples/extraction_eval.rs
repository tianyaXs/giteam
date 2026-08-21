//! 语义抽取离线评测器（docs/asset-graph-extraction-eval.md）。
//!
//! 三种用法：
//!   extraction_eval prompt <case.json>            打印生产同款抽取 prompt
//!   extraction_eval score  <case.json> <raw.txt>  用生产 parse_extraction 解析并打分
//!   extraction_eval report <cases_dir> <outs_dir> 批量打分 + 汇总（outs 里找同名 .txt）
//!
//! case 文件格式见 eval/extraction/*.json。

use giteam_core::asset_graph::extraction::ExtractionInput;
use giteam_core::asset_graph::semantic::{self, ExtractionAnchors, SemanticExtraction};
use serde::Deserialize;

// ---------- case fixture ----------

#[derive(Debug, Deserialize)]
struct Case {
    name: String,
    #[serde(default)]
    note: String,
    /// 预期失败的已知限制 case（报告单列，不计入失败）。
    #[serde(default)]
    xfail: bool,
    input: CaseInput,
    #[serde(default)]
    expect: Expect,
}

#[derive(Debug, Deserialize)]
struct CaseInput {
    #[serde(default)]
    user_text: String,
    #[serde(default)]
    assistant_text: String,
    #[serde(default)]
    file_paths: Vec<String>,
    #[serde(default)]
    commands: Vec<String>,
    #[serde(default)]
    error_lines: Vec<String>,
}

#[derive(Debug, Default, Deserialize)]
struct Expect {
    #[serde(default)]
    entities: Vec<ExpectEntity>,
    #[serde(default)]
    relations: Vec<ExpectRelation>,
    /// worth_extracting() 的期望值（门控 case）。
    gate: Option<bool>,
    min_entities: Option<usize>,
    max_entities: Option<usize>,
    /// 不得出现的实体类型（白名单外诱导）。
    #[serde(default)]
    forbidden_types: Vec<String>,
    /// 实体 label 不得包含的片段（如原始报错行）。
    #[serde(default)]
    forbidden_label_contains: Vec<String>,
    /// 关系 object 不得包含的片段（幻觉文件边）。
    #[serde(default)]
    forbidden_relation_objects: Vec<String>,
}

#[derive(Debug, Deserialize)]
struct ExpectEntity {
    /// 期望类型；type_any 存在时取并集（模型措辞自由，类型可选）。
    #[serde(rename = "type")]
    entity_type: Option<String>,
    #[serde(default)]
    type_any: Vec<String>,
    /// slug 需包含的片段（key = sem:<type>:<slug>）。
    slug_contains: String,
    /// 必须出现的 props 字段（decision: category/reasoning; tradeoff: chose/rejected/because）。
    #[serde(default)]
    props_required: Vec<String>,
    /// 跨 case slug 一致性分组：同组同类型必须产出同一个 sem key。
    slug_group: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ExpectRelation {
    #[serde(rename = "type")]
    relation_type: String,
    subject_contains: String,
    object_contains: String,
}

// ---------- case → 生产结构 ----------

fn extraction_input(case: &Case) -> ExtractionInput {
    ExtractionInput {
        session_id: "eval-session".into(),
        run_id: "eval-run".into(),
        turn_key: Some("turn:eval/1".into()),
        session_key: "session:eval".into(),
        user_text: case.input.user_text.clone(),
        assistant_text: case.input.assistant_text.clone(),
        // 合成 file 锚点 key 直接内嵌路径，打分端 contains 即可判定。
        file_keys: case
            .input
            .file_paths
            .iter()
            .map(|p| (p.clone(), format!("file:{p}")))
            .collect(),
        commands: case.input.commands.clone(),
        error_lines: case.input.error_lines.clone(),
        timestamp_ms: 1_000,
        sequence: 1,
    }
}

fn anchors(input: &ExtractionInput) -> ExtractionAnchors {
    input.anchors()
}

// ---------- 打分 ----------

struct Check {
    label: String,
    passed: bool,
}

fn score_case(case: &Case, raw: &str) -> (Vec<Check>, SemanticExtraction) {
    let input = extraction_input(case);
    let out = semantic::parse_extraction(raw, &anchors(&input));
    let mut checks: Vec<Check> = Vec::new();
    let expect = &case.expect;

    if let Some(gate) = expect.gate {
        checks.push(Check {
            label: format!("gate: worth_extracting() == {gate}"),
            passed: input.worth_extracting() == gate,
        });
    }

    for entity in &expect.entities {
        let types: Vec<String> = if !entity.type_any.is_empty() {
            entity.type_any.clone()
        } else {
            vec![entity.entity_type.clone().unwrap_or_default()]
        };
        let found = out.batch.nodes.iter().find(|n| {
            types.iter().any(|t| n.node_type == t.as_str()) && n.key.contains(&entity.slug_contains)
        });
        checks.push(Check {
            label: format!(
                "entity: type={} slug~'{}'",
                types.join("|"),
                entity.slug_contains
            ),
            passed: found.is_some(),
        });
        for field in &entity.props_required {
            let ok = found
                .and_then(|n| n.props.get(field))
                .map(|v| !v.is_null())
                .unwrap_or(false);
            checks.push(Check {
                label: format!("  props: '{}' present on '{}'", field, entity.slug_contains),
                passed: ok,
            });
        }
    }

    for relation in &expect.relations {
        let sem_type = format!("sem/{}", relation.relation_type);
        let hit = out.batch.edges.iter().any(|e| {
            (e.edge_type == sem_type || e.edge_type == relation.relation_type)
                && e.src_key.contains(&relation.subject_contains)
                && e.dst_key.contains(&relation.object_contains)
        });
        checks.push(Check {
            label: format!(
                "relation: {} '{}' -> '{}'",
                relation.relation_type, relation.subject_contains, relation.object_contains
            ),
            passed: hit,
        });
    }

    for ftype in &expect.forbidden_types {
        checks.push(Check {
            label: format!("forbidden: no entity of type '{ftype}'"),
            passed: !out.batch.nodes.iter().any(|n| n.node_type == ftype),
        });
    }
    for frag in &expect.forbidden_label_contains {
        checks.push(Check {
            label: format!("forbidden: no label containing '{frag}'"),
            passed: !out.batch.nodes.iter().any(|n| n.label.contains(frag)),
        });
    }
    for frag in &expect.forbidden_relation_objects {
        checks.push(Check {
            label: format!("forbidden: no relation object containing '{frag}'"),
            passed: !out.batch.edges.iter().any(|e| e.dst_key.contains(frag)),
        });
    }

    if let Some(min) = expect.min_entities {
        checks.push(Check {
            label: format!("count: entities >= {min} (got {})", out.entity_count),
            passed: out.entity_count >= min,
        });
    }
    if let Some(max) = expect.max_entities {
        checks.push(Check {
            label: format!("count: entities <= {max} (got {})", out.entity_count),
            passed: out.entity_count <= max,
        });
    }

    (checks, out)
}

/// 模型输出能否剥出合法 JSON（JSON 可解析率指标）。
fn json_parseable(raw: &str) -> bool {
    let text = raw.trim();
    let text = text
        .strip_prefix("```json")
        .or_else(|| text.strip_prefix("```"))
        .unwrap_or(text)
        .trim();
    let text = text.strip_suffix("```").unwrap_or(text);
    let Some(start) = text.find('{') else { return false };
    let Some(end) = text.rfind('}') else { return false };
    end > start && serde_json::from_str::<serde_json::Value>(&text[start..=end]).is_ok()
}

fn load_case(path: &std::path::Path) -> Result<Case, String> {
    let text = std::fs::read_to_string(path).map_err(|e| format!("read {}: {e}", path.display()))?;
    serde_json::from_str(&text).map_err(|e| format!("parse {}: {e}", path.display()))
}

fn print_checks(case: &Case, checks: &[Check], parseable: bool) -> (usize, usize) {
    let mut passed = 0;
    println!("== {} {}{}", case.name, if case.xfail { "(xfail) " } else { "" }, if case.note.is_empty() { String::new() } else { format!("— {}", case.note) });
    println!("   json_parseable: {}", if parseable { "yes" } else { "NO" });
    for check in checks {
        println!("   {} {}", if check.passed { "✓" } else { "✗" }, check.label);
        if check.passed {
            passed += 1;
        }
    }
    (passed, checks.len())
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let mode = args.get(1).map(String::as_str).unwrap_or("");
    match mode {
        "prompt" => {
            let case = load_case(std::path::Path::new(args.get(2).expect("usage: prompt <case.json>")))
                .unwrap_or_else(|e| panic!("{e}"));
            print!("{}", extraction_input(&case).build_prompt(&[]));
        }
        "score" => {
            let case = load_case(std::path::Path::new(args.get(2).expect("usage: score <case.json> <raw.txt>")))
                .unwrap_or_else(|e| panic!("{e}"));
            let raw_path = args.get(3).expect("usage: score <case.json> <raw.txt>");
            let raw = std::fs::read_to_string(raw_path).expect("read raw output");
            let parseable = json_parseable(&raw);
            let (checks, out) = score_case(&case, &raw);
            let (passed, total) = print_checks(&case, &checks, parseable);
            println!(
                "   → {passed}/{total} checks passed; extracted {} entities, {} relations",
                out.entity_count, out.relation_count
            );
            if passed < total && !case.xfail {
                std::process::exit(1);
            }
        }
        "report" => {
            let cases_dir = args.get(2).expect("usage: report <cases_dir> <outs_dir>");
            let outs_dir = std::path::Path::new(args.get(3).expect("usage: report <cases_dir> <outs_dir>"));
            let mut paths: Vec<_> = std::fs::read_dir(cases_dir)
                .expect("read cases dir")
                .filter_map(Result::ok)
                .map(|e| e.path())
                .filter(|p| p.extension().is_some_and(|x| x == "json"))
                .collect();
            paths.sort();

            let mut total_pass = 0;
            let mut total_checks = 0;
            let mut scored = 0;
            let mut with_output = 0;
            let mut json_ok = 0;
            let mut xfail_failed = 0;
            // slug_group 一致性：(type, group) → 命中的 sem keys。
            let mut slug_groups: std::collections::HashMap<(String, String), Vec<String>> =
                std::collections::HashMap::new();

            for path in paths {
                let case = match load_case(&path) {
                    Ok(c) => c,
                    Err(e) => {
                        eprintln!("skip: {e}");
                        continue;
                    }
                };
                let stem = path.file_stem().unwrap().to_string_lossy().to_string();
                let out_path = outs_dir.join(format!("{stem}.txt"));
                // 纯门控 case（无实体/关系期望）不需要模型输出，用空 raw 直接打门控分。
                let gate_only = case.expect.gate.is_some()
                    && case.expect.entities.is_empty()
                    && case.expect.relations.is_empty();
                let raw = if out_path.is_file() {
                    std::fs::read_to_string(&out_path).expect("read output")
                } else if gate_only {
                    String::new()
                } else {
                    println!("-- {stem}: no model output ({}), skipped", out_path.display());
                    continue;
                };
                // 门控 case 没有模型输出，不计入 JSON 可解析率。
                let has_output = out_path.is_file();
                let parseable = has_output && json_parseable(&raw);
                with_output += usize::from(has_output);
                json_ok += usize::from(parseable);
                let (checks, out) = score_case(&case, &raw);
                let (passed, total) = print_checks(&case, &checks, parseable);
                if case.xfail && passed < total {
                    xfail_failed += 1;
                }
                total_pass += passed;
                total_checks += total;
                scored += 1;
                for entity in &case.expect.entities {
                    if let Some(group) = &entity.slug_group {
                        let types = if !entity.type_any.is_empty() {
                            entity.type_any.clone()
                        } else {
                            vec![entity.entity_type.clone().unwrap_or_default()]
                        };
                        for key in out.batch.nodes.iter().filter(|n| {
                            types.iter().any(|t| n.node_type == t.as_str())
                                && n.key.contains(&entity.slug_contains)
                        }) {
                            slug_groups
                                .entry((types.join("|"), group.clone()))
                                .or_default()
                                .push(key.key.clone());
                        }
                    }
                }
            }

            println!("\n===== summary =====");
            println!("cases scored: {scored}");
            println!(
                "json parseable: {json_ok}/{with_output} ({:.0}%)",
                100.0 * json_ok as f64 / with_output.max(1) as f64
            );
            println!(
                "checks: {total_pass}/{total_checks} ({:.0}%)",
                100.0 * total_pass as f64 / total_checks.max(1) as f64
            );
            if xfail_failed > 0 {
                println!("xfail cases still failing (known limitations): {xfail_failed}");
            }
            for ((types, group), keys) in &slug_groups {
                let mut uniq = keys.clone();
                uniq.sort();
                uniq.dedup();
                let status = if uniq.len() <= 1 { "✓ stable" } else { "✗ DIVERGED" };
                println!("slug_group '{group}' ({types}): {status} — {uniq:?}");
            }
        }
        _ => {
            eprintln!("usage:\n  extraction_eval prompt <case.json>\n  extraction_eval score <case.json> <raw.txt>\n  extraction_eval report <cases_dir> <outs_dir>");
            std::process::exit(2);
        }
    }
}
