# 参与贡献

SocTalk 采用 Apache 2.0 许可证。欢迎提交 PR。本页介绍开发循环以及审查过程中的注意事项。

## 开发环境

启动一个为 SocTalk 准备就绪的本地集群：

```bash
git clone https://github.com/soctalk/soctalk.git
cd soctalk
./scripts/dev-up.sh           # cluster dependencies only
```

`scripts/dev-up.sh` 会创建一个 k3d 集群并安装集群级别的先决条件：

- 禁用了 Flannel + kube-proxy 的 K3s
- 以 Cilium 作为 CNI，并启用 NetworkPolicy 强制执行
- 已安装 cert-manager
- 以 k3d local-path 作为默认的 StorageClass

它**不会**构建 SocTalk 镜像、安装 SocTalk chart、上线租户或播种数据——本页早期草稿曾声称它会这样做。请自行运行后续步骤。在 `dev-up.sh` 之后的典型流程为：

```bash
just build-api build-frontend  # api image embeds the orchestrator in V1
helm install soctalk-system charts/soctalk-system \
  -n soctalk-system --create-namespace \
  --set install.bootstrapAdmin.email=dev@example \
  --set install.bootstrapAdmin.password=devpassword12
# migrations + bootstrap admin run in the API pod's init command
# sign in at https://<your-ingress>/ with the credentials you set above
```

若想获得更快的内循环（不必每次修改都重新构建镜像），请参阅下文的迭代技巧。

## 选择你的迭代循环

按照项目惯例，优先使用 `uvicorn` / `pnpm dev` 运行服务，而不是走 k3d 的构建-推送-重新部署循环：

```bash
# API (embeds the orchestrator in V1)
cd src && uvicorn soctalk.core.api.app_v1:app --reload --port 8000

# Frontend
cd frontend && pnpm dev
```

通过 `kubectl port-forward` 让它们指向 k3d 集群的 Postgres / Wazuh / Cortex。迭代以秒计，而非以分钟计。

## 仓库布局

```text
src/                Python (control plane, AI pipeline, adapter, runs-worker)
frontend/           SvelteKit (MSSP + customer UI)
charts/             Helm charts (soctalk-system, soctalk-tenant, wazuh, linux-ep)
infra/packer/       VM image generation (see /downloads)
setup-wizard/       Go (first-boot setup wizard)
attack-simulator/   MITRE ATT&CK demo scripts
scripts/            Dev / e2e / seed scripts
alembic/            DB migrations
docker-compose*.yml Various dev composition files
justfile            Build / release recipes
```

文档站点（即本站点）位于一个独立的仓库中，[`soctalk/soctalk-docs`](https://github.com/soctalk/soctalk-docs)。

## 测试

本版本中没有 `just test` / `just test-rls` / `just e2e-l1-l2` 这些 recipe——那是规划中的形态。目前请直接使用 pytest 运行测试：

```bash
pytest tests/                          # full suite
pytest tests/v1/test_rls_isolation.py  # Postgres Row-Level Security suite
```

RLS 测试不容妥协——它们验证了 [安全模型](/zh-cn/reference/security-model) 所承诺的跨租户数据隔离。CI 会在每个 PR 上运行完整的 pytest 套件。

## 代码风格

- Python：ruff + black。CI 强制执行。
- TypeScript：ESLint + Prettier，使用仓库内的配置。CI 强制执行。
- 提交信息：单行主题，遵循 conventional commit 前缀（`feat:`、`fix:`、`chore:`、`ci:`、`chart:` 等）。无需正文。
- 不使用 co-authored-by / signed-off-by 尾注。

## PR 预期

- **为改动编写测试。** 新端点需要 API 测试；新的图节点需要状态机测试；chart 改动需要渲染后的模板快照。
- **若修改了模型则需迁移。** Alembic 会自动生成；在提交前请审查生成的 SQL 是否准确。
- **更新文档**——如果改动影响了已记录的行为，请更新 [`soctalk-docs`](https://github.com/soctalk/soctalk-docs)。对于仅限内部的重构，我们不作严格要求；但对于任何面向用户的内容，我们要求严格。
- **小型 PR。** 混杂大量改动的 PR 难以审查。将重构与功能拆开；将 chart 改动与运行时改动拆开。

## 审查你自己的工作

在请求审查之前，针对你的改动运行 codex：

```bash
codex review --uncommitted
```

这与我们在发布时运行的审查流程相同。它能在人工审查者介入之前捕获显而易见的问题。

## 发布

发布版本从 `main` 打标签。目前的流程比规划中的 `just release` recipe 所暗示的有更多手动步骤：

1. 手动在 `Chart.yaml` + `pyproject.toml` 中提升版本号，提交，推送。
2. 为该提交打标签并推送标签（`git tag v0.1.x && git push --tags`）。
3. `just release`——运行 `just build-all push-all`。这**只会构建并推送容器镜像**；它不会打标签、发布 chart 或创建 GitHub Release。
4. 触发时，`publish-images.yml` GH workflow 负责将镜像发布到 ghcr.io。
5. 目前将 chart 发布到 `ghcr.io/soctalk/charts/` 是手动使用 `helm push` 完成的。
6. 使用 `gh release create` 切出 GitHub Release。
7. `build-packer-images.yml`（手动触发）以全部五种格式构建 [演示 VM 镜像](/zh-cn/downloads) 并将其附加到 GitHub Release。

将步骤 1、2、5 和 6 合并进 `just release` recipe 已在路线图上。

## 安全漏洞披露

如果你发现了漏洞，**请勿提交公开 issue。** 请发送邮件至仓库根目录 SECURITY.md 中列出的地址。我们会在两个工作日内回应。

## 许可证

Apache 2.0。提交 PR 即表示你同意在相同许可证下授权你的贡献。

## 致谢

目前 git log 是权威的贡献者记录；专门的 CONTRIBUTORS.md / `just update-contributors` 正在规划中。
