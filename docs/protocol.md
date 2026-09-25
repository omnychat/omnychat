# Protocol basics

OmniChat speaks **Protobuf** over **WebSocket binary** frames. One WebSocket message = one `Envelope`.

Full schema: [`proto/omnichat/v1/omnichat.proto`](https://github.com/OluwapelumiG/omnichat/blob/main/proto/omnichat/v1/omnichat.proto)  
Generated Go: [`pkg/pb/`](https://github.com/OluwapelumiG/omnichat/tree/main/pkg/pb)

## Framing

- Use binary WebSocket frames only (not text/JSON).
- Max size defaults to 1 MiB (`OMNICHAT_MAX_FRAME_BYTES`).
- Server sends WebSocket pings; clients should reply with pong.

## Envelope

Every frame is an `Envelope` with optional `request_id` (echoed on replies) and one payload.

Common payloads:

| Direction | Type | Purpose |
| --- | --- | --- |
| Client → server | `Auth` | JWT on first frame |
| Server → client | `AuthOK` | Authenticated; includes `user_id` |
| Client → server | `JoinRoom` / `LeaveRoom` | Subscribe to a room |
| Client → server | `SendMessage` | `room_id`, `client_msg_id`, `body` |
| Client → server | `EditMessage` | `room_id`, `server_msg_id`, `body` (author only) |
| Client → server | `DeleteMessage` | `room_id`, `server_msg_id` (author only; soft-delete) |
| Server → client | `MessageAck` | Confirms send/edit/delete (`server_msg_id`, `seq`) |
| Server → client | `MessageEvent` | Message upsert; includes `update_seq`, `edited_at_unix_ms`, `deleted` |
| Client → server | `Typing` | Ephemeral typing flag |
| Client → server | `ReadReceipt` | `last_read_seq` |
| Client → server | `SyncRoom` | Catch-up (`since_seq` = last `update_seq`) |
| Server → client | `Error` | `code` + `message` |

## Happy path

1. Connect → send `Auth` → receive `AuthOK`
2. `JoinRoom` → `JoinOK` (includes `latest_seq`)
3. `SendMessage` → `MessageAck` (+ `MessageEvent` to the room)
4. Optional: `ReadReceipt`, `Typing`, `SyncRoom`

## Errors

| Code | Meaning |
| --- | --- |
| `unauthorized` | Bad/missing JWT or action before auth |
| `not_found` | Unknown room or message |
| `invalid` | Bad payload |
| `forbidden` | Not joined, or not message author |
| `gone` | Message already deleted |
| `internal` | Server failure |

## REST (bootstrap only)

```
POST /v1/rooms
Authorization: Bearer <JWT>
{"id":"lobby","name":"Lobby"}
```

Requires the same JWT secret/keys as WebSocket auth.
## Dig deeper

Wire details and reserved edit/delete types live in the `.proto` file. Client offline queues are described briefly in [Sync model](sync-model.md).
