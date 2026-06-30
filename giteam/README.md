# giteam

giteam 是多端 Git 协作工具，支持桌面端、移动端和 Web 端访问同一个代码仓库。

## 安装

```bash
# 1. 克隆仓库
git clone <repo-url>
cd giteam

# 2. 安装依赖
cd apps/desktop && npm install
cd ../mobile && npm install
```

## 快速上手

### Desktop 模式（Tauri）

```bash
cd apps/desktop
npm run tauri:dev        # 开发模式
npm run tauri:build      # 打包
```

### 移动端（Expo）

```bash
cd apps/mobile
npx expo start           # 启动 Metro
# 按 i 启动 iOS 模拟器，按 a 启动 Android
```

### Web 端

```bash
./run_debug.sh           # 一键构建并启动 Web 服务
# 服务启动后访问 http://localhost:5100
```

## 建立链接

1. 启动任意一端（Desktop / Mobile / Web）
2. 在设置或首页找到「配对码」
3. 在另一设备输入配对码，完成链接
4. 链接成功后，多端即可同步浏览同一仓库
