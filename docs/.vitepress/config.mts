import { defineConfig } from 'vitepress'

/** Replace before publishing. */
const GITHUB_USER = 'OluwapelumiG'
const REPO = 'omnichat'
const GITHUB_REPO = `https://github.com/${GITHUB_USER}/${REPO}`

export default defineConfig({
  title: 'OmniChat',
  description:
    'Self-hostable real-time messaging — WebSockets, ordered delivery, persistence.',
  // Project Pages: https://OluwapelumiG.github.io/omnichat/
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
        href: 'https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600&family=Syne:wght@600;700;800&display=swap',
      },
    ],
  ],

  themeConfig: {
    logo: undefined,
    siteTitle: 'OmniChat',
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
      copyright: 'OmniChat',
    },
  },
})
