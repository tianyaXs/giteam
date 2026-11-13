# Giteam Desktop v0.2.56

发布标签：`desktop-v0.2.56`

## 修复

- macOS 正式包访问局域网 provider（如 `http://192.168.x.x`）仍可能立即失败：
  `No route to host (os error 65)`。
- 0.2.55 已补齐 `NSLocalNetworkUsageDescription`，但 macOS 本地网络授权按代码
  签名身份跟踪；ad-hoc/linker 签名每次构建的身份都会漂移，导致授权不能跨版本
  保持，甚至可能被静默拒绝。
- Release CI 导入稳定的 `Giteam Desktop` 自签代码签名证书，macOS arm64 产物
  使用该身份签名，安装后首次访问局域网模型服务时授权一次，后续升级通常保持。

## 验证

- CI macOS job 的 `security find-identity` 应列出 `Giteam Desktop`。
- 发布产物 `codesign -dvv` 不应包含 `adhoc`，Identifier 应为 `Giteam Desktop`。
- 首次使用局域网模型服务时系统应弹本地网络授权；允许后再次发送不应复现
  `No route to host`。

## 发布

```bash
git tag desktop-v0.2.56 && git push origin desktop-v0.2.56
```
