# OmniChat

Self-hostable real-time messaging. You own auth and UI; OmniChat owns WebSockets, ordered delivery, persistence, typing, and receipts.

**Group chat and 1:1 are the same thing:** a room with one or many users. There is no separate group API.

## Integrate in four steps

### 1. Run the gateway

```bash
export OMNICHAT_JWT_SECRET="dev-secret-change-me"
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

Sign HS256 with the same `OMNICHAT_JWT_SECRET`. Claim `sub` = your user id. OmniChat does not store passwords — it only verifies tokens.

### 4. Connect from your app

Packages live under `clients/typescript` (not on npm yet — link locally or `npm pack`).

```bash
cd clients/typescript && npm install && npm run build
```

```ts
import { createOmniChat, createIndexedDBStorage } from '@omnichat/client';

const client = createOmniChat({
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

**React:** wrap with `OmniChatProvider`, then `useRoom(roomId)` / `useConnection()` from `@omnichat/react`.  
**Vue:** `OmniChatPlugin` + `useRoom` / `useConnection` from `@omnichat/vue`.  
**React Native:** `@omnichat/storage-sqlite` + Expo SQLite.

Smoke-test without UI:

```bash
go run ./examples/echo-client -secret dev-secret-change-me -sub alice -room team-engineering -body "hi"
# or TS: cd clients/typescript && OMNICHAT_JWT_SECRET=dev-secret-change-me npm start -w @omnichat/node-smoke
```

## Group chat

1. Your app decides the member list (who belongs in the group) — store that in **your** DB.
2. `POST /v1/rooms` once with a stable room id.
3. Each member connects with their own JWT and calls `joinRoom(roomId)`.
4. `sendMessage` broadcasts to everyone currently joined; ordering is by `seq`.

OmniChat does not yet list/invite/kick members. Gate joins in your backend (only give JWTs / room ids to allowed users). `POST /v1/rooms` requires a Bearer JWT.

Typing: `client.setTyping(roomId, true)`. Read receipts: `client.sendReadReceipt(roomId, lastSeq)`.

## What you get

| Capability | How |
| --- | --- |
| Live messages | WebSocket hub fan-out per room |
| Order + idempotency | Per-room `seq`; client message IDs |
| Offline catch-up | `SyncRoom` / handled by `@omnichat/client` |
| Persistence | SQLite (gateway); IndexedDB / SQLite on clients |
| Typing + receipts | Built into the protocol |

## Docs

| Guide | |
| --- | --- |
| [Getting started](docs/getting-started.md) | Run locally, first message |
| [How it works](docs/how-it-works.md) | Rooms, JWT, seq |
| [SDK guide](docs/sdk-guide.md) | Full client API examples |
| [Protocol](docs/protocol.md) | WebSocket + Protobuf |
| [Deploy](docs/deploy.md) | Docker, env vars, security |
| [Sync model](docs/sync-model.md) | Client persistence + reconnect |
| [Roadmap](docs/roadmap.md) | What’s next |

Local docs site (VitePress): `make docs` → http://localhost:5173/omnichat/

After you publish: `https://OluwapelumiG.github.io/omnichat/`

## Publish

| What | Where |
| --- | --- |
| Source code | [github.com/OluwapelumiG/omnichat](https://github.com/OluwapelumiG/omnichat) |
| Docs site | GitHub Pages — `https://OluwapelumiG.github.io/omnichat/` |
| Client packages | npm (`@omnichat/*`) when ready — not published yet |
| Do not publish | `chat-demo/` (local E2E only; lives outside this repo) |

When you are ready:

1. From this directory: commit, `git remote add origin git@github.com:OluwapelumiG/omnichat.git`, `git push -u origin main`.
2. Repo **Settings → Pages → Source: GitHub Actions**. The workflow [`.github/workflows/docs.yml`](.github/workflows/docs.yml) builds and deploys on push to `main`.
3. After the first green deploy, the docs site is live at the URL above.
## Layout

```
server/     Go gateway
proto/      Protobuf schemas
clients/typescript/   @omnichat/client, react, vue, storage-sqlite + node-smoke
examples/echo-client  Go smoke client
docs/       Guides + VitePress site
```

## License

Apache License 2.0 — see [LICENSE](LICENSE).
