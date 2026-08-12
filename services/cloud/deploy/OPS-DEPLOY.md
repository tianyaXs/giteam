# Giteam Cloud 运维部署手册

面向集群运维。研发侧交付物：容器镜像 + 本目录脚本/清单；**真实公网入口、镜像仓库账号、密钥由研发另行私下提供**，不要提交进 Git。

| 项 | 说明 |
|----|------|
| 服务名 | `giteam-cloud` |
| 镜像名 | `giteam-cloud` |
| 容器端口 | `8787`（HTTP；控制台与 API 同端口） |
| 健康检查 | `GET /healthz` |
| 依赖 | **Postgres 16**（需提前准备，本清单默认不自带生产库） |
| 副本数 | **必须为 1**（Tunnel Hub 为进程内内存；禁止 HPA / 多副本） |

---

## 1. 架构约束（必读）

```
手机 / 控制台 ──HTTP──► Gateway(:8787) ──WSS tunnel──► 用户本机 CLI(Control :4100)
                              │
                         Postgres
```

- Gateway **只做鉴权、路由、转发**；Agent / 仓库仍在用户本机。
- 在线设备状态存在 **Gateway 进程内存** → Deployment **`replicas: 1`**，升级策略为 `Recreate`。
- 对外入口可以是公网 IP:8787、SLB、或 Ingress；最终用户访问的 URL 必须与配置项 **`PUBLIC_BASE_URL`** 一致（含协议与端口）。

---

## 2. 交付清单

仓库路径：`services/cloud/deploy/`

```text
deploy/
  OPS-DEPLOY.md          ← 本文
  local.env.example      ← 配置模板（复制为 local.env 后填写）
  local.env              ← 真实配置（不进 Git；由研发/运维本机持有）
  k8s/
    apply.sh             ← 一键部署脚本（推荐）
    deployment.yaml      ← Deployment + Service
    configmap.yaml
    secret.example.yaml  ← 仅示例；真实 Secret 由 apply.sh 从 local.env 生成
    ingress.yaml         ← 可选
```

镜像已推送到私有仓库时，完整引用形如：

```text
<REGISTRY>/<NAMESPACE>/giteam-cloud:<TAG>
```

示例（占位）：`registry.example.com/my-ns/giteam-cloud:0.1.0`  
**具体 REGISTRY / NAMESPACE / TAG 以研发私下提供的 `local.env` 为准。**

---

## 3. 前置条件

1. 可访问目标集群：`kubectl` 已配置正确 context。
2. 节点能拉取私有镜像（已有 ImagePullSecret，名称与研发确认，常见如 `indemind`）。
3. **Postgres 16** 已就绪，并提供连接串 `DATABASE_URL`（脚本会写入 K8s Secret）。
4. 网络：对公网或内网客户端开放 **TCP 8787**（若走 Ingress/SLB，则开放对应入口，并反代到 Service `giteam-cloud:8787`）。
5. （可选）若需 WebSocket 长连接经 Ingress：调大 proxy read/send timeout（建议 ≥ 3600s）。

---

## 4. 填写本地配置 `local.env`

在有仓库副本的机器上：

```bash
cd <repo>/services/cloud/deploy
cp local.env.example local.env
# 用编辑器填写 —— 或直接使用研发提供的 local.env（勿提交 Git）
```

必填项：

| 变量 | 含义 |
|------|------|
| `REGISTRY` | 镜像仓库主机 |
| `NAMESPACE` | 仓库命名空间 |
| `IMAGE_NAME` | 固定 `giteam-cloud` |
| `TAG` | 镜像标签，如 `0.1.0` 或 `latest` |
| `PUBLIC_BASE_URL` | **用户实际访问的根 URL**（如 `http://<公网IP>:8787` 或 `https://cloud.example.com`），无尾斜杠 |
| `JWT_SECRET` | ≥16 字符，生产请用强随机 |
| `ADMIN_TOKEN` | 控制台登录 Bearer，生产请用强随机 |
| `DATABASE_URL` | Postgres 连接串 |
| `PULL_SECRET_NAME` | 集群内拉取私有镜像的 Secret 名（若需要） |
| `KUBE_NAMESPACE` | 可选，默认 `default` |

`PUBLIC_BASE_URL` 写错会导致：手机扫码/默认云地址与真实入口不一致、CLI 二维码错误。

---

## 5. 一键部署（推荐）

```bash
cd <repo>

# 确认 context
kubectl config current-context
kubectl get nodes

# 部署（读取 deploy/local.env，设置镜像全路径 + Secret + ConfigMap）
PULL_SECRET_NAME=<集群拉取凭证Secret名> \
  ./services/cloud/deploy/k8s/apply.sh
```

脚本会：

