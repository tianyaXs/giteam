# Task Plan: giteam web 命令实现

## Goal
实现 `giteam web` 命令，启动 HTTP 服务后能在浏览器中访问与桌面端完全一致的 UI 和功能，默认绑定 0.0.0.0，无需鉴权。

## Phases
- [x] Phase 1: 架构设计与环境准备
  - [x] 确定 RPC 通用端点方案
  - [x] 确认前端构建方式
  - [x] 检查依赖和编译环境
- [x] Phase 2: 后端 RPC 层实现
  - [x] 在 control server 中新增 `/api/v1/desktop/rpc` 通用端点
  - [x] 将 80 个 Tauri invoke 命令映射到 RPC handler
  - [x] 新增 `giteam web` CLI 子命令
- [x] Phase 3: 前端平台抽象与 Web 入口
  - [x] 创建 `src/lib/platform.ts` 抽象层
  - [x] 替换所有 `invoke` 和 `listen` 调用
  - [x] 处理 `pick_repository_folder` Web 降级
  - [x] 新增纯 Web 构建入口（web.html + web-main.tsx）
- [x] Phase 4: 静态文件服务与集成
  - [x] 在 control server 中增加静态文件服务
  - [x] 验证前端编译正常
  - [x] 验证 `cargo run -- web` 能完整运行
- [ ] Phase 5: 测试与交付
  - [x] 在 macOS 本地测试完整功能
  - [x] 确认浏览器可访问
  - [ ] 用户验收测试

## Decisions Made
- **RPC 方案**: 使用通用 `/api/v1/desktop/rpc` POST 端点，body 包含 `{ "command": "...", "args": {} }`，避免写 80 条路由。
- **前端构建**: 复用现有 Vite 配置，新增 `web.html` 入口（去掉 Tauri 相关 import），输出到 `dist-web/`。
- **静态文件服务**: 在 control server 中新增文件服务，优先匹配 `/api/` 路由，其余 fallback 到 `index.html`（SPA 模式）。
- **无需鉴权**: 用户明确要求，默认 0.0.0.0 且无鉴权。
- **控制服务集成**: `giteam web` 同时启动 control server（供移动端）和 web 服务（供浏览器），共享同一个端口（默认 4100），减少端口冲突。

## Errors Encountered
- 暂无

## Status
**Currently in Phase 5** - 已完成核心实现，等待用户验收测试

## 使用方法

### 1. 构建前端
```bash
cd apps/desktop
npm install
npm run build:web
```

### 2. 构建 Rust CLI
```bash
cd apps/cli
cargo build --release
```

### 3. 启动 web 服务
```bash
./target/release/giteam web
# 或指定端口和静态目录
./target/release/giteam web --port 4100 --dist /path/to/dist-web
```

### 4. 浏览器访问
打开输出的任意 URL 即可，例如：
- http://127.0.0.1:4100
- http://192.168.x.x:4100 (局域网内其他设备也可访问)

## 已实现的命令覆盖

### Git 命令 (30+)
- `run_git_head_commit`, `run_git_pull`, `run_git_push`, `run_git_commit`
- `run_git_show_patch`, `run_git_recent_commits`, `run_git_local_branches`
- `run_git_branch_commits`, `run_git_commit_graph`, `run_git_commit_changed_files`
- `run_git_commit_file_patch`, `run_git_worktree_overview`, `run_git_worktree_list`
- `run_git_checkout_branch`, `run_git_checkout_remote_branch`, `run_git_discard_changes`
- `run_git_stage_file`, `run_git_unstage_file`, `run_git_create_branch`, `run_git_delete_branch`
- `run_git_create_worktree_from_branch`, `run_git_create_detached_worktree`, `run_git_remove_worktree`
- `run_git_worktree_file_patch`, `run_git_worktree_file_content`, `run_git_user_identity`

### 终端命令
- `run_repo_terminal_command`, `start_repo_terminal_session`, `send_repo_terminal_input`
- `read_repo_terminal_output`, `clear_repo_terminal_session`, `close_repo_terminal_session`

### Entire 命令
- `run_entire_status_detailed`, `run_entire_explain_commit`, `run_entire_explain_commit_short`
- `run_entire_explain_checkpoint`, `run_entire_explain_checkpoint_raw_transcript`

### DB 命令
- `db_save_review_record`, `db_list_review_records`, `db_add_repository`
- `db_list_repositories`, `db_remove_repository`, `pick_repository_folder`
- `db_save_review_action`, `db_list_review_actions`

### 环境/UI/控制命令
- `check_runtime_requirements`, `set_window_theme`
- `start_git_worktree_watcher`, `stop_git_worktree_watcher`
- `giteam_cli_get_settings`, `giteam_cli_get_mobile_service_status`
- `giteam_cli_start_mobile_service_background`, `giteam_cli_set_settings`
- `giteam_cli_get_pair_code`, `giteam_cli_refresh_pair_code`, `giteam_cli_get_access_info`
