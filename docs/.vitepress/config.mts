import { defineConfig } from 'vitepress'

const GITHUB_USER = 'omnychat'
const REPO = 'omnychat'
const GITHUB_REPO = `https://github.com/${GITHUB_USER}/${REPO}`

export default defineConfig({
  title: 'OmnyChat',
  description:
    'Add self-hosted real-time messaging to your app — npm client, WebSockets, ordered delivery.',
  // Project Pages: https://omnychat.github.io/omnychat/
  // Use '/' only for a user/org root site or a custom domain.
  base: `/${REPO}/`,
  cleanUrls: true,
  lastUpdated: true,

  head: [
    [
      'link',
      {
        rel: 'preconnect',
        href: 'https://fonts.googleapis.com',
      },
    ],
    [
      'link',
      {
        rel: 'preconnect',
        href: 'https://fonts.gstatic.com',
        crossorigin: '',
      },
    ],
    [
      'link',
      {
        rel: 'stylesheet',
        href: 'https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,400;0,9..40,500;0,9..40,600;1,9..40,400&family=JetBrains+Mono:wght@400;500&family=Outfit:wght@500;600;700&display=swap',
      },
    ],
  ],

  themeConfig: {
    logo: undefined,
    siteTitle: 'OmnyChat',
    nav: [
      { text: 'Get started', link: '/getting-started' },
      { text: 'SDK', link: '/sdk-guide' },
      { text: 'Deploy', link: '/deploy' },
    ],
    sidebar: [
      {
        text: 'Use in your app',
        items: [
          { text: 'Getting started', link: '/getting-started' },
          { text: 'SDK guide', link: '/sdk-guide' },
          { text: 'How it works', link: '/how-it-works' },
          { text: 'Offline & sync', link: '/sync-model' },
        ],
      },
      {
        text: 'Host',
        items: [
          { text: 'Deploy the gateway', link: '/deploy' },
          { text: 'What’s available', link: '/roadmap' },
        ],
      },
      {
        text: 'Advanced',
        items: [
          { text: 'Protocol', link: '/protocol' },
        ],
      },
    ],
    socialLinks: [{ icon: 'github', link: GITHUB_REPO }],
    search: {
      provider: 'local',
    },
    outline: {
      level: [2, 3],
      label: 'On this page',
    },
    footer: {
      message: 'Apache License 2.0',
      copyright: 'OmnyChat',
    },
  },
})
