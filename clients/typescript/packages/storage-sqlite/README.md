# @omnichat/storage-sqlite

SQLite `Storage` adapter for React Native / Expo.

```ts
import * as SQLite from 'expo-sqlite';
import { createSqliteStorage } from '@omnichat/storage-sqlite';

const storage = await createSqliteStorage(SQLite.openDatabaseAsync);
```

Peer dependency: `expo-sqlite` >= 14 (optional at install time; required at runtime on RN).

See [SDK guide](../../../docs/sdk-guide.md).
