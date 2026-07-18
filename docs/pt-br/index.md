---
layout: home

hero:
  name: SocTalk
  text: Plataforma de SOC AI-first para MSPs e MSSPs
  tagline: Execute uma stack Wazuh dedicada por cliente no seu próprio Kubernetes, atrás de um único control plane.
  actions:
    - theme: brand
      text: Experimente a VM de demonstração
      link: /pt-br/quickstart-vm
    - theme: brand
      text: Implantação piloto MSSP
      link: /pt-br/mssp-pilot
    - theme: alt
      text: Instalação em produção
      link: /pt-br/install
    - theme: alt
      text: GitHub
      link: https://github.com/soctalk/soctalk

features:
  - title: Multi-tenant
    details: Um único control plane executa stacks de SOC por cliente em namespaces isolados do Kubernetes, com o RLS do Postgres como salvaguarda de isolamento de dados.
  - title: Data plane Wazuh
    details: Cada cliente recebe seu próprio Wazuh manager e indexer. Os agentes se registram por ingress roteado por hostname. Totalmente open source.
  - title: Triagem por AI, controle humano
    details: Workers LangGraph fazem a triagem e propõem ações; os analistas aprovam escalações. BYO LLM por tenant.
---

## Três passos adiante

**1. Avalie — [VM de demonstração](/pt-br/quickstart-vm).** Imagem única, assistente no navegador, 5 minutos até uma instalação em execução com um tenant de demonstração. Disponível como QCOW2, VMDK, VHDX, VHD e raw na [página de downloads](/pt-br/downloads). Melhor maneira de ver o analista de SOC com AI respondendo consultas reais do Wazuh de ponta a ponta em um laptop.

**2. Piloto — [implantação piloto MSSP](/pt-br/mssp-pilot).** O próximo passo recomendado: dois ambientes on-premise (control plane MSSP + 1-3 tenants), conectados por uma mesh VPN amigável a firewalls, executando o fluxo multi-tenant completo com dados reais de clientes. Estado final: um analista de SOC com AI respondendo perguntas entre seus primeiros clientes piloto, e uma captura de tela pronta para stakeholders.

**3. Produção — [guia de instalação](/pt-br/install).** K3s + Cilium + cert-manager + Helm. Reserve uma hora e termine com uma instalação multi-tenant reforçada, pronta para sua base de clientes.

## O que há aqui

- [Comece](/pt-br/install) — caminhos de instalação (VM de demonstração + produção), tour pela UI do MSSP.
- [Opere](/pt-br/operations) — operações diárias, ciclo de vida do tenant, upgrades, resolução de problemas.
- [Integre](/pt-br/integrate/llm-providers) — provedores de LLM, TheHive, Cortex, Slack.
- [Referência](/pt-br/reference/architecture) — arquitetura, modelo de segurança, RLS, contrato de chart, REST API.
- [Contribua](/pt-br/contribute) — ambiente de desenvolvimento, expectativas de PR, processo de release.

Fonte: [github.com/soctalk/soctalk](https://github.com/soctalk/soctalk). Apache 2.0.
