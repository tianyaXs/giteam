/**
 * 前端功能开关。
 *
 * REMOTE_REPO_MODULE_ENABLED：临时下线「远程仓库」模块前端入口。
 * 该模块（远程仓库服务 + remote_repo MCP + 侧边栏/右侧面板/设置三入口）
 * 实现尚不完整，故先隐藏全部入口并断掉后台自动加载；后端命令
 * 与 components/remote-repo/* 全部组件文件均保留，模块完整后将此处置为 true 即恢复。
 */
export const REMOTE_REPO_MODULE_ENABLED = false;
