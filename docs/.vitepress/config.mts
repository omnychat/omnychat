import { defineConfig } from 'vitepress'

const GITHUB_USER = 'omnychat'
const REPO = 'omnychat'
const GITHUB_REPO = `https://github.com/${GITHUB_USER}/${REPO}`

export default defineConfig({
  title: 'OmnyChat',
  description:
    'Self-hostable real-time messaging — WebSockets, ordered delivery, persistence.',
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
      { text: 'GitHub', link: GITHUB_REPO },
    ],
    sidebar: [
      {
        text: 'Guides',
        items: [
          { text: 'Getting started', link: '/getting-started' },
          { text: 'How it works', link: '/how-it-works' },
          { text: 'SDK guide', link: '/sdk-guide' },
          { text: 'Protocol', link: '/protocol' },
          { text: 'Deploy', link: '/deploy' },
          { text: 'Sync model', link: '/sync-model' },
          { text: 'Roadmap', link: '/roadmap' },
        ],
      },
    ],
    socialLinks: [{ icon: 'github', link: GITHUB_REPO }],
    editLink: {
      pattern: `${GITHUB_REPO}/edit/main/docs/:path`,
      text: 'Edit this page',
    },
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