1. `apply` ConfigMap / Deployment / Service  
2. 用 `local.env` 创建/更新 Secret `giteam-cloud-secret`  
3. 将 ConfigMap 中 `PUBLIC_BASE_URL` 打成真实值  
4. `kubectl set image` 为：  
   `${REGISTRY}/${NAMESPACE}/${IMAGE_NAME}:${TAG}`  
5. 等待 rollout  
6. 若设置 `APPLY_INGRESS=1`，再 apply Ingress  

查看状态：

```bash
kubectl get deploy,svc,pods -l app=giteam-cloud -o wide
kubectl logs -l app=giteam-cloud --tail=100
```

预期日志含：`giteam cloud gateway listening`，且 `public=` 等于配置的 `PUBLIC_BASE_URL`。

---

## 6. 对外暴露

### 6.1 已有公网 IP 直打节点 / SLB → 8787

确保 Service 可被访问。当前清单为 `ClusterIP`，运维任选其一：

- 改 Service 为 `NodePort` / `LoadBalancer`，或  
- 用已有 Ingress / SLB 反代到 `giteam-cloud:8787`

**暴露后的对外 URL 必须与 `PUBLIC_BASE_URL` 一致。**

### 6.2 Ingress（可选）

```bash
# 先改 k8s/ingress.yaml 中的 host
APPLY_INGRESS=1 ./services/cloud/deploy/k8s/apply.sh
```

---

## 7. 验收清单

在能访问 `PUBLIC_BASE_URL` 的机器上执行：

```bash
# 1) 健康检查
curl -fsS "$PUBLIC_BASE_URL/healthz"
# 期望: {"ok":true,"service":"giteam-cloud-gateway"}

# 2) 控制台页面（同端口）
# 浏览器打开: $PUBLIC_BASE_URL/
# 登录 Token = local.env 中的 ADMIN_TOKEN
# Gateway URL 留空（同域）即可

# 3) Admin API
curl -fsS -H "Authorization: Bearer $ADMIN_TOKEN" \
  "$PUBLIC_BASE_URL/cloud/v1/admin/metrics"
```

研发侧联调（运维可配合）：CLI `giteam cloud link --url <PUBLIC_BASE_URL>`，手机云端模式使用同一地址。

---

## 8. 升级 / 回滚

```bash
# 升级：改 local.env 的 TAG（或 IMAGE=完整引用）后重跑
TAG=0.1.1 ./services/cloud/deploy/k8s/apply.sh

# 回滚到上一版 Deployment
kubectl rollout undo deployment/giteam-cloud
kubectl rollout status deployment/giteam-cloud
```

注意：单副本 Recreate 升级期间会有短暂中断（隧道会断，CLI 需自动重连）。

---

## 9. 常见问题

| 现象 | 排查 |
|------|------|
| `ImagePullBackOff` | 检查镜像全路径、TAG、`imagePullSecrets`（`PULL_SECRET_NAME`） |
| Pod Running 但 curl 不通 | Service/安全组/SLB/节点防火墙是否放行 8787 |
| 控制台能开、手机连不上 | `PUBLIC_BASE_URL` 是否为手机可达地址（勿用仅集群内 DNS） |
| `device_offline` / 无设备 | CLI 未 link 或 Tunnel 未连上；属业务侧，非 Ingress  alone |
| 多副本调度后状态错乱 | **禁止** `replicas > 1` |
| DB 连接失败 | 核对 `DATABASE_URL`、库网络策略、账号权限；首次启动会自动跑迁移 |

---

## 10. 资源参考（可按集群调整）

清单默认：

- requests：`250m` CPU / `256Mi` 内存  
- limits：`1000m` CPU / `1Gi` 内存  

Phase 1 流量不大，一般足够；若 SSE/隧道并发升高再调 limits。

---

## 11. 安全注意

- `JWT_SECRET`、`ADMIN_TOKEN`、`DATABASE_URL`、私有仓库账号 **不要写入公开文档或 Git**。  
- 生产务必轮换示例中的弱密钥。  
- 控制台仅内网或 VPN 可达更佳；若公网暴露，依赖强 `ADMIN_TOKEN` + 后续可再加 IP 限制。  

---

## 12. 联系研发时请准备

若部署失败，请提供：

1. `kubectl describe pod -l app=giteam-cloud`  
2. `kubectl logs -l app=giteam-cloud --tail=200`  
3. 对外访问方式（IP:端口 / Ingress host）及当前 `PUBLIC_BASE_URL`（可打码中间段）  
4. 使用的镜像 TAG  

---

**一句话流程：** 填好 `local.env` → 确认 Postgres 与拉镜像凭证 → 执行 `apply.sh` → 暴露 8787 且与 `PUBLIC_BASE_URL` 一致 → `curl /healthz` 通过 → 把入口与 `ADMIN_TOKEN` 交还给研发验收。
