import { decodeEnvelope, encodeEnvelope, type Envelope } from "./codec.js";

export type WebSocketConstructor = new (
  url: string,
  protocols?: string | string[],
) => WebSocketLike;

export interface WebSocketLike {
  readonly readyState: number;
  binaryType: string;
  onopen: ((ev: unknown) => void) | null;
  onclose: ((ev: { code: number; reason: string }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  send(data: ArrayBuffer | Uint8Array | string): void;
  close(code?: number, reason?: string): void;
}

const OPEN = 1;

export interface TransportOptions {
  url: string;
  WebSocketImpl?: WebSocketConstructor;
  onEnvelope: (env: Envelope) => void;
  onOpen?: () => void;
  onClose?: (info: { code: number; reason: string }) => void;
  onError?: (err: unknown) => void;
}

/** Binary WebSocket transport with injectable WebSocket constructor (browser / RN / ws). */
export class Transport {
  private ws: WebSocketLike | null = null;
  private readonly opts: TransportOptions;

  constructor(opts: TransportOptions) {
    this.opts = opts;
  }

  get connected(): boolean {
    return this.ws != null && this.ws.readyState === OPEN;
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const Impl =
        this.opts.WebSocketImpl ??
        (globalThis as { WebSocket?: WebSocketConstructor }).WebSocket;
      if (!Impl) {
        reject(
          new Error(
            "No WebSocket implementation; pass WebSocketImpl (e.g. from 'ws' in Node)",
          ),
        );
        return;
      }

      const ws = new Impl(this.opts.url);
      this.ws = ws;
      ws.binaryType = "arraybuffer";

      let settled = false;
      ws.onopen = () => {
        if (!settled) {
          settled = true;
          this.opts.onOpen?.();
          resolve();
        }
      };
      ws.onerror = (ev) => {
        this.opts.onError?.(ev);
        if (!settled) {
          settled = true;
          reject(new Error("WebSocket connection failed"));
        }
      };
      ws.onclose = (ev) => {
        this.ws = null;
        this.opts.onClose?.({ code: ev.code, reason: ev.reason });
        if (!settled) {
          settled = true;
          reject(new Error(`WebSocket closed: ${ev.code} ${ev.reason}`));
        }
      };
      ws.onmessage = (ev) => {
        try {
          const bytes = toUint8Array(ev.data);
          if (!bytes) return;
          const env = decodeEnvelope(bytes);
          this.opts.onEnvelope(env);
        } catch (err) {
          this.opts.onError?.(err);
        }
      };
    });
  }

  send(env: Envelope): void {
    if (!this.ws || this.ws.readyState !== OPEN) {
      throw new Error("WebSocket not connected");
    }
    this.ws.send(encodeEnvelope(env));
  }

  close(): void {
    if (this.ws) {
      try {
        this.ws.close(1000, "client close");
      } catch {
        /* ignore */
      }
      this.ws = null;
    }
  }
}

function toUint8Array(data: unknown): Uint8Array | null {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (typeof Buffer !== "undefined" && Buffer.isBuffer(data)) {
    return new Uint8Array(data);
  }
  return null;
}
