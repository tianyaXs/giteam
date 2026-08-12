# Giteam Cloud Relay

手机 ↔ 云端 Gateway ↔ 本机 CLI Control 的中继服务。单镜像同时提供 API 与 **Giteam Cloud** 控制台。

规格：`docs/superpowers/specs/2026-08-11-cloud-relay-mobile-control-design.md`

**交给运维部署请看：** [`deploy/OPS-DEPLOY.md`](./deploy/OPS-DEPLOY.md)

## 私密配置（必读）

生产公网入口、私有镜像仓库、JWT / Admin Token **不得写入公开仓库**。

| 文件 | 是否提交 | 用途 |
|------|----------|------|
| `services/cloud/deploy/local.env.example` | ✅ | 运维模板 |
| `services/cloud/deploy/local.env` | ❌ | 真实仓库地址 / `PUBLIC_BASE_URL` / 密钥 |
| `services/cloud/.env.example` | ✅ | 本地 compose 模板 |
| `services/cloud/.env` | ❌ | 本机 Gateway 环境 |
| `apps/mobile/.env.example` | ✅ | 手机默认云地址模板 |
| `apps/mobile/.env` | ❌ | 本地打包用的 `EXPO_PUBLIC_DEFAULT_CLOUD_BASE_URL` |

```bash
cp services/cloud/deploy/local.env.example services/cloud/deploy/local.env
cp services/cloud/.env.example services/cloud/.env
cp apps/mobile/.env.example apps/mobile/.env
# 再编辑上述本地文件，填入私有值
```

手机「云端」模式留空地址时，使用打包期注入的默认值（来自 `apps/mobile/.env`，不进 git）。

## 本地启动（Compose）

```bash
cd services/cloud
cp .env.example .env   # 按需修改
docker compose up --build
# http://127.0.0.1:8787/  （控制台 + API）
```

控制台热更新（可选）：`cd apps/cloud && npm i && npm run dev` → `:8788`

CLI：`giteam cloud link --url http://127.0.0.1:8787`

真机调试时把本机 `PUBLIC_BASE_URL` 设为电脑局域网 IP（写在 **本地** `.env`，不要提交）。

## 构建并推送镜像

```bash
docker login <your-registry>   # 见 local.env 中的 REGISTRY
./services/cloud/scripts/push-image.sh 0.1.0
```

脚本自动读取 `deploy/local.env`（`REGISTRY` / `NAMESPACE` / `IMAGE_NAME`）。

## 部署到集群

```bash
# local.env 已填好 PUBLIC_BASE_URL、密钥、镜像坐标
PULL_SECRET_NAME=<your-pull-secret> ./services/cloud/deploy/k8s/apply.sh
# 可选 Ingress
APPLY_INGRESS=1 ./services/cloud/deploy/k8s/apply.sh
```

Phase 1：**replicas = 1**（Tunnel Hub 进程内内存）。

## 环境变量

| 变量 | 说明 |
|------|------|
| `DATABASE_URL` | Postgres |
| `JWT_SECRET` | 手机 JWT（≥16） |
| `ADMIN_TOKEN` | 控制台 Bearer |
| `PUBLIC_BASE_URL` | 写入 QR 的公网/局域网入口（仅本地/集群配置） |
| `LISTEN_ADDR` | 默认 `0.0.0.0:8787` |
| `STATIC_DIR` | 控制台静态目录；镜像内 `/app/static` |
| `EXPO_PUBLIC_DEFAULT_CLOUD_BASE_URL` | 手机打包默认云地址（仅 `apps/mobile/.env`） |

## 联调

```bash
GITEAM_LAN_IP=<LAN_IP> python3 services/cloud/scripts/verify_lan_e2e.py
```
