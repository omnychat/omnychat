import type { Storage } from "../storage/types.js";
import type {
  ConnectionState,
  OutboxItem,
  RoomSnapshot,
  StoredMessage,
} from "../types.js";
import {
  makeAuth,
  makeDeleteMessage,
  makeEditMessage,
  makeJoinRoom,
  makeLeaveRoom,
  makeReadReceipt,
  makeSendMessage,
  makeSyncRoom,
  makeTyping,
  seqToNumber,
  type Envelope,
} from "../ws/codec.js";
import {
  Transport,
  type WebSocketConstructor,
} from "../ws/transport.js";

export type TokenProvider = () => string | Promise<string>;

export interface OmniChatOptions {
  url: string;
  tokenProvider: TokenProvider;
  storage: Storage;
  /** Inject for Node (`ws`) or custom RN polyfills. Defaults to global WebSocket. */
  WebSocketImpl?: WebSocketConstructor;
  /** Initial reconnect delay ms (doubles up to max). Default 1000. */
  reconnectBaseMs?: number;
  reconnectMaxMs?: number;
  /** Outbox retry base ms. Default 500. */
  outboxBaseMs?: number;
  outboxMaxMs?: number;
  syncPageSize?: number;
}

export type RoomListener = (snap: RoomSnapshot) => void;
export type ConnectionListener = (state: ConnectionState) => void;

