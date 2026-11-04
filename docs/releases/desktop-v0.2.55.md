# Giteam Desktop v0.2.55

发布标签：`desktop-v0.2.55`

## 修复

- macOS 正式包访问局域网模型服务（如 `http://192.168.x.x`）立即失败：
  `No route to host (os error 65)`。根因是打包后的 app 缺少
  `NSLocalNetworkUsageDescription` 声明，未获本地网络授权时请求被系统拦截；
  `tauri:dev` 从终端启动继承了终端授权，所以开发模式正常。
- 正式包 Info.plist 补充本地网络权限声明，安装后首次访问局域网模型服务时
  系统会弹授权提示，允许即可。

## 发布

```bash
git tag desktop-v0.2.55 && git push origin desktop-v0.2.55
```
