# SDK guide

Headless TypeScript SDK for your chat UI. Install from npm, keep your own screens and styling.

## Install

```bash
npm install @omnychat/client
# optional:
npm install @omnychat/react
npm install @omnychat/vue
npm install @omnychat/storage-sqlite
```

| Package | Role |
| --- | --- |
| [`@omnychat/client`](https://www.npmjs.com/package/@omnychat/client) | Connect, rooms, send, sync, outbox |
| [`@omnychat/react`](https://www.npmjs.com/package/@omnychat/react) | `useOmnyChat`, `useRoom`, `useConnection` |
| [`@omnychat/vue`](https://www.npmjs.com/package/@omnychat/vue) | Same surface as React, for Vue 3 |
| [`@omnychat/storage-sqlite`](https://www.npmjs.com/package/@omnychat/storage-sqlite) | SQLite storage for Expo / React Native |

## Core usage

```ts
import {
  createOmnyChat,
  createMemoryStorage,      // tests / Node
  createIndexedDBStorage,  // browsers
} from '@omnychat/client';

const client = createOmnyChat({
  url: 'wss://chat.example.com/v1/ws',
  tokenProvider: () => fetchToken(), // your auth; JWT sub = user id
  storage: createIndexedDBStorage(),
});

await client.connect();
await client.joinRoom('team-engineering');
await client.sendMessage('team-engineering', 'hello');
await client.editMessage('team-engineering', serverMsgId, 'hello!');
await client.deleteMessage('team-engineering', serverMsgId);
client.subscribeRoom('team-engineering', (snap) => {
  // snap.messages ordered by seq
});

client.setTyping('team-engineering', true);
client.sendReadReceipt('team-engineering', lastSeq);
```

Create rooms once from **your backend** with `POST /v1/rooms` — not from the client SDK.

## Group chat (and DMs)

Group and 1:1 use the same room API:

```ts
// Your backend chose members and created room id "group-42"

await client.connect();
await client.joinRoom('group-42');
client.subscribeRoom('group-42', renderTimeline);
await client.sendMessage('group-42', 'hey team');
```

Everyone who has joined the room receives messages. Decide membership in your app (only give JWTs / room ids to allowed users).

## React

```tsx
import { OmnyChatProvider, useRoom, useConnection } from '@omnychat/react';

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

// <OmnyChatProvider client={client}><Chat roomId="group-42" /></OmnyChatProvider>
```

## Vue 3

```ts
import { createApp } from 'vue';
import { createOmnyChat, createIndexedDBStorage } from '@omnychat/client';
import { OmnyChatPlugin, useRoom, useConnection } from '@omnychat/vue';

const client = createOmnyChat({
  url: 'wss://chat.example.com/v1/ws',
  tokenProvider: () => fetchToken(),
  storage: createIndexedDBStorage(),
});

createApp(App).use(OmnyChatPlugin, { client }).mount('#app');
```

```vue
<script setup lang="ts">
import { useConnection, useRoom } from '@omnychat/vue';
const state = useConnection();
const snap = useRoom('group-42');
</script>
```

## React Native

```ts
import * as SQLite from 'expo-sqlite';
import { createOmnyChat } from '@omnychat/client';
import { createSqliteStorage } from '@omnychat/storage-sqlite';

const storage = await createSqliteStorage(SQLite.openDatabaseAsync);
const client = createOmnyChat({ url, tokenProvider, storage });
```

Also see [How it works](how-it-works.md) and [Offline & sync](sync-model.md).