function randomId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `c-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function backoffMs(attempt: number, base: number, max: number): number {
  const exp = Math.min(max, base * 2 ** Math.max(0, attempt));
  const jitter = Math.floor(Math.random() * Math.min(250, exp * 0.2));
  return exp + jitter;
}

/**
 * Client sync manager: local cache, optimistic outbox, reconnect + SyncRoom catch-up.
 */
export class OmniChatClient {
  private readonly opts: Required<
    Pick<
      OmniChatOptions,
      | "reconnectBaseMs"
      | "reconnectMaxMs"
      | "outboxBaseMs"
      | "outboxMaxMs"
      | "syncPageSize"
    >
  > &
    OmniChatOptions;

  private transport: Transport | null = null;
  private requestId = 0n;
  private userId: string | null = null;
  private connectionState: ConnectionState = "disconnected";
  private intentionalClose = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private outboxTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempt = 0;
  private connectGeneration = 0;

  private readonly roomListeners = new Map<string, Set<RoomListener>>();
  private readonly connListeners = new Set<ConnectionListener>();
  private readonly pendingRequests = new Map<
    bigint,
    {
      resolve: (env: Envelope) => void;
      reject: (err: Error) => void;
      expect: string;
    }
  >();
  /** Rooms currently syncing: resolve when SyncComplete arrives. */
  private readonly syncWaiters = new Map<
    string,
    { resolve: (hasMore: boolean) => void; reject: (err: Error) => void }
  >();

  constructor(opts: OmniChatOptions) {
    this.opts = {
      reconnectBaseMs: 1000,
      reconnectMaxMs: 30_000,
      outboxBaseMs: 500,
      outboxMaxMs: 30_000,
      syncPageSize: 500,
      ...opts,
    };
  }

  get state(): ConnectionState {
    return this.connectionState;
  }

  get currentUserId(): string | null {
    return this.userId;
  }

  onConnection(listener: ConnectionListener): () => void {
    this.connListeners.add(listener);
    listener(this.connectionState);
    return () => this.connListeners.delete(listener);
  }

  subscribeRoom(roomId: string, listener: RoomListener): () => void {
    let set = this.roomListeners.get(roomId);
    if (!set) {
      set = new Set();
      this.roomListeners.set(roomId, set);
    }
    set.add(listener);
    void this.emitRoom(roomId);
    return () => {
      set!.delete(listener);
      if (set!.size === 0) this.roomListeners.delete(roomId);
    };
  }

  async connect(): Promise<void> {
    this.intentionalClose = false;
    await this.opts.storage.open();
    await this.openAndAuth();
  }

  async disconnect(): Promise<void> {
    this.intentionalClose = true;
    this.clearReconnect();
    this.clearOutboxTimer();
    this.transport?.close();
    this.transport = null;
    this.setState("disconnected");
    await this.opts.storage.close();
  }

  async joinRoom(roomId: string): Promise<void> {
    const meta = (await this.opts.storage.getRoomMeta(roomId)) ?? {
      roomId,
      sinceSeq: 0,
      joined: false,
    };
    meta.joined = true;
    await this.opts.storage.putRoomMeta(meta);

    if (this.connectionState === "connected") {
      await this.joinAndSync(roomId);
    }
    await this.emitRoom(roomId);
  }

  async leaveRoom(roomId: string): Promise<void> {
    const meta = await this.opts.storage.getRoomMeta(roomId);
    if (meta) {
      meta.joined = false;
      await this.opts.storage.putRoomMeta(meta);
    }
    if (this.connectionState === "connected" && this.transport) {
      try {
        const reqId = this.nextRequestId();
        await this.request(makeLeaveRoom(reqId, roomId), "leaveOk");
      } catch {
        /* best effort */
      }
    }
    await this.emitRoom(roomId);
  }

  async sendMessage(roomId: string, body: string, clientMsgId?: string): Promise<string> {
    const id = clientMsgId ?? randomId();
    const now = Date.now();
    const msg: StoredMessage = {
      roomId,
      clientMsgId: id,
      senderId: this.userId ?? "local",
      body,
      createdAtUnixMs: now,
      status: "pending",
    };
    await this.opts.storage.upsertMessage(msg);

    const outbox: OutboxItem = {
      roomId,
      clientMsgId: id,
      body,
      createdAtUnixMs: now,
      attempts: 0,
      nextAttemptAtUnixMs: now,
    };
    await this.opts.storage.enqueueOutbox(outbox);
    await this.emitRoom(roomId);
    this.scheduleOutboxFlush(0);
    return id;
  }

  async editMessage(roomId: string, serverMsgId: string, body: string): Promise<void> {
    if (this.connectionState !== "connected" || !this.transport) {
      throw new Error("not connected");
    }
    const existing = await this.opts.storage.getMessageByServerId(roomId, serverMsgId);
    if (existing) {
      await this.opts.storage.upsertMessage({
        ...existing,
        body,
        editedAtUnixMs: Date.now(),
        status: existing.status,
      });
      await this.emitRoom(roomId);
    }
    const env = await this.request(
      makeEditMessage(this.nextRequestId(), roomId, serverMsgId, body),
      "messageAck",
    );
    if (env.payload.case === "error") {
      throw new Error(env.payload.value.message || env.payload.value.code);
    }
  }

  async deleteMessage(roomId: string, serverMsgId: string): Promise<void> {
    if (this.connectionState !== "connected" || !this.transport) {
      throw new Error("not connected");
    }
    const existing = await this.opts.storage.getMessageByServerId(roomId, serverMsgId);
    if (existing) {
      await this.opts.storage.upsertMessage({
        ...existing,
        body: "",
        deleted: true,
        status: existing.status,
      });
      await this.emitRoom(roomId);
    }
    const env = await this.request(
      makeDeleteMessage(this.nextRequestId(), roomId, serverMsgId),
      "messageAck",
    );
    if (env.payload.case === "error") {
      throw new Error(env.payload.value.message || env.payload.value.code);
    }
  }

  async setTyping(roomId: string, isTyping: boolean): Promise<void> {
    if (this.connectionState !== "connected" || !this.transport) return;
    this.transport.send(makeTyping(this.nextRequestId(), roomId, isTyping));
  }

  async sendReadReceipt(roomId: string, lastReadSeq: number): Promise<void> {
    if (this.userId) {
      await this.opts.storage.upsertReceipt({
        roomId,
        userId: this.userId,
        lastReadSeq,
        updatedAtUnixMs: Date.now(),
      });
      await this.emitRoom(roomId);
    }
    if (this.connectionState !== "connected" || !this.transport) return;
    this.transport.send(
      makeReadReceipt(this.nextRequestId(), roomId, BigInt(lastReadSeq)),
    );
  }

  async getRoomSnapshot(roomId: string): Promise<RoomSnapshot> {
    const meta = await this.opts.storage.getRoomMeta(roomId);
    const messages = await this.opts.storage.listMessages(roomId);
    const receipts = await this.opts.storage.listReceipts(roomId);
    return {
      roomId,
      messages,
      receipts,
      sinceSeq: meta?.sinceSeq ?? 0,
      connectionState: this.connectionState,
    };
  }

  private async openAndAuth(): Promise<void> {
    this.clearReconnect();
    const gen = ++this.connectGeneration;
    this.setState(
      this.reconnectAttempt > 0 ? "reconnecting" : "connecting",
    );

    this.transport?.close();
    const transport = new Transport({
      url: this.opts.url,
      WebSocketImpl: this.opts.WebSocketImpl,
      onEnvelope: (env) => this.handleEnvelope(env),
      onClose: () => {
        if (gen !== this.connectGeneration) return;
        this.transport = null;
        if (!this.intentionalClose) {
          this.setState("reconnecting");
          this.scheduleReconnect();
        } else {
          this.setState("disconnected");
        }
      },
      onError: () => {
        /* close handler drives reconnect */
      },
    });
    this.transport = transport;

    try {
      await transport.connect();
      if (gen !== this.connectGeneration) return;

      this.setState("authenticating");
      const token = await this.opts.tokenProvider();
      const reqId = this.nextRequestId();
      const authOk = await this.request(makeAuth(reqId, token), "authOk");
      if (authOk.payload.case !== "authOk") {
        throw new Error("expected AuthOK");
      }
      this.userId = authOk.payload.value.userId;
      this.reconnectAttempt = 0;
      this.setState("connected");

      const joined = await this.opts.storage.listJoinedRooms();
      for (const room of joined) {
        await this.joinAndSync(room.roomId);
      }
      this.scheduleOutboxFlush(0);
    } catch (err) {
      if (gen !== this.connectGeneration) return;
      this.transport?.close();
      this.transport = null;
      if (!this.intentionalClose) {
        this.setState("reconnecting");
        this.scheduleReconnect();
      } else {
        this.setState("disconnected");
      }
      throw err;
    }
  }

  private async joinAndSync(roomId: string): Promise<void> {
    if (!this.transport || this.connectionState !== "connected") return;

    const joinReq = this.nextRequestId();
    const joinOk = await this.request(makeJoinRoom(joinReq, roomId), "joinOk");
    if (joinOk.payload.case !== "joinOk") {
      throw new Error("expected JoinOK");
    }

    let meta = (await this.opts.storage.getRoomMeta(roomId)) ?? {
      roomId,
      sinceSeq: 0,
      joined: true,
    };
    meta.joined = true;
    await this.opts.storage.putRoomMeta(meta);

    let hasMore = true;
    while (hasMore) {
      meta = (await this.opts.storage.getRoomMeta(roomId)) ?? meta;
      const syncReq = this.nextRequestId();
      hasMore = await this.syncPage(
        roomId,
        syncReq,
        BigInt(meta.sinceSeq),
      );
    }
    await this.emitRoom(roomId);
  }

  private syncPage(
    roomId: string,
    requestId: bigint,
    sinceSeq: bigint,
  ): Promise<boolean> {
    return new Promise((resolve, reject) => {
      if (!this.transport) {
        reject(new Error("not connected"));
        return;
      }
      this.syncWaiters.set(roomId, { resolve, reject });
      // Also track SyncComplete by request_id for error handling
      this.pendingRequests.set(requestId, {
        resolve: (env) => {
          if (env.payload.case === "error") {
            this.syncWaiters.delete(roomId);
            reject(
              new Error(
                `${env.payload.value.code}: ${env.payload.value.message}`,
              ),
            );
            return;
          }
          if (env.payload.case === "syncComplete") {
            const waiter = this.syncWaiters.get(roomId);
            this.syncWaiters.delete(roomId);
            waiter?.resolve(env.payload.value.hasMore);
          }
        },
        reject: (err) => {
          this.syncWaiters.delete(roomId);
          reject(err);
        },
        expect: "syncComplete",
      });
      this.transport.send(
        makeSyncRoom(requestId, roomId, sinceSeq, this.opts.syncPageSize),
      );
    });
  }

  private handleEnvelope(env: Envelope): void {
    const pending = this.pendingRequests.get(env.requestId);
    if (pending && env.requestId !== 0n) {
      // SyncComplete and errors for sync are handled via pending; MessageEvents during sync have requestId 0
      if (
        env.payload.case === pending.expect ||
        env.payload.case === "error"
      ) {
        this.pendingRequests.delete(env.requestId);
        pending.resolve(env);
        // Fall through for syncComplete side effects below when needed
        if (env.payload.case === "error") return;
        if (env.payload.case !== "syncComplete") return;
      }
    }

    switch (env.payload.case) {
      case "messageEvent":
        void this.onMessageEvent(env.payload.value);
        break;
      case "messageAck":
        void this.onMessageAck(env.payload.value);
        break;
      case "receiptEvent":
        void this.onReceiptEvent(env.payload.value);
        break;
      case "syncComplete":
        void this.onSyncComplete(env.payload.value);
        break;
      case "error":
        // Unsolicited errors ignored; request-scoped handled above
        break;
      case "typingEvent":
        // Ephemeral — host can subscribe later; no persistence
        break;
      default:
        break;
    }
  }

  private async onMessageEvent(ev: {
    roomId: string;
    clientMsgId: string;
    serverMsgId: string;
    senderId: string;
    body: string;
    seq: bigint;
    createdAtUnixMs: bigint;
    updateSeq?: bigint;
    editedAtUnixMs?: bigint;
    deleted?: boolean;
  }): Promise<void> {
    const seq = seqToNumber(ev.seq);
    const updateSeq = seqToNumber(ev.updateSeq) || seq;
    const msg: StoredMessage = {
      roomId: ev.roomId,
      clientMsgId: ev.clientMsgId,
      serverMsgId: ev.serverMsgId,
      senderId: ev.senderId,
      body: ev.body,
      seq,
      updateSeq,
      createdAtUnixMs: Number(ev.createdAtUnixMs),
      editedAtUnixMs: ev.editedAtUnixMs ? Number(ev.editedAtUnixMs) : undefined,
      deleted: ev.deleted === true,
      status: "confirmed",
    };

    const byServer = await this.opts.storage.getMessageByServerId(
      ev.roomId,
      ev.serverMsgId,
    );
    const existingUpdate = byServer?.updateSeq ?? byServer?.seq ?? 0;
    if (byServer && existingUpdate >= updateSeq) {
      await this.bumpCursor(ev.roomId, updateSeq);
      return;
    }

    await this.opts.storage.upsertMessage(msg);
    await this.opts.storage.removeOutbox(ev.roomId, ev.clientMsgId);
    await this.bumpCursor(ev.roomId, updateSeq);
    await this.emitRoom(ev.roomId);
  }

  private async onMessageAck(ack: {
    roomId: string;
    clientMsgId: string;
    serverMsgId: string;
    seq: bigint;
    createdAtUnixMs: bigint;
  }): Promise<void> {
    const seq = seqToNumber(ack.seq);
    const existing = await this.opts.storage.getMessageByClientId(
      ack.roomId,
      ack.clientMsgId,
    );
    await this.opts.storage.upsertMessage({
      roomId: ack.roomId,
      clientMsgId: ack.clientMsgId,
      serverMsgId: ack.serverMsgId,
      senderId: existing?.senderId ?? this.userId ?? "local",
      body: existing?.body ?? "",
      seq,
      updateSeq: existing?.updateSeq && existing.updateSeq > seq ? existing.updateSeq : seq,
      createdAtUnixMs: Number(ack.createdAtUnixMs) || existing?.createdAtUnixMs || Date.now(),
      editedAtUnixMs: existing?.editedAtUnixMs,
      deleted: existing?.deleted,
      status: "confirmed",
    });
    await this.opts.storage.removeOutbox(ack.roomId, ack.clientMsgId);
    await this.bumpCursor(ack.roomId, seq);
    await this.emitRoom(ack.roomId);
  }

  private async onReceiptEvent(ev: {
    roomId: string;
    userId: string;
    lastReadSeq: bigint;
    updatedAtUnixMs: bigint;
  }): Promise<void> {
    await this.opts.storage.upsertReceipt({
      roomId: ev.roomId,
      userId: ev.userId,
      lastReadSeq: seqToNumber(ev.lastReadSeq),
      updatedAtUnixMs: Number(ev.updatedAtUnixMs),
    });
    await this.emitRoom(ev.roomId);
  }

  private async onSyncComplete(sc: {
    roomId: string;
    latestSeq: bigint;
    hasMore: boolean;
  }): Promise<void> {
    const meta = (await this.opts.storage.getRoomMeta(sc.roomId)) ?? {
      roomId: sc.roomId,
      sinceSeq: 0,
      joined: true,
    };
    const latest = seqToNumber(sc.latestSeq);
    if (latest > meta.sinceSeq && !sc.hasMore) {
      meta.sinceSeq = latest;
      await this.opts.storage.putRoomMeta(meta);
    }
  }

  private async bumpCursor(roomId: string, seq: number): Promise<void> {
    const meta = (await this.opts.storage.getRoomMeta(roomId)) ?? {
      roomId,
      sinceSeq: 0,
      joined: true,
    };
    if (seq > meta.sinceSeq) {
      meta.sinceSeq = seq;
      await this.opts.storage.putRoomMeta(meta);
    }
  }

  private scheduleOutboxFlush(delayMs: number): void {
    this.clearOutboxTimer();
    this.outboxTimer = setTimeout(() => {
      void this.flushOutbox();
    }, delayMs);
  }

  private async flushOutbox(): Promise<void> {
    if (this.connectionState !== "connected" || !this.transport) return;
    const items = await this.opts.storage.listOutbox();
    const now = Date.now();
    let nextWake: number | null = null;

    for (const item of items) {
      if (item.nextAttemptAtUnixMs > now) {
        const wait = item.nextAttemptAtUnixMs - now;
        nextWake = nextWake == null ? wait : Math.min(nextWake, wait);
        continue;
      }
      try {
        this.transport.send(
          makeSendMessage(
            this.nextRequestId(),
            item.roomId,
            item.clientMsgId,
            item.body,
          ),
        );
        item.attempts += 1;
        item.nextAttemptAtUnixMs =
          now +
          backoffMs(
            item.attempts,
            this.opts.outboxBaseMs,
            this.opts.outboxMaxMs,
          );
        await this.opts.storage.updateOutbox(item);
        const wait = item.nextAttemptAtUnixMs - now;
        nextWake = nextWake == null ? wait : Math.min(nextWake, wait);
      } catch {
        item.attempts += 1;
        item.nextAttemptAtUnixMs =
          now +
          backoffMs(
            item.attempts,
            this.opts.outboxBaseMs,
            this.opts.outboxMaxMs,
          );
        await this.opts.storage.updateOutbox(item);
        nextWake =
          nextWake == null
            ? item.nextAttemptAtUnixMs - now
            : Math.min(nextWake, item.nextAttemptAtUnixMs - now);
      }
    }

    if (nextWake != null) {
      this.scheduleOutboxFlush(Math.max(50, nextWake));
    } else if (items.length > 0) {
      this.scheduleOutboxFlush(this.opts.outboxBaseMs);
    }
  }

  private scheduleReconnect(): void {
    this.clearReconnect();
    const delay = backoffMs(
      this.reconnectAttempt,
      this.opts.reconnectBaseMs,
      this.opts.reconnectMaxMs,
    );
    this.reconnectAttempt += 1;
    this.reconnectTimer = setTimeout(() => {
      void this.openAndAuth().catch(() => {
        /* scheduleReconnect from onClose / catch */
      });
    }, delay);
  }

  private clearReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private clearOutboxTimer(): void {
    if (this.outboxTimer) {
      clearTimeout(this.outboxTimer);
      this.outboxTimer = null;
    }
  }

  private nextRequestId(): bigint {
    this.requestId += 1n;
    return this.requestId;
  }

  private request(env: Envelope, expect: string): Promise<Envelope> {
    return new Promise((resolve, reject) => {
      if (!this.transport) {
        reject(new Error("not connected"));
        return;
      }
      const reqId = env.requestId;
      const timer = setTimeout(() => {
        this.pendingRequests.delete(reqId);
        reject(new Error(`timeout waiting for ${expect}`));
      }, 15_000);
      this.pendingRequests.set(reqId, {
        resolve: (reply) => {
          clearTimeout(timer);
          if (reply.payload.case === "error") {
            reject(
              new Error(
                `${reply.payload.value.code}: ${reply.payload.value.message}`,
              ),
            );
            return;
          }
          resolve(reply);
        },
        reject: (err) => {
          clearTimeout(timer);
          reject(err);
        },
        expect,
      });
      this.transport.send(env);
    });
  }

  private setState(state: ConnectionState): void {
    if (this.connectionState === state) return;
    this.connectionState = state;
    for (const l of this.connListeners) l(state);
  }

  private async emitRoom(roomId: string): Promise<void> {
    const listeners = this.roomListeners.get(roomId);
    if (!listeners || listeners.size === 0) return;
    const snap = await this.getRoomSnapshot(roomId);
    for (const l of listeners) l(snap);
  }
}

export function createOmniChat(opts: OmniChatOptions): OmniChatClient {
  return new OmniChatClient(opts);
}
