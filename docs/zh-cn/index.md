---
layout: home

hero:
  name: SocTalk
  text: 面向 MSP 与 MSSP 的 AI 优先 SOC 平台
  tagline: 在你自己的 Kubernetes 上为每个客户运行专属的 Wazuh 技术栈，统一置于同一控制平面之下。
  actions:
    - theme: brand
      text: 试用演示虚拟机
      link: /zh-cn/quickstart-vm
    - theme: brand
      text: MSSP 试点部署
      link: /zh-cn/mssp-pilot
    - theme: alt
      text: 生产环境安装
      link: /zh-cn/install
    - theme: alt
      text: GitHub
      link: https://github.com/soctalk/soctalk

features:
  - title: 多租户
    details: 单一控制平面在相互隔离的 Kubernetes 命名空间中为每个客户运行独立的 SOC 技术栈，并以 Postgres RLS 作为数据隔离的兜底保障。
  - title: Wazuh 数据平面
    details: 每个客户拥有各自的 Wazuh manager 与 indexer。代理通过按主机名路由的 ingress 进行注册。完全开源。
  - title: AI 分诊，人工把关
    details: LangGraph worker 负责分诊并提出处置建议；分析师审批升级操作。每个租户可 BYO LLM。
---

## 三步上手

**1. 评估 —— [演示虚拟机](/zh-cn/quickstart-vm)。** 单一镜像、浏览器向导，5 分钟即可获得一个带演示租户的运行实例。提供 QCOW2、VMDK、VHDX、VHD 及 raw 格式，详见[下载页面](/zh-cn/downloads)。这是在笔记本电脑上端到端体验 AI SOC 分析师回答真实 Wazuh 查询的最佳方式。

**2. 试点 —— [MSSP 试点部署](/zh-cn/mssp-pilot)。** 推荐的下一步：两个本地环境（MSSP 控制平面 + 1-3 个租户），通过对防火墙友好的网状 VPN 连接，使用真实客户数据运行完整的多租户流程。最终状态：一个 AI SOC 分析师可以跨你的首批试点客户回答问题，并生成可供利益相关方查看的截图。

**3. 生产 —— [安装指南](/zh-cn/install)。** K3s + Cilium + cert-manager + Helm。花上一小时，最终得到一套面向客户群、经过加固的多租户安装。

## 这里有什么

- [快速开始](/zh-cn/install) —— 安装路径（演示虚拟机 + 生产环境）、MSSP UI 导览。
- [运维](/zh-cn/operations) —— 日常运维、租户生命周期、升级、故障排查。
- [集成](/zh-cn/integrate/llm-providers) —— LLM 提供方、TheHive、Cortex、Slack。
- [参考](/zh-cn/reference/architecture) —— 架构、安全模型、RLS、chart 约定、REST API。
- [贡献](/zh-cn/contribute) —— 开发环境、PR 要求、发布流程。

源码：[github.com/soctalk/soctalk](https://github.com/soctalk/soctalk)。Apache 2.0。
