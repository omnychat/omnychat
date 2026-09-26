# TypeScript clients

| Package | Path |
| --- | --- |
| `@omnychat/client` | `packages/client` |
| `@omnychat/react` | `packages/react` |
| `@omnychat/vue` | `packages/vue` |
| `@omnychat/storage-sqlite` | `packages/storage-sqlite` |
| `@omnychat/node-smoke` | `examples/node-smoke` |

```bash
npm install
npm run proto    # regenerate TS protobuf from repo proto/
npm run build
npm test
npm start -w @omnychat/node-smoke
npm run publish:dry   # pack check only; does not upload
```

From repo root: `make proto-ts`, `make build-ts`, `make test-ts`.

See [SDK guide](../../docs/sdk-guide.md).
