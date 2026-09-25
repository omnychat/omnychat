# Getting started

Run the gateway, create a room, send a message.

## 1. Start the gateway

```bash
export OMNICHAT_JWT_SECRET="dev-secret-change-me"
docker compose up --build
```

Without Docker: `make run` (Go 1.22+).

```bash
curl http://localhost:8080/healthz   # → ok
# WebSocket: ws://localhost:8080/v1/ws
```

## 2. Create a room

A room is a chat channel — use one for a DM or a group.

```bash
curl -s -X POST http://localhost:8080/v1/rooms \
  -H 'Content-Type: application/json' \
  -d '{"id":"lobby","name":"Lobby"}'
```

## 3. Send a message

Your app mints JWTs. For a quick test, the echo client signs one with the same secret:

```bash
go run ./examples/echo-client \
  -secret dev-secret-change-me \
  -sub alice \
  -room lobby \
  -body "hello omnichat"
```

Expected:

```
authed as alice
joined lobby latest_seq=0
ack server_msg_id=… seq=1
event from=alice seq=1 body="hello omnichat"
ok
```

## 4. Wire your app

See the root [README](https://github.com/OluwapelumiG/omnichat/blob/main/README.md) integrate steps and [SDK guide](sdk-guide.md).

Optional Node smoke (validates `@omnichat/client`):

```bash
cd clients/typescript && npm install && npm run build
OMNICHAT_JWT_SECRET=dev-secret-change-me npm start -w @omnichat/node-smoke
```

Next: [How it works](how-it-works.md) · [Deploy](deploy.md)
