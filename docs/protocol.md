# Protocol (advanced)

Most apps should use [`@omnychat/client`](https://www.npmjs.com/package/@omnychat/client) and skip this page. Read on only if you are building a custom client.

OmnyChat speaks **Protobuf** over **WebSocket binary** frames. One WebSocket message = one `Envelope`.

Schema: [`proto/omnychat/v1/omnychat.proto`](https://github.com/omnychat/omnychat/blob/main/proto/omnychat/v1/omnychat.proto)

## Framing

- Binary WebSocket frames only (not text/JSON)
- Max size defaults to 1 MiB (`OMNYCHAT_MAX_FRAME_BYTES`)
- Server sends WebSocket pings; reply with pong

## Common payloads

| Direction | Type | Purpose |
| --- | --- | --- |
| Client → server | `Auth` | JWT on first frame |
| Server → client | `AuthOK` | Authenticated; includes `user_id` |
| Client → server | `JoinRoom` / `LeaveRoom` | Subscribe to a room |
| Client → server | `SendMessage` | `room_id`, `client_msg_id`, `body` |
| Client → server | `EditMessage` / `DeleteMessage` | Author-only |
| Server → client | `MessageAck` / `MessageEvent` | Confirm + fan-out |
| Client → server | `Typing` / `ReadReceipt` / `SyncRoom` | Presence + catch-up |
| Server → client | `Error` | `code` + `message` |

## Happy path

1. Connect → `Auth` → `AuthOK`
2. `JoinRoom` → `JoinOK`
3. `SendMessage` → `MessageAck` (+ `MessageEvent` to the room)

## REST bootstrap

```
POST /v1/rooms
Authorization: Bearer <JWT>
{"id":"lobby","name":"Lobby"}
```

Same JWT keys as WebSocket auth. App integration: [Getting started](getting-started.md).
