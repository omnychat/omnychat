# How it works

OmniChat is a **messaging engine**, not a full chat app. You bring auth and UI; OmniChat moves messages in real time and keeps them ordered.

## Big picture

```
Your app (login) ──JWT──► OmniChat gateway
                              │
                              ├─ WebSocket hub (live fan-out)
                              └─ SQLite (messages + receipts)
```

1. Your backend logs the user in and issues a **JWT** (`sub` = user id).
2. The client opens `ws://…/v1/ws` and authenticates with that token.
3. The client joins a **room**, then sends and receives messages.
4. The gateway stores messages and pushes events to everyone currently in that room.

## Rooms = 1:1 and group chat

A room is a channel. There is no separate “DM” or “group” type:

- **1:1** — create a room, two users join with their own JWTs.
- **Group** — same room, N users join.

Create rooms with `POST /v1/rooms` and `Authorization: Bearer <JWT>`. Clients must **join** on the WebSocket before they can send or receive live traffic there.

**Membership policy is yours.** OmniChat records who has joined for delivery, but does not yet expose list/invite/kick APIs or enforce ACL. Store the intended member list in your app DB and only hand room ids (and JWTs) to allowed users.

## Auth

OmniChat does not store passwords. It only **verifies** JWTs you mint (HS256 secret or RS256 public key). See [Deploy](deploy.md) for env vars.

## Ordering: sequence numbers

Every message in a room gets a monotonic `seq` (1, 2, 3…). Order the timeline by `seq`, not by clock time.

## Optimistic send

1. Client invents a `client_msg_id` (UUID) and can show the message immediately.
2. Client sends `SendMessage`.
3. Server replies `MessageAck` with `server_msg_id` + `seq`.
4. Peers get `MessageEvent` with the same IDs.

Retries with the same `client_msg_id` are safe (idempotent).

## Catch-up after reconnect

Send `SyncRoom` with `since_seq` to fetch messages missed while offline. Live events and sync may overlap — dedupe by `server_msg_id` or `seq`. The TypeScript client does this for you.

## What ships today vs later

| Today | Later |
| --- | --- |
| Gateway, Docker, protobuf protocol | Live npm publish |
| Typing + read receipts | Multi-node / Postgres |
| `@omnichat/client` + React / Vue / RN storage | REST auth, member list / ACL |
| Ordered rooms (1:1 + group) | Message edit/delete |

Details: [Roadmap](roadmap.md)
