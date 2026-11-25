# Giteam Desktop v0.3.3

发布标签：`desktop-v0.3.3`

## 本版重点

- 会话附件预览管线：docx / pdf / xlsx 等附件可直接在右侧面板预览，配套工具栏支持复制、下载、外部打开、适合宽度与面板折叠
- PDF 预览一步到位：打开即按原始页宽测量容器并自动适配比例，不再先落到默认 300% 再二次缩放
- 附件正文抽取：粘贴 / 上传的 docx / pdf / xlsx 自动抽取正文进入 prompt，气泡渲染剥离文件提示
- 附件真实版式缩略图：macOS 走 QuickLook 与 Finder 同源管线生成缩略快照，失败时回退文本行 / glyph

## 继承自 0.3.2 / 0.3.1（发布时不要退回）

- Windows 仍钉 `tianyaXs/pi_agent_rust@9daf269d`，保留 `windows_process_extensions_raw_attribute` feature gate（0.3.0 的 E0658）
- 工具链 `nightly-2026-08-31`；`giteam-core` recursion_limit 512
- macOS runner `macos-15`；Linux `ubuntu-24.04` 并安装 pipewire / gbm / EGL / wayland
- 前端构建 `NODE_OPTIONS=--max-old-space-size=8192`；npm 钉 10.9.8

## 说明

- 打开 **设置 → 关于** 即可安装，或在下方下载对应平台安装包
- Windows 建议安装 Git for Windows

## 发布

```bash
git tag desktop-v0.3.3 && git push origin desktop-v0.3.3
```
