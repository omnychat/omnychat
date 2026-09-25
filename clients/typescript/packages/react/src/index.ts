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
  OmniChatClient,
  RoomSnapshot,
} from "@omnichat/client";

const OmniChatContext = createContext<OmniChatClient | null>(null);

export interface OmniChatProviderProps {
  client: OmniChatClient;
  children: ReactNode;
}

/** Provide an OmniChatClient to hooks (works in React DOM and React Native). */
export function OmniChatProvider({ client, children }: OmniChatProviderProps) {
  return createElement(OmniChatContext.Provider, { value: client }, children);
}

export function useOmniChat(): OmniChatClient {
  const client = useContext(OmniChatContext);
  if (!client) {
    throw new Error("useOmniChat must be used within OmniChatProvider");
  }
  return client;
}

export function useConnection(): ConnectionState {
  const client = useOmniChat();
  const [state, setState] = useState<ConnectionState>(client.state);
  useEffect(() => client.onConnection(setState), [client]);
  return state;
}

export function useRoom(roomId: string): RoomSnapshot | null {
  const client = useOmniChat();
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
