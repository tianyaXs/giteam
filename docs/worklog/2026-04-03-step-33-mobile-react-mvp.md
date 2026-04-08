# Step 33: Mobile App MVP (React Native / Expo)

## 目标
基于 React 技术栈启动移动端 App，先打通桌面控制服务链路：
- 配对认证
- 发送 prompt
- 订阅 SSE 流

## 结果
- 新增工程：`apps/mobile`
- 技术栈：Expo + React Native + TypeScript
- 已实现页面：`apps/mobile/App.tsx`
  - 输入桌面控制服务 URL
  - 输入配对码并调用 `/api/v1/auth/pair`
  - 发送 prompt 到 `/api/v1/opencode/prompt`
  - 订阅 `/api/v1/opencode/stream` 实时事件

## 关键文件
- `apps/mobile/package.json`
- `apps/mobile/app.json`
- `apps/mobile/babel.config.js`
- `apps/mobile/tsconfig.json`
- `apps/mobile/src/api/controlApi.ts`
- `apps/mobile/src/types.ts`
- `apps/mobile/App.tsx`
- `apps/mobile/README.md`

## 已验证
- 依赖安装：`npm --prefix apps/mobile install` 成功
- 类型检查：`cd apps/mobile && npx tsc --noEmit` 通过

## 下一步建议
1. 接入扫码（扫描桌面端二维码自动填充 URL/验证码）
2. 将 token 和最近连接地址持久化（AsyncStorage）
3. 为 SSE `messages` 做结构化渲染（区分 assistant/user/tool）
4. 增加会话历史列表接口接入与切换
