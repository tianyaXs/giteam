# ADR-0003: 资产图谱可视化层使用 sigma.js

**Date**: 2026-08-21  
**Status**: accepted  
**Deciders**: Giteam maintainers

## Context

资产图谱（`crates/giteam-core/src/asset_graph/`）需要一个桌面端可视化层，渲染 Session/Run/File/Error/Commit 等节点与边，支持力导向布局、缩放平移、点击下钻等交互。候选方案有三类：sigma.js 生态、D3 力导向图、自研 Canvas/WebGL 渲染。核心诉求是**零维护成本**——团队不想长期维护一套图形渲染代码。

## Decision

资产图谱的可视化层锁定 **sigma.js** + **graphology**，布局分两段：

1. **冷启动**：`random` 播种 + **FA2 Worker** 有机聚簇  
2. **交互**：冻结并快照 home；拖拽只动目标节点，松手阻尼弹簧回 home  
3. **不在 FA2 之后接 ForceSupervisor**：FA2 坐标尺度下边拉力 ∝ distance，一拖就会把连通点吸成一团  

不上 D3，也不自研 Canvas 渲染。

理由：sigma.js 自带 WebGL 渲染管线与 graphology 布局生态，开箱即用、社区维护，满足零维护成本的目标。落地形态为 `apps/desktop/src/components/agent/AssetGraphPanel.tsx`，布局在 Worker 中运行不阻塞 UI，坐标缓存落库（`nodes.layout_x/layout_y`）避免每次重跑物理仿真。

## Alternatives Considered

### Alternative 1: D3（d3-force + SVG/Canvas）

- **Pros**: 生态最大、定制能力最强。
- **Cons**: 渲染与交互都要自己拼装；SVG 节点规模上不去，Canvas 模式则命中检测、缩放、标签都要手写。
- **Why not**: 等于把图形渲染当成长期维护负担，违背零维护成本的约束。

### Alternative 2: 自研 Canvas/WebGL 渲染

- **Pros**: 完全可控，无第三方依赖。
- **Cons**: 渲染、布局、交互全量自研，维护成本最高。
- **Why not**: 与零维护成本的目标直接冲突。

## Consequences

### Positive

- WebGL 渲染数千节点无压力（配合子图查询 `subgraph(center, hops, limit)` 控制规模上限）。
- ForceSupervisor 持续布局 + 拖拽钉住回弹（官方范式 ①），Worker 不阻塞 UI。
- 渲染、布局、交互均由上游社区维护，无自研图形代码。

### Negative

- 视觉与交互定制受 sigma.js API 边界约束（如节点拖拽需手写，sigma v3 无内置 `enableNodeDrag`）。
- 引入 sigma / graphology 相关 npm 依赖。

### Risks

- sigma.js 主版本升级可能带来 breaking change（v3 相对 v2 即如此）；缓解措施：锁定 `package.json` 版本，升级时单独评估。
