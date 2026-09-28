# Roadmap — what’s left

## Done

- Go WebSocket gateway, protobuf protocol, SQLite, Docker
- Ordered rooms (1:1 and multi-user / group via the same room model)
- Typing + read receipts, sync / catch-up
- Message edit / soft-delete (`update_seq` sync)
- REST JWT on `POST /v1/rooms`
- Optional Redis pub/sub fan-out (`OMNYCHAT_REDIS_URL`)
- HMAC webhooks for `message.created|edited|deleted`
- Optional TLS (`OMNYCHAT_TLS_*`), structured logs, Prometheus `/metrics`
- `@omnychat/client`, `@omnychat/react`, `@omnychat/vue`, `@omnychat/storage-sqlite` on [npm](https://www.npmjs.com/package/@omnychat/client)
- Echo-client + Node smoke examples; docs

You can self-host and exchange messages (including group chat) today. Install clients with `npm install @omnychat/client`.

## Next

- Member list / invite / kick (or document app-owned membership as the long-term model)
- Postgres option
- Webhook delivery outbox / stronger retries

## Contribute

Highest leverage: Postgres option, or membership APIs.
