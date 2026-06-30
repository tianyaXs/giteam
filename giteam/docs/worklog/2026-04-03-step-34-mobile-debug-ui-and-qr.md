# Step 34: Mobile Debug UI 完善 + QR 扫码接入

## 本轮目标
在 React 移动端 MVP 基础上继续完善：
- 发送/响应/解析链路细化
- 调试 UI 分区化
- 临时 web 调试窗口可访问
- 对接桌面二维码数据，支持自动填充

## 主要改动

### 1) 完整调试流程 UI
文件：`apps/mobile/App.tsx`
- 新布局分区：
  - Connection
  - Session
  - Prompt
  - Messages
  - Stream Events
- 状态展示：
  - `Paired / Unpaired`
  - `Streaming / Idle`
- 功能按钮：
  - Health / Pair
  - Refresh Messages / Start Stream
  - Send / Abort

### 2) 消息解析与链路完善
文件：
- `apps/mobile/src/api/controlApi.ts`
- `apps/mobile/src/messageParser.ts`
- 新增 API：
  - `getMessages`
  - `abortSession`
- SSE `messages` 事件会解析为 user/assistant 聊天卡片。

### 3) 偏好持久化
文件：`apps/mobile/App.tsx`
- 持久化字段：
  - serverUrl
  - repoPath
  - pairCode
  - token
  - sessionId
- Native 使用 AsyncStorage，web 使用 localStorage。

### 4) QR 自动填充
文件：`apps/mobile/App.tsx`
- 新增 `Pair Payload` 输入框，支持粘贴桌面二维码内容并一键应用。
- 新增 `Scan QR`：调用设备相机扫描二维码并自动填充 URL + Pair Code。
- 支持 payload 结构：
  - `{"baseUrl":"http://...:4100","pairCode":"123456"}`

### 5) Web 临时调试服务
文件：`apps/mobile/package.json`
- 新增脚本：
  - `web:debug = expo start --web --host lan --port 19007 --clear`

## 校验
- 类型检查通过：
  - `cd apps/mobile && npx tsc --noEmit`
- 当前 web debug 监听：
  - `*:19007`

## 备注
- `@react-native-async-storage/async-storage` 安装后版本与 Expo 推荐存在偏差（可后续收敛到 Expo 推荐版本）。
