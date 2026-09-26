import { create, fromBinary, toBinary } from "@bufbuild/protobuf";
import {
  AuthSchema,
  DeleteMessageSchema,
  EditMessageSchema,
  EnvelopeSchema,
  JoinRoomSchema,
  LeaveRoomSchema,
  ReadReceiptSchema,
  SendMessageSchema,
  SyncRoomSchema,
  TypingSchema,
  type Envelope,
} from "../proto/omnychat/v1/omnychat_pb.js";

export type { Envelope };
export * from "../proto/omnychat/v1/omnychat_pb.js";

export function encodeEnvelope(env: Envelope): Uint8Array {
  return toBinary(EnvelopeSchema, env);
}

export function decodeEnvelope(bytes: Uint8Array): Envelope {
  return fromBinary(EnvelopeSchema, bytes);
}

export function makeAuth(requestId: bigint, token: string): Envelope {
  return create(EnvelopeSchema, {
    requestId,
    payload: {
      case: "auth",
      value: create(AuthSchema, { token }),
    },
  });
}

export function makeJoinRoom(requestId: bigint, roomId: string): Envelope {
  return create(EnvelopeSchema, {
    requestId,
    payload: {
      case: "joinRoom",
      value: create(JoinRoomSchema, { roomId }),
    },
  });
}

export function makeLeaveRoom(requestId: bigint, roomId: string): Envelope {
  return create(EnvelopeSchema, {
    requestId,
    payload: {
      case: "leaveRoom",
      value: create(LeaveRoomSchema, { roomId }),
    },
  });
}

export function makeSendMessage(
  requestId: bigint,
  roomId: string,
  clientMsgId: string,
  body: string,
): Envelope {
  return create(EnvelopeSchema, {
    requestId,
    payload: {
      case: "sendMessage",
      value: create(SendMessageSchema, { roomId, clientMsgId, body }),
    },
  });
}

export function makeEditMessage(
  requestId: bigint,
  roomId: string,
  serverMsgId: string,
  body: string,
): Envelope {
  return create(EnvelopeSchema, {
    requestId,
    payload: {
      case: "editMessage",
      value: create(EditMessageSchema, { roomId, serverMsgId, body }),
    },
  });
}

export function makeDeleteMessage(
  requestId: bigint,
  roomId: string,
  serverMsgId: string,
): Envelope {
  return create(EnvelopeSchema, {
    requestId,
    payload: {
      case: "deleteMessage",
      value: create(DeleteMessageSchema, { roomId, serverMsgId }),
    },
  });
}

export function makeSyncRoom(
  requestId: bigint,
  roomId: string,
  sinceSeq: bigint,
  limit = 500,
): Envelope {
  return create(EnvelopeSchema, {
    requestId,
    payload: {
      case: "syncRoom",
      value: create(SyncRoomSchema, { roomId, sinceSeq, limit }),
    },
  });
}

export function makeTyping(
  requestId: bigint,
  roomId: string,
  isTyping: boolean,
): Envelope {
  return create(EnvelopeSchema, {
    requestId,
    payload: {
      case: "typing",
      value: create(TypingSchema, { roomId, isTyping }),
    },
  });
}

export function makeReadReceipt(
  requestId: bigint,
  roomId: string,
  lastReadSeq: bigint,
): Envelope {
  return create(EnvelopeSchema, {
    requestId,
    payload: {
      case: "readReceipt",
      value: create(ReadReceiptSchema, { roomId, lastReadSeq }),
    },
  });
}

export function seqToNumber(seq: bigint | number | undefined): number {
  if (seq == null) return 0;
  if (typeof seq === "number") return seq;
  return Number(seq);
}
