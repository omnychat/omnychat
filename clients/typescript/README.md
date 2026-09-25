# TypeScript clients

| Package | Path |
| --- | --- |
| `@omnichat/client` | `packages/client` |
| `@omnichat/react` | `packages/react` |
| `@omnichat/vue` | `packages/vue` |
| `@omnichat/storage-sqlite` | `packages/storage-sqlite` |
| `@omnichat/node-smoke` | `examples/node-smoke` |

```bash
npm install
npm run proto    # regenerate TS protobuf from repo proto/
npm run build
npm test
npm start -w @omnichat/node-smoke
npm run publish:dry   # pack check only; does not upload
```

From repo root: `make proto-ts`, `make build-ts`, `make test-ts`.

See [SDK guide](../../docs/sdk-guide.md).
