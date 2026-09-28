# What’s available

What OmnyChat gives your application today, and what is still coming.

## Available now

- Self-hosted gateway (Docker) with WebSocket messaging
- Ordered rooms for **1:1 and group** chat (same API)
- Typing indicators and read receipts
- Message edit and soft-delete
- Offline catch-up and local persistence via `@omnychat/client`
- npm packages: [`@omnychat/client`](https://www.npmjs.com/package/@omnychat/client), [`@omnychat/react`](https://www.npmjs.com/package/@omnychat/react), [`@omnychat/vue`](https://www.npmjs.com/package/@omnychat/vue), [`@omnychat/storage-sqlite`](https://www.npmjs.com/package/@omnychat/storage-sqlite)
- Optional Redis for multiple gateway replicas
- Optional webhooks for push / side effects
- JWT auth you control (HS256 or RS256)

You can add chat to your product today: install the client, host the gateway, mint JWTs from your backend.

## Coming later

- Built-in member list / invite / kick (today: membership stays in your app)
- Postgres option for larger deployments
- Stronger webhook delivery retries

Membership policy is already designed to live in **your** app — that is intentional for most products.
