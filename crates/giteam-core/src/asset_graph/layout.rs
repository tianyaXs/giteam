//! 总览图力导布局：网格加速的确定性 Fruchterman-Reingold 近似。
//!
//! 为资产图谱总览（compact 全图）提供**预收敛的初始坐标**，前端 sigma 只需
//! 低热微调而非从随机云重算——节点数大时这是「打开即布局完成」与
//! 「冻结数秒」的差别。设计约束：
//!
//! - 确定性：黄金角螺旋播种 + 双缓冲迭代（每轮只读上一轮快照），同样拓扑
//!   永远得到同样布局，与线程调度无关。
//! - 可扩展：均匀网格把斥力从 O(n²) 降到 O(n·k)（k = 截断半径内邻居数）。
//!   30 万节点 + 45 万边在 release 下秒级收敛（`tests::large_graph_layout_smoke`）。
//! - 零新依赖：并行用 `std::thread::scope` 分块，每线程只写自己的槽位。
//! - 指纹缓存：拓扑不变（passive-sync 周期性合并视图）直接复用上次结果。
//!
//! 坐标绝对尺度不重要——前端 sigma 会自动归一化到视口。

use std::collections::HashMap;
use std::sync::{Arc, Mutex, OnceLock};

use super::query::{SubgraphEdge, SubgraphNode};

/// 期望边长（力平衡距离）。sigma 归一化后尺度无意义，只影响迭代动态。
const K: f32 = 60.0;
/// 斥力系数（FR 风格 k²）。
const REPULSION: f32 = K * K;
/// 向心系数：对「到质心的位移」的线性衰减比例，防止外层孤点飘出。
const GRAVITY: f32 = 0.05;
/// 斥力截断半径（网格 cell 尺寸）：超出此距离的斥力忽略。
const CUTOFF: f32 = K * 2.5;
/// 网格最大边长（cell 数）：超宽图自动放大 cell，避免内存失控。
const GRID_MAX_CELLS_PER_AXIS: u32 = 2048;

/// 布局参数。`iterations` 按 0 时按规模自适应（小图精修、大图够用即可）。
#[derive(Clone, Copy, Debug)]
pub struct LayoutOptions {
    pub iterations: usize,
    pub seed: u64,
}

impl Default for LayoutOptions {
    fn default() -> Self {
        Self {
            iterations: 0,
            seed: 0x9E37_79B9_7F4A_7C15,
        }
    }
}

fn default_iterations(node_count: usize) -> usize {
    if node_count <= 2_000 {
        300
    } else if node_count <= 20_000 {
        200
    } else {
        120
    }
}

/// 确定性 xorshift64*，替代浮点随机（同种子同序列）。
struct Rng(u64);

impl Rng {
    fn next_f32_in(&mut self, half_span: f32) -> f32 {
        // xorshift64*
        let mut x = self.0;
        x ^= x >> 12;
        x ^= x << 25;
        x ^= x >> 27;
        self.0 = x;
        let unit = ((x >> 11) as f64 / (1u64 << 53) as f64) as f32;
        (unit - 0.5) * 2.0 * half_span
    }
}

