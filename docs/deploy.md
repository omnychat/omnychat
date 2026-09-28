# Deploy

Host the OmnyChat gateway so your app has a WebSocket endpoint. Docker is the usual path.

## Docker

```bash
export OMNYCHAT_JWT_SECRET="change-me-in-production"
docker compose up --build -d
```

| URL | Purpose |
| --- | --- |
| `http://localhost:8080/healthz` | Liveness |
| `http://localhost:8080/readyz` | Ready (DB; Redis if configured) |
| `ws://localhost:8080/v1/ws` | Your app connects here |

Message data lives under `./data` (SQLite inside the container).

Point `@omnychat/client` at `wss://your-host/v1/ws` in production.

## Environment

| Variable | Default | Notes |
| --- | --- | --- |
| `OMNYCHAT_HTTP_ADDR` | `:8080` | Listen address |
| `OMNYCHAT_DB_PATH` | `./data/omnychat.db` | SQLite path |
| `OMNYCHAT_JWT_SECRET` | _(required)_ | HS256 secret — same one your backend uses to sign JWTs |
| `OMNYCHAT_JWT_PUBLIC_KEY` | | PEM RSA key; use RS256 instead of a shared secret |
| `OMNYCHAT_JWT_ISSUER` | | Optional `iss` check |
| `OMNYCHAT_ALLOWED_ORIGINS` | `*` | Comma-separated browser Origins |
| `OMNYCHAT_MAX_FRAME_BYTES` | `1048576` | Max WebSocket payload |
| `OMNYCHAT_PING_INTERVAL_SEC` | `30` | Heartbeat |
| `OMNYCHAT_REDIS_URL` | | e.g. `redis://redis:6379/0` for more than one gateway replica |
| `OMNYCHAT_INSTANCE_ID` | random UUID | Stable id per replica |
| `OMNYCHAT_WEBHOOK_URL` | | POST target for message events (push notifications, etc.) |
| `OMNYCHAT_WEBHOOK_SECRET` | | Required if webhook URL set; HMAC key |
| `OMNYCHAT_TLS_CERT_FILE` | | Optional TLS cert on the gateway |
| `OMNYCHAT_TLS_KEY_FILE` | | Optional TLS key |

## Webhooks (optional)

When `OMNYCHAT_WEBHOOK_URL` is set, the gateway POSTs JSON after a message is created, edited, or deleted — useful for mobile push from your backend:

```json
{
  "type": "message.created",
  "room_id": "…",
  "server_msg_id": "…",
  "sender_id": "…",
  "seq": 1,
  "body": "…",
  "at": 1710000000000
}
```

Header: `X-OmnyChat-Signature: sha256=<hmac-hex>` over the raw body.

## Security checklist

- Use a strong `OMNYCHAT_JWT_SECRET` (or RS256 with a public key on the gateway)
- Terminate TLS at your reverse proxy (or set `OMNYCHAT_TLS_*`)
- Restrict `OMNYCHAT_ALLOWED_ORIGINS` in production
- Keep the SQLite volume private
- `POST /v1/rooms` requires `Authorization: Bearer <JWT>`

## More than one replica

Set `OMNYCHAT_REDIS_URL` so live room events fan out across gateway instances. Persistence in this release is still SQLite per volume — one writer (or shared storage you trust) until a multi-node DB option ships.
