/**
 * Unit tests for sync helpers: cursor bump semantics via MemoryStorage
 * and outbox lifecycle without a live gateway.
 */
import { createMemoryStorage } from "../storage/memory.js";
import { createOmniChat } from "./client.js";

async function test(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    console.log(`ok — ${name}`);
  } catch (err) {
    console.error(`FAIL — ${name}`);
    console.error(err);
    process.exitCode = 1;
  }
}

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

await test("sendMessage queues optimistic outbox without connection", async () => {
  const storage = createMemoryStorage();
  const client = createOmniChat({
    url: "ws://localhost:9/v1/ws",
    tokenProvider: async () => "unused",
    storage,
  });
  await storage.open();
  // Don't connect — optimistic local write only
  const id = await client.sendMessage("lobby", "hello");
  assert(!!id, "client msg id");
  const msgs = await storage.listMessages("lobby");
  assert(msgs.length === 1, "one local message");
  assert(msgs[0]!.status === "pending", "pending");
  assert(msgs[0]!.body === "hello", "body");
  const outbox = await storage.listOutbox();
  assert(outbox.length === 1, "outbox has item");
  assert(outbox[0]!.clientMsgId === id, "same id");
});

await test("subscribeRoom emits snapshot from storage", async () => {
  const storage = createMemoryStorage();
  await storage.open();
  await storage.putRoomMeta({ roomId: "lobby", sinceSeq: 1, joined: true });
  await storage.upsertMessage({
    roomId: "lobby",
    clientMsgId: "c1",
    serverMsgId: "s1",
    senderId: "alice",
    body: "hi",
    seq: 1,
    createdAtUnixMs: 1,
    status: "confirmed",
  });
  const client = createOmniChat({
    url: "ws://localhost:9/v1/ws",
    tokenProvider: async () => "unused",
    storage,
  });
  const snap = await new Promise<{ messages: { body: string }[] }>((resolve) => {
    client.subscribeRoom("lobby", (s) => resolve(s));
  });
  assert(snap.messages.length === 1, "snapshot messages");
  assert(snap.messages[0]!.body === "hi", "body");
});

if (!process.exitCode) {
  console.log("\nAll sync unit tests passed.");
}
