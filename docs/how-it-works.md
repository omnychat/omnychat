# How it works

OmnyChat is a **messaging engine for your product** — not a full chat app. You keep login and UI; OmnyChat moves messages in real time and keeps them ordered.

## Big picture

```
Your app (login) ──JWT──► OmnyChat gateway
                              │
                              ├─ WebSocket hub (live fan-out)
                              └─ SQLite (messages + receipts)
```

1. Your backend logs the user in and issues a **JWT** (`sub` = user id).
2. Your app opens `ws://…/v1/ws` with `@omnychat/client` and that token.
3. The client joins a **room**, then sends and receives messages.
4. The gateway stores messages and pushes events to everyone in that room.

## Rooms = 1:1 and group chat

A room is just a channel. There is no separate DM or group type:

- **1:1** — one room, two users join with their own JWTs
- **Group** — same room, any number of users join

Create rooms with `POST /v1/rooms` and `Authorization: Bearer <JWT>`. Clients must **join** on the WebSocket before they send or receive live traffic there.

**Membership is your job.** Store who belongs in a chat in your database. Only give room ids (and JWTs) to allowed users. OmnyChat does not list, invite, or kick members yet.

## Auth

OmnyChat does not store passwords. It only **verifies** JWTs you mint (shared secret or public key). See [Deploy](deploy.md) for configuration.

## Ordering

Every message in a room gets a monotonic `seq` (1, 2, 3…). Build timelines from `seq`, not wall-clock time. The npm client already orders `snap.messages` for you.

## Optimistic send

When the user hits send, `@omnychat/client` can show the message immediately, then confirm it when the server assigns `server_msg_id` + `seq`. Retries reuse the same client message id so duplicates are safe.

## After reconnect

If the network drops, the client catches up automatically (`SyncRoom`). You usually do not need to call sync yourself — see [Offline & sync](sync-model.md).
