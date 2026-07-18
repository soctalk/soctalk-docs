import { defineConfig } from 'vitepress'
import { withMermaid } from 'vitepress-plugin-mermaid'
import { NAV, SIDEBAR } from './i18n/structure.mjs'
import { LOCALES, ACTIVE_LOCALES, labels } from './i18n/labels.mjs'

// Build a locale's nav from shared structure + that locale's label table.
// External links (GitHub) are never localized or prefixed.
function buildNav(seg) {
  const L = labels(seg)
  return NAV.map((n) => ({
    text: L.nav[n.id] ?? n.en,
    link: n.external ? n.link : prefix(seg, n.link),
  }))
}

// Build a locale's sidebar the same way; links get the locale segment prefix.
function buildSidebar(seg) {
  const L = labels(seg)
  return SIDEBAR.map((s) => ({
    text: L.sec[s.id] ?? s.en,
    items: s.items.map((i) => ({
      text: L.item[i.id] ?? i.en,
      link: prefix(seg, i.link),
    })),
  }))
}

// Root (en-US) keeps bare links; every other locale is served under /<seg>/.
function prefix(seg, link) {
  return seg === 'root' ? link : `/${seg}${link}`
}

function themeConfigFor(seg) {
  const L = labels(seg)
  return {
    logo: '/logo.png',
    nav: buildNav(seg),
    sidebar: buildSidebar(seg),
    socialLinks: [{ icon: 'github', link: 'https://github.com/soctalk/soctalk' }],
    outline: { label: L.ui.outline },
    docFooter: { prev: L.ui.prev, next: L.ui.next },
    langMenuLabel: L.ui.langMenu,
    returnToTopLabel: L.ui.returnToTop,
    sidebarMenuLabel: L.ui.sidebarMenu,
    darkModeSwitchLabel: L.ui.appearance,
    lightModeSwitchTitle: L.ui.switchToLight,
    darkModeSwitchTitle: L.ui.switchToDark,
    editLink: {
      pattern: 'https://github.com/soctalk/soctalk-docs/edit/main/docs/:path',
      text: L.ui.editLink,
    },
    footer: { message: L.ui.footerMessage, copyright: L.ui.footerCopyright },
    search: { provider: 'local' },
  }
}

// Assemble the VitePress `locales` map from the locales that are content-ready.
// Adding a locale to ACTIVE_LOCALES (in labels.mjs) flips it on everywhere.
function buildLocales() {
  const out = {}
  for (const seg of ACTIVE_LOCALES) {
    const meta = LOCALES[seg]
    out[seg] = {
      label: meta.label,
      lang: meta.lang,
      ...(seg === 'root' ? {} : { link: `/${seg}/` }),
      title: 'SocTalk',
      description: labels(seg).ui.siteDescription,
      themeConfig: themeConfigFor(seg),
    }
  }
  return out
}

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

    locales: buildLocales(),

    markdown: {
      theme: {
        light: 'github-light',
        dark: 'github-dark',
      },
    },
  }),
)
