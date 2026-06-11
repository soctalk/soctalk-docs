---
layout: home

hero:
  name: SocTalk
  text: AI-first SOC platform for MSPs and MSSPs
  tagline: Run a dedicated Wazuh stack per customer on your own Kubernetes, behind one control plane.
  actions:
    - theme: brand
      text: Try the demo VM
      link: /quickstart-vm
    - theme: alt
      text: Production install
      link: /install
    - theme: alt
      text: GitHub
      link: https://github.com/soctalk/soctalk

features:
  - title: Multi-tenant
    details: A single control plane runs per-customer SOC stacks in isolated Kubernetes namespaces, with Postgres RLS as the data-isolation backstop.
  - title: Wazuh data plane
    details: Each customer gets their own Wazuh manager and indexer. Agents enroll over hostname-routed ingress. Fully open source.
  - title: AI triage, human gate
    details: LangGraph workers do the triage and propose actions; analysts approve escalations. BYO LLM per tenant.
---

## Two paths in

**Evaluating?** Boot the [demo VM](/quickstart-vm) — single image, browser wizard, 5 minutes to a running install with a demo tenant. Available as QCOW2, VMDK, VHDX, VHD, and raw on the [downloads page](/downloads).

**Going to production?** The [install guide](/install) walks through K3s + Cilium + cert-manager + Helm. Take an hour, end with a hardened multi-tenant install ready for your first customer.

## What's here

- [Get Started](/install) — install paths (demo VM + production), MSSP UI tour.
- [Operate](/operations) — daily ops, tenant lifecycle, upgrades, troubleshooting.
- [Integrate](/integrate/llm-providers) — LLM providers, TheHive, Cortex, Slack.
- [Reference](/reference/architecture) — architecture, security model, RLS, chart contract, REST API.
- [Contribute](/contribute) — dev environment, PR expectations, release process.

Source: [github.com/soctalk/soctalk](https://github.com/soctalk/soctalk). Apache 2.0.
