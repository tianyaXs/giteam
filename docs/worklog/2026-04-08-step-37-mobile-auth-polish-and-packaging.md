# Step 37: Mobile 鉴权页收敛、字符画渲染稳定化与双端打包交接

Date: 2026-04-08

## 目标

- 收敛移动端鉴权页交互，去除调试入口，保证生产向简洁体验。
- 修复字符画渲染与布局抖动问题，并保留动态加载效果。
- 完成桌面端与移动端可交付包构建（DMG + APK）。

## 关键变更

### 1) Mobile 鉴权页与字符画

文件：`apps/mobile/App.tsx`

- 字符画来源改为代码常量池，并启用随机展示（排除字符画6，仅保留其余可用版本）。
- 字符画动画采用逐字加载。
- 增加字符画槽位固定高度（`authAsciiSlot`），防止动画过程中推挤下方输入区。
- 增加字符画自适应字号计算（基于槽位宽高和字符数等比缩放），保证窄屏下不变形。
- 字符画位移从布局流影响改为 `transform` 位移，避免影响副标题与输入区间距。
- URL 输入框占位符调整为通用文案（不展示具体服务地址）。

### 2) Mobile 鉴权缓存策略

文件：`apps/mobile/App.tsx`

- `serverUrl` 缓存改为“仅用户手动输入才保存”：
  - 新增 `serverUrlTouched` 标记。
  - 扫码/自动填充不会作为默认缓存来源。
  - 首次或未手动输入时，重启后 URL 默认空。

### 3) 移动端诊断功能移除

文件：`apps/mobile/App.tsx`

- 移除鉴权页诊断入口按钮。
- 移除诊断日志面板（复制/清空等操作）。
- 清理对应状态与样式定义。
- 保留 `console` 级别连接日志，便于开发排查。

### 4) 桌面端设置项精简

文件：`apps/desktop/src/App.tsx`

- Mobile Control API 设置弹窗中移除 `Copy payload` 按钮。
- 保留 `Copy URL` 按钮与二维码展示。

## 构建与验证

### 代码验证

- `cd apps/mobile && npx tsc --noEmit` 通过。
- `cd apps/desktop && npm run -s build` 通过。

### 打包产物

1. Desktop DMG

- 命令：`cd apps/desktop && npm run tauri:build`
- 产物：`apps/desktop/src-tauri/target/release/bundle/dmg/giteam_0.1.0_aarch64.dmg`

2. Mobile APK (local release)

- 命令：`cd apps/mobile/android && ./gradlew assembleRelease`
- 产物：`apps/mobile/android/app/build/outputs/apk/release/app-release.apk`

## 当前状态

- 两端构建成功，产物已生成。
- 当前移动端鉴权页已无诊断浮层，交互更简洁。
- 字符画渲染进入稳定状态（不再挤压输入区，窄区域可等比缩放）。

## 下个 Agent 建议

1. 真机再做 2 轮回归：
- 鉴权页（输入/扫码/失败提示）
- 会话切换与消息流式渲染

2. 若需继续做 UI 微调，优先仅改以下样式键，避免破坏布局稳定性：
- `authAsciiSlot`
- `authAsciiBrand`
- `authSub`

3. 若需重新启用端上诊断，建议放入独立开发开关（如 `__DEV__`），不要恢复为默认可见。
