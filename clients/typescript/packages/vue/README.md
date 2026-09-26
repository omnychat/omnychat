# @omnychat/vue

Vue 3 composables for OmnyChat.

```ts
import { createApp } from 'vue';
import { createOmnyChat, createIndexedDBStorage } from '@omnychat/client';
import { OmnyChatPlugin, useRoom, useConnection } from '@omnychat/vue';

const client = createOmnyChat({
  url: 'ws://localhost:8080/v1/ws',
  tokenProvider: () => fetchToken(),
  storage: createIndexedDBStorage(),
});

createApp(App).use(OmnyChatPlugin, { client }).mount('#app');
```

See [SDK guide](../../../docs/sdk-guide.md).
