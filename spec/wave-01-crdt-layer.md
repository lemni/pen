# Wave 1 — CRDT Layer

**Milestone:** M0 · **Package:** `@pen/crdt-yjs` · **Depends on:** Wave 0

---

## Goal

Implement the `YjsAdapter` — the concrete `CRDTAdapter` backed by Yjs. This is the foundation for all document state. After this wave, you can create a Y.Doc with the `PenDocument` structure, write blocks into it, encode/decode binary state, observe changes, and manage undo.

---

## Current State

`packages/crdt/yjs/src/index.ts` contains a single stub:

```typescript
export function yjsAdapter(_options?: YjsAdapterOptions): CRDTAdapter {
  throw new Error("Not implemented");
}
```

The `dist/` directory contains a stale build from a previous implementation attempt. It has the right shape but was never committed as source. The source must be rebuilt from scratch against the current `@pen/types`.

The `package.json` already has `yjs` and `y-protocols` as dependencies. There is an ESM path mismatch: `exports.import.default` points to `./dist/index.mjs` but tsup emits `./dist/index.js`. This must be fixed.

---

## File Structure

```text
packages/crdt/yjs/src/
  document.ts       Y.Doc initialization, per-block Y.Map factory, type guards
  events.ts         CRDTEvent translation from Yjs transactions
  adapter.ts        yjsAdapter factory (the CRDTAdapter implementation)
  undo.ts           UndoManager factory
  awareness.ts      Awareness wrapper
  snapshots.ts      Snapshot, fork, merge utilities
  index.ts          Package entry (exports)
```

Six focused modules + barrel. No `utils.ts`, no shared state, no circular dependencies.

### Import DAG

```text
document.ts    ← (yjs)
events.ts      ← document.ts, (yjs)
undo.ts        ← document.ts, (yjs)
awareness.ts   ← document.ts, (y-protocols)
snapshots.ts   ← document.ts, (yjs)
adapter.ts     ← document.ts, events.ts, undo.ts, awareness.ts, snapshots.ts, (yjs)
index.ts       ← adapter.ts, document.ts
```

`adapter.ts` is the composition root — it imports all other modules and wires them together. No other module imports `adapter.ts`.

---

## Internal Types

These types are internal to `@pen/crdt-yjs`. They are not part of `@pen/core`. They give internal modules full access to Yjs types while the public API stays abstract (`CRDTDocument`).

### `YjsCRDTDocument`

The concrete runtime value returned by `createDocument()` and `loadDocument()`. Externally typed as `CRDTDocument`; internal modules cast via the `asYjsDoc()` helper.

```typescript
import type { CRDTAdapter, CRDTDocument, PenDocument } from '@pen/types';
import * as Y from 'yjs';

interface YjsCRDTDocument extends CRDTDocument {
  readonly adapter: CRDTAdapter;
  readonly ydoc: Y.Doc;
  readonly penDocument: YjsPenDocument;
}

interface YjsPenDocument extends PenDocument {
  readonly blockOrder: Y.Array<string>;
  readonly blocks: Y.Map<Y.Map<unknown>>;
  readonly apps: Y.Map<Y.Map<unknown>>;
  readonly metadata: Y.Map<unknown>;
  readonly adapter: CRDTAdapter;
}
```

### `asYjsDoc` helper

```typescript
function asYjsDoc(doc: CRDTDocument): YjsCRDTDocument {
  return doc as YjsCRDTDocument;
}
```

No runtime check — this is a type assertion. All `CRDTDocument` values produced by this adapter are `YjsCRDTDocument` instances.

### Per-block Y.Map structure

Every block in the `blocks` Y.Map has this shape. Content keys are mutually exclusive, determined by the block's content type.

```text
Y.Map (block) {
  'type':         string                     // block type name
  'props':        Y.Map<unknown>             // always present, schema-validated properties
  'content':      Y.Text                     // present when content: 'inline'
  'children':     Y.Array<string>            // present when content: BlockSchema[] (nested)
  'tableContent': Y.Array<Y.Map>             // present when content: 'table'
  'meta':         Y.Map<unknown>             // always present, keyed by extension namespace
  'layout':       Y.Map<unknown>             // optional, for layout containers (M2)
}
```

#### Table content structure

When `content: 'table'`, the block stores rows as `Y.Array<Y.Map>` under `tableContent`. Each row Y.Map has this shape:

```text
Y.Map (table row) {
  'id':    string                // row identifier
  'cells': Y.Array<Y.Map>       // ordered cells in this row
}

Y.Map (table cell) {
  'id':      string              // cell identifier
  'content': Y.Text              // cell text content (inline formatting via Y.Text attributes)
  'colspan': number              // column span (default: 1, omitted when 1)
  'rowspan': number              // row span (default: 1, omitted when 1)
  'header':  boolean             // whether this cell is a header cell (omitted when false)
}
```

Each cell's `content` is a `Y.Text` — the same type used for inline block content. This means cells support the same inline formatting (bold, italic, links, etc.) as paragraph blocks. Cell-level operations (`insert-table-row`, `delete-table-column`, `merge-table-cells`, `split-table-cell`) manipulate this structure directly.

The table field editor (Wave 5) manages cell focus and tab navigation. Cell selection (`CellSelection` from Wave 0) identifies anchor and head cells for multi-cell operations.

---

## Module-by-Module Spec

All paths relative to `packages/crdt/yjs/src/`.

### 1. `document.ts` — Y.Doc Initialization and Block Factory

Owns Y.Doc creation and the per-block Y.Map factory. This is the only module that creates Yjs shared types.

**Exports:**

- `createYjsDocument(adapter, options?)` — creates a fresh `Y.Doc`, initializes the four shared types, returns `YjsCRDTDocument`.
- `wrapYjsDocument(adapter, ydoc)` — wraps an existing `Y.Doc` (from `loadDocument`, `restoreSnapshot`, or `fork`) into a `YjsCRDTDocument`. Does not create shared types — they already exist in the Y.Doc.
- `initBlockMap(blocks, blockId, blockType, contentType)` — creates a per-block Y.Map with the correct structure and inserts it into the `blocks` map.
- `isYjsCRDTDocument(doc)` — type guard: `'ydoc' in doc && doc.ydoc instanceof Y.Doc`.
- Constants: `BLOCK_ORDER = 'blockOrder'`, `BLOCKS = 'blocks'`, `APPS = 'apps'`, `METADATA = 'metadata'`.

**`createYjsDocument` implementation:**

```typescript
function createYjsDocument(
  adapter: CRDTAdapter,
  options?: YjsAdapterOptions,
): YjsCRDTDocument {
  const ydoc = new Y.Doc({ gc: options?.gc ?? true });
  const blockOrder = ydoc.getArray<string>(BLOCK_ORDER);
  const blocks = ydoc.getMap<Y.Map<unknown>>(BLOCKS);
  const apps = ydoc.getMap<Y.Map<unknown>>(APPS);
  const metadata = ydoc.getMap(METADATA);

  const penDocument: YjsPenDocument = {
    blockOrder,
    blocks,
    apps,
    metadata,
    adapter,
  };

  return { adapter, ydoc, penDocument };
}
```

