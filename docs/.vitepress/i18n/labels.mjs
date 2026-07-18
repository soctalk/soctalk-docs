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
export const ACTIVE_LOCALES = ['root', 'pt-br']

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
    },
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
    },
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
  'es-419': { nav: {}, sec: {}, item: {}, ui: {} },
  'zh-cn': { nav: {}, sec: {}, item: {}, ui: {} },
  'fr-fr': { nav: {}, sec: {}, item: {}, ui: {} },
  'de-de': { nav: {}, sec: {}, item: {}, ui: {} },
  'it-it': { nav: {}, sec: {}, item: {}, ui: {} },
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
