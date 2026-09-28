# Getting started

Add OmnyChat to your app: install the npm client, run a gateway, connect.

## 1. Install the client

```bash
npm install @omnychat/client
```

Optional UI helpers:

```bash
npm install @omnychat/react          # React / React Native
npm install @omnychat/vue            # Vue 3
npm install @omnychat/storage-sqlite # Expo / React Native SQLite
```

| Package | What it is |
| --- | --- |
| [`@omnychat/client`](https://www.npmjs.com/package/@omnychat/client) | Core SDK — connect, rooms, send, sync |
| [`@omnychat/react`](https://www.npmjs.com/package/@omnychat/react) | React hooks |
| [`@omnychat/vue`](https://www.npmjs.com/package/@omnychat/vue) | Vue 3 composables |
| [`@omnychat/storage-sqlite`](https://www.npmjs.com/package/@omnychat/storage-sqlite) | On-device SQLite for React Native |

## 2. Run the gateway

Your app needs a WebSocket server. The fastest way is Docker:

```bash
export OMNYCHAT_JWT_SECRET="dev-secret-change-me"
docker compose up --build
```

- Health: `http://localhost:8080/healthz`
- WebSocket: `ws://localhost:8080/v1/ws`

For production hosting, see [Deploy](deploy.md).

## 3. Rooms and JWTs (your backend)

OmnyChat does not replace your login system. Your backend:

1. Creates a room when a chat (DM or group) should exist
2. Issues a JWT for each signed-in user (`sub` = your user id), signed with the same `OMNYCHAT_JWT_SECRET`

```bash
curl -s -X POST http://localhost:8080/v1/rooms \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $YOUR_JWT" \
  -d '{"id":"lobby","name":"Lobby"}'
```

Use stable room ids you control (for example `dm-alice-bob` or `group-{uuid}`).

## 4. Connect from your app

```ts
import { createOmnyChat, createIndexedDBStorage } from '@omnychat/client';

const client = createOmnyChat({
  url: 'ws://localhost:8080/v1/ws',
  tokenProvider: () => fetchYourJwt(), // JWT sub = user id
  storage: createIndexedDBStorage(),
});

await client.connect();
await client.joinRoom('lobby');
await client.sendMessage('lobby', 'hello');
client.subscribeRoom('lobby', (snap) => {
  // snap.messages ordered by seq — render your own UI
});
```

- **React:** wrap with `OmnyChatProvider`, then `useRoom(roomId)` / `useConnection()` from `@omnychat/react`
- **Vue:** `OmnyChatPlugin` + `useRoom` / `useConnection` from `@omnychat/vue`
- **React Native:** use `@omnychat/storage-sqlite` with Expo SQLite

More examples: [SDK guide](sdk-guide.md). Concepts: [How it works](how-it-works.md).
