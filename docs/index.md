---
layout: home

hero:
  name: SocTalk
  text: AI-first SOC platform for MSPs and MSSPs
  tagline: Run a dedicated Wazuh stack per customer on your own Kubernetes, behind one control plane.
  actions:
    - theme: brand
      text: Install
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

## What's here

If you're installing SocTalk, start with Install. Once it's running, Operate has the day-2 procedures (ops, upgrades, troubleshooting). Reference is for digging into the architecture, RLS hygiene, chart contract, network policy, secrets, and sizing.

## Where things live

The product home is at [soctalk.ai](https://soctalk.ai). Source lives on [GitHub](https://github.com/soctalk/soctalk), which is also where issues and RFCs go.
