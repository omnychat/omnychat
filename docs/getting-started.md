# Getting started

Install the client from npm, point it at a gateway, send a message.

## 1. Install from npm

```bash
npm install @omnychat/client
```

Optional packages:

```bash
npm install @omnychat/react          # React / React Native hooks
npm install @omnychat/vue            # Vue 3 composables
npm install @omnychat/storage-sqlite # Expo / React Native SQLite
```

| Package | npm |
| --- | --- |
| `@omnychat/client` | [npmjs.com/package/@omnychat/client](https://www.npmjs.com/package/@omnychat/client) |
| `@omnychat/react` | [npmjs.com/package/@omnychat/react](https://www.npmjs.com/package/@omnychat/react) |
| `@omnychat/vue` | [npmjs.com/package/@omnychat/vue](https://www.npmjs.com/package/@omnychat/vue) |
| `@omnychat/storage-sqlite` | [npmjs.com/package/@omnychat/storage-sqlite](https://www.npmjs.com/package/@omnychat/storage-sqlite) |

## 2. Run a gateway

You need a WebSocket endpoint. Locally:

```bash
export OMNYCHAT_JWT_SECRET="dev-secret-change-me"
docker compose up --build
# health: curl http://localhost:8080/healthz
# WS:     ws://localhost:8080/v1/ws
```

Or `make run` (Go 1.22+). Production: [Deploy](deploy.md).

## 3. Create a room + mint a JWT

From **your** backend (when a DM or group is created):

```bash
curl -s -X POST http://localhost:8080/v1/rooms \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $YOUR_JWT" \
  -d '{"id":"lobby","name":"Lobby"}'
```

Sign HS256 JWTs with the same `OMNYCHAT_JWT_SECRET`. Claim `sub` = your user id. OmnyChat does not store passwords.

## 4. Connect and send

```ts
import { createOmnyChat, createIndexedDBStorage } from '@omnychat/client';

const client = createOmnyChat({
  url: 'ws://localhost:8080/v1/ws',
  tokenProvider: () => fetchYourJwt(), // must include sub = user id
  storage: createIndexedDBStorage(),   // or createMemoryStorage() / SQLite on RN
});

await client.connect();
await client.joinRoom('lobby');
await client.sendMessage('lobby', 'hello');
client.subscribeRoom('lobby', (snap) => {
  // snap.messages ordered by seq
});
```

**React:** `OmnyChatProvider` + `useRoom` / `useConnection` from `@omnychat/react`.  
**Vue:** `OmnyChatPlugin` + same hooks from `@omnychat/vue`.  
**React Native:** `@omnychat/storage-sqlite` + Expo SQLite.

Full API: [SDK guide](sdk-guide.md).

## Optional: smoke test without UI

```bash
go run ./examples/echo-client \
  -secret dev-secret-change-me \
  -sub alice \
  -room lobby \
  -body "hello omnychat"
```

Next: [How it works](how-it-works.md) · [Deploy](deploy.md)
