import { defineConfig } from 'vitepress'
import { withMermaid } from 'vitepress-plugin-mermaid'

export default withMermaid(
  defineConfig({
    title: 'SocTalk',
    description: 'SocTalk documentation',
    base: '/soctalk-docs/',

    head: [
      ['link', { rel: 'icon', type: 'image/png', href: '/soctalk-docs/logo.png' }],
      ['meta', { name: 'theme-color', content: '#f43f5e' }],
      ['meta', { property: 'og:type', content: 'website' }],
      ['meta', { property: 'og:title', content: 'SocTalk Documentation' }],
      [
        'meta',
        {
          property: 'og:description',
          content: 'SocTalk documentation: install, operate, reference.',
        },
      ],
    ],

    themeConfig: {
      logo: '/logo.png',

      nav: [
        { text: 'Get Started', link: '/quickstart-vm' },
        { text: 'Launchpad', link: '/launchpad' },
        { text: 'Operate', link: '/operations' },
        { text: 'Integrate', link: '/integrate/llm-providers' },
        { text: 'Reference', link: '/reference/architecture' },
        { text: 'GitHub', link: 'https://github.com/soctalk/soctalk' },
      ],

      sidebar: [
        {
          text: 'Get Started',
          items: [
            { text: 'Quickstart: demo VM', link: '/quickstart-vm' },
            { text: 'MSSP pilot rollout', link: '/launchpad' },
            { text: 'MSSP pilot: do it yourself', link: '/mssp-pilot' },
            { text: 'Production install', link: '/install' },
            { text: 'Downloads', link: '/downloads' },
            { text: 'Setup wizard', link: '/setup-wizard' },
            { text: 'Run on VirtualBox', link: '/virtualbox' },
            { text: 'Run on VMware ESXi', link: '/vmware' },
            { text: 'Run on Windows (WSL2)', link: '/windows' },
            { text: 'Run on Proxmox', link: '/proxmox' },
            { text: 'Run on AWS', link: '/aws' },
            { text: 'Run on Azure', link: '/azure' },
            { text: 'MSSP UI Tour', link: '/mssp-ui' },
          ],
        },
        {
          text: 'Concepts',
          items: [
            { text: 'How it works', link: '/how-it-works' },
            { text: 'AI pipeline', link: '/ai-pipeline' },
            { text: 'Triage Policies', link: '/triage-policies' },
            { text: 'Response Playbooks', link: '/response-playbooks' },
            { text: 'Authorization', link: '/authorization' },
            { text: 'Tenant lifecycle', link: '/tenant-lifecycle' },
          ],
        },
        {
          text: 'Operate',
          items: [
            { text: 'Daily Operations', link: '/operations' },
            { text: 'Users and roles', link: '/users-and-roles' },
            { text: 'Managing users: a walkthrough', link: '/manage-users' },
            { text: 'Human review (HIL)', link: '/human-review' },
            { text: 'Observability', link: '/observability' },
            { text: 'Backup and restore', link: '/backup-restore' },
            { text: 'Upgrades', link: '/upgrades' },
            { text: 'Troubleshooting', link: '/troubleshooting' },
          ],
        },
        {
          text: 'Integrate',
          items: [
            { text: 'LLM providers', link: '/integrate/llm-providers' },
            { text: 'Ollama (local LLM)', link: '/integrate/ollama' },
            { text: 'TheHive', link: '/integrate/thehive' },
            { text: 'Cortex', link: '/integrate/cortex' },
            { text: 'Slack', link: '/integrate/slack' },
          ],
        },
        {
          text: 'Reference',
          items: [
            { text: 'Architecture', link: '/reference/architecture' },
            { text: 'Security Model', link: '/reference/security-model' },
            { text: 'Internal Auth', link: '/reference/internal-auth' },
            { text: 'Postgres RLS', link: '/reference/postgres-rls' },
            { text: 'Network Policy', link: '/reference/network-policy' },
            { text: 'Secrets', link: '/reference/secrets' },
            { text: 'Chart Contract', link: '/reference/chart-contract' },
            { text: 'Chart Audit', link: '/reference/chart-audit' },
            { text: 'Wazuh Ingress', link: '/reference/wazuh-ingress' },
            { text: 'Sizing', link: '/reference/sizing' },
            { text: 'REST API', link: '/reference/api' },
            { text: 'Launchpad events', link: '/reference/launchpad-events' },
            { text: 'CLI and scripts', link: '/reference/cli' },
            { text: 'Attack simulator', link: '/reference/attack-simulator' },
          ],
        },
        {
          text: 'Project',
          items: [
            { text: 'FAQ', link: '/faq' },
            { text: 'Contribute', link: '/contribute' },
          ],
        },
      ],

      socialLinks: [
        { icon: 'github', link: 'https://github.com/soctalk/soctalk' },
      ],

      footer: {
        message: 'Released under the Apache 2.0 License.',
        copyright: 'Copyright © 2025-2026 Gianluca Brigandi',
      },

      search: {
        provider: 'local',
      },

      editLink: {
        pattern:
          'https://github.com/soctalk/soctalk-docs/edit/main/docs/:path',
        text: 'Edit this page on GitHub',
      },
    },

    markdown: {
      theme: {
        light: 'github-light',
        dark: 'github-dark',
      },
    },
  }),
)