`Y.Doc.getArray()` and `Y.Doc.getMap()` are idempotent — calling them on an existing Y.Doc returns the existing shared type (they don't create duplicates). This is why `wrapYjsDocument` uses the same calls:

```typescript
function wrapYjsDocument(
  adapter: CRDTAdapter,
  ydoc: Y.Doc,
): YjsCRDTDocument {
  const blockOrder = ydoc.getArray<string>(BLOCK_ORDER);
  const blocks = ydoc.getMap<Y.Map<unknown>>(BLOCKS);
  const apps = ydoc.getMap<Y.Map<unknown>>(APPS);
  const metadata = ydoc.getMap(METADATA);

  const penDocument: YjsPenDocument = {
    blockOrder,
    blocks,
    apps,
    metadata,
    adapter,
  };

  return { adapter, ydoc, penDocument };
}
```

> **`wrapYjsDocument` is a public export** for advanced consumers that construct their own `Y.Doc` — e.g., `@pen/test` building test documents, or network providers that receive a `Y.Doc` from a WebSocket sync layer. It does not create shared types; it assumes the Y.Doc already has the `PenDocument` structure (the `getArray`/`getMap` calls will create them as empty if not present, which is safe for fresh docs).

**`initBlockMap` implementation:**

Creates a per-block Y.Map with the correct structure based on content type and inserts it into the `blocks` map. Called by the schema engine (Wave 2) and test harness.

```typescript
type BlockContentType = 'inline' | 'table' | 'nested' | 'none';

function initBlockMap(
  blocks: Y.Map<Y.Map<unknown>>,
  blockId: string,
  blockType: string,
  contentType: BlockContentType = 'inline',
): Y.Map<unknown> {
  const blockMap = new Y.Map<unknown>();
  blockMap.set('type', blockType);
  blockMap.set('props', new Y.Map<unknown>());
  blockMap.set('meta', new Y.Map<unknown>());

  switch (contentType) {
    case 'inline':
      blockMap.set('content', new Y.Text());
      break;
    case 'table':
      blockMap.set('tableContent', new Y.Array<Y.Map<unknown>>());
      break;
    case 'nested':
      blockMap.set('children', new Y.Array<string>());
      break;
    case 'none':
      break;
  }

  blocks.set(blockId, blockMap);
  return blockMap;
}
```

> **Props are intentionally empty.** Normalization rule 4 (Spec Section 4.8) states that prop values equal to their schema default are omitted from CRDT storage. Defaults are derived from the `BlockSchema` at read time by the `BlockHandle` API (Wave 2). Storing defaults would bloat CRDT state and cause spurious diffs during collaborative merges.
>
> **`BlockContentType` mapping from `@pen/core`.** The `@pen/core` `ContentType` union includes `BlockSchema[]` for nested content. Callers map this to `'nested'` when calling `initBlockMap`: `Array.isArray(contentType) ? 'nested' : contentType`. `BlockContentType` is exported from the package entry for callers that need to type this argument.

**Key detail:** `meta` is always created, even if no extensions use it. This avoids lazy-init checks in extension code. The `meta` map is keyed by extension namespace (`block.meta.get('ai')`, `block.meta.get('comments')`) — see Spec Section 4.6.

**Edge case — `gc` option:** Defaults to `true` for memory efficiency. Set to `false` when snapshots/version-history are needed — garbage collection destroys deleted content, breaking `Y.createDocFromSnapshot()`. The `YjsAdapterOptions.gc` flag controls this.

#### Lifecycle

`Y.Doc` instances allocate internal state (event listeners, item graph, client table) that must be released when the document is no longer needed. The `Y.Doc.destroy()` method handles this cleanup.

**Ownership contract:** The consumer that calls `createDocument()` or `loadDocument()` owns the lifecycle. When the document is discarded (editor unmounted, tab closed, session ended), call `adapter.raw<Y.Doc>(doc).destroy()`. This is the `Editor`'s responsibility (Wave 3), not the adapter's — the adapter has no way to know when a document is "done".

The same applies to forked documents: each fork is an independent `Y.Doc` that must be destroyed separately when no longer needed.

---

### 2. `events.ts` — CRDTEvent Translation

The most complex module. Bridges Yjs's internal transaction/event model with Pen's `CRDTEvent` interface.

**Exports:**

- `createObserver(doc, callback)` — attaches an observer to the Y.Doc, returns `Unsubscribe`. The callback receives a single `CRDTEvent` object (not a raw Yjs `Transaction`). This is the canonical callback type for `CRDTAdapter.observe()`: `(event: CRDTEvent) => void`. Higher layers that expose event arrays (for example `PenEventMap.change`) wrap this as `[event]`.

**Internal helpers (not exported):**

- `originToOpOrigin(origin)` — maps Yjs transaction origin to `OpOrigin`.
- `extractAffectedBlocks(txn)` — walks `txn.changed` to find all affected block IDs.
- `reconstructOps(txn)` — best-effort reconstruction of `DocumentOp[]` from Yjs deltas.

#### Observer attachment — two-listener architecture

The observer uses two Yjs listeners working in tandem:

1. **`blocks.observeDeep(handler)`** — fires during the transaction, before `afterTransaction`. Captures `YTextEvent.delta` (the incremental change delta) for each changed `Y.Text`, stashing them in a per-transaction map.
2. **`ydoc.on('afterTransaction', handler)`** — fires after all `observeDeep` callbacks complete. Reads the stashed deltas, walks `txn.changed` for block/prop/app changes, and builds the final `CRDTEvent`.

This two-phase design is necessary because `afterTransaction` provides the transaction object (for origin and `changed` map access), but does not expose per-type event deltas. The `observeDeep` callback provides the incremental deltas but fires per-type, not per-transaction. Combining both gives us: one `CRDTEvent` per transaction with correct incremental text deltas.

```typescript
function createObserver(
  doc: YjsCRDTDocument,
  callback: (event: CRDTEvent) => void,
): Unsubscribe {
  const blocksMap = doc.penDocument.blocks;

  let pendingTextDeltas = new Map<string, { delta: any[] }>();

  const deepHandler = (events: Y.YEvent<any>[]) => {
    for (const event of events) {
      if (!(event instanceof Y.YTextEvent)) continue;
      const blockId = resolveBlockId(event.target, blocksMap);
      if (blockId) {
        pendingTextDeltas.set(blockId, { delta: event.delta });
      }
    }
  };

  const txnHandler = (txn: Y.Transaction) => {
    if (txn.changed.size === 0 && pendingTextDeltas.size === 0) {
      return;
    }

    const textDeltas = pendingTextDeltas;
    pendingTextDeltas = new Map();

    const event: CRDTEvent = {
      origin: originToOpOrigin(txn.origin),
      affectedBlocks: extractAffectedBlocks(txn),
      ops: reconstructOps(txn, textDeltas),
      timestamp: Date.now(),
    };
    callback(event);
  };

  blocksMap.observeDeep(deepHandler);
  doc.ydoc.on('afterTransaction', txnHandler);

  return () => {
    blocksMap.unobserveDeep(deepHandler);
    doc.ydoc.off('afterTransaction', txnHandler);
  };
}
```

**Ordering guarantee:** Within a single `Y.transact()`, Yjs fires `observeDeep` callbacks before `afterTransaction`. This means `pendingTextDeltas` is always populated by the time `txnHandler` reads it. The stash is swapped (not cleared) to avoid interference if a callback triggers a nested transaction.

**No-op filter:** Skip transactions where both `txn.changed.size === 0` and no text deltas were captured. Yjs fires `afterTransaction` for read-only transactions too (e.g., encoding state). Without this filter, observers receive noisy no-op events.

#### Origin mapping

Yjs allows any value as transaction origin. Pen constrains to the `OpOrigin` union. Unknown origins (from third-party Yjs code) map to `'extension'`.

```typescript
const KNOWN_ORIGINS: ReadonlySet<string> = new Set([
  'user',
  'ai',
  'collaborator',
  'extension',
  'history',
  'input-rule',
  'app',
  'import',
  'system',
]);

function originToOpOrigin(origin: unknown): OpOrigin {
  if (origin === null || origin === undefined) return 'user';
  if (typeof origin === 'string' && KNOWN_ORIGINS.has(origin))
    return origin as OpOrigin;
  return 'extension';
}
```

#### Affected blocks extraction

Walks `txn.changed` — a `Map<Y.AbstractType, Set<string | null>>` — to identify every block ID that was touched by the transaction.

**Algorithm (three cases):**

1. **Changed type IS the `blocks` Y.Map itself.** The changed keys are block IDs that were added or removed from the top-level blocks map.
2. **Changed type IS the `blockOrder` Y.Array.** The order changed — extract all current block IDs. (Conservatively reports all blocks; a more precise diff would compare before/after arrays, but the extra precision isn't worth the complexity for `affectedBlocks`.)
3. **Changed type is a nested Yjs type** (a block's props Y.Map, content Y.Text, table cell Y.Text, etc.). Walk up the Yjs item tree via `_item.parent` until we find an item whose parent is the `blocks` Y.Map — that item's `parentSub` is the block ID.

```typescript
function resolveBlockId(
  ytype: Y.AbstractType<unknown>,
  blocksMap: Y.Map<unknown>,
): string | null {
  let current: Y.AbstractType<unknown> | null = ytype;
  while (current != null) {
    const item = (current as { _item?: { id: { client: number } } })._item;
    if (item == null) break;
    if (item.parent === blocksMap && item.parentSub != null) {
      return item.parentSub;
    }
    current = item.parent;
  }
  return null;
}

function extractAffectedBlocks(txn: Y.Transaction): string[] {
  const blockIds = new Set<string>();
  const blocksMap = txn.doc.getMap(BLOCKS);
  const blockOrderArray = txn.doc.getArray(BLOCK_ORDER);

  for (const [ytype, keys] of txn.changed) {
    if (ytype === blocksMap) {
      for (const key of keys) {
        if (key !== null) blockIds.add(key);
      }
      continue;
    }
    if (ytype === blockOrderArray) {
      const arr = blockOrderArray.toArray() as string[];
      for (const id of arr) blockIds.add(id);
      continue;
    }
    const blockId = resolveBlockId(ytype, blocksMap);
    if (blockId) blockIds.add(blockId);
  }

  return Array.from(blockIds);
}
```

The tree-walking approach via `_item.parent` handles arbitrarily nested changes — a change to a cell's `Y.Text` inside a table row inside `tableContent` inside a block correctly resolves to the table block's ID.

> **`affectedBlocks` covers blocks only.** As the name implies, `affectedBlocks` reports block IDs — it does not include app changes. Extensions that care about app mutations should inspect `ops` for `create-app` and `delete-app` op types (see Pass 4 below).

**Note on `_item`:** This accesses Yjs internals. The `_item` property is stable across Yjs 13.x and is the standard way to traverse the Yjs item tree. It is used by `Y.UndoManager` itself. If Yjs 14 changes this, the adapter must be updated.

#### Op reconstruction

Three-pass best-effort reconstruction of `DocumentOp[]` from Yjs transaction state.

**Pass 1 — Block-level ops** from `blocks` Y.Map changes:

```typescript
function reconstructOpsFromBlocksMap(
  txn: Y.Transaction,
  blocksMap: Y.Map<Y.Map<unknown>>,
): DocumentOp[] {
  const ops: DocumentOp[] = [];
  const blocksChanges = txn.changed.get(blocksMap);
  if (!blocksChanges) return ops;

  for (const key of blocksChanges) {
    if (key === null) continue;
    const blockMap = blocksMap.get(key);
    if (blockMap) {
      const blockType = blockMap.get('type') as string;
      const propsMap = blockMap.get('props') as Y.Map<unknown> | undefined;
      ops.push({
        type: 'insert-block',
        blockId: key,
        blockType: blockType ?? 'paragraph',
        props: propsMap ? Object.fromEntries(propsMap.entries()) : {},
        position: 'last',
      });
    } else {
      ops.push({ type: 'delete-block', blockId: key });
    }
  }
  return ops;
}
```

**Pass 2 — Prop changes** from nested `props` Y.Map mutations:

Walk `txn.changed`, identify Y.Maps whose `_item.parentSub === 'props'` and whose grandparent is the `blocks` map.

```typescript
function reconstructOpsFromProps(
  txn: Y.Transaction,
  blocksMap: Y.Map<unknown>,
): DocumentOp[] {
  const ops: DocumentOp[] = [];

  for (const [ytype, keys] of txn.changed) {
    if (!(ytype instanceof Y.Map)) continue;
    const item = (ytype as { _item?: { parentSub: string | null; parent: unknown } })._item;
    if (!item || item.parentSub !== 'props') continue;
    const parentBlock = item.parent;
    if (!parentBlock) continue;
    const parentItem = (parentBlock as { _item?: { parent: unknown } })._item;
    if (!parentItem || parentItem.parent !== blocksMap) continue;
    const blockId = parentItem.parentSub as string;
    if (!blockId) continue;

    const changedProps: Record<string, unknown> = {};
    for (const key of keys) {
      if (key !== null) changedProps[key] = ytype.get(key);
    }
    if (Object.keys(changedProps).length > 0) {
      ops.push({ type: 'update-block', blockId, props: changedProps });
    }
  }
  return ops;
}
```

**Pass 3 — Text content changes** from stashed `observeDeep` deltas:

Uses the `pendingTextDeltas` map populated by the `observeDeep` listener (see "Observer attachment" above). Each entry maps a block ID to its `YTextEvent.delta` — the incremental change (insert/delete/retain of only the modified content), NOT the full document delta. This correctly produces `insert-text`, `delete-text`, and `format-text` ops.

```typescript
function reconstructOpsFromTextDeltas(
  textDeltas: Map<string, { delta: any[] }>,
): DocumentOp[] {
  const ops: DocumentOp[] = [];
  for (const [blockId, { delta }] of textDeltas) {
    let offset = 0;
    for (const d of delta) {
      if (typeof d.insert === 'string') {
        ops.push({
          type: 'insert-text',
          blockId,
          offset,
          text: d.insert,
          marks: d.attributes,
        });
        offset += d.insert.length;
      } else if (d.delete != null) {
        ops.push({ type: 'delete-text', blockId, offset, length: d.delete });
      } else if (d.retain != null) {
        if (d.attributes) {
          ops.push({
            type: 'format-text',
            blockId,
            offset,
            length: d.retain,
            marks: d.attributes,
          });
        }
        offset += d.retain;
      }
    }
  }
  return ops;
}
```

**Why `observeDeep` deltas instead of `toDelta()`:** `Y.Text.toDelta()` returns the **full content** of the text type, not the incremental change. A single character insert in a 5000-character block would produce ops for all 5001 characters. The `YTextEvent.delta` from `observeDeep` contains only what changed — e.g., `[{ retain: 42 }, { insert: 'x' }]` for a single character insert at position 42. This also naturally captures `delete` entries, which are absent from `toDelta()` (it returns the current state, not the diff).

**Pass 4 — App-level ops** from `apps` Y.Map changes:

Mirrors Pass 1 for the `apps` shared type. Produces `create-app` and `delete-app` ops when apps are added or removed.

```typescript
function reconstructOpsFromAppsMap(
  txn: Y.Transaction,
  appsMap: Y.Map<Y.Map<unknown>>,
): DocumentOp[] {
  const ops: DocumentOp[] = [];
  const appsChanges = txn.changed.get(appsMap as Y.AbstractType<unknown>);
  if (!appsChanges) return ops;

  for (const key of appsChanges) {
    if (key === null) continue;
    const appMap = appsMap.get(key);
    if (appMap) {
      const appType = (appMap.get('type') as string) ?? 'unknown';
      const placementMap = appMap.get('placement') as Record<string, unknown> | undefined;
      const configMap = appMap.get('config') as Y.Map<unknown> | undefined;
      ops.push({
        type: 'create-app',
        appId: key,
        appType,
        placement: placementMap ?? { mode: 'anchored', blockId: '', anchor: 'after' },
        config: configMap ? Object.fromEntries(configMap.entries()) : {},
      });
    } else {
      ops.push({ type: 'delete-app', appId: key });
    }
  }
  return ops;
}
```

**Combined:**

```typescript
function reconstructOps(
  txn: Y.Transaction,
  textDeltas: Map<string, { delta: any[] }>,
): DocumentOp[] {
  const blocksMap = txn.doc.getMap(BLOCKS);
  const appsMap = txn.doc.getMap(APPS);
  return [
    ...reconstructOpsFromBlocksMap(txn, blocksMap as Y.Map<Y.Map<unknown>>),
    ...reconstructOpsFromProps(txn, blocksMap),
    ...reconstructOpsFromTextDeltas(textDeltas),
    ...reconstructOpsFromAppsMap(txn, appsMap as Y.Map<Y.Map<unknown>>),
  ];
}
```

**Limitation:** `CRDTEvent.ops` is best-effort. Complex concurrent merges or `blockOrder` array mutations (`move-block` = delete + insert) produce ops that approximate the original intent. Extensions should use `affectedBlocks` for reliable change detection and `ops` for informational introspection only. This is documented in Spec Section 7.2.

---

### 3. `adapter.ts` — `yjsAdapter` Factory

The composition root. Returns a `CRDTAdapter` object that delegates to all other modules.

**Exports:**

- `yjsAdapter(options?)` — factory function returning `CRDTAdapter`.
- `YjsAdapterOptions` — `{ gc?: boolean }`.

#### `DocumentStore` Methods

The adapter exposes `DocumentStore` methods on the `CRDTAdapter` interface for CRDT-safe type creation. These allow callers (schema engine, apply pipeline) to create Yjs shared types without importing Yjs directly:

```typescript
// On CRDTAdapter (part of the CRDTAdapter interface in @pen/core):
createMap(): unknown;       // → new Y.Map<unknown>()
createArray(): unknown;     // → new Y.Array<unknown>()
createText(): unknown;      // → new Y.Text()
initBlockMap(doc: CRDTDocument, blockId: string, blockType: string, contentType: BlockContentType): unknown;
```

These methods are the ONLY way `@pen/core` runtime code creates CRDT shared types. The schema engine, apply pipeline, and handles module never import `Y.Map`, `Y.Array`, or `Y.Text` directly — they call these factory methods on the adapter. This keeps the abstraction layer intact: swapping `@pen/crdt-yjs` for `@pen/crdt-loro` only requires implementing these four methods with Loro equivalents.

**Implementation:**

The adapter is a closure-captured object. The self-reference pattern (`adapter` references itself inside its methods) is necessary because `createDocument` and `loadDocument` embed `adapter` into the returned `YjsCRDTDocument`.

```typescript
export interface YjsAdapterOptions {
  gc?: boolean;
}

export function yjsAdapter(options?: YjsAdapterOptions): CRDTAdapter {
  const adapter: CRDTAdapter = {
    createDocument() {
      return createYjsDocument(adapter, options);
    },

    loadDocument(binary: Uint8Array) {
      const ydoc = new Y.Doc({ gc: options?.gc ?? true });
      Y.applyUpdate(ydoc, binary);
      return wrapYjsDocument(adapter, ydoc);
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
      Y.applyUpdate(asYjsDoc(doc).ydoc, update);
    },

    transact(doc, fn, origin?) {
      asYjsDoc(doc).ydoc.transact(fn, origin ?? 'user');
    },

    observe(doc, callback) {
      return createObserver(asYjsDoc(doc), callback);
    },

    getClientId(doc) {
      return asYjsDoc(doc).ydoc.clientID;
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

    initBlockMap(doc, blockId, blockType, contentType) {
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
      const blockMap = yjsDoc.penDocument.blocks.get(blockId);
      if (!blockMap) return [];
      const content = blockMap.get('content');
      if (!(content instanceof Y.Text)) return [];

      const ranges: AttributionRange[] = [];
      let offset = 0;
      const deltas = content.toDelta();
      for (const delta of deltas) {
        const len = typeof delta.insert === 'string' ? delta.insert.length : 1;
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
```

**Key implementation details:**

- **`transact` defaults to `'user'` origin.** When no origin is provided, the transaction is tagged as `'user'`. This ensures the UndoManager always captures these mutations (it tracks `'user'` and `'ai'`). Passing `undefined` to Yjs would make the transaction untracked.
- **`encodeUpdate(doc, since?)`** — the `since` parameter IS a state vector (`Uint8Array`), not a document. This matches the `CRDTAdapter` interface from Spec Section 10.1. Yjs's `encodeStateAsUpdate(doc, stateVector)` produces only the operations the receiver is missing.
- **`raw<T>(doc)`** — the escape hatch for hot-path code (field editor, streaming, selection). Returns the underlying `Y.Doc`. Only the six modules in the `raw()` blast radius budget (Spec Section 10.1) should call this.

---

### 4. `undo.ts` — Undo Manager Factory

Creates a `Y.UndoManager` scoped to the document's primary shared types.

**Exports:**

- `createYjsUndoManager(doc, options?)` — returns `CRDTUndoManager`.

**Scope:** `[blockOrder, blocks]`. These two shared types cover all document content mutations. `apps` and `metadata` are intentionally excluded:

- App config changes are typically user-initiated via dedicated UI (not keyboard-undoable).
- Metadata changes are extension-managed — undo of metadata would break extension state.

**Configuration:**

- `trackedOrigins`: defaults to `new Set(['user', 'ai'])`. The local client's UndoManager tracks both user and AI writes. Collaborator writes (origin `'collaborator'`) are excluded — you never undo someone else's work with Ctrl+Z. See Spec Section 9.2.
- `captureTimeout`: defaults to `0` (no auto-grouping by time). The higher-level `UndoManager` wrapper (Wave 3, Spec Section 9.4) controls idle-timeout grouping via explicit `stopCapturing()` calls at field editor activation, generation boundaries, and idle timeouts.

> Yjs UndoManager matches origins by reference equality. Since Pen only uses string origins (which are interned by the JS engine), this is safe. Non-string origins (objects, symbols) would silently bypass tracking — do not use them.

```typescript
function createYjsUndoManager(
  doc: YjsCRDTDocument,
  options?: UndoManagerOptions,
): CRDTUndoManager {
  const { blockOrder, blocks } = doc.penDocument;
  const trackedOrigins = new Set<string>(
    options?.trackedOrigins ?? ['user', 'ai'],
  );

  const undoManager = new Y.UndoManager([blockOrder, blocks], {
    trackedOrigins,
    captureTimeout: options?.captureTimeout ?? 0,
    doc: doc.ydoc,
  });

  return {
    undo() {
      if (undoManager.undoStack.length === 0) return false;
      undoManager.undo();
      return true;
    },
    redo() {
      if (undoManager.redoStack.length === 0) return false;
      undoManager.redo();
      return true;
    },
    canUndo() {
      return undoManager.undoStack.length > 0;
    },
    canRedo() {
      return undoManager.redoStack.length > 0;
    },
    stopCapturing() {
      undoManager.stopCapturing();
    },
  };
}
```

**Why `undo()` / `redo()` check stack length before calling:** `Y.UndoManager.undo()` is a no-op when the stack is empty, but returning `false` lets callers know nothing happened (Spec Section 9.4: `undo(): boolean`).

**Yjs UndoManager risks** (Spec Section 9.5) — handled at higher layers but documented here for awareness:

1. **Normalization-induced undo pollution.** Mitigated by the normalization idempotency invariant (Wave 2).
2. **Undo of concurrent remote edits.** Mitigated by `trackedOrigins` — only local `'user'` and `'ai'` origins are captured.
3. **Undo of structural operations.** Mitigated by `editor.apply()` executing all ops in a single `Y.transact()` (Wave 3).
4. **UndoManager and deleted types.** Expected behavior — undoing edits to a deleted block is not meaningful.

---

### 5. `awareness.ts` — Awareness Factory

Wraps `y-protocols/awareness.Awareness` into Pen's `Awareness` interface.

**Exports:**

- `createYjsAwareness(doc)` — returns `Awareness`.

```typescript
import { Awareness as YAwareness } from 'y-protocols/awareness';

function createYjsAwareness(doc: YjsCRDTDocument): Awareness {
  const awareness = new YAwareness(doc.ydoc);
  const callbackMap = new WeakMap<Function, Function>();

  return {
    getLocalState(): Record<string, unknown> | null {
      return awareness.getLocalState() as Record<string, unknown> | null;
    },
    setLocalState(state: Record<string, unknown>) {
      awareness.setLocalState(state);
    },
    getStates(): Map<number, Record<string, unknown>> {
      return awareness.getStates();
    },
    on(event: 'change', callback: (changes: AwarenessChangeEvent) => void) {
      const wrapper = (changes: { added: number[]; updated: number[]; removed: number[] }) => {
        callback({ added: changes.added, updated: changes.updated, removed: changes.removed });
      };
      callbackMap.set(callback, wrapper);
      awareness.on(event, wrapper);
    },
    off(event: 'change', callback: (changes: AwarenessChangeEvent) => void) {
      const wrapper = callbackMap.get(callback);
      if (wrapper) {
        awareness.off(event, wrapper as any);
        callbackMap.delete(callback);
      }
    },
    destroy() {
      awareness.destroy();
    },
  };
}
```

> **`on('change')` wraps the y-protocols event.** The y-protocols `Awareness` passes `({ added, updated, removed }, origin)` to handlers. The Pen wrapper extracts the structured payload and passes it to the callback as `AwarenessChangeEvent`. This matches Wave 0's updated `Awareness` interface and enables Wave 8's collaboration extension to efficiently track which clients changed.

**Event mapping:** The `off` handler needs the same function reference to remove the listener. In practice, `off('change', cb)` removes by reference equality. Since the wrapper creates a new closure in `on()`, the `off` implementation must store the original-to-wrapper mapping. Implementation detail: use a `WeakMap<Function, Function>` to map Pen callbacks to their y-protocols wrappers.

**Usage:** Awareness is used for collaborative cursors (Spec Section 6.5) and AI presence state (Spec Section 5.7). The `createAwareness` method is optional on `CRDTAdapter` — consumers who don't need collaboration can skip it.

---

### 6. `snapshots.ts` — Snapshots, Fork, and Merge

Utilities for version history and document branching.

**Exports:**

- `createYjsSnapshot(doc)` — captures current state as `Uint8Array`.
- `restoreYjsSnapshot(adapter, doc, snapshot)` — reconstructs a document at a past point in time.
- `mergeYjsUpdates(updates)` — compacts multiple binary updates into one.
- `forkDocument(adapter, doc)` — creates an independent copy with a new `clientID`.
- `mergeDocuments(target, source)` — applies source's changes to target via differential update.

#### `createYjsSnapshot`

```typescript
function createYjsSnapshot(doc: YjsCRDTDocument): Uint8Array {
  return Y.encodeSnapshot(Y.snapshot(doc.ydoc));
}
```

`Y.snapshot(ydoc)` captures the current state vector + delete set as a `Snapshot` object. `Y.encodeSnapshot()` serializes it to `Uint8Array`.

#### `restoreYjsSnapshot`

```typescript
function restoreYjsSnapshot(
  adapter: CRDTAdapter,
  doc: YjsCRDTDocument,
  snapshot: Uint8Array,
): YjsCRDTDocument {
  const restoredDoc = Y.createDocFromSnapshot(
    doc.ydoc,
    Y.decodeSnapshot(snapshot),
  );
  return wrapYjsDocument(adapter, restoredDoc);
}
```

**Important:** The returned document is effectively read-only. `Y.createDocFromSnapshot` produces a Y.Doc that shares history with the source but represents a frozen point in time. Writes to it create a divergent branch. This is correct for version history viewing (Spec Section 10.2.1).

**Important:** `gc` must be `false` on the source Y.Doc for snapshots to work. If `gc: true`, deleted content is garbage collected and `createDocFromSnapshot` can't reconstruct past states. The `YjsAdapterOptions.gc` flag controls this.

#### `mergeYjsUpdates`

```typescript
function mergeYjsUpdates(updates: Uint8Array[]): Uint8Array {
  return Y.mergeUpdates(updates);
}
```

Operates on raw binary data without loading a `Y.Doc` into memory. Deduplicates overlapping operations and produces a smaller encoding. This is the backing operation for `PenPersistence.compact()` (Spec Section 10.2) — safe to run as a background server task.

#### `forkDocument`

```typescript
function forkDocument(
  adapter: CRDTAdapter,
  doc: YjsCRDTDocument,
  options?: YjsAdapterOptions,
): YjsCRDTDocument {
  const state = Y.encodeStateAsUpdate(doc.ydoc);
  const forkedYdoc = new Y.Doc({ gc: options?.gc ?? doc.ydoc.gc });
  Y.applyUpdate(forkedYdoc, state);
  return wrapYjsDocument(adapter, forkedYdoc);
}
```

The forked doc has a different `clientID` — writes to it are attributed to a new peer. This is critical for branching (Spec Section 10.6): the AI writes to a fork, and when merged back, the writes carry the fork's `clientID`, not the source's.

The `gc` option defaults to the source doc's `gc` setting (via `doc.ydoc.gc`), preserving snapshot capability on forks. An explicit `options.gc` overrides this. Without this, forking a `gc: false` doc would silently produce a `gc: true` fork, breaking snapshots on the forked branch.

#### `mergeDocuments`

```typescript
function mergeDocuments(
  target: YjsCRDTDocument,
  source: YjsCRDTDocument,
): void {
  const stateVector = Y.encodeStateVector(target.ydoc);
  const diff = Y.encodeStateAsUpdate(source.ydoc, stateVector);
  Y.applyUpdate(target.ydoc, diff);
}
```

Efficient differential merge — only missing operations are transferred. Updates are commutative, associative, and idempotent (Spec Section 10.6). Merge order doesn't matter; merging the same source twice is a no-op the second time.

---

### 7. `index.ts` — Package Entry

```typescript
export { yjsAdapter } from './adapter.js';
export type { YjsAdapterOptions } from './adapter.js';
export { initBlockMap, isYjsCRDTDocument, wrapYjsDocument } from './document.js';
export type { BlockContentType, YjsCRDTDocument, YjsPenDocument } from './document.js';
```

`initBlockMap` is exported for the Wave 2 schema engine (needs it to create blocks during `editor.apply()`) and `@pen/test` (needs it to build test documents). `isYjsCRDTDocument` is exported for downstream type narrowing. `wrapYjsDocument` is exported for advanced consumers that construct their own `Y.Doc` (e.g., `@pen/test`, network providers that receive a Y.Doc from a WebSocket). `BlockContentType` is exported so callers can type their `contentType` arguments without re-declaring the union.

Internal types (`YjsCRDTDocument`, `YjsPenDocument`) are exported as type-only — they're useful for downstream packages that need Yjs-specific type narrowing but should not be instantiated directly.

---

## Key Data Flow

```text
createDocument()
  → Y.Doc (gc: options.gc ?? true)
  → ydoc.getArray('blockOrder')   : Y.Array<string>
  → ydoc.getMap('blocks')         : Y.Map<Y.Map<unknown>>
  → ydoc.getMap('apps')           : Y.Map<Y.Map<unknown>>
  → ydoc.getMap('metadata')       : Y.Map<unknown>
  → { adapter, ydoc, penDocument }

initBlockMap(blocks, 'block-1', 'paragraph', 'inline')
  → Y.Map {
       'type':    'paragraph'
       'props':   Y.Map {}
       'content': Y.Text ''
       'meta':    Y.Map {}
     }

initBlockMap(blocks, 'block-2', 'table', 'table')
  → Y.Map {
       'type':    'table'
       'props':   Y.Map {}
       'tableContent': Y.Array []
       'meta':    Y.Map {}
     }

observe() event flow (two-listener architecture):
  Y.transact(ydoc, fn, 'user')
    → mutations on Y.Text / Y.Map / Y.Array
    → blocks.observeDeep fires (during transaction)
         → stashes YTextEvent.delta per block into pendingTextDeltas
    → ydoc 'afterTransaction' fires (after observeDeep)
    → txnHandler(txn):
         origin = originToOpOrigin(txn.origin)        → 'user'
         affectedBlocks = extractAffectedBlocks(txn)   → ['block-1']
         textDeltas = pendingTextDeltas (swap + clear)
         ops = reconstructOps(txn, textDeltas)         → [{ type: 'insert-text', ... }]
         → callback({ origin, affectedBlocks, ops, timestamp })

encodeState / loadDocument round-trip:
  doc = createDocument()
  // ... add blocks, write content ...
  binary = encodeState(doc)                // Y.encodeStateAsUpdate(ydoc)
  doc2 = loadDocument(binary)              // new Y.Doc → Y.applyUpdate(ydoc, binary)
  // doc2 has identical shared type state

fork / merge:
  main = createDocument()
  // ... add content ...
  branch = fork(main)                      // full state transfer, new clientID
  // ... modify branch ...
  merge(main, branch)                      // differential update: only branch's new ops
  // main now has branch's changes
```

---

## Package Configuration Fix

The current `package.json` has an ESM path mismatch: `exports.import.default` and `module` point to `./dist/index.mjs` but tsup emits `./dist/index.js` for ESM format.

Fix by adding `outExtension` to `tsup.config.ts`:

```typescript
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  outDir: 'dist',
  clean: true,
  external: ['@pen/types'],
  outExtension({ format }) {
    return { js: format === 'esm' ? '.mjs' : '.cjs' };
  },
});
```

This produces `dist/index.mjs` (ESM) and `dist/index.cjs` (CJS), matching the `package.json` paths.

---

## New Dependencies

`@pen/crdt-yjs` depends on `@pen/types` (not `@pen/core`) for type definitions only — `CRDTAdapter`, `CRDTDocument`, `PenDocument`, etc.

Already in `package.json`:

- `yjs` `^13.6.29` — core CRDT library
- `y-protocols` `^1.0.7` — awareness protocol (only subpath `y-protocols/awareness` used)
- `lib0` — transitive via `yjs`, not a direct dependency

No new dependencies needed.

---

## Conflict Resolution Semantics

Yjs guarantees eventual consistency at the data structure level — all peers converge to the same byte-identical state. But convergence alone doesn't guarantee *sensible* editor behavior. This section defines what the user sees when concurrent operations collide. These are **editor-level contracts**, not Yjs implementation details.

### Guiding Principles

1. **No data loss.** Concurrent edits must never silently discard user input. When two operations conflict, both effects must be preserved (possibly in degraded form), or the user must be notified.
2. **Last-writer-wins only for metadata, never for content.** Block props (heading level, checkbox state, alignment) use Y.Map semantics — concurrent writes to the same key resolve by Yjs's internal LWW per-key arbitration (deterministic by clientID). Content (Y.Text) uses positional insertion — concurrent inserts at the same offset both appear, ordered by clientID.
3. **Predictability over cleverness.** Users should be able to reason about what happened. A slightly wrong but understandable result is better than a "smart" merge that produces surprising output.

### Scenario Matrix

#### 1. Concurrent text edits in the same block

**Scenario:** User A inserts "hello" at offset 5. User B inserts "world" at offset 5.

**CRDT behavior:** Y.Text inserts at the same position are ordered by clientID. Both insertions are preserved. One appears before the other (deterministic but arbitrary).

**Editor behavior:** Both users see "helloworld" (or "worldhello") at offset 5. No content is lost. The relative ordering is stable once synced — it will never flip.

**Edge case — interleaved characters:** If A types "abc" and B types "xyz" character-by-character at the same position, Y.Text may interleave them as "axbycz" rather than grouping by author. This is a known Yjs behavior for character-at-a-time concurrent typing at identical offsets.

**Mitigation:** This only occurs when two users place their cursor at the exact same offset simultaneously. In practice, awareness-driven remote cursors make this visible, and users naturally stagger positions. No editor-level intervention needed.

#### 2. Concurrent block type conversion

**Scenario:** User A converts paragraph `block-1` to `heading` (level 2). User B converts the same paragraph to `heading` (level 3).

**CRDT behavior:** Both users write to `block-1.props.get('level')` — a Y.Map key. Y.Map uses per-key LWW: the write with the higher Lamport timestamp wins. If timestamps are equal, the higher clientID wins.

**Editor behavior:** Both users converge on the same heading level. One "wins" deterministically. The loser sees their block change to the winner's heading level after sync.

**Invariant:** The block type is always valid after merge. If A converts to `heading` and B converts to `codeBlock`, the LWW resolution on the `type` key in the block Y.Map determines the winner. The props map for the losing type may contain stale keys — the normalization pass (Wave 2) strips props that aren't in the winning type's schema.

**Post-merge normalization:** After any remote merge, the editor MUST run the normalization pass on affected blocks. This ensures prop/type consistency. The apply pipeline already does this (Wave 3, `applyAndNormalize`).

#### 3. Concurrent block deletion and content editing

**Scenario:** User A deletes `block-1` via `blocks.delete('block-1')` and `blockOrder.delete(indexOf('block-1'))`. User B inserts text into `block-1.content` (Y.Text).

**CRDT behavior:** Y.Text inserts into a deleted Y.Map's child are valid CRDT operations — they execute in the Yjs item graph. But the parent Y.Map entry is tombstoned in the `blocks` map. After merge:
- The `blocks` map no longer contains `block-1`.
- The `blockOrder` array no longer contains `block-1`.
- The Y.Text content exists in the CRDT history (retrievable via snapshots if `gc: false`) but is unreachable through the document structure.

**Editor behavior:** User B's edits are effectively lost — the block no longer exists. User B sees the block disappear on sync.

**Mitigation strategy (required for M0):**
1. **Field editor block existence guard.** The field editor checks block existence before every write (already specified in Wave 5 — `handleTextUpdate` checks `this.editor.getBlock(blockId)`). If the block was deleted remotely, the field editor deactivates silently.
2. **Undo recoverability.** User B can undo the deletion via Ctrl+Z IF the delete was a local operation (origin `'user'`). Remote deletions (origin `'collaborator'`) are not in B's undo stack. However, User A CAN undo their own deletion, which restores the block with B's concurrent edits (the Y.Text inserts are still in the CRDT history).
3. **Awareness-based conflict hint (M1).** The presence system can detect that a remote user is editing a block that the local user is about to delete. Surface a confirmation: "User B is editing this block. Delete anyway?"

#### 4. AI generation conflicts with concurrent user edits

**Scenario:** AI streams tokens into `block-1` with origin `'ai'`. User simultaneously types in the same block.

**CRDT behavior:** Both sets of inserts are preserved. AI tokens and user tokens interleave based on their insertion offsets and Yjs ordering.

**Editor behavior:** The AI's streaming target tracks a Y.RelativePosition for its insertion cursor. User edits at a different offset in the same block are fine — both sets of content appear at their respective positions. User edits at the same offset as the AI stream will interleave.

**Mitigation strategy:**
1. **AI writes to a specific offset range.** The generation zone (Wave 7) confines AI writes to a marked region. User edits outside this region don't conflict.
2. **During active generation, user edits within the generation zone abort the generation.** The AI extension detects concurrent user writes to the active generation range (via the CRDT observer checking origin) and aborts the stream. The user's edit takes precedence.
3. **Post-generation, AI content becomes a suggestion.** Track changes marks (Wave 7) allow the user to review and accept/reject AI output. Until accepted, AI content is visually distinct.

#### 5. Concurrent suggestion accept/reject

**Scenario:** User A accepts suggestion `s-1` while User B rejects the same suggestion.

**CRDT behavior:** Both operations modify the suggestion mark attributes on Y.Text:
- Accept: removes the suggestion mark, keeping the inserted content visible (or removing the deleted content permanently).
- Reject: removes the suggestion mark AND removes the inserted content (or restores deleted content).

These are Y.Text attribute mutations + potential content deletions. Both execute in the CRDT.

**Editor behavior:** The operations are NOT commutative at the editor level. If accept runs first: the suggestion mark is removed, content is finalized. Then reject runs: it tries to remove a mark that no longer exists (no-op for the mark) but may delete content that was already accepted.

**Resolution strategy:**
1. **Suggestion marks carry a `status` field.** Values: `'pending'` | `'accepted'` | `'rejected'`. Accept/reject operations are guarded: they only execute if `status === 'pending'`.
2. **Status transitions use Y.Map LWW.** The `meta.get('ai').get(suggestionId).status` field is a Y.Map key. Concurrent writes resolve via LWW. The "winner" sets the status; the "loser" discovers the status has already changed.
3. **Post-resolution cleanup.** After a suggestion status changes to `'accepted'` or `'rejected'`, a cleanup transaction runs: strip the suggestion mark attributes from Y.Text (for accepted), or remove the inserted Y.Text content (for rejected). This cleanup is idempotent — running it twice is harmless.
4. **Guard in `accept-reject.ts`.** The `acceptSuggestion` and `rejectSuggestion` functions read the current status before executing. If the status is not `'pending'`, they return `false` (already resolved). The UI disables accept/reject buttons when the suggestion is no longer pending.

#### 6. Concurrent block reordering

**Scenario:** User A moves `block-3` to position 1. User B moves `block-3` to position 5.

**CRDT behavior:** `blockOrder` is a `Y.Array<string>`. Move = delete from old position + insert at new position. Two concurrent move operations on the same block produce two deletes (both delete `block-3` from the original position — only one succeeds, the other is a no-op on a tombstone) and two inserts (both insert `block-3` at their respective target positions).

**Result:** `block-3` appears TWICE in `blockOrder` after merge — once at each target position.

**Editor behavior:** Duplicate block IDs in `blockOrder` is an invalid state. The normalization pass detects this.

**Resolution strategy:**
1. **`blockOrder` normalization (required for M0).** After any remote merge, scan `blockOrder` for duplicates. Keep the last occurrence, remove earlier duplicates. This aligns with Yjs's LWW semantics: `move-block` is implemented as delete + insert, and the last insert (by Yjs timestamp ordering) represents the newest intended position. All peers apply the same deterministic rule, preserving convergence.
2. **Orphan detection.** Blocks in `blocks` map but not in `blockOrder` are orphans (can happen if one peer's delete of the blockOrder entry won). Orphans are re-appended to blockOrder during normalization.

#### 7. Schema version mismatch

**Scenario:** Peer A has schema version 2 (with a new `callout` block type). Peer B has schema version 1 (no `callout`).

**CRDT behavior:** Peer A creates a block with `type: 'callout'`. The CRDT replicates the block faithfully to Peer B.

**Editor behavior on Peer B:** The `callout` type is unknown to B's schema. The block renders via `DefaultRenderer` (Wave 5) — a fallback that displays the block type name and raw props.

**Resolution strategy:**
1. **Unknown blocks are preserved, not stripped.** The normalization pass does NOT delete blocks with unknown types. This ensures that when Peer B upgrades, the blocks appear correctly.
2. **Unknown blocks are read-only.** The field editor refuses to activate for blocks with unresolved schemas. This prevents B from corrupting callout-specific props.
3. **Awareness-based version advertisement (M2).** Peers can advertise their schema version via awareness state. The UI can warn "User B is using an older version" when versions diverge.

### Implementation Notes

These conflict resolution behaviors are NOT additional code in `@pen/crdt-yjs` — they are contracts enforced by higher layers:

| Behavior | Enforced by | Wave |
|---|---|---|
| Post-merge normalization | `SchemaEngineImpl.normalize()` | Wave 2 |
| Block existence guard in field editor | `FieldEditorImpl.handleTextUpdate` | Wave 5 |
| Suggestion status guard | `accept-reject.ts` | Wave 7 |
| blockOrder dedup | `DocumentStateImpl.rebuild()` | Wave 3 |
| Unknown block preservation | `SchemaRegistryImpl.resolve()` returning null | Wave 2 |
| AI generation zone abort | `AIExtension.onDocumentChange` | Wave 7 |

The CRDT layer's responsibility is to guarantee convergence and expose accurate `CRDTEvent`s. The editor layer's responsibility is to interpret those events into sensible user-facing behavior.

---

## CRDT Integrity: Health Checks, Corruption Detection, and Recovery

CRDTs are append-only. If a bug in the apply pipeline, a malformed remote update, or a corrupted binary payload writes garbage into the Y.Doc, you cannot "undo" it at the CRDT level — `Y.UndoManager` only tracks operations from specific origins, and structural corruption isn't an operation that can be reversed.

This section specifies how Pen detects, reports, and recovers from corrupt CRDT state.

### Corruption Sources

1. **Malformed remote updates.** A buggy peer or network corruption produces an invalid `Uint8Array` that `Y.applyUpdate` cannot parse. Yjs throws on malformed binary data.
2. **Logically invalid state from bugs.** The apply pipeline writes a block with a `type` that doesn't exist in the schema, or writes props that violate schema constraints. The CRDT bytes are valid, but the document semantics are broken.
3. **Storage corruption.** The persisted binary (from `PenPersistence`) is truncated or bit-flipped. Loading it produces a Y.Doc with missing or garbled shared types.
4. **Version skew.** A document created with Yjs 13.x is loaded by a future Yjs 14.x that changes the binary format (unlikely within a major version, but possible across majors).

### Validation on Load

Every `loadDocument(binary)` call MUST validate the resulting Y.Doc before returning it to the caller. Validation runs after `Y.applyUpdate(ydoc, binary)` succeeds (no parse error) but before the document is usable.

```typescript
interface DocumentValidationResult {
  valid: boolean;
  errors: DocumentValidationError[];
  repaired: boolean;
}

interface DocumentValidationError {
  code: 'MISSING_SHARED_TYPE' | 'INVALID_BLOCK_STRUCTURE' | 'ORPHAN_BLOCK'
      | 'DUPLICATE_BLOCK_ORDER' | 'UNKNOWN_CONTENT_TYPE' | 'MISSING_BLOCK_MAP_KEY';
  blockId?: string;
  message: string;
  severity: 'error' | 'warning';
}
```

**Validation checks (ordered by severity):**

1. **Shared type existence.** Verify all four shared types exist: `blockOrder`, `blocks`, `apps`, `metadata`. A missing shared type means the document was never properly initialized or the binary is from a different application. **Severity: error.** **Recovery: none — reject the document.**

2. **Block structure integrity.** For each block in the `blocks` map:
   - The block Y.Map must have a `type` key (string).
   - The block Y.Map must have a `props` key (Y.Map).
   - The block Y.Map must have a `meta` key (Y.Map).
   - Exactly one content key must be present: `content` (Y.Text), `tableContent` (Y.Array), `children` (Y.Array), or none.
   - **Severity: error per block.** **Recovery: quarantine — move the block ID to a `_quarantined` metadata key. Remove from `blockOrder`. Log for diagnostics.**

3. **blockOrder/blocks consistency.** Every ID in `blockOrder` must have a corresponding entry in `blocks`. Every entry in `blocks` must appear in `blockOrder`.
   - **Orphans (in blocks but not blockOrder):** append to end of `blockOrder`. **Severity: warning.**
   - **Dangling references (in blockOrder but not blocks):** remove from `blockOrder`. **Severity: warning.**
   - **Duplicates in blockOrder:** keep first occurrence, remove rest. **Severity: warning.**

4. **Props type safety.** For blocks with known schemas, validate that prop values match expected types (string, number, boolean, enum). Coerce where possible (e.g., string "3" → number 3 for heading level). Remove props that aren't in the schema.
   - **Severity: warning.** **Recovery: auto-repair via normalization.**

**Validation is non-destructive by default.** The validator reports errors. Repair only runs if the caller opts in (e.g., `loadDocument(binary, { repair: true })`). This prevents silent data mutation on load.

### Runtime Health Checks

In addition to load-time validation, the editor periodically checks document health during a session.

**`DocumentHealthMonitor`** (instantiated by `createEditor`, Wave 3):

```typescript
interface DocumentHealthMonitor {
  check(): DocumentValidationResult;
  onCorruption(cb: (errors: DocumentValidationError[]) => void): Unsubscribe;
}
```

**When checks run:**
- After every remote merge (`applyUpdate` with origin `'remote'`). This is the primary vector for corruption from buggy peers.
- On idle (debounced, 30 seconds after last edit). Catches corruption from local bugs.
- Before snapshot creation. Ensures snapshots capture clean state.

**What checks run at runtime (lighter than load-time):**
- blockOrder/blocks consistency (check 3 above).
- Block structure integrity for affected blocks only (check 2 above, scoped to `CRDTEvent.affectedBlocks`).

**Performance budget:** Runtime checks must complete in <5ms for a 500-block document. The blockOrder consistency check is O(n) where n = blockOrder length. Block structure checks are O(k) where k = affected blocks per transaction (typically 1-5).

### Recovery from Corrupt State

When corruption is detected and cannot be auto-repaired:

**Strategy 1: Rebuild from last known-good snapshot.**

```
1. Editor detects corruption via DocumentHealthMonitor.
2. Editor emits 'corruption' event with error details.
3. If PenPersistence is available:
   a. Load the most recent snapshot that passes validation.
   b. Create a new Y.Doc from the snapshot.
   c. Apply any incremental updates saved after the snapshot timestamp.
   d. Re-validate.
   e. If valid: swap the editor's Y.Doc. Emit 'recovered' event.
   f. If still corrupt: surface error to user. Offer manual snapshot selection.
4. If no PenPersistence: surface error to user. The document is in a degraded state.
```

**Strategy 2: Fork-and-repair.**

```
1. Fork the corrupt document.
2. On the fork, run aggressive repair:
   a. Remove all quarantined blocks.
   b. Strip all unrecognized props.
   c. Rebuild blockOrder from blocks map keys.
3. Present the repaired fork to the user for review.
4. User can accept the repair (replace the original) or reject (keep the corrupt state and report the bug).
```

**Strategy 3: Export and reimport.**

As a last resort, the document can be exported to Markdown or HTML (Wave 4) from whatever state is readable, and reimported into a fresh document. This loses CRDT history and collaboration state but preserves content.

### `applyUpdate` Error Handling

The `adapter.applyUpdate(doc, update)` method currently calls `Y.applyUpdate(ydoc, binary)` without error handling. This must be wrapped:

```typescript
applyUpdate(doc, update) {
  try {
    Y.applyUpdate(asYjsDoc(doc).ydoc, update);
  } catch (err) {
    const diagnostic: CRDTDiagnostic = {
      code: 'MALFORMED_UPDATE',
      message: `Failed to apply CRDT update: ${err instanceof Error ? err.message : String(err)}`,
      severity: 'error',
      updateSize: update.byteLength,
      timestamp: Date.now(),
    };
    this.emitDiagnostic(diagnostic);
    // Do NOT rethrow — the document continues functioning with the update dropped.
    // The peer will re-sync via the next sync-step-1 exchange.
  }
},
```

Dropped updates are recoverable: the y-websocket sync protocol's sync-step-1 exchange will detect the missing state and re-send it. A single dropped update does not cause permanent divergence.

### Diagnostic Events

All validation failures, corruption detections, and recovery attempts are surfaced through the editor's event system. The canonical `PenEventMap` in Wave 0 (`types/editor.ts`) defines the `'crdt:corruption'` and `'crdt:recovered'` event types. CRDT-level diagnostics (malformed updates, parse errors) are surfaced via the existing `'diagnostic'` event with `source: 'crdt'`:

```typescript
// CRDT diagnostic — surfaced via the existing 'diagnostic' event
editor.on('diagnostic', (event) => {
  if (event.source === 'crdt') {
    // event.code: 'MALFORMED_UPDATE', etc.
    // event.message: human-readable description
    // event.severity: 'error' | 'warning' | 'info'
  }
});

// Corruption detection — dedicated event (defined in PenEventMap)
editor.on('crdt:corruption', (errors) => { /* DocumentValidationError[] */ });

// Recovery completion — dedicated event (defined in PenEventMap)
editor.on('crdt:recovered', (method) => { /* 'snapshot' | 'repair' | 'reimport' */ });
```

These events are for observability. The editor remains functional during corruption detection — it does not crash or lock the UI. Consumers (e.g., a monitoring dashboard) can subscribe and report issues.

---

## Key Decisions

1. **`observe()` uses a two-listener architecture: `blocks.observeDeep` + `ydoc.on('afterTransaction')`.** The `observeDeep` listener captures incremental `YTextEvent.delta` for text changes (the actual insert/delete/retain diff, not the full content). The `afterTransaction` listener fires once per transaction, reads the stashed deltas, and builds a single `CRDTEvent`. This gives correct incremental text ops while maintaining one event per `Y.transact()` batch.

2. **`CRDTEvent.ops` is best-effort.** Reconstructing `DocumentOp` from Yjs deltas is useful for extension introspection but is not the write path. Some complex operations (concurrent merges, `move-block` as delete + insert) may produce `ops` that don't exactly match the original intent. Extensions should use `affectedBlocks` for reliable change detection.

3. **No `Y.XmlFragment`.** Pen uses `Y.Text` for inline content, not `Y.XmlFragment`. Formatting is stored as `Y.Text` attributes. This is simpler and sufficient for Pen's inline content model (Spec Section 4.3).

4. **`transact()` defaults to `'user'` origin.** When no origin is provided, the transaction is tagged as `'user'`. This ensures the UndoManager always captures these mutations (it tracks `'user'` and `'ai'`). Passing `undefined` would make the transaction untracked — a silent undo bug.

5. **UndoManager scoped to `[blockOrder, blocks]`.** `apps` and `metadata` changes are intentionally excluded from undo/redo. App configuration changes and extension metadata are managed by their respective owners.

6. **`gc` defaults to `true`.** Garbage collection is enabled by default for memory efficiency. Consumers using snapshot-based version history must set `gc: false` to preserve deleted content needed for `Y.createDocFromSnapshot()`. This is documented in `YjsAdapterOptions`.

7. **`initBlockMap` always creates `meta` Y.Map.** The meta map is present on every block from creation, even if no extensions use it. This avoids the need for lazy initialization in extension code.

8. **Tree-walking `_item.parent` for affected block resolution.** This accesses Yjs internals (`_item` property). It is stable across Yjs 13.x and is used by `Y.UndoManager` itself. If a future Yjs major version changes the internal structure, only `events.ts` needs updating.

9. **`wrapYjsDocument` is exported for pre-existing Y.Doc wrapping.** Wave 2's `@pen/test` expects to create test documents by wrapping an existing `Y.Doc`. The wave-02 spec shows `yjsAdapter({ doc: ydoc }).document`, but this pattern is incorrect — the `CRDTAdapter` interface does not have a `.document` property or a `doc` option (per v01 Spec Section 10.1). The correct approach is: `wrapYjsDocument(adapter, ydoc)`. This standalone utility wraps a pre-existing `Y.Doc` without modifying the `CRDTAdapter` interface. The wave-02 spec should be updated to use this pattern instead.

10. **`CRDTAdapter` exposes `DocumentStore` factory methods.** `createMap()`, `createArray()`, `createText()`, and `initBlockMap()` allow callers in `@pen/core` (the schema engine, apply pipeline, handles) to create CRDT shared types without importing Yjs directly. This is the mechanism that keeps the `@pen/core` → `@pen/crdt-*` dependency as type-only at the import level and purely through the adapter instance at runtime. Without these methods, `@pen/core` would need to `import * as Y from 'yjs'` to create `Y.Map`, `Y.Text`, etc. — destroying the adapter abstraction. The factory methods have trivial Loro equivalents (`new LoroMap()`, `new LoroText()`, etc.).

11. **Conflict resolution is specified at the editor level, not the CRDT level.** Yjs guarantees convergence. Pen guarantees that converged state is meaningful to the user. Each conflict scenario has a defined resolution strategy enforced by the appropriate wave's implementation. The CRDT layer does not attempt to "fix" conflicts — it provides accurate events for higher layers to interpret.

12. **CRDT health checks run on every remote merge and on idle.** Corruption detection is continuous, not just at load time. Runtime checks are scoped to affected blocks for performance (<5ms for 500 blocks). Load-time validation is comprehensive.

13. **Malformed updates are dropped, not fatal.** `applyUpdate` wraps `Y.applyUpdate` in a try/catch. A dropped update triggers re-sync via the WebSocket protocol, not permanent divergence. The editor never crashes from a bad remote update.

14. **Document validation is non-destructive by default.** The validator reports errors without modifying the document. Repair is opt-in. This prevents well-intentioned auto-repair from silently mutating state in ways that surprise the user.

---

## Acceptance Criteria

### `document.ts`

1. `createYjsDocument()` produces a `YjsCRDTDocument` with all four shared types (`blockOrder`, `blocks`, `apps`, `metadata`) accessible and correctly typed.
2. `initBlockMap` with `contentType: 'inline'` creates a Y.Map containing `type`, `props: Y.Map`, `content: Y.Text`, and `meta: Y.Map`.
3. `initBlockMap` with `contentType: 'table'` creates a Y.Map containing `tableContent: Y.Array` (no `content` or `children`).
4. `initBlockMap` with `contentType: 'nested'` creates a Y.Map containing `children: Y.Array` (no `content` or `tableContent`).
5. `initBlockMap` with `contentType: 'none'` creates a Y.Map with only `type`, `props`, and `meta` (no content key).
6. `isYjsCRDTDocument` returns `true` for adapter-created docs and `false` for plain objects.

### `events.ts`

1. Insert a block via `blocks.set()` inside `Y.transact()` → `observe()` callback fires with `affectedBlocks` containing the new block's ID.
2. Insert text into a block's `Y.Text` that already contains content → `observe()` fires with `ops` containing an `insert-text` op with only the inserted text (not the full block content). Verify `offset` reflects the insertion position and `text` contains only the new characters.
3. Update a block's props via `props.set()` → `observe()` fires with an `update-block` op.
4. Delete a block via `blocks.delete()` → `observe()` fires with a `delete-block` op.
5. Transaction with origin `'ai'` → event has `origin: 'ai'`.
6. Transaction with `null`/`undefined` origin → event has `origin: 'user'`.
7. Transaction with unknown string origin → event has `origin: 'extension'`.
8. Empty transaction (no changes) → observer does NOT fire.
9. Nested `Y.Text` change (e.g., table cell content) → `affectedBlocks` includes the containing table block ID.
10. Delete text from a block's `Y.Text` → `observe()` fires with `ops` containing a `delete-text` op with correct `offset` and `length`.
11. Add an app via `apps.set()` → `observe()` fires with `ops` containing a `create-app` op. Remove an app via `apps.delete()` → `observe()` fires with a `delete-app` op. `affectedBlocks` does not include app changes (it covers blocks only).

### `adapter.ts`

1. `encodeState()` → `loadDocument()` round-trip produces an identical document (verified by comparing `blockOrder.toArray()` and block content).
2. `encodeUpdate(doc, since)` produces only the delta since the state vector.
3. `applyUpdate` with a remote update → local doc includes remote changes.
4. `transact` batches multiple writes into a single `observe()` event.
5. `getClientId` returns a stable number for the same doc across calls.
6. `raw<Y.Doc>(doc)` returns the underlying `Y.Doc` instance.

### `undo.ts`

1. Insert text → `undo()` → text is removed → `redo()` → text is back.
2. `stopCapturing()` creates a boundary: changes before and after are separate undo steps.
3. Changes with origin `'collaborator'` are NOT captured (not in `trackedOrigins`).
4. `canUndo()` / `canRedo()` accurately reflect stack state.

### `awareness.ts`

1. `setLocalState({ cursor: ... })` → `getStates()` includes the local client's state.
2. `on('change', cb)` fires when any client's state changes.
3. `off('change', cb)` removes the listener.
4. `destroy()` cleans up the underlying y-protocols `Awareness` instance — after `destroy()`, `on('change', cb)` no longer fires.

### `snapshots.ts`

1. `createSnapshot()` → modify doc → `restoreSnapshot()` → restored doc matches the snapshot state (with `gc: false`).
2. `mergeUpdates()` with multiple incremental updates → single update that, when applied to a fresh doc, produces the same state.
3. `fork()` → modify fork → `merge()` back → target has the fork's changes.
4. `fork()` produces a doc with a different `clientID` than the source.
5. `merge()` is idempotent: merging the same source twice produces identical state.
6. `fork()` on a doc created with `gc: false` → forked doc also has `gc: false` (verified via `raw<Y.Doc>(forked).gc`).

### Package

1. `pnpm build` succeeds for `@pen/crdt-yjs`.
2. `pnpm typecheck` succeeds for `@pen/crdt-yjs`.
3. ESM import (`import { yjsAdapter } from '@pen/crdt-yjs'`) resolves correctly.

### Conflict Resolution

1. Two peers concurrently insert text at the same offset in the same Y.Text → both insertions are preserved after merge. No content is lost. The ordering is deterministic across all peers.
2. Two peers concurrently write different values to the same block prop key → after merge, both peers converge to the same value (LWW by Lamport timestamp).
3. Peer A deletes a block while Peer B edits it → after merge, the block is deleted. B's field editor deactivates when it detects the block is gone.
4. Peer A moves a block to position 1, Peer B moves the same block to position 5 → after merge and normalization, the block appears exactly once in `blockOrder`.
5. A block with an unknown type (from a newer schema version) is preserved in the document, renders via `DefaultRenderer`, and is read-only.
6. Post-merge normalization runs on all affected blocks. Stale props from a losing type conversion are stripped.

### CRDT Integrity

1. `loadDocument` with a valid binary passes all validation checks and returns `valid: true`.
2. `loadDocument` with a binary missing the `blocks` shared type returns `valid: false` with a `MISSING_SHARED_TYPE` error.
3. `loadDocument` with a block missing the `type` key returns an error with `MISSING_BLOCK_MAP_KEY` code.
4. `loadDocument` with orphan blocks (in `blocks` but not `blockOrder`) returns a warning and, when `repair: true`, appends them to `blockOrder`.
5. `loadDocument` with duplicate IDs in `blockOrder` returns a warning and, when `repair: true`, deduplicates (keeps first occurrence).
6. `applyUpdate` with a malformed binary does NOT throw. It emits a `crdt:diagnostic` event and drops the update.
7. Runtime health check after a remote merge that introduces a dangling `blockOrder` reference detects the inconsistency and emits `crdt:corruption`.
8. Recovery from snapshot: given a corrupt document and a valid snapshot, `recoverFromSnapshot` produces a clean document that passes validation.
