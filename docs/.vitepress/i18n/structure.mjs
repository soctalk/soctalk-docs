// Single source of truth for the docs nav + sidebar *structure*.
// Labels live per-locale in ./labels.mjs keyed by the ids below; the base
// (en-US) labels are inlined here so English needs no translation table.
// buildThemeConfig() stitches structure + labels + locale link-prefix together
// so every locale's nav/sidebar stays in lockstep with a single edit here.

export const NAV = [
  { id: 'nav_get_started', link: '/quickstart-vm', en: 'Get Started' },
  { id: 'nav_launchpad', link: '/launchpad', en: 'Launchpad' },
  { id: 'nav_operate', link: '/operations', en: 'Operate' },
  { id: 'nav_integrate', link: '/integrate/llm-providers', en: 'Integrate' },
  { id: 'nav_reference', link: '/reference/architecture', en: 'Reference' },
  // GitHub is an external, literal link — never localized, never prefixed.
  { id: 'nav_github', link: 'https://github.com/soctalk/soctalk', en: 'GitHub', external: true },
]

export const SIDEBAR = [
  {
    id: 'sec_get_started', en: 'Get Started',
    items: [
      { id: 'quickstart-vm', link: '/quickstart-vm', en: 'Quickstart: demo VM' },
      { id: 'launchpad', link: '/launchpad', en: 'MSSP pilot rollout' },
      { id: 'mssp-pilot', link: '/mssp-pilot', en: 'MSSP pilot: do it yourself' },
      { id: 'install', link: '/install', en: 'Production install' },
      { id: 'downloads', link: '/downloads', en: 'Downloads' },
      { id: 'setup-wizard', link: '/setup-wizard', en: 'Setup wizard' },
      { id: 'virtualbox', link: '/virtualbox', en: 'Run on VirtualBox' },
      { id: 'vmware', link: '/vmware', en: 'Run on VMware ESXi' },
      { id: 'windows', link: '/windows', en: 'Run on Windows (WSL2)' },
      { id: 'proxmox', link: '/proxmox', en: 'Run on Proxmox' },
      { id: 'aws', link: '/aws', en: 'Run on AWS' },
      { id: 'azure', link: '/azure', en: 'Run on Azure' },
      { id: 'mssp-ui', link: '/mssp-ui', en: 'MSSP UI Tour' },
    ],
  },
  {
    id: 'sec_concepts', en: 'Concepts',
    items: [
      { id: 'how-it-works', link: '/how-it-works', en: 'How it works' },
      { id: 'ai-pipeline', link: '/ai-pipeline', en: 'AI pipeline' },
      { id: 'triage-policies', link: '/triage-policies', en: 'Triage Policies' },
      { id: 'response-playbooks', link: '/response-playbooks', en: 'Response Playbooks' },
      { id: 'authorization', link: '/authorization', en: 'Authorization' },
      { id: 'tenant-lifecycle', link: '/tenant-lifecycle', en: 'Tenant lifecycle' },
    ],
  },
  {
    id: 'sec_guides', en: 'Guides',
    items: [
      { id: 'guides/multi-tenant-wazuh-mssp', link: '/guides/multi-tenant-wazuh-mssp', en: 'Multi-tenant Wazuh for MSSPs' },
      { id: 'guides/ai-triage-wazuh-alerts', link: '/guides/ai-triage-wazuh-alerts', en: 'AI triage for Wazuh alerts' },
      { id: 'guides/wazuh-tenant-onboarding', link: '/guides/wazuh-tenant-onboarding', en: 'Onboarding a customer tenant' },
      { id: 'guides/open-source-soc-stack', link: '/guides/open-source-soc-stack', en: 'Open-source SOC stack' },
      { id: 'guides/inference-cost-optimization', link: '/guides/inference-cost-optimization', en: 'Keeping the AI triage bill low' },
      { id: 'guides/inference-cost-benchmark', link: '/guides/inference-cost-benchmark', en: 'What triage inference costs, measured' },
    ],
  },
  {
    id: 'sec_operate', en: 'Operate',
    items: [
      { id: 'operations', link: '/operations', en: 'Daily Operations' },
      { id: 'users-and-roles', link: '/users-and-roles', en: 'Users and roles' },
      { id: 'manage-users', link: '/manage-users', en: 'Managing users: a walkthrough' },
      { id: 'human-review', link: '/human-review', en: 'Human review (HIL)' },
      { id: 'observability', link: '/observability', en: 'Observability' },
      { id: 'backup-restore', link: '/backup-restore', en: 'Backup and restore' },
      { id: 'upgrades', link: '/upgrades', en: 'Upgrades' },
      { id: 'troubleshooting', link: '/troubleshooting', en: 'Troubleshooting' },
    ],
  },
  {
    id: 'sec_integrate', en: 'Integrate',
    items: [
      { id: 'integrate/llm-providers', link: '/integrate/llm-providers', en: 'LLM providers' },
      { id: 'integrate/ollama', link: '/integrate/ollama', en: 'Ollama (local LLM)' },
      { id: 'integrate/thehive', link: '/integrate/thehive', en: 'TheHive' },
      { id: 'integrate/cortex', link: '/integrate/cortex', en: 'Cortex' },
      { id: 'integrate/slack', link: '/integrate/slack', en: 'Slack' },
    ],
  },
  {
    id: 'sec_reference', en: 'Reference',
    items: [
      { id: 'reference/architecture', link: '/reference/architecture', en: 'Architecture' },
      { id: 'reference/security-model', link: '/reference/security-model', en: 'Security Model' },
      { id: 'reference/internal-auth', link: '/reference/internal-auth', en: 'Internal Auth' },
      { id: 'reference/postgres-rls', link: '/reference/postgres-rls', en: 'Postgres RLS' },
      { id: 'reference/network-policy', link: '/reference/network-policy', en: 'Network Policy' },
      { id: 'reference/secrets', link: '/reference/secrets', en: 'Secrets' },
      { id: 'reference/chart-contract', link: '/reference/chart-contract', en: 'Chart Contract' },
      { id: 'reference/chart-audit', link: '/reference/chart-audit', en: 'Chart Audit' },
      { id: 'reference/wazuh-ingress', link: '/reference/wazuh-ingress', en: 'Wazuh Ingress' },
      { id: 'reference/sizing', link: '/reference/sizing', en: 'Sizing' },
      { id: 'reference/api', link: '/reference/api', en: 'REST API' },
      { id: 'reference/launchpad-events', link: '/reference/launchpad-events', en: 'Launchpad events' },
      { id: 'reference/cli', link: '/reference/cli', en: 'CLI and scripts' },
      { id: 'reference/attack-simulator', link: '/reference/attack-simulator', en: 'Attack simulator' },
    ],
  },
  {
    id: 'sec_project', en: 'Project',
    items: [
      { id: 'faq', link: '/faq', en: 'FAQ' },
      { id: 'contribute', link: '/contribute', en: 'Contribute' },
    ],
  },
]

// Every content page the sidebar references, for coverage checks by tooling.
export const ALL_PAGES = SIDEBAR.flatMap((s) => s.items.map((i) => i.link.slice(1)))
  .concat(['index', 'faq']) // index is the home layout; ensure it's tracked
