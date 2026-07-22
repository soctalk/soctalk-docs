// Per-locale label tables for the docs chrome (nav, sidebar, UI strings).
// Structure + English base labels live in ./structure.mjs; this file only
// carries translations, keyed by the same ids.
//
// Locale segments match the app (frontend) exactly: pt-br, es-419, zh-cn,
// fr-fr, de-de, it-it. `root` is en-US, served unprefixed.
//
// A locale appears in the site (nav switcher + routes) ONLY when it is listed
// in ACTIVE_LOCALES *and* its content tree under docs/<seg>/ is complete —
// VitePress 404s on a declared locale's missing pages, so we flip a locale on
// only after its pages land. See ./glossary.md for the term policy.

// Switcher labels are native endonyms (industry standard) — each language
// listed in its own name/script. English is the default locale (root, served
// unprefixed).
export const LOCALES = {
  root: { label: 'English', lang: 'en-US' },
  'pt-br': { label: 'Português', lang: 'pt-BR' },
  'es-419': { label: 'Español', lang: 'es-419' },
  'zh-cn': { label: '简体中文', lang: 'zh-CN' },
  'fr-fr': { label: 'Français', lang: 'fr-FR' },
  'de-de': { label: 'Deutsch', lang: 'de-DE' },
  'it-it': { label: 'Italiano', lang: 'it-IT' },
}

// Flip locales on here as their docs/<seg>/ trees are completed & verified.
export const ACTIVE_LOCALES = ['root', 'pt-br', 'es-419', 'zh-cn', 'fr-fr', 'de-de', 'it-it']

const EN_UI = {
  siteDescription: 'SocTalk documentation: install, operate, reference.',
  outline: 'On this page',
  prev: 'Previous page',
  next: 'Next page',
  langMenu: 'Change language',
  returnToTop: 'Return to top',
  sidebarMenu: 'Menu',
  appearance: 'Appearance',
  switchToLight: 'Switch to light theme',
  switchToDark: 'Switch to dark theme',
  editLink: 'Edit this page on GitHub',
  footerMessage: 'Released under the Apache 2.0 License.',
  footerCopyright: 'Copyright © 2025-2026 Gianluca Brigandi',
}

