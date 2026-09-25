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
  OmniChatClient,
  RoomSnapshot,
  StoredMessage,
} from "@omnichat/client";

const OmniChatKey: InjectionKey<OmniChatClient> = Symbol("omnichat");

export interface OmniChatPluginOptions {
  client: OmniChatClient;
}

/** Vue plugin: `app.use(OmniChatPlugin, { client })` */
export const OmniChatPlugin: Plugin<[OmniChatPluginOptions]> = {
  install(app: App, options: OmniChatPluginOptions) {
    provideOmniChat(options.client, app);
  },
};

/** Provide client without the plugin (e.g. in setup / tests). */
export function provideOmniChat(client: OmniChatClient, app?: App): void {
  if (app) {
    app.provide(OmniChatKey, client);
  } else {
    provide(OmniChatKey, client);
  }
}

export function useOmniChat(): OmniChatClient {
  const client = inject(OmniChatKey);
  if (!client) {
    throw new Error(
      "useOmniChat() requires OmniChatPlugin or provideOmniChat()",
    );
  }
  return client;
}

export function useConnection(): Ref<ConnectionState> {
  const client = useOmniChat();
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
  const client = useOmniChat();
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
