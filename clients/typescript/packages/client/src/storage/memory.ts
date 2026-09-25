import type {
  OutboxItem,
  RoomMeta,
  StoredMessage,
  StoredReceipt,
} from "../types.js";
import type { Storage } from "./types.js";

function msgKey(roomId: string, clientMsgId: string): string {
  return `${roomId}\0${clientMsgId}`;
}

function receiptKey(roomId: string, userId: string): string {
  return `${roomId}\0${userId}`;
}

/** In-memory storage for tests and Node smoke without persistence. */
export class MemoryStorage implements Storage {
  private rooms = new Map<string, RoomMeta>();
  private messages = new Map<string, StoredMessage>();
  private byServer = new Map<string, string>(); // room\0serverId -> clientKey
  private receipts = new Map<string, StoredReceipt>();
  private outbox = new Map<string, OutboxItem>();

  async open(): Promise<void> {}
  async close(): Promise<void> {}

  async getRoomMeta(roomId: string): Promise<RoomMeta | undefined> {
    return this.rooms.get(roomId);
  }

  async putRoomMeta(meta: RoomMeta): Promise<void> {
    this.rooms.set(meta.roomId, { ...meta });
  }

  async listJoinedRooms(): Promise<RoomMeta[]> {
    return [...this.rooms.values()].filter((r) => r.joined);
  }

  async upsertMessage(msg: StoredMessage): Promise<void> {
    const key = msgKey(msg.roomId, msg.clientMsgId);
    const existing = this.messages.get(key);
    const merged: StoredMessage = {
      ...existing,
      ...msg,
      status: msg.status ?? existing?.status ?? "pending",
    };
    if (existing?.serverMsgId && !merged.serverMsgId) {
      merged.serverMsgId = existing.serverMsgId;
    }
    if (existing?.seq != null && merged.seq == null) {
      merged.seq = existing.seq;
    }
    if (existing?.updateSeq != null && merged.updateSeq == null) {
      merged.updateSeq = existing.updateSeq;
    }
    // Prefer confirmed over pending
    if (existing?.status === "confirmed" && msg.status === "pending") {
      merged.status = "confirmed";
    }
    this.messages.set(key, merged);
    if (merged.serverMsgId) {
      this.byServer.set(`${msg.roomId}\0${merged.serverMsgId}`, key);
    }
  }

  async getMessageByClientId(
    roomId: string,
    clientMsgId: string,
  ): Promise<StoredMessage | undefined> {
    return this.messages.get(msgKey(roomId, clientMsgId));
  }

  async getMessageByServerId(
    roomId: string,
    serverMsgId: string,
  ): Promise<StoredMessage | undefined> {
    const key = this.byServer.get(`${roomId}\0${serverMsgId}`);
    return key ? this.messages.get(key) : undefined;
  }

  async listMessages(roomId: string): Promise<StoredMessage[]> {
    const list = [...this.messages.values()].filter((m) => m.roomId === roomId);
    return list.sort((a, b) => {
      const as = a.seq ?? Number.MAX_SAFE_INTEGER;
      const bs = b.seq ?? Number.MAX_SAFE_INTEGER;
      if (as !== bs) return as - bs;
      return a.createdAtUnixMs - b.createdAtUnixMs;
    });
  }

  async upsertReceipt(receipt: StoredReceipt): Promise<void> {
    const key = receiptKey(receipt.roomId, receipt.userId);
    const existing = this.receipts.get(key);
    if (existing && existing.lastReadSeq >= receipt.lastReadSeq) {
      return;
    }
    this.receipts.set(key, { ...receipt });
  }

  async listReceipts(roomId: string): Promise<StoredReceipt[]> {
    return [...this.receipts.values()].filter((r) => r.roomId === roomId);
  }

  async enqueueOutbox(item: OutboxItem): Promise<void> {
    this.outbox.set(msgKey(item.roomId, item.clientMsgId), { ...item });
  }

  async listOutbox(): Promise<OutboxItem[]> {
    return [...this.outbox.values()].sort(
      (a, b) => a.createdAtUnixMs - b.createdAtUnixMs,
    );
  }

  async updateOutbox(item: OutboxItem): Promise<void> {
    this.outbox.set(msgKey(item.roomId, item.clientMsgId), { ...item });
  }

  async removeOutbox(roomId: string, clientMsgId: string): Promise<void> {
    this.outbox.delete(msgKey(roomId, clientMsgId));
  }
}

export function createMemoryStorage(): Storage {
  return new MemoryStorage();
}
