# @omnichat/vue

Vue 3 composables for OmniChat.

```ts
import { createApp } from 'vue';
import { createOmniChat, createIndexedDBStorage } from '@omnichat/client';
import { OmniChatPlugin, useRoom, useConnection } from '@omnichat/vue';

const client = createOmniChat({
  url: 'ws://localhost:8080/v1/ws',
  tokenProvider: () => fetchToken(),
  storage: createIndexedDBStorage(),
});

createApp(App).use(OmniChatPlugin, { client }).mount('#app');
```

See [SDK guide](../../../docs/sdk-guide.md).
