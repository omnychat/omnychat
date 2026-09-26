import {
  createContext,
  createElement,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import type {
  ConnectionState,
  OmnyChatClient,
  RoomSnapshot,
} from "@omnychat/client";

const OmnyChatContext = createContext<OmnyChatClient | null>(null);

export interface OmnyChatProviderProps {
  client: OmnyChatClient;
  children: ReactNode;
}

/** Provide an OmnyChatClient to hooks (works in React DOM and React Native). */
export function OmnyChatProvider({ client, children }: OmnyChatProviderProps) {
  return createElement(OmnyChatContext.Provider, { value: client }, children);
}

export function useOmnyChat(): OmnyChatClient {
  const client = useContext(OmnyChatContext);
  if (!client) {
    throw new Error("useOmnyChat must be used within OmnyChatProvider");
  }
  return client;
}

export function useConnection(): ConnectionState {
  const client = useOmnyChat();
  const [state, setState] = useState<ConnectionState>(client.state);
  useEffect(() => client.onConnection(setState), [client]);
  return state;
}

export function useRoom(roomId: string): RoomSnapshot | null {
  const client = useOmnyChat();
  const [snap, setSnap] = useState<RoomSnapshot | null>(null);
  useEffect(() => {
    return client.subscribeRoom(roomId, setSnap);
  }, [client, roomId]);
  return snap;
}

export function useMessages(roomId: string) {
  const snap = useRoom(roomId);
  return snap?.messages ?? [];
}
