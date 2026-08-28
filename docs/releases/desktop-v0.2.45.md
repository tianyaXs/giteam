# Giteam Desktop v0.2.45

发布标签：`desktop-v0.2.45`

## 修复

- 恢复 `package-lock.json` 中 `@emnapi/core` / `@emnapi/runtime` 顶层条目，修复 CI `npm ci` 失败（含 Windows 构建）
- 分享导入完成后用跨平台路径比较选中项目（Windows 反斜杠 / 大小写）

## 发布

```bash
git tag desktop-v0.2.45
git push origin desktop-v0.2.45
```

功能内容与 v0.2.44 相同；见 [desktop-v0.2.44.md](./desktop-v0.2.44.md)。
