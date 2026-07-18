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
export const ACTIVE_LOCALES = ['root']

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
  'pt-br': { nav: {}, sec: {}, item: {}, ui: {} },
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
