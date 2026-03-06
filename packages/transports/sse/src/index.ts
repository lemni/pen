import type { PenTransport } from "@pen/core";

export interface SSETransportOptions {
  url: string;
  headers?: Record<string, string>;
}

export type { PenTransport };

export function sseTransport(_options: SSETransportOptions): PenTransport {
  throw new Error("Not implemented");
}
