# Step 36: Mobile Control 局域网可达、扫码/流式状态修复与本地 APK 构建记录

## 本轮目标
- 让手机端默认使用局域网可访问地址，而不是仅 localhost。
- 支持在桌面端设置里自定义 Mobile Control API 地址并保存。
- 修复手机端扫码无响应与“流式响应中”状态残留问题。
- 记录云构建与本地 APK 构建结果，沉淀交接说明。

## 代码改动（产品功能）

### 1) Desktop: Control URL 默认策略与自定义保存
文件：`apps/desktop/src-tauri/src/commands/control.rs`
- `ControlServerSettings`/`ControlAccessInfo` 增加 `public_base_url` 字段。
- 读取与保存配置时统一做 trim 和去尾 `/` 归一化。
- `get_control_access_info` 返回 URL 优先级：
  - 已配置 `public_base_url`
  - 局域网 IPv4 地址
  - localhost 回退

文件：`apps/desktop/src/App.tsx`
- 控制面板新增 `publicBaseUrl` 输入项（可编辑、可保存）。
- 保存前做 URL 规范化（补协议、去 path/query/hash）。
- 二维码 payload 取值优先级与后端一致：自定义 > LAN > localhost。

### 2) Mobile: 局域网 HTTP 访问与扫码恢复
文件：`apps/mobile/android/app/src/main/AndroidManifest.xml`
- `<application ... android:usesCleartextTraffic="true">`，允许 HTTP（局域网调试场景）。

文件：`apps/mobile/app.json`
- iOS 增加 ATS 配置：
  - `NSAllowsArbitraryLoads: true`
  - `NSAllowsLocalNetworking: true`

文件：`apps/mobile/App.tsx`
- 扫码失败路径（payload 非法、字段缺失、鉴权失败）统一解锁 scanner，避免“扫一次就卡死”。
- 页面显示扫码状态文案，便于用户判断当前步骤。
- 流式状态处理改为“真实事件驱动”：移除强制写入“流式响应中...”；在写入结束时清理陈旧状态文本。

## 构建与验证

### 桌面端
- `apps/desktop`: `npm run build` 通过。
- `apps/desktop/src-tauri`: `cargo check` 通过。

### APK 构建结果
- 云构建成功（EAS）：
  - Build ID: `568adb95-a712-434b-9705-50deeab9e365`
  - APK: `https://expo.dev/artifacts/eas/bFPNZJk4KxXJv5SrU8ge5z.apk`
- 本地 release 构建成功：
  - 文件：`apps/mobile/android/app/build/outputs/apk/release/app-release.apk`
  - SHA256：`5c768e11c0446428cc22e861ad0fb180e5836a2360a4cc788ddecaf11f01fa09`

## 本地构建中的临时性 workaround（交接重点）

以下改动为“本机网络/环境问题绕过”，不建议直接当成长期仓库策略：

1. `apps/mobile/android/gradle/wrapper/gradle-wrapper.properties`
- 改为腾讯镜像 `gradle-8.8-all.zip` 并写入 `distributionSha256Sum`。

2. 本机 Android SDK 元数据修复
- 针对 `android-34` 平台识别异常做过本机 SDK `package.xml` 修复（不在仓库内）。

3. 本机 `node_modules` 临时补丁
- `node_modules/expo-modules-core/android/src/main/java/expo/modules/adapters/react/permissions/PermissionsService.kt`
- 空安全调用改动用于绕过本地 Kotlin 编译报错（不在仓库版本控制内）。

## 交接建议

1. 若追求“团队可复现”，优先用 EAS 云构建链路，减少本机环境差异。
2. 若保留本地构建，建议把镜像源与依赖版本策略文档化，避免再次踩到网络/缓存问题。
3. 下个迭代可补一个“构建前健康检查脚本”（Java/Android SDK/Gradle 缓存一致性）。
