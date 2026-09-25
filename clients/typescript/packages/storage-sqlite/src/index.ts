import type {
  OutboxItem,
  RoomMeta,
  StoredMessage,
  StoredReceipt,
  Storage,
} from "@omnichat/client";

/**
 * Minimal async SQLite surface compatible with expo-sqlite's openDatabaseAsync API.
 * Inject your DB so this package does not hard-require expo-sqlite at build time.
 */
export interface SqliteDatabase {
  execAsync(source: string): Promise<void>;
  runAsync(
    source: string,
    ...params: (string | number | null)[]
  ): Promise<unknown>;
  getFirstAsync<T>(
    source: string,
    ...params: (string | number | null)[]
  ): Promise<T | null>;
  getAllAsync<T>(
    source: string,
    ...params: (string | number | null)[]
  ): Promise<T[]>;
}

export type OpenDatabase = (name: string) => Promise<SqliteDatabase>;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS rooms (
  room_id TEXT PRIMARY KEY NOT NULL,
  since_seq INTEGER NOT NULL DEFAULT 0,
  joined INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS messages (
  room_id TEXT NOT NULL,
  client_msg_id TEXT NOT NULL,
  server_msg_id TEXT,
  sender_id TEXT NOT NULL,
  body TEXT NOT NULL,
  seq INTEGER,
  update_seq INTEGER,
  created_at_unix_ms INTEGER NOT NULL,
  edited_at_unix_ms INTEGER,
  deleted INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL,
  PRIMARY KEY (room_id, client_msg_id)
);
CREATE INDEX IF NOT EXISTS idx_messages_server ON messages(room_id, server_msg_id);
CREATE TABLE IF NOT EXISTS receipts (
  room_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  last_read_seq INTEGER NOT NULL,
  updated_at_unix_ms INTEGER NOT NULL,
  PRIMARY KEY (room_id, user_id)
);
CREATE TABLE IF NOT EXISTS outbox (
  room_id TEXT NOT NULL,
  client_msg_id TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at_unix_ms INTEGER NOT NULL,
  attempts INTEGER NOT NULL,
  next_attempt_at_unix_ms INTEGER NOT NULL,
  PRIMARY KEY (room_id, client_msg_id)
);
`;

/** SQLite-backed Storage for React Native / Expo. */
export class SqliteStorage implements Storage {
  private db: SqliteDatabase | null = null;

  constructor(
    private readonly openDatabase: OpenDatabase,
    private readonly dbName = "omnichat.db",
  ) {}

  async open(): Promise<void> {
    if (this.db) return;
    this.db = await this.openDatabase(this.dbName);
    await this.db.execAsync(SCHEMA);
    await this.migrateMessageColumns();
  }

  private async migrateMessageColumns(): Promise<void> {
    const db = this.requireDb();
    const alters = [
      "ALTER TABLE messages ADD COLUMN update_seq INTEGER",
      "ALTER TABLE messages ADD COLUMN edited_at_unix_ms INTEGER",
      "ALTER TABLE messages ADD COLUMN deleted INTEGER NOT NULL DEFAULT 0",
    ];
    for (const sql of alters) {
      try {
        await db.execAsync(sql);
      } catch {
        /* column may already exist */
      }
    }
  }

  async close(): Promise<void> {
    this.db = null;
  }

  private requireDb(): SqliteDatabase {
    if (!this.db) throw new Error("SqliteStorage not open");
    return this.db;
  }

  async getRoomMeta(roomId: string): Promise<RoomMeta | undefined> {
    const row = await this.requireDb().getFirstAsync<{
      room_id: string;
      since_seq: number;
      joined: number;
    }>("SELECT room_id, since_seq, joined FROM rooms WHERE room_id = ?", roomId);
    if (!row) return undefined;
    return {
      roomId: row.room_id,
      sinceSeq: row.since_seq,
      joined: row.joined === 1,
    };
  }

  async putRoomMeta(meta: RoomMeta): Promise<void> {
    await this.requireDb().runAsync(
      `INSERT INTO rooms (room_id, since_seq, joined) VALUES (?, ?, ?)
       ON CONFLICT(room_id) DO UPDATE SET since_seq = excluded.since_seq, joined = excluded.joined`,
      meta.roomId,
      meta.sinceSeq,
      meta.joined ? 1 : 0,
    );
  }

  async listJoinedRooms(): Promise<RoomMeta[]> {
    const rows = await this.requireDb().getAllAsync<{
      room_id: string;
      since_seq: number;
      joined: number;
    }>("SELECT room_id, since_seq, joined FROM rooms WHERE joined = 1");
    return rows.map((r) => ({
      roomId: r.room_id,
      sinceSeq: r.since_seq,
      joined: true,
    }));
  }

  async upsertMessage(msg: StoredMessage): Promise<void> {
    const db = this.requireDb();
    const existing = await db.getFirstAsync<{
      server_msg_id: string | null;
      seq: number | null;
      update_seq: number | null;
      edited_at_unix_ms: number | null;
      deleted: number | null;
      status: string;
      sender_id: string;
      body: string;
      created_at_unix_ms: number;
    }>(
      "SELECT server_msg_id, seq, update_seq, edited_at_unix_ms, deleted, status, sender_id, body, created_at_unix_ms FROM messages WHERE room_id = ? AND client_msg_id = ?",
      msg.roomId,
      msg.clientMsgId,
    );

    let status = msg.status;
    let serverMsgId = msg.serverMsgId ?? existing?.server_msg_id ?? null;
    let seq = msg.seq ?? existing?.seq ?? null;
    let updateSeq = msg.updateSeq ?? existing?.update_seq ?? seq;
    let editedAt = msg.editedAtUnixMs ?? existing?.edited_at_unix_ms ?? null;
    let deleted = 0;
    if (msg.deleted === true) deleted = 1;
    else if (msg.deleted === false) deleted = 0;
    else if (existing?.deleted === 1) deleted = 1;
    if (existing?.status === "confirmed" && msg.status === "pending") {
      status = "confirmed";
    }

    await db.runAsync(
      `INSERT INTO messages (room_id, client_msg_id, server_msg_id, sender_id, body, seq, update_seq, created_at_unix_ms, edited_at_unix_ms, deleted, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(room_id, client_msg_id) DO UPDATE SET
         server_msg_id = excluded.server_msg_id,
         sender_id = excluded.sender_id,
         body = excluded.body,
         seq = excluded.seq,
         update_seq = excluded.update_seq,
         created_at_unix_ms = excluded.created_at_unix_ms,
         edited_at_unix_ms = excluded.edited_at_unix_ms,
         deleted = excluded.deleted,
         status = excluded.status`,
      msg.roomId,
      msg.clientMsgId,
      serverMsgId,
      msg.senderId,
      msg.body,
      seq,
      updateSeq,
      msg.createdAtUnixMs,
      editedAt,
      deleted,
      status,
    );
  }

  async getMessageByClientId(
    roomId: string,
    clientMsgId: string,
  ): Promise<StoredMessage | undefined> {
    const row = await this.requireDb().getFirstAsync<MsgRow>(
      "SELECT * FROM messages WHERE room_id = ? AND client_msg_id = ?",
      roomId,
      clientMsgId,
    );
    return row ? rowToMsg(row) : undefined;
  }

  async getMessageByServerId(
    roomId: string,
    serverMsgId: string,
  ): Promise<StoredMessage | undefined> {
    const row = await this.requireDb().getFirstAsync<MsgRow>(
      "SELECT * FROM messages WHERE room_id = ? AND server_msg_id = ?",
      roomId,
      serverMsgId,
    );
    return row ? rowToMsg(row) : undefined;
  }

  async listMessages(roomId: string): Promise<StoredMessage[]> {
    const rows = await this.requireDb().getAllAsync<MsgRow>(
      `SELECT * FROM messages WHERE room_id = ?
       ORDER BY CASE WHEN seq IS NULL THEN 1 ELSE 0 END, seq ASC, created_at_unix_ms ASC`,
      roomId,
    );
    return rows.map(rowToMsg);
  }

  async upsertReceipt(receipt: StoredReceipt): Promise<void> {
    const db = this.requireDb();
    const existing = await db.getFirstAsync<{ last_read_seq: number }>(
      "SELECT last_read_seq FROM receipts WHERE room_id = ? AND user_id = ?",
      receipt.roomId,
      receipt.userId,
    );
    if (existing && existing.last_read_seq >= receipt.lastReadSeq) return;
    await db.runAsync(
      `INSERT INTO receipts (room_id, user_id, last_read_seq, updated_at_unix_ms)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(room_id, user_id) DO UPDATE SET
         last_read_seq = excluded.last_read_seq,
         updated_at_unix_ms = excluded.updated_at_unix_ms`,
      receipt.roomId,
      receipt.userId,
      receipt.lastReadSeq,
      receipt.updatedAtUnixMs,
    );
  }

  async listReceipts(roomId: string): Promise<StoredReceipt[]> {
    const rows = await this.requireDb().getAllAsync<{
      room_id: string;
      user_id: string;
      last_read_seq: number;
      updated_at_unix_ms: number;
    }>("SELECT * FROM receipts WHERE room_id = ?", roomId);
    return rows.map((r) => ({
      roomId: r.room_id,
      userId: r.user_id,
      lastReadSeq: r.last_read_seq,
      updatedAtUnixMs: r.updated_at_unix_ms,
    }));
  }

  async enqueueOutbox(item: OutboxItem): Promise<void> {
    await this.requireDb().runAsync(
      `INSERT INTO outbox (room_id, client_msg_id, body, created_at_unix_ms, attempts, next_attempt_at_unix_ms)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(room_id, client_msg_id) DO UPDATE SET
         body = excluded.body,
         attempts = excluded.attempts,
         next_attempt_at_unix_ms = excluded.next_attempt_at_unix_ms`,
      item.roomId,
      item.clientMsgId,
      item.body,
      item.createdAtUnixMs,
      item.attempts,
      item.nextAttemptAtUnixMs,
    );
  }

  async listOutbox(): Promise<OutboxItem[]> {
    const rows = await this.requireDb().getAllAsync<{
      room_id: string;
      client_msg_id: string;
      body: string;
      created_at_unix_ms: number;
      attempts: number;
      next_attempt_at_unix_ms: number;
    }>("SELECT * FROM outbox ORDER BY created_at_unix_ms ASC");
    return rows.map((r) => ({
      roomId: r.room_id,
      clientMsgId: r.client_msg_id,
      body: r.body,
      createdAtUnixMs: r.created_at_unix_ms,
      attempts: r.attempts,
      nextAttemptAtUnixMs: r.next_attempt_at_unix_ms,
    }));
  }

  async updateOutbox(item: OutboxItem): Promise<void> {
    await this.enqueueOutbox(item);
  }

  async removeOutbox(roomId: string, clientMsgId: string): Promise<void> {
    await this.requireDb().runAsync(
      "DELETE FROM outbox WHERE room_id = ? AND client_msg_id = ?",
      roomId,
      clientMsgId,
    );
  }
}

interface MsgRow {
  room_id: string;
  client_msg_id: string;
  server_msg_id: string | null;
  sender_id: string;
  body: string;
  seq: number | null;
  update_seq: number | null;
  created_at_unix_ms: number;
  edited_at_unix_ms: number | null;
  deleted: number | null;
  status: "pending" | "confirmed" | "failed";
}

function rowToMsg(r: MsgRow): StoredMessage {
  return {
    roomId: r.room_id,
    clientMsgId: r.client_msg_id,
    serverMsgId: r.server_msg_id ?? undefined,
    senderId: r.sender_id,
    body: r.body,
    seq: r.seq ?? undefined,
    updateSeq: r.update_seq ?? undefined,
    createdAtUnixMs: r.created_at_unix_ms,
    editedAtUnixMs: r.edited_at_unix_ms ?? undefined,
    deleted: r.deleted === 1,
    status: r.status,
  };
}

/**
 * Create SQLite storage. Pass expo-sqlite's openDatabaseAsync (or compatible).
 *
 * @example
 * import * as SQLite from 'expo-sqlite';
 * import { createSqliteStorage } from '@omnichat/storage-sqlite';
 * const storage = await createSqliteStorage(SQLite.openDatabaseAsync);
 */
export async function createSqliteStorage(
  openDatabase: OpenDatabase,
  dbName = "omnichat.db",
): Promise<Storage> {
  const storage = new SqliteStorage(openDatabase, dbName);
  await storage.open();
  return storage;
}