/// 计算布局：返回交错的 `[x0, y0, x1, y1, ...]`（长度 = `node_count * 2`）。
#[must_use]
pub fn compute_layout(node_count: usize, edges: &[[u32; 2]], options: LayoutOptions) -> Vec<f32> {
    if node_count == 0 {
        return Vec::new();
    }
    if node_count == 1 {
        return vec![0.0, 0.0];
    }
    let iterations = if options.iterations == 0 {
        default_iterations(node_count)
    } else {
        options.iterations
    };

    // 黄金角螺旋播种：确定性、各向同性、半径随 sqrt(n) 增长（面积均匀）。
    let mut rng = Rng(options.seed);
    let mut current: Vec<f32> = Vec::with_capacity(node_count * 2);
    for i in 0..node_count {
        let radius = 0.6 * K * (i as f32).sqrt() + rng.next_f32_in(K * 0.25);
        let theta = i as f32 * 2.399_963_2 + rng.next_f32_in(0.2);
        current.push(radius * theta.cos());
        current.push(radius * theta.sin());
    }

    // CSR 邻接（双向）：斥力/引力都按索引读，迭代中零分配。
    let mut degree = vec![0u32; node_count];
    let mut valid_edges: Vec<[u32; 2]> = Vec::with_capacity(edges.len());
    for &[src, dst] in edges {
        if (src as usize) < node_count && (dst as usize) < node_count && src != dst {
            valid_edges.push([src, dst]);
            degree[src as usize] += 1;
            degree[dst as usize] += 1;
        }
    }
    let mut offsets = vec![0u32; node_count + 1];
    for i in 0..node_count {
        offsets[i + 1] = offsets[i] + degree[i];
    }
    let mut cursor = offsets.clone();
    let mut adjacency = vec![0u32; valid_edges.len() * 2];
    for &[src, dst] in &valid_edges {
        adjacency[cursor[src as usize] as usize] = dst;
        cursor[src as usize] += 1;
        adjacency[cursor[dst as usize] as usize] = src;
        cursor[dst as usize] += 1;
    }
    drop(degree);

    let cutoff_sq = CUTOFF * CUTOFF;
    let mut next: Vec<f32> = vec![0.0; node_count * 2];

    // 温度线性退火：最大位移从 K/3 收到 K/30（FA2 风格，防振荡）。
    let speed_start = K / 3.0;
    let speed_end = K / 30.0;

    let threads = std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(4)
        .clamp(1, 8);
    let chunk = node_count.div_ceil(threads);

    for iteration in 0..iterations {
        let t = iteration as f32 / (iterations.max(1) - 1).max(1) as f32;
        let speed = speed_start + (speed_end - speed_start) * t;

        // 1) 本轮包围盒与质心（读快照 current）。
        let (mut min_x, mut min_y, mut max_x, mut max_y) = (f32::MAX, f32::MAX, f32::MIN, f32::MIN);
        for i in 0..node_count {
            let (x, y) = (current[i * 2], current[i * 2 + 1]);
            min_x = min_x.min(x);
            min_y = min_y.min(y);
            max_x = max_x.max(x);
            max_y = max_y.max(y);
        }
        let center_x = (min_x + max_x) * 0.5;
        let center_y = (min_y + max_y) * 0.5;

        // 2) 均匀网格（counting sort，复用分配）。
        let span_x = (max_x - min_x).max(1.0);
        let span_y = (max_y - min_y).max(1.0);
        let cell = CUTOFF.max(span_x / GRID_MAX_CELLS_PER_AXIS as f32)
            .max(span_y / GRID_MAX_CELLS_PER_AXIS as f32);
        let grid_w = ((span_x / cell).ceil() as u32).clamp(1, GRID_MAX_CELLS_PER_AXIS);
        let grid_h = ((span_y / cell).ceil() as u32).clamp(1, GRID_MAX_CELLS_PER_AXIS);
        let cells = grid_w as usize * grid_h as usize;
        let mut cell_count = vec![0u32; cells];
        let cell_of = |x: f32, y: f32| -> usize {
            let cx = (((x - min_x) / cell) as u32).min(grid_w - 1) as usize;
            let cy = (((y - min_y) / cell) as u32).min(grid_h - 1) as usize;
            cy * grid_w as usize + cx
        };
        for i in 0..node_count {
            cell_count[cell_of(current[i * 2], current[i * 2 + 1])] += 1;
        }
        let mut cell_start = cell_count; // 复用为前缀和
        let mut running = 0u32;
        for c in cell_start.iter_mut() {
            running += *c;
            *c = running;
        }
        // cell_start[c] = c 及之前 cell 的节点总数（ exclusive-scan 终态）。
        let mut fill = cell_start.clone();
        let mut items = vec![0u32; node_count];
        for i in (0..node_count).rev() {
            let c = cell_of(current[i * 2], current[i * 2 + 1]);
            fill[c] -= 1;
            items[fill[c] as usize] = i as u32;
        }
        // 迭代后 fill[c] = c 的起始偏移（cell 区间 = [fill[c], cell_start[c])）。
        let mut fill = cell_start.clone();
        let mut items = vec![0u32; node_count];
        for i in (0..node_count).rev() {
            let c = cell_of(current[i * 2], current[i * 2 + 1]);
            fill[c] -= 1;
            items[fill[c] as usize] = i as u32;
        }
        drop(fill);

        // 3) 分块并行：每节点只读快照（current / grid），只写自己的槽位。
        //    next 按 chunk 切成互斥的可变切片，线程间零数据竞争、结果确定。
        let current_ref: &Vec<f32> = &current;
        let cell_start_ref: &Vec<u32> = &cell_start;
        let items_ref: &Vec<u32> = &items;
        let adjacency_ref: &Vec<u32> = &adjacency;
        let offsets_ref: &Vec<u32> = &offsets;
        let grid_w_usize = grid_w as usize;
        let next_chunks: Vec<&mut [f32]> = next.chunks_mut(chunk * 2).collect();
        std::thread::scope(|scope| {
            for (thread_idx, next_chunk) in next_chunks.into_iter().enumerate() {
                let lo = thread_idx * chunk;
                let hi = (lo + chunk).min(node_count);
                if lo >= hi {
                    break;
                }
                scope.spawn(move || {
                    for i in lo..hi {
                        let (x, y) = (current_ref[i * 2], current_ref[i * 2 + 1]);
                        let mut fx = 0.0f32;
                        let mut fy = 0.0f32;

                        // 斥力：3×3 邻近 cell 内、截断半径内的点对。
                        let cx = (((x - min_x) / cell) as u32).min(grid_w - 1) as i32;
                        let cy = (((y - min_y) / cell) as u32).min(grid_h - 1) as i32;
                        let gy_lo = (cy - 1).max(0);
                        let gy_hi = (cy + 1).min(grid_h as i32 - 1);
                        let gx_lo = (cx - 1).max(0);
                        let gx_hi = (cx + 1).min(grid_w as i32 - 1);
                        for gy in gy_lo..=gy_hi {
                            for gx in gx_lo..=gx_hi {
                                let c = (gy as usize) * grid_w_usize + gx as usize;
                                let b = if c == 0 { 0 } else { cell_start_ref[c - 1] };
                                let e = cell_start_ref[c];
                                for slot in b..e {
                                    let j = items_ref[slot as usize] as usize;
                                    if j == i {
                                        continue;
                                    }
                                    let (ox, oy) =
                                        (current_ref[j * 2], current_ref[j * 2 + 1]);
                                    let (dx, dy) = (x - ox, y - oy);
                                    let d2 = dx * dx + dy * dy;
                                    if d2 >= cutoff_sq {
                                        continue;
                                    }
                                    let d = d2.sqrt().max(0.01);
                                    let f = REPULSION / d2;
                                    fx += dx / d * f;
                                    fy += dy / d * f;
                                }
                            }
                        }

                        // 引力：弹簧拉向期望边长。
                        let (b, e) = (offsets_ref[i], offsets_ref[i + 1]);
                        for slot in b..e {
                            let j = adjacency_ref[slot as usize] as usize;
                            let (ox, oy) = (current_ref[j * 2], current_ref[j * 2 + 1]);
                            let (dx, dy) = (ox - x, oy - y);
                            let d = (dx * dx + dy * dy).sqrt().max(0.01);
                            let f = (d - K) / d * 0.5;
                            fx += dx * f;
                            fy += dy * f;
                        }

                        // 向心力：线性拉回质心，孤点不至于漂出。
                        fx += (center_x - x) * GRAVITY;
                        fy += (center_y - y) * GRAVITY;

                        // 温度限幅。
                        let mag = (fx * fx + fy * fy).sqrt();
                        let scale = if mag > speed { speed / mag } else { 1.0 };
                        let local = i - lo;
                        next_chunk[local * 2] = x + fx * scale;
                        next_chunk[local * 2 + 1] = y + fy * scale;
                    }
                });
            }
        });
        std::mem::swap(&mut current, &mut next);
    }
    current
}

