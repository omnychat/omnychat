# Getting started

Run the gateway, create a room, send a message.

## 1. Start the gateway

```bash
export OMNYCHAT_JWT_SECRET="dev-secret-change-me"
docker compose up --build
```

Without Docker: `make run` (Go 1.22+).

```bash
curl http://localhost:8080/healthz   # → ok
# WebSocket: ws://localhost:8080/v1/ws
```

## 2. Create a room

A room is a chat channel — use one for a DM or a group.

```bash
curl -s -X POST http://localhost:8080/v1/rooms \
  -H 'Content-Type: application/json' \
  -d '{"id":"lobby","name":"Lobby"}'
```

## 3. Send a message

Your app mints JWTs. For a quick test, the echo client signs one with the same secret:

```bash
go run ./examples/echo-client \
  -secret dev-secret-change-me \
  -sub alice \
  -room lobby \
  -body "hello omnychat"
```

Expected:

```
authed as alice
joined lobby latest_seq=0
ack server_msg_id=… seq=1
event from=alice seq=1 body="hello omnychat"
ok
```

## 4. Install the client (npm)

```bash
npm install @omnychat/client
# optional:
npm install @omnychat/react          # React / React Native
npm install @omnychat/vue            # Vue 3
npm install @omnychat/storage-sqlite # Expo / React Native SQLite
```

Packages: [@omnychat/client](https://www.npmjs.com/package/@omnychat/client) and related `@omnychat/*` on npm.

## 5. Connect from your app

```ts
import { createOmnyChat, createIndexedDBStorage } from '@omnychat/client';

const client = createOmnyChat({
  url: 'ws://localhost:8080/v1/ws',
  tokenProvider: () => fetchYourJwt(), // JWT sub = user id; same OMNYCHAT_JWT_SECRET
  storage: createIndexedDBStorage(),
});

await client.connect();
await client.joinRoom('lobby');
await client.sendMessage('lobby', 'hello');
client.subscribeRoom('lobby', (snap) => {
  // snap.messages ordered by seq
});
```

More API detail: [SDK guide](sdk-guide.md).

Next: [How it works](how-it-works.md) · [Deploy](deploy.md)
