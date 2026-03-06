import type { PenTransport } from "@pen/core";

export type { PenTransport };

export function directTransport(): PenTransport {
  throw new Error("Not implemented");
}
