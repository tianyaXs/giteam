# Giteam Desktop v0.2.59

发布标签：`desktop-v0.2.59`

## 本版重点

- 消息流取消虚拟列表，改用真实 DOM + Lenis 惯性滚动；修复快滑回弹、到底下不去、流式输出不跟进
- 新增帆船航线概览标尺（设置可切换），进度与原生滚动条对齐
- 工具授权请求卡片改为紧凑单行，去掉冗长目标详情
- 本地仓库流体导航、空闲水滴氛围、自动化日历等桌面体验更新
- 修复发布 CI：`pi_agent_rust` 改回 git 依赖（含 Kimi message_delta cache 用量修正），并提高 macOS Vite 堆内存

## 说明

- 打开 **设置 → 关于** 即可安装，或在下方下载对应平台安装包
- Windows 建议安装 Git for Windows
- 详细说明见本文件

## 发布

```bash
git tag desktop-v0.2.59 && git push origin desktop-v0.2.59
```
