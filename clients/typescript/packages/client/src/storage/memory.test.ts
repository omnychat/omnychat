import { createMemoryStorage } from "./memory.js";
import type { StoredMessage } from "../types.js";
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

await test("memory: upsert + list ordered by seq", async () => {
  const s = createMemoryStorage();
  await s.open();
  await s.upsertMessage({
    roomId: "r1",
    clientMsgId: "c2",
    body: "second",
    senderId: "u",
    createdAtUnixMs: 2,
    seq: 2,
    status: "confirmed",
  });
  await s.upsertMessage({
    roomId: "r1",
    clientMsgId: "c1",
    body: "first",
    senderId: "u",
    createdAtUnixMs: 1,
    seq: 1,
    status: "confirmed",
  });
  const list = await s.listMessages("r1");
  assert(list.length === 2, "expected 2 messages");
  assert(list[0]!.clientMsgId === "c1", "seq order");
  assert(list[1]!.clientMsgId === "c2", "seq order");
});

await test("memory: dedupe merge pending -> confirmed", async () => {
  const s = createMemoryStorage();
  await s.open();
  const pending: StoredMessage = {
    roomId: "r1",
    clientMsgId: "c1",
    body: "hi",
    senderId: "me",
    createdAtUnixMs: 1,
    status: "pending",
  };
  await s.upsertMessage(pending);
  await s.upsertMessage({
    ...pending,
    serverMsgId: "s1",
    seq: 5,
    status: "confirmed",
  });
  const got = await s.getMessageByClientId("r1", "c1");
  assert(got?.status === "confirmed", "should be confirmed");
  assert(got?.serverMsgId === "s1", "server id");
  assert(got?.seq === 5, "seq");
  // Re-upsert pending must not downgrade
  await s.upsertMessage(pending);
  const again = await s.getMessageByClientId("r1", "c1");
  assert(again?.status === "confirmed", "must stay confirmed");
});

await test("memory: receipt monotonic max", async () => {
  const s = createMemoryStorage();
  await s.open();
  await s.upsertReceipt({
    roomId: "r1",
    userId: "u",
    lastReadSeq: 3,
    updatedAtUnixMs: 1,
  });
  await s.upsertReceipt({
    roomId: "r1",
    userId: "u",
    lastReadSeq: 2,
    updatedAtUnixMs: 2,
  });
  const list = await s.listReceipts("r1");
  assert(list[0]!.lastReadSeq === 3, "must keep max");
});

await test("memory: outbox enqueue update remove", async () => {
  const s = createMemoryStorage();
  await s.open();
  await s.enqueueOutbox({
    roomId: "r1",
    clientMsgId: "c1",
    body: "x",
    createdAtUnixMs: 1,
    attempts: 0,
    nextAttemptAtUnixMs: 1,
  });
  await s.updateOutbox({
    roomId: "r1",
    clientMsgId: "c1",
    body: "x",
    createdAtUnixMs: 1,
    attempts: 2,
    nextAttemptAtUnixMs: 99,
  });
  let items = await s.listOutbox();
  assert(items[0]!.attempts === 2, "attempts updated");
  await s.removeOutbox("r1", "c1");
  items = await s.listOutbox();
  assert(items.length === 0, "removed");
});

await test("memory: server id lookup", async () => {
  const s = createMemoryStorage();
  await s.open();
  await s.upsertMessage({
    roomId: "r1",
    clientMsgId: "c1",
    serverMsgId: "srv",
    body: "x",
    senderId: "u",
    createdAtUnixMs: 1,
    seq: 1,
    status: "confirmed",
  });
  const got = await s.getMessageByServerId("r1", "srv");
  assert(got?.clientMsgId === "c1", "lookup by server id");
});

if (!process.exitCode) {
  console.log("\nAll storage tests passed.");
}
