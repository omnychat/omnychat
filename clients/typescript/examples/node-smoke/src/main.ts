/**
 * Smoke test against a local OmniChat gateway.
 *
 * Usage (gateway must be running on :8080):
 *   OMNICHAT_JWT_SECRET=dev-secret-change-me npm start -w @omnichat/node-smoke
 */
import { SignJWT } from "jose";
import WebSocket from "ws";
import {
  createMemoryStorage,
  createOmniChat,
  type WebSocketConstructor,
} from "@omnichat/client";

const base = process.env.OMNICHAT_HTTP ?? "http://localhost:8080";
const wsUrl = process.env.OMNICHAT_WS ?? "ws://localhost:8080/v1/ws";
const secret = process.env.OMNICHAT_JWT_SECRET ?? "dev-secret-change-me";
const room = process.env.OMNICHAT_ROOM ?? "lobby";
const sub = process.env.OMNICHAT_SUB ?? "smoke-user";

async function mintToken(): Promise<string> {
  const key = new TextEncoder().encode(secret);
  return new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(sub)
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(key);
}

async function ensureRoom(): Promise<void> {
  const token = await mintToken();
  const res = await fetch(`${base}/v1/rooms`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ id: room, name: room }),
  });
  if (!res.ok && res.status !== 409) {
    const text = await res.text();
    console.warn(`create room: ${res.status} ${text}`);
  }
}

async function main(): Promise<void> {
  await ensureRoom();

  const storage = createMemoryStorage();
  const client = createOmniChat({
    url: wsUrl,
    tokenProvider: mintToken,
    storage,
    WebSocketImpl: WebSocket as unknown as WebSocketConstructor,
  });

  client.onConnection((s) => console.log("connection:", s));

  await client.connect();
  console.log("authed as", client.currentUserId);

  await client.joinRoom(room);
  console.log("joined", room);

  const unsub = client.subscribeRoom(room, (snap) => {
    console.log(
      `room ${snap.roomId}: ${snap.messages.length} messages, sinceSeq=${snap.sinceSeq}`,
    );
  });

  const id = await client.sendMessage(room, `smoke ${new Date().toISOString()}`);
  console.log("sent client_msg_id=", id);

  // Wait for ack / confirmation
  await new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout waiting for confirm")), 10_000);
    const stop = client.subscribeRoom(room, (snap) => {
      const msg = snap.messages.find((m) => m.clientMsgId === id);
      if (msg?.status === "confirmed" && msg.seq != null) {
        clearTimeout(t);
        stop();
        console.log("confirmed seq=", msg.seq, "server_msg_id=", msg.serverMsgId);
        resolve();
      }
    });
  });

  unsub();
  await client.disconnect();
  console.log("done");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
