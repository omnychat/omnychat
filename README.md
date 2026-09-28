# OmnyChat

Self-hostable real-time messaging. You own auth and UI; OmnyChat owns WebSockets, ordered delivery, persistence, typing, and receipts.

**Group chat and 1:1 are the same thing:** a room with one or many users. There is no separate group API.

**Docs:** [omnychat.github.io/omnychat](https://omnychat.github.io/omnychat/)

## Install from npm

```bash
npm install @omnychat/client
# optional UI bindings:
npm install @omnychat/react          # React / React Native hooks
npm install @omnychat/vue            # Vue 3 composables
npm install @omnychat/storage-sqlite # Expo / React Native SQLite storage
```

Package: [@omnychat/client](https://www.npmjs.com/package/@omnychat/client)

## Integrate in four steps

### 1. Run the gateway

```bash
export OMNYCHAT_JWT_SECRET="dev-secret-change-me"
docker compose up --build
# health: curl http://localhost:8080/healthz
# WS:     ws://localhost:8080/v1/ws
```

Or: `make run` (Go 1.22+).

### 2. Create a room

Call this from your backend when a chat (DM or group) is created:

```bash
curl -s -X POST http://localhost:8080/v1/rooms \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $YOUR_JWT" \
  -d '{"id":"team-engineering","name":"Engineering"}'
```

Use a stable `id` you control (e.g. `dm-{userA}-{userB}` or `group-{uuid}`).

### 3. Mint a JWT (your auth)

Sign HS256 with the same `OMNYCHAT_JWT_SECRET`. Claim `sub` = your user id. OmnyChat does not store passwords — it only verifies tokens.

### 4. Connect from your app

```ts
import { createOmnyChat, createIndexedDBStorage } from '@omnychat/client';

const client = createOmnyChat({
  url: 'ws://localhost:8080/v1/ws',
  tokenProvider: () => fetchYourJwt(), // must include sub = user id
  storage: createIndexedDBStorage(),   // or createMemoryStorage() / SQLite on RN
});

await client.connect();
await client.joinRoom('team-engineering');
await client.sendMessage('team-engineering', 'hello');
client.subscribeRoom('team-engineering', (snap) => {
  // snap.messages ordered by seq
});
```

**React:** wrap with `OmnyChatProvider`, then `useRoom(roomId)` / `useConnection()` from `@omnychat/react`.  
**Vue:** `OmnyChatPlugin` + `useRoom` / `useConnection` from `@omnychat/vue`.  
**React Native:** `@omnychat/storage-sqlite` + Expo SQLite.

Smoke-test without UI:

```bash
go run ./examples/echo-client -secret dev-secret-change-me -sub alice -room team-engineering -body "hi"
# or TS: cd clients/typescript && OMNYCHAT_JWT_SECRET=dev-secret-change-me npm start -w @omnychat/node-smoke
```

## Group chat

1. Your app decides the member list (who belongs in the group) — store that in **your** DB.
2. `POST /v1/rooms` once with a stable room id.
3. Each member connects with their own JWT and calls `joinRoom(roomId)`.
4. `sendMessage` broadcasts to everyone currently joined; ordering is by `seq`.

OmnyChat does not yet list/invite/kick members. Gate joins in your backend (only give JWTs / room ids to allowed users). `POST /v1/rooms` requires a Bearer JWT.

Typing: `client.setTyping(roomId, true)`. Read receipts: `client.sendReadReceipt(roomId, lastSeq)`.

## What you get

| Capability | How |
| --- | --- |
| Live messages | WebSocket hub fan-out per room |
| Order + idempotency | Per-room `seq`; client message IDs |
| Offline catch-up | `SyncRoom` / handled by `@omnychat/client` |
| Persistence | SQLite (gateway); IndexedDB / SQLite on clients |
| Typing + receipts | Built into the protocol |

## Docs

**Site:** [https://omnychat.github.io/omnychat/](https://omnychat.github.io/omnychat/)

| Guide | |
| --- | --- |
| [Getting started](docs/getting-started.md) | Run locally, first message |
| [How it works](docs/how-it-works.md) | Rooms, JWT, seq |
| [SDK guide](docs/sdk-guide.md) | Full client API examples |
| [Protocol](docs/protocol.md) | WebSocket + Protobuf |
| [Deploy](docs/deploy.md) | Docker, env vars, security |
| [Sync model](docs/sync-model.md) | Client persistence + reconnect |
| [Roadmap](docs/roadmap.md) | What’s next |

Local docs site (VitePress): `make docs` → http://localhost:5173/omnychat/

## Links

| What | Where |
| --- | --- |
| Source code | [github.com/omnychat/omnychat](https://github.com/omnychat/omnychat) |
| Docs site | [omnychat.github.io/omnychat](https://omnychat.github.io/omnychat/) |
| Client on npm | [@omnychat/client](https://www.npmjs.com/package/@omnychat/client) |
| Do not publish | `chat-demo/` (local E2E only; lives outside this repo) |

## Layout

```
server/     Go gateway
proto/      Protobuf schemas
clients/typescript/   @omnychat/client, react, vue, storage-sqlite + node-smoke
examples/echo-client  Go smoke client
docs/       Guides + VitePress site
```

## License

Apache License 2.0 — see [LICENSE](LICENSE).
