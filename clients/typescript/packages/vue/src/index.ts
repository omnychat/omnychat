import {
  computed,
  inject,
  onUnmounted,
  provide,
  ref,
  unref,
  watch,
  type App,
  type InjectionKey,
  type MaybeRefOrGetter,
  type Plugin,
  type Ref,
} from "vue";
import type {
  ConnectionState,
  OmnyChatClient,
  RoomSnapshot,
  StoredMessage,
} from "@omnychat/client";

const OmnyChatKey: InjectionKey<OmnyChatClient> = Symbol("omnychat");

export interface OmnyChatPluginOptions {
  client: OmnyChatClient;
}

/** Vue plugin: `app.use(OmnyChatPlugin, { client })` */
export const OmnyChatPlugin: Plugin<[OmnyChatPluginOptions]> = {
  install(app: App, options: OmnyChatPluginOptions) {
    provideOmnyChat(options.client, app);
  },
};

/** Provide client without the plugin (e.g. in setup / tests). */
export function provideOmnyChat(client: OmnyChatClient, app?: App): void {
  if (app) {
    app.provide(OmnyChatKey, client);
  } else {
    provide(OmnyChatKey, client);
  }
}

export function useOmnyChat(): OmnyChatClient {
  const client = inject(OmnyChatKey);
  if (!client) {
    throw new Error(
      "useOmnyChat() requires OmnyChatPlugin or provideOmnyChat()",
    );
  }
  return client;
}

export function useConnection(): Ref<ConnectionState> {
  const client = useOmnyChat();
  const state = ref<ConnectionState>(client.state);
  const unsub = client.onConnection((s) => {
    state.value = s;
  });
  onUnmounted(unsub);
  return state;
}

export function useRoom(
  roomId: MaybeRefOrGetter<string>,
): Ref<RoomSnapshot | null> {
  const client = useOmnyChat();
  const snap = ref<RoomSnapshot | null>(null);
  let unsub: (() => void) | undefined;

  const subscribe = (id: string) => {
    unsub?.();
    unsub = client.subscribeRoom(id, (s) => {
      snap.value = s;
    });
  };

  watch(
    () => (typeof roomId === "function" ? roomId() : unref(roomId)),
    (id) => {
      snap.value = null;
      subscribe(id);
    },
    { immediate: true },
  );

  onUnmounted(() => unsub?.());
  return snap;
}

export function useMessages(
  roomId: MaybeRefOrGetter<string>,
): Ref<StoredMessage[]> {
  const snap = useRoom(roomId);
  return computed(() => snap.value?.messages ?? []);
}
