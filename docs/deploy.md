# Deploy

Run OmnyChat with Docker. Redis is optional but recommended when you run more than one gateway replica.

## Docker (recommended)

```bash
export OMNYCHAT_JWT_SECRET="change-me-in-production"
docker compose up --build -d
```

| URL | Purpose |
| --- | --- |
| `http://localhost:8080/healthz` | Liveness |
| `http://localhost:8080/readyz` | Ready (DB; Redis if configured) |
| `http://localhost:8080/metrics` | Prometheus metrics |
| `ws://localhost:8080/v1/ws` | Messaging |

Data directory: `./data` → `/data/omnychat.db` in the container.

## Environment

| Variable | Default | Notes |
| --- | --- | --- |
| `OMNYCHAT_HTTP_ADDR` | `:8080` | Listen address |
| `OMNYCHAT_DB_PATH` | `./data/omnychat.db` | SQLite path |
| `OMNYCHAT_JWT_SECRET` | _(required)_ | HS256 secret |
| `OMNYCHAT_JWT_PUBLIC_KEY` | | PEM RSA key; enables RS256 instead |
| `OMNYCHAT_JWT_ISSUER` | | Optional `iss` check |
| `OMNYCHAT_ALLOWED_ORIGINS` | `*` | Comma-separated Origins |
| `OMNYCHAT_MAX_FRAME_BYTES` | `1048576` | Max WS payload |
| `OMNYCHAT_PING_INTERVAL_SEC` | `30` | Heartbeat |
| `OMNYCHAT_REDIS_URL` | | e.g. `redis://redis:6379/0` for multi-node fan-out |
| `OMNYCHAT_INSTANCE_ID` | random UUID | Stable id per replica (skip Redis echo) |
| `OMNYCHAT_WEBHOOK_URL` | | POST target for message events |
| `OMNYCHAT_WEBHOOK_SECRET` | | Required if webhook URL set; HMAC key |
| `OMNYCHAT_TLS_CERT_FILE` | | Optional in-process TLS cert |
| `OMNYCHAT_TLS_KEY_FILE` | | Optional in-process TLS key |

## Webhooks

When `OMNYCHAT_WEBHOOK_URL` is set, the gateway POSTs JSON after durable create/edit/delete:

```json
{
  "type": "message.created",
  "room_id": "…",
  "server_msg_id": "…",
  "sender_id": "…",
  "seq": 1,
  "update_seq": 1,
  "body": "…",
  "at": 1710000000000
}
```

Header: `X-OmnyChat-Signature: sha256=<hmac-hex>` over the raw body. Use this from your app to trigger push notifications.

## Binary without Docker

```bash
make build
export OMNYCHAT_JWT_SECRET="change-me"
./bin/omnychat
```

## Security checklist

- Change `OMNYCHAT_JWT_SECRET` outside local dev
- Prefer RS256 so the gateway only holds a **public** key
- Terminate TLS at a reverse proxy (Caddy, nginx, Traefik), or set `OMNYCHAT_TLS_*`
- Restrict `OMNYCHAT_ALLOWED_ORIGINS` in production
- Do not expose the SQLite volume publicly
- `POST /v1/rooms` requires `Authorization: Bearer <JWT>`

## Scaling

With `OMNYCHAT_REDIS_URL`, multiple gateway replicas share live room events via Redis pub/sub. Persistence remains SQLite on each node’s volume in this release — put the DB on shared storage only if you understand SQLite locking limits, or run a single writer replica until Postgres lands (see [Roadmap](roadmap.md)).
