# SDK guide

Headless TypeScript clients. You keep your own chat UI.

## Packages

| Package | Role |
| --- | --- |
| `@omnichat/client` | Core: connect, rooms, send, sync, outbox |
| `@omnichat/react` | Hooks: `useOmniChat`, `useRoom`, `useConnection` (web + React Native) |
| `@omnichat/vue` | Vue 3 composables (same surface as React) |
| `@omnichat/storage-sqlite` | SQLite storage for Expo / React Native |

## Setup (workspace)

```bash
cd clients/typescript && npm install && npm run build
```

Packages live under `clients/typescript/packages/`. They are **not published to npm yet**. Dry-run packing:

```bash
cd clients/typescript && npm run publish:dry
```

## Core usage

```ts
import {
  createOmniChat,
  createMemoryStorage,      // Node / tests
  createIndexedDBStorage,  // browsers
} from '@omnichat/client';

const client = createOmniChat({
  url: 'wss://chat.example.com/v1/ws',
  tokenProvider: () => fetchToken(), // your auth; JWT sub = user id
  storage: createIndexedDBStorage(),
  // Node: WebSocketImpl: (await import('ws')).default
});

await client.connect();
await client.joinRoom('team-engineering');
await client.sendMessage('team-engineering', 'hello'); // optimistic + outbox
await client.editMessage('team-engineering', serverMsgId, 'hello!');
await client.deleteMessage('team-engineering', serverMsgId);
client.subscribeRoom('team-engineering', (snap) => {
  // snap.messages ordered by seq (pending last if no seq yet)
});

client.setTyping('team-engineering', true);
client.sendReadReceipt('team-engineering', lastSeq);
```

Create the room once via REST (`POST /v1/rooms`) from your backend — not from this client.

## Group chat pattern

```ts
// Your backend already decided members = [alice, bob, carol]
// and created room id "group-42"

// On each device, after login:
await client.connect();
await client.joinRoom('group-42');
client.subscribeRoom('group-42', renderTimeline);
await client.sendMessage('group-42', 'hey team');
```

Every joined connection receives the broadcast. Gate who may learn `group-42` in your app.

## React (web or React Native)

```tsx
import { OmniChatProvider, useRoom, useConnection } from '@omnichat/react';

function Chat({ roomId }: { roomId: string }) {
  const state = useConnection();
  const snap = useRoom(roomId);
  return (
    <div>
      <p>{state}</p>
      <ul>
        {snap?.messages.map((m) => (
          <li key={m.clientMsgId}>
            {m.body} {m.status === 'pending' ? '…' : ''}
          </li>
        ))}
      </ul>
    </div>
  );
}

// Wrap once:
// <OmniChatProvider client={client}><Chat roomId="group-42" /></OmniChatProvider>
```

## Vue 3

```ts
import { createApp } from 'vue';
import { createOmniChat, createIndexedDBStorage } from '@omnichat/client';
import { OmniChatPlugin, useRoom, useConnection } from '@omnichat/vue';

const client = createOmniChat({
  url: 'ws://localhost:8080/v1/ws',
  tokenProvider: () => fetchToken(),
  storage: createIndexedDBStorage(),
});

createApp(App).use(OmniChatPlugin, { client }).mount('#app');
```

```vue
<script setup lang="ts">
import { useConnection, useRoom } from '@omnichat/vue';
const state = useConnection();
const snap = useRoom('group-42');
</script>
```

## React Native storage

```ts
import * as SQLite from 'expo-sqlite';
import { createOmniChat } from '@omnichat/client';
import { createSqliteStorage } from '@omnichat/storage-sqlite';

const storage = await createSqliteStorage(SQLite.openDatabaseAsync);
const client = createOmniChat({ url, tokenProvider, storage });
```

## Smoke test (Node)

```bash
make run   # terminal 1
cd clients/typescript && OMNICHAT_JWT_SECRET=dev-secret-change-me npm start -w @omnichat/node-smoke
```

See also [Sync model](sync-model.md) and [Roadmap](roadmap.md).
