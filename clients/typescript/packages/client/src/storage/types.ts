import type { OutboxItem, RoomMeta, StoredMessage, StoredReceipt } from "../types.js";

/**
 * Pluggable persistence for the sync manager.
 * Implementations: MemoryStorage, IndexedDBStorage, SqliteStorage (RN).
 */
export interface Storage {
  open(): Promise<void>;
  close(): Promise<void>;

  getRoomMeta(roomId: string): Promise<RoomMeta | undefined>;
  putRoomMeta(meta: RoomMeta): Promise<void>;
  listJoinedRooms(): Promise<RoomMeta[]>;

  upsertMessage(msg: StoredMessage): Promise<void>;
  getMessageByClientId(
    roomId: string,
    clientMsgId: string,
  ): Promise<StoredMessage | undefined>;
  getMessageByServerId(
    roomId: string,
    serverMsgId: string,
  ): Promise<StoredMessage | undefined>;
  listMessages(roomId: string): Promise<StoredMessage[]>;

  upsertReceipt(receipt: StoredReceipt): Promise<void>;
  listReceipts(roomId: string): Promise<StoredReceipt[]>;

  enqueueOutbox(item: OutboxItem): Promise<void>;
  listOutbox(): Promise<OutboxItem[]>;
  updateOutbox(item: OutboxItem): Promise<void>;
  removeOutbox(roomId: string, clientMsgId: string): Promise<void>;
}