// ---------- 指纹缓存：拓扑不变不重算（passive-sync 周期性全量拉取） ----------

fn layout_cache() -> &'static Mutex<Vec<(u64, Arc<Vec<f32>>)>> {
    static CACHE: OnceLock<Mutex<Vec<(u64, Arc<Vec<f32>>)>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(Vec::with_capacity(4)))
}

const CACHE_MAX_ENTRIES: usize = 4;

/// FNV-1a：节点数 + 边列表的稳定指纹。
#[must_use]
pub fn layout_fingerprint(node_count: usize, edges: &[[u32; 2]]) -> u64 {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    let mut mix = |byte: u8, hash: &mut u64| {
        *hash ^= u64::from(byte);
        *hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    };
    for byte in node_count.to_le_bytes() {
        mix(byte, &mut hash);
    }
    for pair in edges {
        for value in pair {
            for byte in value.to_le_bytes() {
                mix(byte, &mut hash);
            }
        }
    }
    hash
}

/// 带缓存的布局入口：命中指纹直接复用，未命中计算后入缓存（上限 4 份）。
#[must_use]
pub fn cached_layout(fingerprint: u64, node_count: usize, edges: &[[u32; 2]]) -> Arc<Vec<f32>> {
    if let Ok(cache) = layout_cache().lock() {
        if let Some((_, hit)) = cache.iter().find(|(key, _)| *key == fingerprint) {
            return Arc::clone(hit);
        }
    }
    let computed = Arc::new(compute_layout(node_count, edges, LayoutOptions::default()));
    if let Ok(mut cache) = layout_cache().lock() {
        if let Some(slot) = cache.iter_mut().find(|(key, _)| *key == fingerprint) {
            slot.1 = Arc::clone(&computed);
        } else {
            if cache.len() >= CACHE_MAX_ENTRIES {
                cache.remove(0);
            }
            cache.push((fingerprint, Arc::clone(&computed)));
        }
    }
    computed
}

