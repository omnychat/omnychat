# Offline & sync

`@omnychat/client` keeps a local copy of rooms and messages so your UI stays responsive offline and after reconnect.

You usually only call `connect`, `joinRoom`, `sendMessage`, and `subscribeRoom`. Sync runs inside the client.

## What you get

- Messages can appear in the UI immediately (optimistic send)
- Rooms, messages, and read receipts persist on the device
- Failed sends retry automatically
- After reconnect, missed messages are fetched for you

## Choosing storage

| Environment | Storage |
| --- | --- |
| Browser | `createIndexedDBStorage()` from `@omnychat/client` |
| Tests / Node | `createMemoryStorage()` from `@omnychat/client` |
| React Native / Expo | `createSqliteStorage(...)` from `@omnychat/storage-sqlite` |

```ts
// Web
import { createOmnyChat, createIndexedDBStorage } from '@omnychat/client';

const client = createOmnyChat({
  url: 'wss://chat.example.com/v1/ws',
  tokenProvider: () => fetchToken(),
  storage: createIndexedDBStorage(),
});
```

```ts
// React Native / Expo
import * as SQLite from 'expo-sqlite';
import { createOmnyChat } from '@omnychat/client';
import { createSqliteStorage } from '@omnychat/storage-sqlite';

const storage = await createSqliteStorage(SQLite.openDatabaseAsync);
const client = createOmnyChat({ url, tokenProvider, storage });
```

## How reconnect works (for your UI)

1. Client reconnects and authenticates with your JWT
2. For each joined room it catches up from the last known sequence
3. Pending sends in the outbox flush (same message id — no duplicates)
4. Live events resume; `subscribeRoom` keeps getting snapshots

Message `status` in snapshots is typically `pending`, `confirmed`, or `failed` — use that for send indicators in your UI.

SDK examples: [SDK guide](sdk-guide.md).
