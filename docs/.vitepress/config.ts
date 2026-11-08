import { defineConfig } from 'vitepress'
import path from 'node:path'
import { smaltLight, smaltDark } from './theme/shiki'
import { smaltworksMenu, smaltworksFooter } from './theme/smaltworks'

const REPO = 'https://github.com/stenhoor/smaltty'
// Served at stenhoor.github.io/smaltty/; DOCS_BASE overrides it.
const base = process.env.DOCS_BASE ?? '/smaltty/'

export default defineConfig({
  title: 'smaltty',
  description: 'The TypeScript kit for the smalt apps: parse, strip and bind TypeScript in the browser, with no dependencies.',
  base,
  cleanUrls: true,
  lastUpdated: false,
  head: [
    ['link', { rel: 'preconnect', href: 'https://fonts.googleapis.com' }],
    ['link', { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossorigin: '' }],
    ['link', { rel: 'stylesheet', href: 'https://fonts.googleapis.com/css2?family=Geist:wght@400;500;700&family=Geist+Mono:wght@400;500&family=Martian+Mono:wght@400;600&display=swap' }],
    ['meta', { property: 'og:title', content: 'smaltty' }],
    ['meta', { property: 'og:description', content: 'The TypeScript kit for the smalt apps: parse, strip and bind TypeScript in the browser, with no dependencies.' }],
  ],
  markdown: {
    theme: { light: smaltLight, dark: smaltDark },
    config(md) {
      // Links that leave docs/ (the corpus, sources) point at the file on GitHub.
      const fallback = md.renderer.rules.link_open ?? ((t, i, o, _e, s) => s.renderToken(t, i, o))
      md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
        const href = tokens[idx].attrGet('href')
        if (href && !/^[a-z]+:|^#|^\//i.test(href) && env?.relativePath) {
          const target = path.posix.normalize(path.posix.join(path.posix.dirname(env.relativePath), href))
          if (target.startsWith('../')) {
            tokens[idx].attrSet('href', `${REPO}/blob/HEAD/${target.slice(3)}`)
            tokens[idx].attrSet('target', '_blank')
            tokens[idx].attrSet('rel', 'noreferrer')
          }
        }
        return fallback(tokens, idx, options, env, self)
      }
    },
  },
  themeConfig: {
    siteTitle: 'smaltty',
    nav: [
      { text: 'Guide', link: '/guide/getting-started' },
      { text: 'Benchmarks', link: '/BENCHMARKS' },
      { text: 'Status', link: '/guide/status' },
      smaltworksMenu(),
    ],
    sidebar: [
      {
        text: 'Guide',
        items: [
          { text: 'Getting started', link: '/guide/getting-started' },
          { text: 'Stripping types', link: '/guide/stripping' },
          { text: 'Parsing', link: '/guide/parsing' },
          { text: 'Binding names', link: '/guide/binding' },
          { text: 'Status', link: '/guide/status' },
        ],
      },
      {
        text: 'Design',
        items: [
          { text: 'Decisions and order of work', link: '/DESIGN' },
          { text: 'Milestones', link: '/MILESTONES' },
          { text: 'Benchmarks', link: '/BENCHMARKS' },
        ],
      },
    ],
    socialLinks: [{ icon: 'github', link: REPO }],
    search: { provider: 'local' },
    outline: { level: [2, 3] },
    footer: smaltworksFooter(base),
  },
})