/// 总览视图入口：为节点写入预布局坐标（`x`/`y`），并做指纹缓存。
/// 边端点按 `node_id → index` 映射，悬垂边防御性跳过。
pub fn attach_overview_positions(nodes: &mut [SubgraphNode], edges: &[SubgraphEdge]) {
    if nodes.is_empty() {
        return;
    }
    let index_by_id: HashMap<&str, u32> = nodes
        .iter()
        .enumerate()
        .map(|(i, node)| (node.node_id.as_str(), i as u32))
        .collect();
    let mut pairs: Vec<[u32; 2]> = Vec::with_capacity(edges.len());
    for edge in edges {
        if let (Some(&src), Some(&dst)) = (
            index_by_id.get(edge.src_id.as_str()),
            index_by_id.get(edge.dst_id.as_str()),
        ) {
            if src != dst {
                pairs.push([src, dst]);
            }
        }
    }
    let fingerprint = layout_fingerprint(nodes.len(), &pairs);
    let positions = cached_layout(fingerprint, nodes.len(), &pairs);
    for (i, node) in nodes.iter_mut().enumerate() {
        node.x = Some(positions[i * 2]);
        node.y = Some(positions[i * 2 + 1]);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ring(node_count: u32) -> Vec<[u32; 2]> {
        (0..node_count)
            .map(|i| [i, (i + 1) % node_count])
            .collect()
    }

    #[test]
    fn empty_and_single() {
        assert!(compute_layout(0, &[], LayoutOptions::default()).is_empty());
        assert_eq!(compute_layout(1, &[], LayoutOptions::default()), vec![0.0, 0.0]);
    }

    #[test]
    fn deterministic_and_finite() {
        let edges = ring(64);
        let a = compute_layout(64, &edges, LayoutOptions { iterations: 40, ..Default::default() });
        let b = compute_layout(64, &edges, LayoutOptions { iterations: 40, ..Default::default() });
        assert_eq!(a.len(), 128);
        assert_eq!(a, b, "同拓扑同参数必须得到相同布局");
        assert!(a.iter().all(|v| v.is_finite()));
    }

    #[test]
    fn connected_nodes_end_closer_than_random_pairs() {
        // 环上相邻点收敛后应显著近于环上对径点：布局确实「成团」。
        let n = 120usize;
        let edges: Vec<[u32; 2]> = (0..n as u32).map(|i| [i, (i + 1) % n as u32]).collect();
        let pos = compute_layout(n, &edges, LayoutOptions { iterations: 150, ..Default::default() });
        let dist = |a: usize, b: usize| {
            ((pos[a * 2] - pos[b * 2]).powi(2) + (pos[a * 2 + 1] - pos[b * 2 + 1]).powi(2)).sqrt()
        };
        let adjacent: f32 = (0..n).map(|i| dist(i, (i + 1) % n)).sum::<f32>() / n as f32;
        let opposite: f32 = (0..n).map(|i| dist(i, (i + n / 2) % n)).sum::<f32>() / n as f32;
        assert!(
            adjacent < opposite * 0.5,
            "相邻 {adjacent} 应显著小于对径 {opposite}"
        );
    }

    #[test]
    fn fingerprint_reflects_topology() {
        assert_ne!(layout_fingerprint(3, &[[0, 1]]), layout_fingerprint(3, &[[0, 2]]));
        assert_eq!(layout_fingerprint(3, &[[0, 1], [1, 2]]), layout_fingerprint(3, &[[0, 1], [1, 2]]));
    }

    #[test]
    fn cache_hits_same_fingerprint() {
        let edges = ring(32);
        let fp = layout_fingerprint(32, &edges);
        let first = cached_layout(fp, 32, &edges);
        let second = cached_layout(fp, 32, &edges);
        assert!(Arc::ptr_eq(&first, &second), "同指纹应命中缓存");
    }

    /// 中等规模冒烟（debug 构建也快）：1 万节点 3 连环。
    #[test]
    fn medium_graph_layout_smoke() {
        let n = 10_000usize;
        let edges: Vec<[u32; 2]> = (0..n as u32)
            .flat_map(|i| [[i, (i + 1) % n as u32], [i, (i + 97) % n as u32]])
            .collect();
        let started = std::time::Instant::now();
        let pos = compute_layout(n, &edges, LayoutOptions::default());
        let elapsed = started.elapsed();
        assert_eq!(pos.len(), n * 2);
        assert!(pos.iter().all(|v| v.is_finite()));
        println!("10k nodes / {} edges layout: {elapsed:?}", edges.len());
    }

    /// 30 万节点全量冒烟：debug 构建下忽略（慢 20~50×），
    /// 用 `cargo test --release -p giteam-core asset_graph::layout -- --ignored` 跑。
    #[test]
    #[cfg_attr(debug_assertions, ignore = "release 构建下运行：cargo test --release -- --ignored")]
    fn large_graph_layout_smoke() {
        let n = 300_000usize;
        let edges: Vec<[u32; 2]> = (0..n as u32)
            .flat_map(|i| [[i, (i + 1) % n as u32], [i, (i + 977) % n as u32]])
            .collect();
        let started = std::time::Instant::now();
        let pos = compute_layout(n, &edges, LayoutOptions::default());
        let elapsed = started.elapsed();
        assert_eq!(pos.len(), n * 2);
        assert!(pos.iter().all(|v| v.is_finite()));
        println!("300k nodes / {} edges layout: {elapsed:?}", edges.len());
    }
}
