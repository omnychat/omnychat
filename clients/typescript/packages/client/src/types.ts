/** Shared domain types for the sync manager and storage adapters. */

export type ConnectionState =
  | "disconnected"
  | "connecting"
  | "authenticating"
  | "connected"
  | "reconnecting";

export interface StoredMessage {
  roomId: string;
  clientMsgId: string;
  serverMsgId?: string;
  senderId: string;
  body: string;
  seq?: number;
  /** Sync cursor field; equals seq on create, advances on edit/delete. */
  updateSeq?: number;
  createdAtUnixMs: number;
  editedAtUnixMs?: number;
  deleted?: boolean;
  /** pending = outbox / optimistic; confirmed = acked or synced from server */
  status: "pending" | "confirmed" | "failed";
}

export interface StoredReceipt {
  roomId: string;
  userId: string;
  lastReadSeq: number;
  updatedAtUnixMs: number;
}

export interface OutboxItem {
  roomId: string;
  clientMsgId: string;
  body: string;
  createdAtUnixMs: number;
  attempts: number;
  nextAttemptAtUnixMs: number;
}

export interface RoomMeta {
  roomId: string;
  /** Highest confirmed seq applied locally (cursor for SyncRoom). */
  sinceSeq: number;
  joined: boolean;
}

export interface RoomSnapshot {
  roomId: string;
  messages: StoredMessage[];
  receipts: StoredReceipt[];
  sinceSeq: number;
  connectionState: ConnectionState;
}
