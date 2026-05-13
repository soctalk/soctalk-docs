import { defineConfig } from 'vitepress'
import { withMermaid } from 'vitepress-plugin-mermaid'

export default withMermaid(
  defineConfig({
    title: 'SocTalk',
    description: 'SocTalk documentation',
    base: '/',

    head: [
      ['link', { rel: 'icon', type: 'image/png', href: '/logo.png' }],
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
        { text: 'Get Started', link: '/install' },
        { text: 'Operate', link: '/operations' },
        { text: 'Reference', link: '/reference/architecture' },
        { text: 'GitHub', link: 'https://github.com/soctalk/soctalk' },
      ],

      sidebar: [
        {
          text: 'Get Started',
          items: [
            { text: 'Install', link: '/install' },
          ],
        },
        {
          text: 'Operate',
          items: [
            { text: 'Daily Operations', link: '/operations' },
            { text: 'Upgrades', link: '/upgrades' },
            { text: 'Troubleshooting', link: '/troubleshooting' },
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
