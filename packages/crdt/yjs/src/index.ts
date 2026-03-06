import type { CRDTAdapter } from "@pen/core";

export interface YjsAdapterOptions {
    gc?: boolean;
}

export function yjsAdapter(_options?: YjsAdapterOptions): CRDTAdapter {
    throw new Error("Not implemented");
}
