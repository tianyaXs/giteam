/**
 * 前端功能开关。
 *
 * MCP_MODULE_ENABLED：临时下线 MCP 模块前端入口。pi 运行时尚未实现 MCP
 * （pi SDK 无原生 MCP 支持），且桌面版 delete 命令损坏，故先隐藏 UI。
 * 后端命令与全部 MCP 组件文件均保留——PR8 实现 pi 原生 MCP 后，
 * 将此处置为 true 即可恢复全部入口。
 */
export const MCP_MODULE_ENABLED = false;

/**
 * REMOTE_REPO_MODULE_ENABLED：临时下线「远程仓库」模块前端入口。
 * 该模块（远程仓库服务 + remote_repo MCP + 侧边栏/右侧面板/设置三入口）
 * 实现尚不完整，故先隐藏全部入口并断掉后台自动加载；后端命令
 * 与 components/remote-repo/* 全部组件文件均保留，模块完整后将此处置为 true 即恢复。
 */
export const REMOTE_REPO_MODULE_ENABLED = false;
