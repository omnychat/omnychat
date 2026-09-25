# Sync model

The TypeScript sync manager (`@omnichat/client`) owns local persistence, optimistic sends, and reconnect catch-up.

## Goals

- Optimistic UI with stable `client_msg_id`
- Persist rooms/messages/receipts on device
- Retry unacked sends with backoff
- Catch up via `SyncRoom` / `since_seq`

## Packages

| Package | Role |
| --- | --- |
| `@omnichat/client` | Sync engine + `MemoryStorage` + `IndexedDBStorage` |
| `@omnichat/storage-sqlite` | SQLite adapter for React Native / Expo |
| `@omnichat/react` | Hooks shared by React web and React Native |

## Local schema (logical)

- **rooms** — `room_id`, `since_seq` (cursor), `joined`
- **messages** — keyed by `(room_id, client_msg_id)`; optional `server_msg_id` / `seq`; `status` = `pending` \| `confirmed` \| `failed`
- **receipts** — `(room_id, user_id)` → `last_read_seq` (monotonic max)
- **outbox** — unacked sends with `attempts` + `next_attempt_at_unix_ms`

## Reconnect loop

1. Open WebSocket → `Auth` → `AuthOK`
2. For each joined room: `JoinRoom` → `SyncRoom(since_seq)` until `!has_more`
3. Flush outbox (same `client_msg_id`, exponential backoff)
4. Apply live `MessageEvent` / receipts with dedupe

## Conflict rules

- Dedupe by `server_msg_id` or `(room_id, client_msg_id)`
- Receipts are monotonic (`max` of local/remote)
- Future edit/delete: **server wins**

## Storage adapters

```ts
// Web
import { createOmniChat, createIndexedDBStorage } from '@omnichat/client';

// React Native / Expo
import { createSqliteStorage } from '@omnichat/storage-sqlite';
import * as SQLite from 'expo-sqlite';
const storage = await createSqliteStorage(SQLite.openDatabaseAsync);
```

Wire protocol details: [Protocol](protocol.md). SDK usage: [SDK guide](sdk-guide.md).
