# CLI 与脚本

运维人员的大多数操作都通过 [MSSP UI](/zh-cn/mssp-ui) 或 [REST API](/zh-cn/reference/api) 完成。CLI 面向的场景很小，仅用于引导初始化、开发环境和离线操作。

## Pod 内入口点

这些命令在 `soctalk-system-api`（或一次性 Job）内部运行。它们使用 Pod 挂载的 Postgres 凭据和 chart 配置——不依赖任何外部状态。

### 引导初始化

本版本没有单独的引导初始化 CLI——chart 的 API Pod 初始化命令会内联执行引导流程（迁移、角色密码、组织记录行、可选的管理员用户）。参见 [安装——迁移与引导](/zh-cn/install#migrations-and-bootstrap-run-automatically)。

### LLM 冒烟测试

本版本没有 `soctalk.llm.smoke_test` CLI。若要检查已配置的 LLM 是否可达，请参见 [LLM 提供方——健全性测试](/zh-cn/integrate/llm-providers#sanity-test) 中的单行 Python 表达式。

### `soctalk-auth`（Pod 内辅助工具）

本版本中唯一的一等 CLI 辅助工具。仅有一个子命令：`set-password`。

```bash
kubectl -n soctalk-system exec -it deploy/soctalk-system-api -- \
  soctalk-auth set-password user@example.com
```

它会提示输入新密码（或从 `SOCTALK_PASSWORD` 读取），查找该用户，设置哈希后的密码，并记录 `auth.password.reset.admin` 审计事件。适用于无需经过 API 的强制重置。该用户记录行必须已经存在；`soctalk-auth` 不会创建记录行。

### `soctalk`（编排器入口点）

`soctalk` 是编排器入口点——运行 LangGraph 主管 + 工作节点。在 V1 中，API Pod 内嵌了编排器（没有单独的 `soctalk-system-orchestrator` Deployment）。在开发环境之外通常不会手动调用。

### 尚无通用的 `soctalk-cli`

本页面早先的草稿在一个 `soctalk-cli` 二进制文件下列出了租户管理命令，但该二进制在当前版本中并不存在。如今租户操作（挂起、恢复、退役、轮换管理员）通过 [REST API](/zh-cn/reference/api) 完成。租户操作的 CLI 面向能力已列入未来版本的跟踪计划。

## 仓库侧：`justfile` 配方

仓库根目录下的 [`justfile`](https://github.com/soctalk/soctalk/blob/main/justfile) 包含开发和发布期间使用的配方：

| 配方 | 作用 |
|---|---|
| `just build-api` | 构建 API 容器镜像 |
| `just build-orchestrator` | 构建编排器容器镜像 |
| `just build-frontend` | 构建 SvelteKit 前端容器镜像 |
| `just build-mock-endpoint` | 构建 mock endpoint 模拟镜像 |
| `just run` | 通过 docker-compose 运行开发栈 |
| `just push-all` | 将所有镜像推送到配置的镜像仓库 |
| `just release` | 构建并推送所有镜像（`build-all` + `push-all`）。带版本号的 chart 发布、git 标签和 GitHub Release 由 **Cut k8s Release** GitHub Action 单独完成，而非由此配方完成。 |

## 仓库侧：`scripts/`

| 脚本 | 用途 |
|---|---|
| `scripts/dev-up.sh` | 启动一个包含 SocTalk 和一个预置租户的单节点 k3d 开发集群 |
| `scripts/local-up.sh` | 同上，但运行在主机的 k3s 上而非 k3d |
| `scripts/local-down.sh` | 拆除由 `local-up.sh` 创建的集群 |
| `scripts/e2e-l1-l2-k3d.sh` | 双集群 k3d 配置（MSSP L1 + 租户 L2），用于完整的端到端验证 |
| `scripts/seed-mssp-demo-data.py` | 用固定租户（`acme-corp`、`wayne-industries`、`stark-defense`）填充 Postgres，并通过索引器回放 Wazuh 告警，用于截图准备 |
| `scripts/dump_openapi.py` | 将 FastAPI 的 OpenAPI schema 导出为 JSON；作为文档 REST API 参考据以生成的权威来源 |
| `scripts/verify-pages-visual.py` | 针对开发环境 SocTalk UI 的 Playwright 视觉回归检查 |

这些脚本都期望从仓库根目录运行。请阅读脚本头部以了解确切的参数。

## 仓库侧：Packer

关于 VM 镜像构建，请参见 [下载 → 自行构建](/zh-cn/downloads#build-it-yourself)。

## 气隙（离线）操作

对于没有互联网访问的安装，仅凭 API + `soctalk-auth` 即可运行 SocTalk 而无需接触 UI：

```bash
# 引导会在 API Pod 的 init 命令中自动完成——无需
# 额外步骤。只需在安装 chart 时设置 install.bootstrapAdmin.* 即可。

# 或者，若未提供这些值，可在安装后设置管理员密码：
kubectl -n soctalk-system exec deploy/soctalk-system-api -- \
  soctalk-auth set-password admin@example
# 读取管理员凭据。
kubectl -n soctalk-system get secret soctalk-system-bootstrap-admin \
  -o jsonpath='{.data.password}' | base64 -d; echo

# 通过 API 接入一个租户。
curl -k -c jar -X POST http://soctalk-system-api:8000/api/auth/login \
  -d '{"email":"admin@example","password":"..."}'
curl -k -b jar -X POST http://soctalk-system-api:8000/api/mssp/tenants/onboard \
  -d '{"slug":"acme","display_name":"Acme","profile":"persistent"}'
```

关于引导 Job 输出的引导管理员现有密码，请参见 [安装 → 迁移与引导](/zh-cn/install#migrations-and-bootstrap-run-automatically)。

## 源码指引

| 概念 | 文件 |
|---|---|
| 引导（内联） | [`charts/soctalk-system/templates/30-api.yaml`](https://github.com/soctalk/soctalk/blob/main/charts/soctalk-system/templates/30-api.yaml)（init 命令） |
| LLM 提供方工厂 | [`src/soctalk/llm.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/llm.py) |
| `soctalk-auth` 源码 | [`src/soctalk/core/cli/auth.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/core/cli/auth.py) |
| `soctalk` 编排器入口 | [`src/soctalk/main.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/main.py) |
| `justfile` | [`justfile`](https://github.com/soctalk/soctalk/blob/main/justfile) |
| `scripts/` | [`scripts/`](https://github.com/soctalk/soctalk/tree/main/scripts) |
