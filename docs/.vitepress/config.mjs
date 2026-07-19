import { defineConfig } from 'vitepress'
import { withMermaid } from 'vitepress-plugin-mermaid'
import { NAV, SIDEBAR } from './i18n/structure.mjs'
import { LOCALES, ACTIVE_LOCALES, labels } from './i18n/labels.mjs'

const HOST = 'https://soctalk.github.io/soctalk-docs/'

// hreflang values must be valid BCP-47 language[-REGION]; "es-419" (UN M.49)
// is rejected by Google, so the Spanish variant is annotated language-only.
const HREFLANG = {
  root: 'en-US',
  'pt-br': 'pt-BR',
  'es-419': 'es',
  'zh-cn': 'zh-CN',
  'fr-fr': 'fr-FR',
  'de-de': 'de-DE',
  'it-it': 'it-IT',
}

// Map a source page path (e.g. "pt-br/guides/foo.md") to { seg, rel } where
// rel is the locale-independent route ("guides/foo.html", "" for the home page).
function splitPage(page) {
  let rel = page.replace(/\.md$/, '.html')
  if (rel === 'index.html' || rel.endsWith('/index.html')) rel = rel.slice(0, -'index.html'.length)
  for (const seg of ACTIVE_LOCALES) {
    if (seg === 'root') continue
    if (rel === `${seg}/` || rel === seg || rel.startsWith(`${seg}/`)) {
      const stripped = rel === seg ? '' : rel.slice(seg.length + 1)
      return { seg, rel: stripped }
    }
  }
  return { seg: 'root', rel }
}

function alternateLinks(page) {
  const { rel } = splitPage(page)
  const links = ACTIVE_LOCALES.map((seg) => [
    'link',
    {
      rel: 'alternate',
      hreflang: HREFLANG[seg],
      href: `${HOST}${seg === 'root' ? '' : `${seg}/`}${rel}`,
    },
  ])
  links.push(['link', { rel: 'alternate', hreflang: 'x-default', href: `${HOST}${rel}` }])
  return links
}

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

    sitemap: {
      hostname: HOST,
    },

    // Per-page hreflang alternates across all active locales (+ x-default).
    transformHead({ page }) {
      return alternateLinks(page)
    },

    markdown: {
      theme: {
        light: 'github-light',
        dark: 'github-dark',
      },
    },
  }),
)
