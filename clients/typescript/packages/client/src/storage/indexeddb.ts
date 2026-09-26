import type {
  OutboxItem,
  RoomMeta,
  StoredMessage,
  StoredReceipt,
} from "../types.js";
import type { Storage } from "./types.js";

const DB_NAME = "omnychat";
const DB_VERSION = 1;

function msgKey(roomId: string, clientMsgId: string): string {
  return `${roomId}|${clientMsgId}`;
}

function receiptKey(roomId: string, userId: string): string {
  return `${roomId}|${userId}`;
}

interface MessageRow extends StoredMessage {
  id: string;
  serverKey?: string;
}

interface ReceiptRow extends StoredReceipt {
  id: string;
}

interface OutboxRow extends OutboxItem {
  id: string;
}

function stripMessage(row: MessageRow): StoredMessage {
  const { id: _id, serverKey: _sk, ...msg } = row;
  return msg;
}

function idbReq<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("indexedDB request failed"));
  });
}

/** Browser IndexedDB persistence. */
export class IndexedDBStorage implements Storage {
  private db: IDBDatabase | null = null;
  private readonly dbName: string;

  constructor(dbName = DB_NAME) {
    this.dbName = dbName;
  }

  async open(): Promise<void> {
    if (this.db) return;
    if (typeof indexedDB === "undefined") {
      throw new Error("indexedDB is not available in this environment");
    }
    this.db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(this.dbName, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains("rooms")) {
          db.createObjectStore("rooms", { keyPath: "roomId" });
        }
        if (!db.objectStoreNames.contains("messages")) {
          const store = db.createObjectStore("messages", { keyPath: "id" });
          store.createIndex("byRoom", "roomId", { unique: false });
          store.createIndex("byServer", "serverKey", { unique: false });
        }
        if (!db.objectStoreNames.contains("receipts")) {
          const store = db.createObjectStore("receipts", { keyPath: "id" });
          store.createIndex("byRoom", "roomId", { unique: false });
        }
        if (!db.objectStoreNames.contains("outbox")) {
          db.createObjectStore("outbox", { keyPath: "id" });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error("indexedDB open failed"));
    });
  }

  async close(): Promise<void> {
    this.db?.close();
    this.db = null;
  }

  private requireDb(): IDBDatabase {
    if (!this.db) throw new Error("IndexedDBStorage not open");
    return this.db;
  }

  async getRoomMeta(roomId: string): Promise<RoomMeta | undefined> {
    const db = this.requireDb();
    const tx = db.transaction("rooms", "readonly");
    return idbReq(tx.objectStore("rooms").get(roomId));
  }

  async putRoomMeta(meta: RoomMeta): Promise<void> {
    const db = this.requireDb();
    const tx = db.transaction("rooms", "readwrite");
    await idbReq(tx.objectStore("rooms").put(meta));
  }

  async listJoinedRooms(): Promise<RoomMeta[]> {
    const db = this.requireDb();
    const tx = db.transaction("rooms", "readonly");
    const all = await idbReq(tx.objectStore("rooms").getAll());
    return (all as RoomMeta[]).filter((r) => r.joined);
  }

  async upsertMessage(msg: StoredMessage): Promise<void> {
    const id = msgKey(msg.roomId, msg.clientMsgId);
    const db = this.requireDb();
    const tx = db.transaction("messages", "readwrite");
    const store = tx.objectStore("messages");
    const existing = (await idbReq(store.get(id))) as MessageRow | undefined;
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
    if (existing?.status === "confirmed" && msg.status === "pending") {
      merged.status = "confirmed";
    }
    const row: MessageRow = {
      ...merged,
      id,
      serverKey: merged.serverMsgId
        ? `${merged.roomId}|${merged.serverMsgId}`
        : undefined,
    };
    await idbReq(store.put(row));
  }

  async getMessageByClientId(
    roomId: string,
    clientMsgId: string,
  ): Promise<StoredMessage | undefined> {
    const db = this.requireDb();
    const tx = db.transaction("messages", "readonly");
    const row = (await idbReq(
      tx.objectStore("messages").get(msgKey(roomId, clientMsgId)),
    )) as MessageRow | undefined;
    return row ? stripMessage(row) : undefined;
  }

  async getMessageByServerId(
    roomId: string,
    serverMsgId: string,
  ): Promise<StoredMessage | undefined> {
    const db = this.requireDb();
    const tx = db.transaction("messages", "readonly");
    const row = (await idbReq(
      tx.objectStore("messages").index("byServer").get(`${roomId}|${serverMsgId}`),
    )) as MessageRow | undefined;
    return row ? stripMessage(row) : undefined;
  }

  async listMessages(roomId: string): Promise<StoredMessage[]> {
    const db = this.requireDb();
    const tx = db.transaction("messages", "readonly");
    const rows = (await idbReq(
      tx.objectStore("messages").index("byRoom").getAll(roomId),
    )) as MessageRow[];
    return rows
      .map(stripMessage)
      .sort((a, b) => {
        const as = a.seq ?? Number.MAX_SAFE_INTEGER;
        const bs = b.seq ?? Number.MAX_SAFE_INTEGER;
        if (as !== bs) return as - bs;
        return a.createdAtUnixMs - b.createdAtUnixMs;
      });
  }

  async upsertReceipt(receipt: StoredReceipt): Promise<void> {
    const id = receiptKey(receipt.roomId, receipt.userId);
    const db = this.requireDb();
    const tx = db.transaction("receipts", "readwrite");
    const store = tx.objectStore("receipts");
    const existing = (await idbReq(store.get(id))) as ReceiptRow | undefined;
    if (existing && existing.lastReadSeq >= receipt.lastReadSeq) return;
    await idbReq(store.put({ ...receipt, id }));
  }

  async listReceipts(roomId: string): Promise<StoredReceipt[]> {
    const db = this.requireDb();
    const tx = db.transaction("receipts", "readonly");
    const rows = (await idbReq(
      tx.objectStore("receipts").index("byRoom").getAll(roomId),
    )) as ReceiptRow[];
    return rows.map((r) => ({
      roomId: r.roomId,
      userId: r.userId,
      lastReadSeq: r.lastReadSeq,
      updatedAtUnixMs: r.updatedAtUnixMs,
    }));
  }

  async enqueueOutbox(item: OutboxItem): Promise<void> {
    const db = this.requireDb();
    const tx = db.transaction("outbox", "readwrite");
    await idbReq(
      tx.objectStore("outbox").put({
        ...item,
        id: msgKey(item.roomId, item.clientMsgId),
      }),
    );
  }

  async listOutbox(): Promise<OutboxItem[]> {
    const db = this.requireDb();
    const tx = db.transaction("outbox", "readonly");
    const rows = (await idbReq(tx.objectStore("outbox").getAll())) as OutboxRow[];
    return rows
      .map(({ id: _id, ...rest }) => rest)
      .sort((a, b) => a.createdAtUnixMs - b.createdAtUnixMs);
  }

  async updateOutbox(item: OutboxItem): Promise<void> {
    await this.enqueueOutbox(item);
  }

  async removeOutbox(roomId: string, clientMsgId: string): Promise<void> {
    const db = this.requireDb();
    const tx = db.transaction("outbox", "readwrite");
    await idbReq(tx.objectStore("outbox").delete(msgKey(roomId, clientMsgId)));
  }
}

export function createIndexedDBStorage(dbName?: string): Storage {
  return new IndexedDBStorage(dbName);
}
