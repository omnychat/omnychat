# Echo client

Smoke-test client for Phase 1.

```bash
# Terminal 1: start gateway
export OMNYCHAT_JWT_SECRET=dev-secret-change-me
make run

# Terminal 2: send a message
go run ./examples/echo-client -sub alice -room lobby -body "hello"

# Print a JWT only
go run ./examples/echo-client -token-only -sub bob
```
