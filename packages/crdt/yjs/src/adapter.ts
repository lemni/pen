import type {
  AttributionRange,
  CRDTAdapter,
  CRDTDocument,
} from "@pen/types";
import * as Y from "yjs";

import { createYjsAwareness } from "./awareness";
import {
  asYjsDoc,
  createYjsDocument,
  getDocumentProfile as getPersistedDocumentProfile,
  initBlockMap,
  setDocumentProfile as setPersistedDocumentProfile,
  validateDocument,
} from "./document";
import type { BlockContentType } from "./document";
import { createObserver } from "./events";
import {
  createYjsSnapshot,
  forkDocument,
  mergeDocuments,
  mergeYjsUpdates,
  restoreYjsSnapshot,
} from "./snapshots";
import { createYjsUndoManager } from "./undo";

export interface CRDTDiagnostic {
  code: string;
  message: string;
  severity: "error" | "warning" | "info";
  updateSize?: number;
  timestamp: number;
}

export interface YjsAdapterOptions {
  gc?: boolean;
  onDiagnostic?: (diagnostic: CRDTDiagnostic) => void;
}

function findItemAtOffset(
  ytext: Y.Text,
  targetOffset: number,
): { id: { client: number } } | null {
  let item = (ytext as unknown as { _start: unknown })._start as {
    id: { client: number };
    content: { getLength(): number };
    next: unknown;
    deleted: boolean;
  } | null;

  let offset = 0;
  while (item != null) {
    if (!item.deleted) {
      const len = item.content.getLength();
      if (offset + len > targetOffset) return item;
      offset += len;
    }
    item = item.next as typeof item;
  }
  return null;
}

export function yjsAdapter(options?: YjsAdapterOptions): CRDTAdapter {
  const emitDiagnostic = options?.onDiagnostic ?? (() => {});

  const adapter: CRDTAdapter = {
    createDocument() {
      return createYjsDocument(adapter, options);
    },

    loadDocument(binary: Uint8Array) {
      const doc = createYjsDocument(adapter, options);
      Y.applyUpdate(doc.ydoc, binary);

      const validation = validateDocument(doc.ydoc);

      if (!validation.valid) {
        emitDiagnostic({
          code: "LOAD_VALIDATION_FAILED",
          message: `Document failed validation with ${validation.errors.length} error(s): ${validation.errors.map((e) => e.message).join("; ")}`,
          severity: "error",
          timestamp: Date.now(),
        });
      }

      return doc;
    },

    encodeState(doc) {
      return Y.encodeStateAsUpdate(asYjsDoc(doc).ydoc);
    },

    encodeUpdate(doc, since?) {
      if (since) {
        return Y.encodeStateAsUpdate(asYjsDoc(doc).ydoc, since);
      }
      return Y.encodeStateAsUpdate(asYjsDoc(doc).ydoc);
    },

    applyUpdate(doc, update) {
      try {
        Y.applyUpdate(asYjsDoc(doc).ydoc, update);
      } catch (err) {
        emitDiagnostic({
          code: "MALFORMED_UPDATE",
          message: `Failed to apply CRDT update: ${err instanceof Error ? err.message : String(err)}`,
          severity: "error",
          updateSize: update.byteLength,
          timestamp: Date.now(),
        });
      }
    },

    transact(doc, fn, origin?) {
      asYjsDoc(doc).ydoc.transact(fn, origin ?? "user");
    },

    observe(doc, callback) {
      return createObserver(asYjsDoc(doc), callback);
    },

    getClientId(doc) {
      return asYjsDoc(doc).ydoc.clientID;
    },

    getDocumentProfile(doc) {
      return getPersistedDocumentProfile(doc);
    },

    setDocumentProfile(doc, profile) {
      setPersistedDocumentProfile(doc, profile);
    },

    raw<T>(doc: CRDTDocument): T {
      return asYjsDoc(doc).ydoc as unknown as T;
    },

    createMap() {
      return new Y.Map<unknown>();
    },

    createArray() {
      return new Y.Array<unknown>();
    },

    createText() {
      return new Y.Text();
    },

    initBlockMap(
      doc: CRDTDocument,
      blockId: string,
      blockType: string,
      contentType: BlockContentType,
    ) {
      const blocks = asYjsDoc(doc).penDocument.blocks;
      return initBlockMap(blocks, blockId, blockType, contentType);
    },

    createUndoManager(doc, undoOptions?) {
      return createYjsUndoManager(asYjsDoc(doc), undoOptions);
    },

    createAwareness(doc) {
      return createYjsAwareness(asYjsDoc(doc));
    },

    createSnapshot(doc) {
      return createYjsSnapshot(asYjsDoc(doc));
    },

    restoreSnapshot(doc, snapshot) {
      return restoreYjsSnapshot(adapter, asYjsDoc(doc), snapshot);
    },

    mergeUpdates(updates) {
      return mergeYjsUpdates(updates);
    },

    fork(doc) {
      return forkDocument(adapter, asYjsDoc(doc), options);
    },

    merge(target, source) {
      mergeDocuments(asYjsDoc(target), asYjsDoc(source));
    },

    getAttributionRanges(doc, blockId) {
      const yjsDoc = asYjsDoc(doc);
      const blockMap = yjsDoc.penDocument.blocks.get(blockId) as
        | Y.Map<unknown>
        | undefined;
      if (!blockMap) return [];
      const content = blockMap.get("content");
      if (!(content instanceof Y.Text)) return [];

      const ranges: AttributionRange[] = [];
      let offset = 0;
      const deltas = content.toDelta() as Array<{
        insert: string | object;
        attributes?: Record<string, unknown>;
      }>;
      for (const delta of deltas) {
        const len =
          typeof delta.insert === "string" ? delta.insert.length : 1;
        const item = findItemAtOffset(content, offset);
        if (item) {
          ranges.push({ offset, length: len, clientId: item.id.client });
        }
        offset += len;
      }
      return ranges;
    },
  };

  return adapter;
}
