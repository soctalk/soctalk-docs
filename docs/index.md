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
    - theme: brand
      text: MSSP pilot rollout
      link: /mssp-pilot
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

## Three steps in

**1. Evaluate, [demo VM](/quickstart-vm).** Single image, browser wizard, 5 minutes to a running install with a demo tenant. Available as QCOW2, VMDK, VHDX, VHD, and raw on the [downloads page](/downloads). Best way to see the AI SOC analyst answering real Wazuh queries end-to-end on a laptop.

**2. Pilot, [MSSP pilot rollout](/mssp-pilot).** The recommended next step: two on-premise environments (MSSP control plane + 1-3 tenants), connected by a firewall-friendly mesh VPN, running the full multi-tenant flow with real customer data. End state: an AI SOC analyst answering questions across your first pilot customers, and a stakeholder-ready screenshot.

**3. Production, [install guide](/install).** K3s + Cilium + cert-manager + Helm. Take an hour, end with a hardened multi-tenant install ready for your customer base.

## What's here

- [Get Started](/install), install paths (demo VM + production), MSSP UI tour.
- [Operate](/operations), daily ops, tenant lifecycle, upgrades, troubleshooting.
- [Integrate](/integrate/llm-providers), LLM providers, TheHive, Cortex, Slack.
- [Reference](/reference/architecture), architecture, security model, RLS, chart contract, REST API.
- [Contribute](/contribute), dev environment, PR expectations, release process.

Source: [github.com/soctalk/soctalk](https://github.com/soctalk/soctalk). Apache 2.0.