// Per-locale overrides: { nav, sec, item, ui }. Empty until translated;
// any missing key falls back to the English base (structure.en / EN_UI).
export const TR = {
  'pt-br': {
    nav: {
      nav_get_started: 'Comece aqui',
      nav_launchpad: 'Launchpad',
      nav_operate: 'Operar',
      nav_integrate: 'Integrar',
      nav_reference: 'Referência',
    },
    sec: {
      sec_get_started: 'Comece aqui',
      sec_concepts: 'Conceitos',
      sec_operate: 'Operar',
      sec_integrate: 'Integrar',
      sec_reference: 'Referência',
      sec_project: 'Projeto',
     sec_guides: 'Guias'},
    item: {
      'quickstart-vm': 'Início rápido: VM de demonstração',
      launchpad: 'Implantação piloto MSSP',
      'mssp-pilot': 'Piloto MSSP: faça você mesmo',
      install: 'Instalação em produção',
      downloads: 'Downloads',
      'setup-wizard': 'Assistente de configuração',
      virtualbox: 'Executar no VirtualBox',
      vmware: 'Executar no VMware ESXi',
      windows: 'Executar no Windows (WSL2)',
      proxmox: 'Executar no Proxmox',
      aws: 'Executar na AWS',
      azure: 'Executar no Azure',
      'mssp-ui': 'Tour da UI do MSSP',
      'how-it-works': 'Como funciona',
      'ai-pipeline': 'Pipeline de AI',
      'triage-policies': 'Políticas de triagem',
      'response-playbooks': 'Playbooks de resposta',
      authorization: 'Autorização',
      'tenant-lifecycle': 'Ciclo de vida do tenant',
      operations: 'Operações diárias',
      'users-and-roles': 'Usuários e funções',
      'manage-users': 'Gerenciando usuários: um passo a passo',
      'human-review': 'Revisão humana (HIL)',
      observability: 'Observabilidade',
      'backup-restore': 'Backup e restauração',
      upgrades: 'Atualizações',
      troubleshooting: 'Solução de problemas',
      'integrate/llm-providers': 'Provedores de LLM',
      'integrate/ollama': 'Ollama (LLM local)',
      'integrate/thehive': 'TheHive',
      'integrate/cortex': 'Cortex',
      'integrate/slack': 'Slack',
      'reference/architecture': 'Arquitetura',
      'reference/security-model': 'Modelo de segurança',
      'reference/internal-auth': 'Autenticação interna',
      'reference/postgres-rls': 'Postgres RLS',
      'reference/network-policy': 'Política de rede',
      'reference/secrets': 'Secrets',
      'reference/chart-contract': 'Contrato do chart',
      'reference/chart-audit': 'Auditoria do chart',
      'reference/wazuh-ingress': 'Ingress do Wazuh',
      'reference/sizing': 'Dimensionamento',
      'reference/api': 'REST API',
      'reference/launchpad-events': 'Eventos do Launchpad',
      'reference/cli': 'CLI e scripts',
      'reference/attack-simulator': 'Simulador de ataques',
      faq: 'FAQ',
      contribute: 'Contribuir',
     'guides/multi-tenant-wazuh-mssp': 'Wazuh multi-tenant para MSSPs', 'guides/ai-triage-wazuh-alerts': 'Triagem de alertas Wazuh com AI', 'guides/wazuh-tenant-onboarding': 'Onboarding de um tenant cliente', 'guides/open-source-soc-stack': 'Stack SOC open source', 'guides/inference-cost-optimization': 'Manter a conta do triage de IA baixa', 'guides/inference-cost-benchmark': 'Custo de inferência, medido'},
    ui: {
      siteDescription: 'Documentação do SocTalk: instalar, operar, referência.',
      outline: 'Nesta página',
      prev: 'Página anterior',
      next: 'Próxima página',
      langMenu: 'Mudar idioma',
      returnToTop: 'Voltar ao topo',
      sidebarMenu: 'Menu',
      appearance: 'Aparência',
      switchToLight: 'Mudar para o tema claro',
      switchToDark: 'Mudar para o tema escuro',
      editLink: 'Edite esta página no GitHub',
      footerMessage: 'Publicado sob a Licença Apache 2.0.',
    },
  },
  'es-419': {
    nav: {"nav_get_started": "Empezar", "nav_launchpad": "Launchpad", "nav_operate": "Operar", "nav_integrate": "Integrar", "nav_reference": "Referencia"},
    sec: {"sec_get_started": "Empezar", "sec_concepts": "Conceptos", "sec_operate": "Operar", "sec_integrate": "Integrar", "sec_reference": "Referencia", "sec_project": "Proyecto", sec_guides: 'Guías'},
    item: {"quickstart-vm": "Inicio rápido: VM de demostración", "launchpad": "Despliegue piloto MSSP", "mssp-pilot": "Piloto MSSP: hágalo usted mismo", "install": "Instalación en producción", "downloads": "Descargas", "setup-wizard": "Asistente de configuración", "virtualbox": "Ejecutar en VirtualBox", "vmware": "Ejecutar en VMware ESXi", "windows": "Ejecutar en Windows (WSL2)", "proxmox": "Ejecutar en Proxmox", "aws": "Ejecutar en AWS", "azure": "Ejecutar en Azure", "mssp-ui": "Recorrido por la UI de MSSP", "how-it-works": "Cómo funciona", "ai-pipeline": "Pipeline de IA", "triage-policies": "Políticas de triaje", "response-playbooks": "Playbooks de respuesta", "authorization": "Autorización", "tenant-lifecycle": "Ciclo de vida del tenant", "operations": "Operaciones diarias", "users-and-roles": "Usuarios y roles", "manage-users": "Gestión de usuarios: un recorrido paso a paso", "human-review": "Revisión humana (HIL)", "observability": "Observabilidad", "backup-restore": "Copia de seguridad y restauración", "upgrades": "Actualizaciones", "troubleshooting": "Solución de problemas", "integrate/llm-providers": "Proveedores de LLM", "integrate/ollama": "Ollama (LLM local)", "integrate/thehive": "TheHive", "integrate/cortex": "Cortex", "integrate/slack": "Slack", "reference/architecture": "Arquitectura", "reference/security-model": "Modelo de seguridad", "reference/internal-auth": "Autenticación interna", "reference/postgres-rls": "Postgres RLS", "reference/network-policy": "Política de red", "reference/secrets": "Secrets", "reference/chart-contract": "Contrato del chart", "reference/chart-audit": "Auditoría del chart", "reference/wazuh-ingress": "Ingress de Wazuh", "reference/sizing": "Dimensionamiento", "reference/api": "REST API", "reference/launchpad-events": "Eventos de Launchpad", "reference/cli": "CLI y scripts", "reference/attack-simulator": "Simulador de ataques", "faq": "FAQ", "contribute": "Contribuir", 'guides/multi-tenant-wazuh-mssp': 'Wazuh multi-tenant para MSSPs', 'guides/ai-triage-wazuh-alerts': 'Triaje de alertas Wazuh con IA', 'guides/wazuh-tenant-onboarding': 'Onboarding de un tenant cliente', 'guides/open-source-soc-stack': 'Stack SOC open source', 'guides/inference-cost-optimization': 'Mantener baja la factura del triaje IA', 'guides/inference-cost-benchmark': 'Costo de inferencia, medido'},
    ui: {"siteDescription": "Documentación de SocTalk: instalar, operar, referencia.", "outline": "En esta página", "prev": "Página anterior", "next": "Página siguiente", "langMenu": "Cambiar idioma", "returnToTop": "Volver arriba", "sidebarMenu": "Menú", "appearance": "Apariencia", "switchToLight": "Cambiar al tema claro", "switchToDark": "Cambiar al tema oscuro", "editLink": "Editar esta página en GitHub", "footerMessage": "Publicado bajo la Licencia Apache 2.0."},
  },
  'zh-cn': {
    nav: {"nav_get_started": "快速开始", "nav_launchpad": "Launchpad", "nav_operate": "运维", "nav_integrate": "集成", "nav_reference": "参考"},
    sec: {"sec_get_started": "快速开始", "sec_concepts": "概念", "sec_operate": "运维", "sec_integrate": "集成", "sec_reference": "参考", "sec_project": "项目", sec_guides: '指南'},
    item: {"quickstart-vm": "快速开始：演示虚拟机", "launchpad": "MSSP 试点部署", "mssp-pilot": "MSSP 试点：自行部署", "install": "生产环境安装", "downloads": "下载", "setup-wizard": "安装向导", "virtualbox": "在 VirtualBox 上运行", "vmware": "在 VMware ESXi 上运行", "windows": "在 Windows 上运行（WSL2）", "proxmox": "在 Proxmox 上运行", "aws": "在 AWS 上运行", "azure": "在 Azure 上运行", "mssp-ui": "MSSP 界面导览", "how-it-works": "工作原理", "ai-pipeline": "AI 流水线", "triage-policies": "分诊策略", "response-playbooks": "响应 Playbook", "authorization": "授权", "tenant-lifecycle": "租户生命周期", "operations": "日常运维", "users-and-roles": "用户与角色", "manage-users": "管理用户：操作演练", "human-review": "人工审查（HIL）", "observability": "可观测性", "backup-restore": "备份与恢复", "upgrades": "升级", "troubleshooting": "故障排查", "integrate/llm-providers": "LLM 提供商", "integrate/ollama": "Ollama（本地 LLM）", "integrate/thehive": "TheHive", "integrate/cortex": "Cortex", "integrate/slack": "Slack", "reference/architecture": "架构", "reference/security-model": "安全模型", "reference/internal-auth": "内部认证", "reference/postgres-rls": "Postgres RLS", "reference/network-policy": "网络策略", "reference/secrets": "Secrets", "reference/chart-contract": "Chart 契约", "reference/chart-audit": "Chart 审计", "reference/wazuh-ingress": "Wazuh Ingress", "reference/sizing": "容量规划", "reference/api": "REST API", "reference/launchpad-events": "Launchpad 事件", "reference/cli": "CLI 与脚本", "reference/attack-simulator": "攻击模拟器", "faq": "FAQ", "contribute": "贡献", 'guides/multi-tenant-wazuh-mssp': '面向 MSSP 的多租户 Wazuh', 'guides/ai-triage-wazuh-alerts': 'Wazuh 告警的 AI 分诊', 'guides/wazuh-tenant-onboarding': '客户租户接入', 'guides/open-source-soc-stack': '开源 SOC 技术栈', 'guides/inference-cost-optimization': '压低 AI 分诊账单', 'guides/inference-cost-benchmark': '分诊推理成本实测'},
    ui: {"siteDescription": "SocTalk 文档：安装、运维、参考。", "outline": "本页内容", "prev": "上一页", "next": "下一页", "langMenu": "切换语言", "returnToTop": "返回顶部", "sidebarMenu": "菜单", "appearance": "外观", "switchToLight": "切换到浅色主题", "switchToDark": "切换到深色主题", "editLink": "在 GitHub 上编辑此页", "footerMessage": "基于 Apache 2.0 许可证发布。"},
  },
  'fr-fr': {
    nav: {"nav_get_started": "Prise en main", "nav_launchpad": "Launchpad", "nav_operate": "Exploiter", "nav_integrate": "Intégrer", "nav_reference": "Référence"},
    sec: {"sec_get_started": "Prise en main", "sec_concepts": "Concepts", "sec_operate": "Exploiter", "sec_integrate": "Intégrer", "sec_reference": "Référence", "sec_project": "Projet", sec_guides: 'Guides'},
    item: {"quickstart-vm": "Démarrage rapide : VM de démonstration", "launchpad": "Déploiement pilote MSSP", "mssp-pilot": "Pilote MSSP : faites-le vous-même", "install": "Installation en production", "downloads": "Téléchargements", "setup-wizard": "Assistant de configuration", "virtualbox": "Exécuter sur VirtualBox", "vmware": "Exécuter sur VMware ESXi", "windows": "Exécuter sur Windows (WSL2)", "proxmox": "Exécuter sur Proxmox", "aws": "Exécuter sur AWS", "azure": "Exécuter sur Azure", "mssp-ui": "Visite de l'interface MSSP", "how-it-works": "Fonctionnement", "ai-pipeline": "Pipeline d'IA", "triage-policies": "Politiques de triage", "response-playbooks": "Playbooks de réponse", "authorization": "Autorisation", "tenant-lifecycle": "Cycle de vie du tenant", "operations": "Opérations quotidiennes", "users-and-roles": "Utilisateurs et rôles", "manage-users": "Gestion des utilisateurs : guide pas à pas", "human-review": "Revue humaine (HIL)", "observability": "Observabilité", "backup-restore": "Sauvegarde et restauration", "upgrades": "Mises à niveau", "troubleshooting": "Dépannage", "integrate/llm-providers": "Fournisseurs de LLM", "integrate/ollama": "Ollama (LLM local)", "integrate/thehive": "TheHive", "integrate/cortex": "Cortex", "integrate/slack": "Slack", "reference/architecture": "Architecture", "reference/security-model": "Modèle de sécurité", "reference/internal-auth": "Authentification interne", "reference/postgres-rls": "Postgres RLS", "reference/network-policy": "Politique réseau", "reference/secrets": "Secrets", "reference/chart-contract": "Contrat du chart", "reference/chart-audit": "Audit du chart", "reference/wazuh-ingress": "Ingress Wazuh", "reference/sizing": "Dimensionnement", "reference/api": "API REST", "reference/launchpad-events": "Événements Launchpad", "reference/cli": "CLI et scripts", "reference/attack-simulator": "Simulateur d'attaques", "faq": "FAQ", "contribute": "Contribuer", 'guides/multi-tenant-wazuh-mssp': 'Wazuh multi-tenant pour les MSSP', 'guides/ai-triage-wazuh-alerts': 'Triage IA des alertes Wazuh', 'guides/wazuh-tenant-onboarding': 'Onboarding d\'un tenant client', 'guides/open-source-soc-stack': 'Stack SOC open source', 'guides/inference-cost-optimization': 'Réduire la facture du triage IA', 'guides/inference-cost-benchmark': "Coût d'inférence, mesuré"},
    ui: {"siteDescription": "Documentation de SocTalk : installer, exploiter, référence.", "outline": "Sur cette page", "prev": "Page précédente", "next": "Page suivante", "langMenu": "Changer de langue", "returnToTop": "Retour en haut", "sidebarMenu": "Menu", "appearance": "Apparence", "switchToLight": "Passer au thème clair", "switchToDark": "Passer au thème sombre", "editLink": "Modifier cette page sur GitHub", "footerMessage": "Publié sous la licence Apache 2.0."},
  },
  'de-de': {
    nav: {"nav_get_started": "Erste Schritte", "nav_launchpad": "Launchpad", "nav_operate": "Betreiben", "nav_integrate": "Integrieren", "nav_reference": "Referenz"},
    sec: {"sec_get_started": "Erste Schritte", "sec_concepts": "Konzepte", "sec_operate": "Betreiben", "sec_integrate": "Integrieren", "sec_reference": "Referenz", "sec_project": "Projekt", sec_guides: 'Anleitungen'},
    item: {"quickstart-vm": "Schnellstart: Demo-VM", "launchpad": "MSSP-Pilot-Rollout", "mssp-pilot": "MSSP-Pilot: selbst durchführen", "install": "Produktivinstallation", "downloads": "Downloads", "setup-wizard": "Einrichtungsassistent", "virtualbox": "Auf VirtualBox ausführen", "vmware": "Auf VMware ESXi ausführen", "windows": "Unter Windows ausführen (WSL2)", "proxmox": "Auf Proxmox ausführen", "aws": "Auf AWS ausführen", "azure": "Auf Azure ausführen", "mssp-ui": "MSSP-UI-Tour", "how-it-works": "Funktionsweise", "ai-pipeline": "AI-Pipeline", "triage-policies": "Triage-Richtlinien", "response-playbooks": "Response-Playbooks", "authorization": "Autorisierung", "tenant-lifecycle": "Mandanten-Lebenszyklus", "operations": "Täglicher Betrieb", "users-and-roles": "Benutzer und Rollen", "manage-users": "Benutzer verwalten: eine Anleitung", "human-review": "Menschliche Prüfung (HIL)", "observability": "Observability", "backup-restore": "Sicherung und Wiederherstellung", "upgrades": "Upgrades", "troubleshooting": "Fehlerbehebung", "integrate/llm-providers": "LLM-Anbieter", "integrate/ollama": "Ollama (lokales LLM)", "integrate/thehive": "TheHive", "integrate/cortex": "Cortex", "integrate/slack": "Slack", "reference/architecture": "Architektur", "reference/security-model": "Sicherheitsmodell", "reference/internal-auth": "Interne Authentifizierung", "reference/postgres-rls": "Postgres RLS", "reference/network-policy": "Netzwerkrichtlinie", "reference/secrets": "Secrets", "reference/chart-contract": "Chart-Vertrag", "reference/chart-audit": "Chart-Audit", "reference/wazuh-ingress": "Wazuh-Ingress", "reference/sizing": "Dimensionierung", "reference/api": "REST API", "reference/launchpad-events": "Launchpad-Ereignisse", "reference/cli": "CLI und Skripte", "reference/attack-simulator": "Angriffssimulator", "faq": "FAQ", "contribute": "Mitwirken", 'guides/multi-tenant-wazuh-mssp': 'Multi-Tenant-Wazuh für MSSPs', 'guides/ai-triage-wazuh-alerts': 'AI-Triage für Wazuh-Warnungen', 'guides/wazuh-tenant-onboarding': 'Onboarding eines Kunden-Mandanten', 'guides/open-source-soc-stack': 'Open-Source-SOC-Stack', 'guides/inference-cost-optimization': 'KI-Triage-Rechnung niedrig halten', 'guides/inference-cost-benchmark': 'Inferenzkosten, gemessen'},
    ui: {"siteDescription": "SocTalk-Dokumentation: Installation, Betrieb, Referenz.", "outline": "Auf dieser Seite", "prev": "Vorherige Seite", "next": "Nächste Seite", "langMenu": "Sprache ändern", "returnToTop": "Nach oben", "sidebarMenu": "Menü", "appearance": "Darstellung", "switchToLight": "Zum hellen Design wechseln", "switchToDark": "Zum dunklen Design wechseln", "editLink": "Diese Seite auf GitHub bearbeiten", "footerMessage": "Veröffentlicht unter der Apache-2.0-Lizenz."},
  },
  'it-it': {
    nav: {"nav_get_started": "Inizia qui", "nav_launchpad": "Launchpad", "nav_operate": "Operare", "nav_integrate": "Integrare", "nav_reference": "Riferimento"},
    sec: {"sec_get_started": "Inizia qui", "sec_concepts": "Concetti", "sec_operate": "Operare", "sec_integrate": "Integrare", "sec_reference": "Riferimento", "sec_project": "Progetto", sec_guides: 'Guide'},
    item: {"quickstart-vm": "Avvio rapido: VM demo", "launchpad": "Distribuzione pilota MSSP", "mssp-pilot": "Pilota MSSP: fai da te", "install": "Installazione in produzione", "downloads": "Download", "setup-wizard": "Procedura guidata di configurazione", "virtualbox": "Esecuzione su VirtualBox", "vmware": "Esecuzione su VMware ESXi", "windows": "Esecuzione su Windows (WSL2)", "proxmox": "Esecuzione su Proxmox", "aws": "Esecuzione su AWS", "azure": "Esecuzione su Azure", "mssp-ui": "Tour della UI MSSP", "how-it-works": "Come funziona", "ai-pipeline": "Pipeline AI", "triage-policies": "Politiche di triage", "response-playbooks": "Playbook di risposta", "authorization": "Autorizzazione", "tenant-lifecycle": "Ciclo di vita del tenant", "operations": "Operazioni quotidiane", "users-and-roles": "Utenti e ruoli", "manage-users": "Gestione degli utenti: una guida passo passo", "human-review": "Revisione umana (HIL)", "observability": "Osservabilità", "backup-restore": "Backup e ripristino", "upgrades": "Aggiornamenti", "troubleshooting": "Risoluzione dei problemi", "integrate/llm-providers": "Provider LLM", "integrate/ollama": "Ollama (LLM locale)", "integrate/thehive": "TheHive", "integrate/cortex": "Cortex", "integrate/slack": "Slack", "reference/architecture": "Architettura", "reference/security-model": "Modello di sicurezza", "reference/internal-auth": "Autenticazione interna", "reference/postgres-rls": "Postgres RLS", "reference/network-policy": "Criteri di rete", "reference/secrets": "Secrets", "reference/chart-contract": "Contratto del chart", "reference/chart-audit": "Audit del chart", "reference/wazuh-ingress": "Ingress di Wazuh", "reference/sizing": "Dimensionamento", "reference/api": "REST API", "reference/launchpad-events": "Eventi di Launchpad", "reference/cli": "CLI e script", "reference/attack-simulator": "Simulatore di attacchi", "faq": "FAQ", "contribute": "Contribuire", 'guides/multi-tenant-wazuh-mssp': 'Wazuh multi-tenant per gli MSSP', 'guides/ai-triage-wazuh-alerts': 'Triage AI degli alert Wazuh', 'guides/wazuh-tenant-onboarding': 'Onboarding di un tenant cliente', 'guides/open-source-soc-stack': 'Stack SOC open source', 'guides/inference-cost-optimization': 'Tenere bassa la bolletta del triage AI', 'guides/inference-cost-benchmark': 'Costo di inferenza, misurato'},
    ui: {"siteDescription": "Documentazione di SocTalk: installazione, operatività, riferimento.", "outline": "In questa pagina", "prev": "Pagina precedente", "next": "Pagina successiva", "langMenu": "Cambia lingua", "returnToTop": "Torna su", "sidebarMenu": "Menu", "appearance": "Aspetto", "switchToLight": "Passa al tema chiaro", "switchToDark": "Passa al tema scuro", "editLink": "Modifica questa pagina su GitHub", "footerMessage": "Rilasciato sotto la Licenza Apache 2.0."},
  },
}

export function labels(seg) {
  const t = TR[seg] ?? {}
  return {
    nav: t.nav ?? {},
    sec: t.sec ?? {},
    item: t.item ?? {},
    ui: { ...EN_UI, ...(t.ui ?? {}) },
  }
}
