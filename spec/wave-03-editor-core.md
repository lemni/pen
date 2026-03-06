# Wave 3 — Editor Core

**Milestone:** M0 · **Packages:** `@pen/core` (editor impl), `@pen/undo`, `@pen/document-ops`, `@pen/delta-stream` · **Depends on:** Waves 0-2

---

## Goal

Implement `createEditor()` — the central factory that wires schema, CRDT, extensions, and the mutation pipeline. After this wave, you can programmatically create an editor, insert/delete/move blocks, format text, observe changes, undo/redo, stream AI deltas, and run the full extension lifecycle — all headless, no DOM required.

---

## File Structure

Wave 0 creates `@pen/types` with all type definitions and lightweight helpers. Wave 2 adds the schema engine to `@pen/core` under `schema/`. Wave 3 adds the editor implementation under `editor/`, plus three new packages.

```
packages/core/src/
├── schema/          (Wave 2 — registry, normalize, handles)
├── editor/
│   ├── editor.ts            createEditor() factory + EditorImpl
│   ├── apply.ts             ApplyPipeline — editor.apply() mutation path
│   ├── extension-manager.ts ExtensionManagerImpl
│   ├── selection.ts         SelectionManagerImpl
│   ├── range.ts             DocumentRangeImpl
│   ├── decorations.ts       DecorationSetImpl + createDecorationSet/emptyDecorationSet
│   ├── events.ts            EventEmitter
│   └── document-state.ts    DocumentStateImpl — cached block index
├── importer-utils.ts        blocksToOps + PendingBlock — shared by importers (Wave 4)
└── index.ts         (re-exports @pen/types + schema + editor runtime)

packages/undo/src/
├── undo-extension.ts    UndoExtension implementing Extension
├── undo-manager.ts      UndoManagerImpl wrapping CRDTUndoManager
└── index.ts             Package entry

packages/document-ops/src/
├── document-ops-extension.ts  DocumentOpsExtension implementing Extension
├── tool-server.ts             ToolServerImpl
├── tool-context.ts            ToolContextImpl
├── tools/
│   ├── read-document.ts
│   ├── write-document.ts
│   ├── get-context.ts
│   ├── search-document.ts
│   ├── list-block-types.ts
│   ├── insert-block.ts
│   ├── update-block.ts
│   ├── delete-block.ts
│   └── move-block.ts
└── index.ts             Package entry

packages/delta-stream/src/
├── delta-stream-extension.ts  DeltaStreamExtension implementing Extension
├── streaming-target.ts        StreamingTargetImpl
├── process-stream.ts          processStream() pipeline
├── batch.ts                   BatchingBuffer
└── index.ts                   Package entry
```

### Import DAG (editor modules)

```
types/editor.ts           ← (type definitions only)
types/extension.ts        ← (type definitions only)
types/crdt.ts             ← (type definitions only)
types/ops.ts              ← (type definitions only)
types/selection.ts        ← (type definitions only)
types/decorations.ts      ← (type definitions only)

editor/events.ts          ← types/utility (Unsubscribe)
editor/decorations.ts     ← types/decorations (Decoration, DecorationSet, PositionMapping, InlineDecoration)
editor/document-state.ts  ← types/editor (DocumentState)
                          ← types/crdt (PenDocument)
                          ← types/handles (BlockHandle)
                          ← schema/handles (createBlockHandle)
editor/range.ts           ← types/document-range (DocumentRange)
                          ← types/selection (TextSelection)
                          ← types/crdt (PenDocument)
editor/selection.ts       ← types/selection (SelectionState, TextSelection, BlockSelection)
                          ← types/crdt (PenDocument)
                          ← types/handles (BlockHandle)
                          ← schema/handles (createBlockHandle)
                          ← editor/events (EventEmitter)
editor/extension-manager.ts ← types/extension (Extension, ExtensionStateSpec, InputRule, KeyBinding)
                            ← types/crdt (CRDTEvent)
                            ← types/editor (Editor, DocumentState)
                            ← types/decorations (DecorationSet)
                            ← editor/decorations (createDecorationSet, emptyDecorationSet)
editor/apply.ts           ← types/ops (DocumentOp, Position, OpOrigin)
                          ← types/crdt (PenDocument, CRDTAdapter)
                          ← types/schema (SchemaRegistry, BlockSchema, InlineSchema)
                          ← schema/normalize (SchemaEngineImpl)
                          ← editor/events (EventEmitter)
editor/editor.ts          ← types/editor (Editor, CreateEditorOptions, PenEventMap)
                          ← types/crdt (CRDTAdapter, CRDTDocument, PenDocument)
                          ← types/extension (Extension)
                          ← types/schema (SchemaRegistry, ComposableSchema)
                          ← schema/registry (SchemaRegistryImpl)
                          ← schema/normalize (SchemaEngineImpl)
                          ← schema/handles (createBlockHandle)
                          ← editor/apply (ApplyPipeline)
                          ← editor/extension-manager (ExtensionManagerImpl)
                          ← editor/selection (SelectionManagerImpl)
                          ← editor/events (EventEmitter)
                          ← editor/document-state (DocumentStateImpl)
                          ← editor/decorations (createDecorationSet, emptyDecorationSet)
```

No cycles. `editor.ts` is the root that composes all other modules. Leaf modules (`events.ts`, `decorations.ts`, `range.ts`) depend only on types. `apply.ts` and `selection.ts` depend on schema modules and leaf editor modules. `extension-manager.ts` depends on types and `decorations.ts`. `editor.ts` depends on everything.

### Cross-Package Import DAG

```
@pen/core              → @pen/types (types + lightweight helpers)
@pen/undo              → @pen/core (types + runtime)
@pen/document-ops      → @pen/core (types + runtime)
@pen/delta-stream      → @pen/core (types + runtime)
@pen/delta-stream      → @pen/document-ops (ToolServer, type-only)
```

No cross-package cycles. `@pen/core` depends on `@pen/types`. All three extension packages depend on `@pen/core`. `@pen/delta-stream` has an optional runtime dependency on `@pen/document-ops` for tool dispatch, but this is injected via the editor's extension context, not a hard import.

### `EditorInternals` — Typed Extension Access

Extensions need access to editor internals (adapter, CRDT document, schema engine, etc.) that are not on the public `Editor` interface. Rather than casting via `(editor as any)._private`, the editor exposes a typed `EditorInternals` interface accessible via `editor.internals`:

```typescript
// In types/editor.ts:
interface EditorInternals {
  readonly adapter: CRDTAdapter;
  readonly crdtDoc: CRDTDocument;
  readonly doc: PenDocument;
  readonly engine: SchemaEngine;
  readonly awareness: Awareness | null;

  // Extension-managed slots (typed registry, not monkey-patching)
  getSlot<T>(key: string): T | undefined;
  setSlot<T>(key: string, value: T): void;
}

// On Editor interface:
interface Editor {
  // ... existing public API ...
  readonly internals: EditorInternals;
}
```

**Extension-managed slots.** Extensions that need to expose state to other extensions (e.g. `@pen/undo` exposes the undo manager, `@pen/document-ops` exposes the tool server, `@pen/delta-stream` exposes the streaming target) use `editor.internals.setSlot(key, value)` during activation and `editor.internals.getSlot<T>(key)` for retrieval. This replaces the `(editor as any)._toolServer = ...` monkey-patching pattern with a typed, collision-safe registry.

**Slot key conventions.** Each extension owns a namespace: `undo:manager`, `document-ops:toolServer`, `delta-stream:target`. Keys are plain strings — the convention prevents collisions without runtime enforcement.

**Why `internals` instead of `_private`.** The underscore prefix signals "don't touch" but provides no actual protection — any extension casts through `any`. `internals` is explicit, typed, and documented. Third-party extensions that access `internals` are aware they're using internal API and accept the stability trade-off.

---

## Package 1: `@pen/core` — Editor Implementation

### Module: `editor/events.ts` — EventEmitter

A minimal typed event emitter. No external dependency.

```typescript
type Handler = (...args: unknown[]) => void;

export class EventEmitter {
  private readonly _handlers = new Map<string, Set<Handler>>();

  on(event: string, handler: Handler): Unsubscribe {
    let set = this._handlers.get(event);
    if (!set) {
      set = new Set();
      this._handlers.set(event, set);
    }
    set.add(handler);
    return () => { set!.delete(handler); };
  }

  off(event: string, handler: Handler): void {
    this._handlers.get(event)?.delete(handler);
  }

  emit(event: string, ...args: unknown[]): void {
    const set = this._handlers.get(event);
    if (!set) return;
    for (const handler of set) {
      try {
        handler(...args);
      } catch (err) {
        console.error(`EventEmitter: handler for "${event}" threw:`, err);
      }
    }
  }

  removeAllListeners(event?: string): void {
    if (event) {
      this._handlers.delete(event);
    } else {
      this._handlers.clear();
    }
  }
}
```

Each handler is wrapped in `try/catch` — a broken handler must not prevent other handlers or the editor from proceeding. Errors are logged, not swallowed silently.

**`PenEventMap` events** dispatched by the editor:

| Event | Payload | When |
|---|---|---|
| `change` | `CRDTEvent[]` | After each `Y.transact()` batch completes and extensions have been notified. Wave 3 emits one-item arrays (`[event]`) to match the canonical `PenEventMap` contract from Wave 0. |
| `documentChange` | `{ ops: DocumentOp[]; origin: OpOrigin; affectedBlocks: string[] }` | After `apply()` completes and normalization has settled |
| `decorationsChange` | `number` | After decoration generation increments (explicit request or extension invalidation) |
| `selectionChange` | `SelectionState` | After any selection mutation |
| `focus` | `{ blockId: string }` | Field editor activates for a block |
| `blur` | `{ blockId: string }` | Field editor deactivates |

Extension custom events use `ctx.emit(eventName, payload)`. The extension manager namespaces these as `ext:${extensionName}:${eventName}` to prevent collisions. Consumers listen via `editor.on('ext:search:match', handler)`.

---

### Module: `editor/decorations.ts` — DecorationSet Runtime

Implements the `DecorationSet` interface (Spec Section 8.2). Replaces the throw stubs from Wave 0.

#### Internal Data Structures

```typescript
let nextGeneration = 1;

class DecorationSetImpl implements DecorationSet {
  readonly decorations: readonly Decoration[];
  readonly generation: number;
  private readonly _blockIndex: Map<string, Decoration[]>;

  constructor(decorations: Decoration[], generation?: number) {
    this.decorations = decorations;
    this.generation = generation ?? nextGeneration++;
    this._blockIndex = new Map();

    for (const dec of decorations) {
      const key = dec.blockId;
      let list = this._blockIndex.get(key);
      if (!list) {
        list = [];
        this._blockIndex.set(key, list);
      }
      list.push(dec);
    }
  }

  forBlock(blockId: string): readonly Decoration[] {
    return this._blockIndex.get(blockId) ?? EMPTY_ARRAY;
  }

  inlineForBlock(blockId: string): readonly InlineDecoration[] {
    const all = this.forBlock(blockId);
    return all.filter(
      (d): d is InlineDecoration => d.type === 'inline'
    );
  }

  equals(other: DecorationSet): boolean {
    return this.generation === other.generation;
  }

  map(mapping: PositionMapping): DecorationSet {
    if (!mapping.affectedBlocks || mapping.affectedBlocks.length === 0) {
      return this;
    }

    const affected = new Set(mapping.affectedBlocks);
    let changed = false;
    const mapped: Decoration[] = [];

    for (const dec of this.decorations) {
      if (dec.type === 'inline' && affected.has(dec.blockId)) {
        const newFrom = mapping.mapOffset(dec.blockId, dec.from);
        const newTo = mapping.mapOffset(dec.blockId, dec.to);

        if (newFrom >= newTo) continue; // collapsed — remove

        if (newFrom !== dec.from || newTo !== dec.to) {
          changed = true;
          mapped.push({ ...dec, from: newFrom, to: newTo });
          continue;
        }
      }
      mapped.push(dec);
    }

    if (!changed && mapped.length === this.decorations.length) {
      return this;
    }

    return new DecorationSetImpl(mapped);
  }
}

const EMPTY_ARRAY: readonly Decoration[] = Object.freeze([]);

const EMPTY_SET = new DecorationSetImpl([], 0);
```

**Generation counter semantics.** `nextGeneration` is module-scoped and monotonically increasing. Every new `DecorationSetImpl` gets a unique `generation` value. The rendering layer uses `generation` to skip re-renders: if the decoration set's `generation` hasn't changed since the last render, no DOM update is needed.

`emptyDecorationSet()` returns the singleton `EMPTY_SET` (generation 0). It is never equal to any non-empty set.

`map(mapping)` returns `this` (same `generation`) when no decorations are affected — this is the common case. The renderer sees the same `generation` and skips re-rendering. Only when inline decoration positions change does `map` create a new instance with a new `generation`.

#### Top-Level Exports

```typescript
export function createDecorationSet(decorations: Decoration[]): DecorationSet {
  if (decorations.length === 0) return EMPTY_SET;
  return new DecorationSetImpl(decorations);
}

export function emptyDecorationSet(): DecorationSet {
  return EMPTY_SET;
}

export function mergeDecorationSets(...sets: DecorationSet[]): DecorationSet {
  const all: Decoration[] = [];
  for (const set of sets) {
    all.push(...set.decorations);
  }
  if (all.length === 0) return EMPTY_SET;
  return new DecorationSetImpl(all);
}
```

`mergeDecorationSets` concatenates all decorations. For inline decorations on overlapping ranges in the same block, the rendering layer merges attributes — later decorations in the array win on key collisions. This matches the extension dispatch order (later-registered extensions override earlier ones on attribute conflicts).

---

### Module: `editor/document-state.ts` — DocumentState Cached Index

The hot-path cache referenced in Wave 2's `BlockHandle` performance notes. `BlockHandle.index`, `.prev`, `.next` fall back to O(n) linear scan of `blockOrder`. `DocumentStateImpl` pre-indexes these for O(1) access.

```typescript
export class DocumentStateImpl implements DocumentState {
  private _positionIndex: Map<string, number>;
  private _parentIndex: Map<string, string>;
  private _blockOrder: string[];
  private readonly _doc: PenDocument;
  private readonly _registry: SchemaRegistry;

  constructor(doc: PenDocument, registry: SchemaRegistry) {
    this._doc = doc;
    this._registry = registry;
    this._positionIndex = new Map();
    this._parentIndex = new Map();
    this._blockOrder = [];
    this.rebuild();
  }

  get blockOrder(): readonly string[] {
    return this._blockOrder;
  }

  get blockCount(): number {
    return this._blockOrder.length;
  }

  indexOf(blockId: string): number {
    return this._positionIndex.get(blockId) ?? -1;
  }

  blockAt(index: number): string | null {
    return this._blockOrder[index] ?? null;
  }

  parentOf(blockId: string): string | null {
    return this._parentIndex.get(blockId) ?? null;
  }

  rebuild(): void {
    const order = this._doc.blockOrder;
    this._blockOrder = [];
    this._positionIndex = new Map();
    this._parentIndex = new Map();

    for (let i = 0; i < order.length; i++) {
      const id = order.get(i) as string;
      this._blockOrder.push(id);
      this._positionIndex.set(id, i);
    }

    // Build parent index from parentId props and children arrays
    for (const [blockId, blockMap] of (this._doc.blocks as CRDTBlockMap).entries()) {
      const props = blockMap.get('props') as CRDTMap<unknown> | undefined;
      if (props?.get?.('parentId')) {
        this._parentIndex.set(blockId, props.get('parentId'));
      }
      const children = blockMap.get('children') as CRDTArray<string> | undefined;
      if (children) {
        for (let i = 0; i < children.length; i++) {
          this._parentIndex.set(children.get(i), blockId);
        }
      }
    }
  }

  incrementalUpdate(affectedBlocks: readonly string[]): void {
    const orderLength = this._doc.blockOrder.length;
    if (orderLength !== this._blockOrder.length) {
      this.rebuild();
      return;
    }

    let needsRebuild = false;
    for (const blockId of affectedBlocks) {
      const cachedIndex = this._positionIndex.get(blockId);
      if (cachedIndex === undefined) {
        needsRebuild = true;
        break;
      }
      const actual = this._doc.blockOrder.get(cachedIndex) as string;
      if (actual !== blockId) {
        needsRebuild = true;
        break;
      }
    }

    if (needsRebuild) {
      this.rebuild();
    }
  }
}
```

**Rebuild strategy.** `incrementalUpdate` is called after each `change` event with `CRDTEvent.affectedBlocks`. If the `blockOrder` length changed or any affected block's cached position is stale, a full rebuild runs. For the common case (text edits within existing blocks), `incrementalUpdate` is a no-op — the block order hasn't changed.

Full rebuild is O(n) where n = block count. Performance claims are benchmark-bound (not absolute): on the M0 reference benchmark fixture (1000 blocks, warm cache, release build), `rebuild()` should stay within the Wave 6 target budget and be reported with p50/p95 timings.

---

### Module: `editor/range.ts` — DocumentRange Implementation

Runtime implementation of the `DocumentRange` interface defined in `types/document-range.ts`.

```typescript
export class DocumentRangeImpl implements DocumentRange {
  readonly anchor: { blockId: string; offset?: number };
  readonly focus: { blockId: string; offset?: number };
  readonly start: { blockId: string; offset?: number };
  readonly end: { blockId: string; offset?: number };

  constructor(
    anchor: { blockId: string; offset?: number },
    focus: { blockId: string; offset?: number },
    private readonly _doc: PenDocument,
  ) {
    this.anchor = anchor;
    this.focus = focus;

    const anchorIdx = this._indexOfBlock(anchor.blockId);
    const focusIdx = this._indexOfBlock(focus.blockId);

    if (anchorIdx < focusIdx ||
        (anchorIdx === focusIdx &&
         (anchor.offset ?? 0) <= (focus.offset ?? 0))) {
      this.start = anchor;
      this.end = focus;
    } else {
      this.start = focus;
      this.end = anchor;
    }
  }

  contains(blockId: string, offset?: number): boolean {
    const idx = this._indexOfBlock(blockId);
    const startIdx = this._indexOfBlock(this.start.blockId);
    const endIdx = this._indexOfBlock(this.end.blockId);

    if (idx < startIdx || idx > endIdx) return false;
    if (idx > startIdx && idx < endIdx) return true;

    if (idx === startIdx && offset !== undefined && this.start.offset !== undefined) {
      if (offset < this.start.offset) return false;
    }
    if (idx === endIdx && offset !== undefined && this.end.offset !== undefined) {
      if (offset > this.end.offset) return false;
    }
    return true;
  }

  overlaps(other: DocumentRange): boolean {
    const thisStartIdx = this._indexOfBlock(this.start.blockId);
    const thisEndIdx = this._indexOfBlock(this.end.blockId);
    const otherStartIdx = this._indexOfBlock(other.start.blockId);
    const otherEndIdx = this._indexOfBlock(other.end.blockId);

    return thisStartIdx <= otherEndIdx && otherStartIdx <= thisEndIdx;
  }

  equals(other: DocumentRange): boolean {
    return this.start.blockId === other.start.blockId &&
           this.start.offset === other.start.offset &&
           this.end.blockId === other.end.blockId &&
           this.end.offset === other.end.offset;
  }

  toTextSelection(): TextSelection | null {
    if (this.start.blockId !== this.end.blockId) return null;
    if (this.start.offset === undefined || this.end.offset === undefined) return null;
    return {
      type: 'text',
      blockId: this.start.blockId,
      from: this.start.offset,
      to: this.end.offset,
    };
  }

  get blockRange(): readonly string[] {
    const startIdx = this._indexOfBlock(this.start.blockId);
    const endIdx = this._indexOfBlock(this.end.blockId);
    const result: string[] = [];
    for (let i = startIdx; i <= endIdx; i++) {
      result.push(this._doc.blockOrder.get(i) as string);
    }
    return result;
  }

  private _indexOfBlock(blockId: string): number {
    for (let i = 0; i < this._doc.blockOrder.length; i++) {
      if ((this._doc.blockOrder.get(i) as string) === blockId) return i;
    }
    return -1;
  }
}
```

The constructor normalizes anchor/focus into start/end by document order. `blockRange` computes the set of block IDs between start and end inclusive, reading from `blockOrder`. `toTextSelection()` returns `null` for cross-block ranges.

---

### Module: `editor/selection.ts` — SelectionManager

Owns the `SelectionState` (Spec Section 13.6). Coordinates with the event emitter for `selectionChange` events.

```typescript
export class SelectionManagerImpl {
  private _selection: SelectionState = null;
  private readonly _doc: PenDocument;
  private readonly _crdtDoc: CRDTDocument;
  private readonly _registry: SchemaRegistry;
  private readonly _emitter: EventEmitter;

  constructor(doc: PenDocument, crdtDoc: CRDTDocument, registry: SchemaRegistry, emitter: EventEmitter) {
    this._doc = doc;
    this._crdtDoc = crdtDoc;
    this._registry = registry;
    this._emitter = emitter;
  }

  getSelection(): SelectionState {
    return this._selection;
  }

  setSelection(selection: SelectionState): void {
    if (selection && !this._validateSelection(selection)) return;
    const prev = this._selection;
    this._selection = selection;
    if (prev !== selection) {
      this._emitter.emit('selectionChange', selection);
    }
  }

  selectBlock(blockId: string): void {
    if (!this._blockExists(blockId)) return;
    this.setSelection({ type: 'block', blockIds: [blockId] });
  }

  selectBlocks(blockIds: string[]): void {
    const valid = blockIds.filter(id => this._blockExists(id));
    if (valid.length === 0) return;
    this.setSelection({ type: 'block', blockIds: valid });
  }

  selectText(blockId: string, from: number, to: number): void {
    if (!this._blockExists(blockId)) return;

    const blockMap = this._doc.blocks.get(blockId) as CRDTMap<unknown>;
    const content = blockMap?.get('content');
    if (!content || typeof content.length !== 'number') return;

    const len = content.length as number;
    const clampedFrom = Math.max(0, Math.min(from, len));
    const clampedTo = Math.max(clampedFrom, Math.min(to, len));

    this.setSelection({
      type: 'text',
      anchor: { blockId, offset: clampedFrom },
      focus: { blockId, offset: clampedTo },
    });
  }

  selectAll(): void {
    const ids: string[] = [];
    for (let i = 0; i < this._doc.blockOrder.length; i++) {
      ids.push(this._doc.blockOrder.get(i) as string);
    }
    if (ids.length > 0) {
      this.setSelection({ type: 'block', blockIds: ids });
    }
  }

  getSelectedText(): string {
    const sel = this._selection;
    if (!sel) return '';

    if (sel.type === 'text') {
      const blockMap = this._doc.blocks.get(sel.anchor.blockId) as CRDTMap<unknown>;
      const content = blockMap?.get('content');
      if (!content || typeof content.toString !== 'function') return '';
      const full = content.toString() as string;
      const from = Math.min(sel.anchor.offset, sel.focus.offset);
      const to = Math.max(sel.anchor.offset, sel.focus.offset);
      return full.slice(from, to);
    }

    if (sel.type === 'block') {
      const parts: string[] = [];
      for (const id of sel.blockIds) {
        const handle = createBlockHandle(id, this._doc, this._crdtDoc, this._registry);
        parts.push(handle.textContent());
      }
      return parts.join('\n');
    }

    return '';
  }

  getSelectedBlocks(): BlockHandle[] {
    const sel = this._selection;
    if (!sel) return [];

    if (sel.type === 'block') {
      return sel.blockIds
        .filter(id => this._blockExists(id))
        .map(id => createBlockHandle(id, this._doc, this._crdtDoc, this._registry));
    }

    if (sel.type === 'text') {
      if (this._blockExists(sel.anchor.blockId)) {
        return [createBlockHandle(sel.anchor.blockId, this._doc, this._crdtDoc, this._registry)];
      }
    }

    return [];
  }

  updateDocument(doc: PenDocument): void {
    Object.assign(this, { _doc: doc });
    this._selection = null;
  }

  // ── Validation ──────────────────────────────────────────

  private _validateSelection(sel: SelectionState): boolean {
    if (!sel) return true;
    if (sel.type === 'text') return this._blockExists(sel.anchor.blockId);
    if (sel.type === 'block') return sel.blockIds.every(id => this._blockExists(id));
    if (sel.type === 'app') return true;
    if (sel.type === 'cell') return this._blockExists(sel.blockId);
    return false;
  }

  private _blockExists(blockId: string): boolean {
    return (this._doc.blocks as CRDTBlockMap).has(blockId);
  }
}
```

**Offset clamping.** `selectText` clamps `from`/`to` to the `Y.Text.length` of the target block. This prevents out-of-bounds selections from external callers (LLM tool calls, extensions).

**`updateDocument`** is called by `loadDocument()` when the editor swaps its CRDT document. The selection is reset to `null` because the old selection's block IDs may not exist in the new document.

`replaceSelection(content)` and `deleteSelection()` are implemented on the `EditorImpl` class (not the SelectionManager) because they require access to `editor.apply()`:

```typescript
// On EditorImpl:
replaceSelection(content: string | Block[]): void {
  const sel = this._selection.getSelection();
  if (!sel) return;

  if (sel.type === 'text') {
    const from = Math.min(sel.anchor.offset, sel.focus.offset);
    const to = Math.max(sel.anchor.offset, sel.focus.offset);
    this.apply(
      { type: 'delete-text', blockId: sel.anchor.blockId,
        offset: from, length: to - from },
      { type: 'insert-text', blockId: sel.anchor.blockId,
        offset: from, text: typeof content === 'string' ? content : '' },
    );
    return;
  }

  if (sel.type === 'block' && sel.blockIds.length > 0) {
    const firstId = sel.blockIds[0];
    const firstIndex = this._resolvePosition({ before: firstId });
    for (const id of sel.blockIds) {
      this.apply({ type: 'delete-block', blockId: id });
    }

    const insertPosition = firstIndex === 0
      ? 'first' as const
      : { after: (this._doc.blockOrder as CRDTArray<string>).get(firstIndex - 1) as string };

    if (typeof content === 'string') {
      const newId = crypto.randomUUID();
      this.apply({
        type: 'insert-block', blockId: newId,
        blockType: 'paragraph', props: {},
        position: insertPosition,
      });
      this.apply({
        type: 'insert-text', blockId: newId,
        offset: 0, text: content,
      });
    } else if (Array.isArray(content)) {
      let prevPosition = insertPosition;
      for (const block of content) {
        const newId = crypto.randomUUID();
        this.apply({
          type: 'insert-block', blockId: newId,
          blockType: block.type, props: block.props ?? {},
          position: prevPosition,
        });
        if (block.content) {
          this.apply({
            type: 'insert-text', blockId: newId,
            offset: 0, text: typeof block.content === 'string' ? block.content : '',
          });
        }
        prevPosition = { after: newId };
      }
    }
  }
}

deleteSelection(): void {
  const sel = this._selection.getSelection();
  if (!sel) return;

  if (sel.type === 'text') {
    const from = Math.min(sel.anchor.offset, sel.focus.offset);
    const to = Math.max(sel.anchor.offset, sel.focus.offset);
    this.apply({
      type: 'delete-text', blockId: sel.anchor.blockId,
      offset: from, length: to - from,
    });
    this.setSelection({
      type: 'text',
      anchor: { blockId: sel.anchor.blockId, offset: from },
      focus: { blockId: sel.anchor.blockId, offset: from },
    });
    return;
  }

  if (sel.type === 'block') {
    for (const id of sel.blockIds) {
      this.apply({ type: 'delete-block', blockId: id });
    }
    this.setSelection(null);
  }
}
```

---

### Module: `editor/extension-manager.ts` — ExtensionManager

Manages extension lifecycle, dependency resolution, and CRDT observation dispatch (Spec Section 13.1).

#### Internal Data Structures

```typescript
export class ExtensionManagerImpl {
  private readonly _extensions = new Map<string, Extension>();
  private _sorted: Extension[] = [];
  private readonly _stateMap = new Map<string, unknown>();
  private readonly _emitter: EventEmitter;

  constructor(emitter: EventEmitter) {
    this._emitter = emitter;
  }
}
```

`_extensions` stores registered extensions keyed by name. `_sorted` is the topologically sorted activation order. `_stateMap` holds per-extension state managed by `ExtensionStateSpec`.

#### `register(ext)` — Registration and Dependency Resolution

```typescript
register(ext: Extension): void {
  if (this._extensions.has(ext.name)) {
    throw new Error(`Extension "${ext.name}" is already registered`);
  }
  this._extensions.set(ext.name, ext);
  this._resortAndValidate();
}
```

`_resortAndValidate()` runs after every registration or unregistration:

```typescript
private _resortAndValidate(): void {
  const extensions = [...this._extensions.values()];

  // Build adjacency: extension → extensions it depends on
  const inDegree = new Map<string, number>();
  const dependents = new Map<string, string[]>();

  for (const ext of extensions) {
    inDegree.set(ext.name, 0);
    dependents.set(ext.name, []);
  }

  for (const ext of extensions) {
    if (!ext.dependencies) continue;
    for (const dep of ext.dependencies) {
      if (!this._extensions.has(dep)) {
        throw new Error(
          `Extension "${ext.name}" depends on "${dep}", which is not registered`
        );
      }
      inDegree.set(ext.name, (inDegree.get(ext.name) ?? 0) + 1);
      dependents.get(dep)!.push(ext.name);
    }
  }

  // Kahn's algorithm
  const queue: string[] = [];
  for (const [name, degree] of inDegree) {
    if (degree === 0) queue.push(name);
  }

  const sorted: Extension[] = [];
  while (queue.length > 0) {
    const name = queue.shift()!;
    sorted.push(this._extensions.get(name)!);
    for (const dependent of dependents.get(name) ?? []) {
      const newDegree = (inDegree.get(dependent) ?? 1) - 1;
      inDegree.set(dependent, newDegree);
      if (newDegree === 0) queue.push(dependent);
    }
  }

  if (sorted.length !== extensions.length) {
    const missing = extensions
      .filter(e => !sorted.includes(e))
      .map(e => e.name);
    throw new Error(
      `Circular dependency detected among extensions: ${missing.join(', ')}`
    );
  }

  this._sorted = sorted;
}
```

**Kahn's algorithm** produces a topological ordering where extensions appear after all their dependencies. Circular dependencies cause the algorithm to terminate early (not all extensions processed), which is detected and throws.

#### `unregister(name)`

```typescript
unregister(name: string): void {
  const ext = this._extensions.get(name);
  if (!ext) return;

  // Check that no other extension depends on this one
  for (const other of this._extensions.values()) {
    if (other.dependencies?.includes(name)) {
      throw new Error(
        `Cannot unregister "${name}": "${other.name}" depends on it`
      );
    }
  }

  this._extensions.delete(name);
  this._stateMap.delete(name);
  this._resortAndValidate();
}
```

#### `activateAll(editor)` / `deactivateAll(editor)`

```typescript
async activateAll(editor: Editor): Promise<void> {
  for (const ext of this._sorted) {
    try {
      if (ext.activateClient) {
        await ext.activateClient({
          editor,
          emit: (event: string, ...args: unknown[]) => {
            this._emitter.emit(`ext:${ext.name}:${event}`, ...args);
          },
        });
      }
      if (ext.state) {
        this._stateMap.set(ext.name, ext.state.init(editor));
      }
    } catch (err) {
      console.error(`Extension "${ext.name}" activation failed:`, err);
    }
  }
}

async deactivateAll(editor: Editor): Promise<void> {
  // Reverse dependency order
  const reversed = [...this._sorted].reverse();
  for (const ext of reversed) {
    try {
      if (ext.deactivateClient) {
        await ext.deactivateClient();
      }
    } catch (err) {
      console.error(`Extension "${ext.name}" deactivation failed:`, err);
    }
  }
  this._stateMap.clear();
}
```

Activation runs in dependency order (dependencies first). Deactivation runs in reverse order (dependents first). Each extension is wrapped in `try/catch` — a failing extension does not prevent others from activating/deactivating.

#### `dispatchObserve(events, editor)`

```typescript
dispatchObserve(events: CRDTEvent[], editor: Editor): void {
  for (const ext of this._sorted) {
    if (!ext.observe) continue;
    try {
      ext.observe(events, editor);
    } catch (err) {
      this._emitter.emit('diagnostic', {
        level: 'error',
        source: 'extension',
        message: `Extension "${ext.name}" observe() threw`,
        detail: err,
      });
    }
  }

  // Update extension state
  for (const ext of this._sorted) {
    if (!ext.state) continue;
    const current = this._stateMap.get(ext.name);
    try {
      const next = ext.state.apply(current, events, editor);
      this._stateMap.set(ext.name, next);
    } catch (err) {
      this._emitter.emit('diagnostic', {
        level: 'error',
        source: 'extension',
        message: `Extension "${ext.name}" state.apply() threw`,
        detail: err,
      });
    }
  }
}
```

Called after every `Y.transact()` batch. Extensions observe in dependency order — an extension can rely on its dependencies having already processed the same events.

**Error isolation.** Each extension's `observe()` and `state.apply()` are wrapped in `try/catch`. In development mode, a warning is logged. In production, errors are silently caught. A broken extension never prevents other extensions from receiving events.

#### `collectDecorations(state, editor)`

```typescript
collectDecorations(state: DocumentState, editor: Editor): DecorationSet {
  const sets: DecorationSet[] = [];
  for (const ext of this._sorted) {
    if (!ext.decorations) continue;
    try {
      const set = ext.decorations(state, editor);
      if (set && set.decorations.length > 0) {
        sets.push(set);
      }
    } catch (err) {
      this._emitter.emit('diagnostic', {
        level: 'error',
        source: 'extension',
        message: `Extension "${ext.name}" decorations() threw`,
        detail: err,
      });
    }
  }

  if (sets.length === 0) return emptyDecorationSet();
  if (sets.length === 1) return sets[0];
  return mergeDecorationSets(...sets);
}
```

**Merge strategy.** Decoration sets from all extensions are concatenated. For inline decorations on the same text range within a block, attributes are merged at the rendering layer — later extensions in the array (later in dependency order) win on attribute key collisions. Block decorations at the same position stack (all rendered). In development mode, the manager warns on attribute key collisions to help debug visual conflicts.

#### `collectInputRules()` / `collectKeyBindings()`

```typescript
collectInputRules(): readonly InputRule[] {
  const rules: InputRule[] = [];
  for (const ext of this._sorted) {
    if (ext.inputRules) {
      rules.push(...ext.inputRules);
    }
  }
  return rules;
}

collectKeyBindings(registry: SchemaRegistry): readonly KeyBinding[] {
  const bindings: KeyBinding[] = [];

  // Extension-level bindings
  for (const ext of this._sorted) {
    if (ext.keyBindings) {
      bindings.push(...ext.keyBindings);
    }
  }

  // Schema-level bindings from block schemas
  for (const schema of registry.allBlocks()) {
    if (schema.keyBindings) {
      for (const binding of schema.keyBindings) {
        bindings.push({
          ...binding,
          _blockType: schema.type,  // implicit filter
        } as KeyBinding & { _blockType: string });
      }
    }
  }

  // Sort: higher priority first, then registration order (stable sort)
  bindings.sort((a, b) => {
    const pA = (a as { priority?: number }).priority ?? 0;
    const pB = (b as { priority?: number }).priority ?? 0;
    return pB - pA;
  });

  return bindings;
}
```

Input rules are evaluated in registration order. First match wins. Key bindings are sorted by priority (higher first), then by registration order within the same priority. Schema-level bindings carry an implicit `_blockType` filter — the binding only fires when the active block matches that type. Extension bindings at the same priority appear before schema bindings (extensions can override schema defaults).

#### `getExtensionState(name)`

```typescript
getExtensionState<T>(name: string): T | undefined {
  return this._stateMap.get(name) as T | undefined;
}
```

---

### Module: `editor/apply.ts` — `editor.apply()` and Mutation Pipeline

The write path (Spec Section 7.2). The most complex module in Wave 3.

#### Architecture

```typescript
export class ApplyPipeline {
  private readonly _doc: PenDocument;
  private readonly _crdtDoc: CRDTDocument;
  private readonly _adapter: CRDTAdapter;
  private readonly _registry: SchemaRegistry;
  private readonly _engine: SchemaEngineImpl;
  private readonly _emitter: EventEmitter;
  private readonly _selection: SelectionManagerImpl;
  private _applying = false;
  private _suppressObserver = false;
  private readonly _queue: { ops: DocumentOp[]; origin: OpOrigin }[] = [];

  get suppressObserver(): boolean { return this._suppressObserver; }

  // ── Typed CRDT accessors ──────────────────────────────────
  // PenDocument types blocks/blockOrder generically (CRDT-agnostic).
  // The apply pipeline works directly with the Yjs-shaped API:
  //   blocks   → Map<string, Map<string, unknown>>  (Y.Map of Y.Maps)
  //   blockOrder → Array-like with insert/delete/get  (Y.Array<string>)
  // We narrow once here instead of casting on every access.

  private get blocks(): CRDTBlockMap {
    return this._doc.blocks as CRDTBlockMap;
  }

  private get blockOrder(): CRDTArray<string> {
    return this._doc.blockOrder as CRDTArray<string>;
  }

  private get apps(): CRDTMap<CRDTMap<unknown>> {
    return this._doc.apps as CRDTMap<CRDTMap<unknown>>;
  }
```

Add this type alias block directly before the `ApplyPipeline` class:

```typescript
// Typed CRDT structure interfaces.
// These describe the Map/Array API surface used by the op executor.
// Both Yjs (Y.Map, Y.Array) and Loro satisfy this shape.

interface CRDTMap<V = unknown> {
  get(key: string): V | undefined;
  set(key: string, value: V): void;
  delete(key: string): void;
  has(key: string): boolean;
  entries(): IterableIterator<[string, V]>;
  toJSON(): Record<string, unknown>;
}

interface CRDTArray<T = unknown> {
  get(index: number): T | undefined;
  insert(index: number, items: T[]): void;
  delete(index: number, length?: number): void;
  toArray(): T[];
  readonly length: number;
}

type CRDTBlockMap = CRDTMap<CRDTMap<unknown>>;

interface CRDTText {
  insert(offset: number, text: string, attributes?: Record<string, unknown>): void;
  delete(offset: number, length: number): void;
  format(offset: number, length: number, attributes: Record<string, unknown>): void;
  toDelta(): Array<{ insert: string | object; attributes?: Record<string, unknown> }>;
  readonly length: number;
}
```

  constructor(
    doc: PenDocument,
    crdtDoc: CRDTDocument,
    adapter: CRDTAdapter,
    registry: SchemaRegistry,
    engine: SchemaEngineImpl,
    emitter: EventEmitter,
    selection: SelectionManagerImpl,
  ) {
    this._doc = doc;
    this._crdtDoc = crdtDoc;
    this._adapter = adapter;
    this._registry = registry;
    this._engine = engine;
    this._emitter = emitter;
    this._selection = selection;
  }
}
```

#### Reentry-Safe Apply

```typescript
// Overloads for apply() — supports both rest params (v01 spec) and array:
//   editor.apply(op1, op2, op3)              // rest params
//   editor.apply([op1, op2, op3])            // array
//   editor.apply(op1, { origin: 'ai' })      // rest with options
//   editor.apply([op1, op2], { origin: 'ai' }) // array with options
apply(
  opsOrFirst: DocumentOp[] | DocumentOp,
  ...rest: (DocumentOp | { origin?: OpOrigin; undoGroup?: boolean })[]
): void {
  let ops: DocumentOp[];
  let origin: OpOrigin = 'user';
  let undoGroup = false;

  if (Array.isArray(opsOrFirst)) {
    ops = opsOrFirst;
    const lastArg = rest[0];
    if (lastArg && 'origin' in lastArg) {
      origin = lastArg.origin ?? 'user';
      undoGroup = (lastArg as { undoGroup?: boolean }).undoGroup ?? false;
    }
  } else {
    ops = [opsOrFirst];
    for (const arg of rest) {
      if ('type' in arg) {
        ops.push(arg as DocumentOp);
      } else if ('origin' in arg) {
        origin = arg.origin ?? 'user';
        undoGroup = (arg as { undoGroup?: boolean }).undoGroup ?? false;
      }
    }
  }

  if (undoGroup) {
    const undo = this._editor.internals.getSlot<UndoManagerImpl>('undo:manager');
    undo?.stopCapturing();
  }

  this._applyInternal(ops, origin);
}

private _applyInternal(ops: DocumentOp[], origin: OpOrigin): void {
  if (this._applying) {
    this._queue.push({ ops, origin });
    return;
  }

  this._applying = true;
  try {
    this._executeOps(ops, origin);
    while (this._queue.length > 0) {
      const { ops: queued, origin: queuedOrigin } = this._queue.shift()!;
      this._executeOps(queued, queuedOrigin);
    }
  } finally {
    this._applying = false;
  }
}
```

If `apply()` is called during an active `Y.transact()` (e.g., from an extension's `observe()` hook), the ops are enqueued with their origin. After the current batch completes, the queue drains synchronously. Each dequeued batch gets its own `Y.transact()` with its own origin — ensuring correct undo tracking (extension-origin ops don't merge into user undo groups).

#### `_executeOps` — The Core Pipeline

```typescript
private _executeOps(ops: DocumentOp[], origin: OpOrigin): void {
  const affectedBlocks: string[] = [];
  const validatedOps: DocumentOp[] = [];

  for (const op of ops) {
    const blockId = this._opBlockId(op);

    // 1. Schema validation
    if (!this._validateOp(op)) continue;

    // 2. Block existence check
    if (blockId && !this._blockExists(blockId) && op.type !== 'insert-block') {
      this._emitter.emit('diagnostic', {
        level: 'warn',
        source: 'apply',
        message: `apply: skipping ${op.type} for non-existent block "${blockId}"`,
      });
      continue;
    }

    validatedOps.push(op);
  }

  if (validatedOps.length === 0) return;

  // 3. Suppress the CRDT observer during apply().
  // The observer (Wave 1 two-listener architecture) fires for every
  // Y.transact(). Without suppression, extensions would receive TWO
  // events for each apply() call: one from the observer (raw CRDT deltas)
  // and one from the pipeline (structured DocumentOps with correct origin).
  // The pipeline's event is strictly better — it has the original ops,
  // correct origin, and fires AFTER normalization. So we suppress the
  // observer during apply() and only emit the pipeline's event.
  this._suppressObserver = true;

  // 4. Execute all ops inside a single transact
  try {
    this._adapter.transact(this._crdtDoc, () => {
      for (const op of validatedOps) {
        const affected = this._executeSingleOp(op);
        affectedBlocks.push(...affected);
      }

      // 5. Mark affected blocks dirty
      for (const blockId of affectedBlocks) {
        this._engine.markDirty(blockId);
      }

      // 6. Run normalization
      this._engine.normalizeDirty();
    }, origin);
  } finally {
    this._suppressObserver = false;
  }

  // Construct CRDTEvent for extensions (the ONLY event for this transaction)
  const event: CRDTEvent = {
    origin,
    affectedBlocks: [...new Set(affectedBlocks)],
    ops: validatedOps,
    timestamp: Date.now(),
  };

  // Dispatch to extensions and emit change event.
  // Pipeline emits directly (observer is suppressed during apply).
  // Wrap in array to match PenEventMap.change: (events: CRDTEvent[]) => void.
  this._extensions.dispatchObserve([event], this._editor);
  this._emitter.emit('change', [event]);
}
```

**Observer suppression.** The CRDT observer (Wave 1) is the path for remote/collaborator changes; the apply pipeline above is the path for local changes. During `apply()`, `suppressObserver` is true, so the adapter observer callback returns early. This eliminates double-firing. The observer suppression check and the array wrapping are both visible in the `EditorImpl` constructor's observer wiring (see "CRDT observation" above). The example below is the conceptual flow:

```typescript
// Conceptual — the actual code lives in the EditorImpl constructor.
adapter.observe(crdtDoc, (event: CRDTEvent) => {
  if (pipeline.suppressObserver) return;
  extensionManager.dispatchObserve([event], editor);
  emitter.emit('change', [event]);
});
```

#### Schema Validation

```typescript
private _validateOp(op: DocumentOp): boolean {
  switch (op.type) {
    case 'insert-block': {
      const schema = this._registry.resolve(op.blockType);
      if (!schema) {
        this._emitter.emit('validation-error', {
          op, reason: `Unknown block type: "${op.blockType}"`,
        });
        return false;
      }
      if (schema.validateProps && op.props) {
        try {
          schema.validateProps(op.props);
        } catch {
          this._emitter.emit('validation-error', {
            op, reason: `Invalid props for block type "${op.blockType}"`,
          });
          return false;
        }
      }
      return true;
    }
    case 'convert-block': {
      const schema = this._registry.resolve(op.newType);
      if (!schema) {
        this._emitter.emit('validation-error', {
          op, reason: `Unknown block type: "${op.newType}"`,
        });
        return false;
      }
      return true;
    }
    case 'insert-inline-node': {
      const schema = this._registry.resolveInline(op.nodeType);
      if (!schema || schema.kind !== 'node') {
        this._emitter.emit('validation-error', {
          op, reason: `Unknown inline node type: "${op.nodeType}"`,
        });
        return false;
      }
      return true;
    }
    default:
      return true;
  }
}
```

Validation is strict: unknown block types, unknown inline node types, and invalid props are rejected. The op is dropped and a `validation-error` diagnostic event is emitted. The remaining ops in the batch continue processing.

#### Position Resolution

```typescript
private _resolvePosition(position: Position): number {
  const blockOrder = this._doc.blockOrder;

  if (position === 'first') return 0;
  if (position === 'last') return blockOrder.length;

  if ('after' in position) {
    for (let i = 0; i < blockOrder.length; i++) {
      if ((blockOrder.get(i) as string) === position.after) return i + 1;
    }
    return blockOrder.length;
  }

  if ('before' in position) {
    for (let i = 0; i < blockOrder.length; i++) {
      if ((blockOrder.get(i) as string) === position.before) return i;
    }
    return 0;
  }

  if ('parent' in position) {
    const parentMap = (this._doc.blocks as CRDTBlockMap).get(position.parent);
    if (!parentMap) return blockOrder.length;
    let children = parentMap.get('children');
    if (!children) {
      children = this._adapter.createArray();
      parentMap.set('children', children);
    }
    return Math.min(position.index, children.length);
  }

  return blockOrder.length;
}
```

`Position` is resolved to a numeric index suitable for `Y.Array.insert()`. The `parent` variant operates on a block's `children` `Y.Array`, not `blockOrder` — layout containers own their children structurally.

#### Per-Op CRDT Mappings

Each op type has a dedicated method that returns the list of affected block IDs:

```typescript
private _executeSingleOp(op: DocumentOp): string[] {
  switch (op.type) {
    case 'insert-block':    return this._insertBlock(op);
    case 'update-block':    return this._updateBlock(op);
    case 'delete-block':    return this._deleteBlock(op);
    case 'move-block':      return this._moveBlock(op);
    case 'convert-block':   return this._convertBlock(op);
    case 'split-block':     return this._splitBlock(op);
    case 'merge-blocks':    return this._mergeBlocks(op);
    case 'insert-text':     return this._insertText(op);
    case 'delete-text':     return this._deleteText(op);
    case 'format-text':     return this._formatText(op);
    case 'replace-text':    return this._replaceText(op);
    case 'insert-inline-node': return this._insertInlineNode(op);
    case 'remove-inline-node': return this._removeInlineNode(op);
    case 'set-selection':   return this._setSelection(op);
    case 'update-layout':   return this._updateLayout(op);
    case 'create-app':      return this._createApp(op);
    case 'update-app':      return this._updateApp(op);
    case 'delete-app':      return this._deleteApp(op);
    case 'insert-table-row':
    case 'delete-table-row':
    case 'insert-table-column':
    case 'delete-table-column':
    case 'merge-table-cells':
    case 'split-table-cell':
      return this._tableOp(op);
    case 'set-meta':         return this._setMeta(op);
    default:
      return [];
  }
}
```

##### `_setMeta`

```typescript
private _setMeta(op: SetMetaOp): string[] {
  const blockMap = (this._doc.blocks as CRDTBlockMap).get(op.blockId);
  if (!blockMap) return [];

  let metaMap = blockMap.get('meta') as CRDTMap<unknown> | undefined;
  if (!metaMap) {
    metaMap = this._adapter.createMap() as CRDTMap<unknown>;
    blockMap.set('meta', metaMap);
  }

  if (op.data === null) {
    metaMap.delete(op.namespace);
  } else {
    const nsMap = this._adapter.createMap() as CRDTMap<unknown>;
    for (const [key, value] of Object.entries(op.data)) {
      nsMap.set(key, value);
    }
    metaMap.set(op.namespace, nsMap);
  }

  return [op.blockId];
}
```

`set-meta` writes to (or removes from) the block's `meta` Y.Map under the given namespace. When `data` is non-null, it replaces the entire namespace entry with a new Y.Map — this avoids merge-patch complexity and matches the "set or clear" semantics defined in Wave 0.

##### `_insertBlock`

```typescript
private _insertBlock(op: InsertBlockOp): string[] {
  const schema = this._registry.resolve(op.blockType);
  if (!schema) return [];

  // Use adapter.initBlockMap to create the per-block CRDT structure.
  // This delegates to the adapter's factory methods, avoiding direct
  // Yjs constructor access from @pen/core.
  const contentType = Array.isArray(schema.content) ? 'nested'
    : schema.content === 'inline' ? 'inline'
    : schema.content === 'table' ? 'table'
    : 'none';
  const blockMap = this._adapter.initBlockMap(
    this._crdtDoc, op.blockId, op.blockType, contentType,
  );

  if (op.props && Object.keys(op.props).length > 0) {
    const propsMap = (blockMap as CRDTMap<unknown>).get('props') as CRDTMap<unknown> | undefined;
    for (const [key, value] of Object.entries(op.props)) {
      propsMap.set(key, value);
    }
  }

  const blockOrder = this._doc.blockOrder as CRDTArray<string>;

  if ('parent' in op.position) {
    const parentMap = (this._doc.blocks as CRDTBlockMap).get(op.position.parent);
    if (parentMap) {
      let children = parentMap.get('children');
      if (!children) {
        children = this._adapter.createArray();
        parentMap.set('children', children);
      }
      const idx = Math.min(op.position.index, children.length);
      children.insert(idx, [op.blockId]);
    }
  } else {
    const idx = this._resolvePosition(op.position);
    blockOrder.insert(idx, [op.blockId]);
  }

  return [op.blockId];
}
```

Creates a `Y.Map` for the new block, populates `type`, `props` (if non-empty), and the content structure appropriate for the schema's `content` type. Inserts the block ID into either `blockOrder` (top-level) or a parent's `children` array (layout nesting) based on `Position`.

##### `_updateBlock`

```typescript
private _updateBlock(op: UpdateBlockOp): string[] {
  const blockMap = (this._doc.blocks as CRDTBlockMap).get(op.blockId);
  if (!blockMap) return [];

  let propsMap = blockMap.get('props');
  if (!propsMap) {
    propsMap = this._adapter.createMap();
    blockMap.set('props', propsMap);
  }

  for (const [key, value] of Object.entries(op.props)) {
    if (value === undefined || value === null) {
      propsMap.delete(key);
    } else {
      propsMap.set(key, value);
    }
  }

  return [op.blockId];
}
```

Merge semantics: present keys are set, `null`/`undefined` keys are deleted. This allows selective property updates without providing the full props object.

##### `_deleteBlock`

```typescript
private _deleteBlock(op: DeleteBlockOp): string[] {
  const blocks = this._doc.blocks as CRDTBlockMap;
  const blockOrder = this._doc.blockOrder as CRDTArray<string>;

  blocks.delete(op.blockId);

  // Remove from blockOrder
  for (let i = blockOrder.length - 1; i >= 0; i--) {
    if (blockOrder.get(i) === op.blockId) {
      blockOrder.delete(i, 1);
    }
  }

  // Remove from any parent's children array
  for (const [, parentMap] of blocks.entries()) {
    const children = parentMap.get('children');
    if (!children) continue;
    for (let i = children.length - 1; i >= 0; i--) {
      if (children.get(i) === op.blockId) {
        children.delete(i, 1);
      }
    }
  }

  return [op.blockId];
}
```

Removes the block from `blocks` map and from all arrays that reference it (`blockOrder` and any `children` arrays). Iterates in reverse to avoid index shifting.

##### `_moveBlock`

```typescript
private _moveBlock(op: MoveBlockOp): string[] {
  const blockOrder = this._doc.blockOrder as CRDTArray<string>;

  // Remove from current position
  for (let i = blockOrder.length - 1; i >= 0; i--) {
    if (blockOrder.get(i) === op.blockId) {
      blockOrder.delete(i, 1);
      break;
    }
  }

  // Also remove from any children array
  for (const [, parentMap] of (this._doc.blocks as CRDTBlockMap).entries()) {
    const children = parentMap.get('children');
    if (!children) continue;
    for (let i = children.length - 1; i >= 0; i--) {
      if (children.get(i) === op.blockId) {
        children.delete(i, 1);
      }
    }
  }

  // Insert at new position
  if ('parent' in op.position) {
    const parentMap = (this._doc.blocks as CRDTBlockMap).get(op.position.parent);
    if (parentMap) {
      let children = parentMap.get('children');
      if (!children) {
        children = this._adapter.createArray();
        parentMap.set('children', children);
      }
      const idx = Math.min(op.position.index, children.length);
      children.insert(idx, [op.blockId]);
    }
  } else {
    const idx = this._resolvePosition(op.position);
    blockOrder.insert(idx, [op.blockId]);
  }

  return [op.blockId];
}
```

Implemented as delete-from-old + insert-at-new within a single `Y.transact()`. Concurrent moves of the same block can produce duplicate entries — normalization Rule 9 (Section 4.8) deduplicates.

##### `_convertBlock`

```typescript
private _convertBlock(op: ConvertBlockOp): string[] {
  const blockMap = (this._doc.blocks as CRDTBlockMap).get(op.blockId);
  if (!blockMap) return [];

  const oldType = blockMap.get('type') as string;
  const oldSchema = this._registry.resolve(oldType);
  const newSchema = this._registry.resolve(op.newType);
  if (!newSchema) return [];

  // Update type
  blockMap.set('type', op.newType);

  // Strip props not in new schema, add defaults for new props
  const propsMap = blockMap.get('props');
  if (propsMap) {
    // Remove props not in new schema
    const newPropKeys = new Set(Object.keys(newSchema.propSchema));
    for (const key of [...propsMap.keys()]) {
      if (!newPropKeys.has(key)) {
        propsMap.delete(key);
      }
    }
  }

  // Apply explicit newProps overrides
  if (op.newProps) {
    let props = blockMap.get('props');
    if (!props) {
      props = this._adapter.createMap();
      blockMap.set('props', props);
    }
    for (const [key, value] of Object.entries(op.newProps)) {
      props.set(key, value);
    }
  }

  // Content preservation logic
  const oldContent = oldSchema?.content;
  const newContent = newSchema.content;

  if (oldContent === 'inline' && newContent === 'none') {
    blockMap.delete('content');
  } else if (oldContent === 'none' && newContent === 'inline') {
    const ytext = this._adapter.createText();
    blockMap.set('content', ytext);
  }
  // inline → inline: content preserved (no action needed)
  // none → none: no content on either side

  return [op.blockId];
}
```

Conversion semantics follow the spec (Section 7.2): props are stripped/added per the new schema, inline content is preserved when both types support it, discarded when the new type has `content: 'none'`, and created empty when converting from `content: 'none'` to `content: 'inline'`.

##### `_splitBlock`

```typescript
private _splitBlock(op: SplitBlockOp): string[] {
  const blockMap = (this._doc.blocks as CRDTBlockMap).get(op.blockId);
  if (!blockMap) return [];

  const content = blockMap.get('content');
  if (!content || typeof content.toDelta !== 'function') return [];

  const oldType = blockMap.get('type') as string;
  const newType = op.newBlockType ?? oldType;
  const schema = this._registry.resolve(newType);

  // Extract content after offset
  const deltas = content.toDelta();
  const tailDeltas: any[] = [];
  let pos = 0;

  for (const delta of deltas) {
    const len = typeof delta.insert === 'string' ? delta.insert.length : 1;
    if (pos + len <= op.offset) {
      pos += len;
      continue;
    }

    if (pos < op.offset) {
      // Delta spans the split point
      const splitAt = op.offset - pos;
      const tailText = (delta.insert as string).slice(splitAt);
      if (tailText) {
        tailDeltas.push({ insert: tailText, attributes: delta.attributes });
      }
    } else {
      tailDeltas.push(delta);
    }
    pos += len;
  }

  // Delete tail from original
  const totalLength = content.length;
  if (op.offset < totalLength) {
    content.delete(op.offset, totalLength - op.offset);
  }

  // Create new block with tail content
  const newBlockMap = this._adapter.createMap() as CRDTMap<unknown>;
  newBlockMap.set('type', newType);

  const newText = this._adapter.createText() as CRDTText;
  for (const delta of tailDeltas) {
    newText.insert(newText.length, delta.insert, delta.attributes);
  }
  newBlockMap.set('content', newText);

  // Copy parentId if present
  const propsMap = blockMap.get('props');
  if (propsMap?.get('parentId')) {
    const newProps = this._adapter.createMap() as CRDTMap<unknown>;
    newProps.set('parentId', propsMap.get('parentId'));
    newBlockMap.set('props', newProps);
  }

  (this._doc.blocks as CRDTBlockMap).set(op.newBlockId, newBlockMap);

  // Insert new block right after original in blockOrder
  const blockOrder = this._doc.blockOrder as CRDTArray<string>;
  for (let i = 0; i < blockOrder.length; i++) {
    if (blockOrder.get(i) === op.blockId) {
      blockOrder.insert(i + 1, [op.newBlockId]);
      break;
    }
  }

  return [op.blockId, op.newBlockId];
}
```

Splits the `Y.Text` at `offset`. Content after the offset is extracted as deltas (preserving formatting attributes), deleted from the original, and inserted into a new block. The new block is placed immediately after the original in `blockOrder`. If `newBlockType` is provided (e.g. pressing Enter in a heading creates a paragraph), the new block uses that type.

`parentId` is copied so that splitting a list item preserves nesting.

##### `_mergeBlocks`

```typescript
private _mergeBlocks(op: MergeBlocksOp): string[] {
  const targetMap = (this._doc.blocks as CRDTBlockMap).get(op.targetBlockId);
  const sourceMap = (this._doc.blocks as CRDTBlockMap).get(op.sourceBlockId);
  if (!targetMap || !sourceMap) return [];

  const targetContent = targetMap.get('content');
  const sourceContent = sourceMap.get('content');

  if (targetContent && sourceContent &&
      typeof sourceContent.toDelta === 'function') {
    const deltas = sourceContent.toDelta();
    for (const delta of deltas) {
      targetContent.insert(
        targetContent.length,
        delta.insert,
        delta.attributes,
      );
    }
  }

  // Delete source block
  (this._doc.blocks as CRDTBlockMap).delete(op.sourceBlockId);
  const blockOrder = this._doc.blockOrder as CRDTArray<string>;
  for (let i = blockOrder.length - 1; i >= 0; i--) {
    if (blockOrder.get(i) === op.sourceBlockId) {
      blockOrder.delete(i, 1);
      break;
    }
  }

  return [op.targetBlockId, op.sourceBlockId];
}
```

Appends all deltas from the source block's `Y.Text` to the target block's `Y.Text`, preserving formatting. Then deletes the source block entirely.

##### Text Operations

```typescript
private _insertText(op: InsertTextOp): string[] {
  const blockMap = (this._doc.blocks as CRDTBlockMap).get(op.blockId);
  if (!blockMap) return [];
  const content = blockMap.get('content');
  if (!content) return [];

  const marks = op.marks ? this._resolveMarks(op.marks) : undefined;
  content.insert(op.offset, op.text, marks);
  return [op.blockId];
}

private _deleteText(op: DeleteTextOp): string[] {
  const blockMap = (this._doc.blocks as CRDTBlockMap).get(op.blockId);
  if (!blockMap) return [];
  const content = blockMap.get('content');
  if (!content) return [];

  content.delete(op.offset, op.length);
  return [op.blockId];
}

private _formatText(op: FormatTextOp): string[] {
  const blockMap = (this._doc.blocks as CRDTBlockMap).get(op.blockId);
  if (!blockMap) return [];
  const content = blockMap.get('content');
  if (!content) return [];

  // Merge patch semantics: null = remove mark
  content.format(op.offset, op.length, op.marks);
  return [op.blockId];
}

private _replaceText(op: ReplaceTextOp): string[] {
  const blockMap = (this._doc.blocks as CRDTBlockMap).get(op.blockId);
  if (!blockMap) return [];
  const content = blockMap.get('content');
  if (!content) return [];

  content.delete(op.offset, op.length);
  const marks = op.marks ? this._resolveMarks(op.marks) : undefined;
  content.insert(op.offset, op.text, marks);
  return [op.blockId];
}
```

`format-text` uses Yjs's `ytext.format()` which applies merge-patch semantics: present key = set mark, key set to `null` = remove mark, absent key = unchanged. `replace-text` executes delete + insert atomically within the same `Y.transact()`.

##### `_resolveMarks` — Mark Boundary Expand Enforcement

```typescript
private _resolveMarks(
  marks: Record<string, unknown>
): Record<string, unknown> {
  const resolved: Record<string, unknown> = {};
  for (const [type, value] of Object.entries(marks)) {
    const schema = this._registry.resolveInline(type);
    if (!schema) continue;
    if (schema.expand === 'none' && value !== null) {
      // expand: 'none' marks don't expand to adjacent inserts by default,
      // but when explicitly applied via apply(), they're set.
      resolved[type] = value;
    } else {
      resolved[type] = value;
    }
  }
  return resolved;
}
```

Mark `expand` policy (`'after'`, `'before'`, `'both'`, `'none'`) is primarily enforced by the field editor's `beforeinput` handler (Wave 5) and the streaming target. In `editor.apply()`, marks are set as-is because the caller explicitly requested them. The `expand` policy on `InlineSchema` governs what happens when text is inserted at a mark boundary without explicit marks — a concern of the input layer, not the programmatic API.

##### Inline Node and Layout Operations

```typescript
private _insertInlineNode(op: InsertInlineNodeOp): string[] {
  const blockMap = (this._doc.blocks as CRDTBlockMap).get(op.blockId);
  if (!blockMap) return [];
  const content = blockMap.get('content');
  if (!content) return [];

  content.insertEmbed(op.offset, { type: op.nodeType, ...op.props });
  return [op.blockId];
}

private _removeInlineNode(op: RemoveInlineNodeOp): string[] {
  const blockMap = (this._doc.blocks as CRDTBlockMap).get(op.blockId);
  if (!blockMap) return [];
  const content = blockMap.get('content');
  if (!content) return [];

  content.delete(op.offset, 1);
  return [op.blockId];
}

private _setSelection(op: SetSelectionOp): string[] {
  this._selection.setSelection(op.selection);
  return [];
}

private _updateLayout(op: UpdateLayoutOp): string[] {
  const blockMap = (this._doc.blocks as CRDTBlockMap).get(op.blockId);
  if (!blockMap) return [];

  let layoutMap = blockMap.get('layout');
  if (!layoutMap) {
    layoutMap = this._adapter.createMap() as CRDTMap<unknown>;
    blockMap.set('layout', layoutMap);
  }

  for (const [key, value] of Object.entries(op.layout)) {
    if (value === undefined || value === null) {
      layoutMap.delete(key);
    } else {
      layoutMap.set(key, value);
    }
  }

  return [op.blockId];
}
```

##### App Operations

```typescript
private _createApp(op: CreateAppOp): string[] {
  const apps = this._doc.apps as CRDTMap<CRDTMap<unknown>>;
  const appMap = this._adapter.createMap() as CRDTMap<unknown>;

  appMap.set('type', op.appType);
  appMap.set('placement', op.placement);

  if (op.config && Object.keys(op.config).length > 0) {
    const configMap = this._adapter.createMap() as CRDTMap<unknown>;
    for (const [key, value] of Object.entries(op.config)) {
      configMap.set(key, value);
    }
    appMap.set('config', configMap);
  }

  apps.set(op.appId, appMap);
  return [];
}

private _updateApp(op: UpdateAppOp): string[] {
  const appMap = (this._doc.apps as CRDTMap<CRDTMap<unknown>>).get(op.appId);
  if (!appMap) return [];

  let configMap = appMap.get('config');
  if (!configMap) {
    configMap = this._adapter.createMap() as CRDTMap<unknown>;
    appMap.set('config', configMap);
  }

  for (const [key, value] of Object.entries(op.patch)) {
    if (value === undefined || value === null) {
      configMap.delete(key);
    } else {
      configMap.set(key, value);
    }
  }
  return [];
}

private _deleteApp(op: DeleteAppOp): string[] {
  (this._doc.apps as CRDTMap<CRDTMap<unknown>>).delete(op.appId);
  return [];
}
```

##### Table Operations

```typescript
private _tableOp(op: DocumentOp): string[] {
  const tableOp = op as { type: string; blockId: string; index: number };
  const blockMap = (this._doc.blocks as CRDTBlockMap).get(tableOp.blockId);
  if (!blockMap) return [];

  const tableContent = blockMap.get('tableContent');
  if (!tableContent) return [];

  switch (op.type) {
    case 'insert-table-row': {
      const row = this._adapter.createArray() as CRDTArray<CRDTMap<unknown>>;
      const colCount = tableContent.length > 0
        ? (tableContent.get(0) as CRDTArray<unknown>).length
        : 1;
      for (let c = 0; c < colCount; c++) {
        const cell = this._adapter.createMap() as CRDTMap<unknown>;
        cell.set('content', this._adapter.createText());
        row.insert(row.length, [cell]);
      }
      tableContent.insert(tableOp.index, [row]);
      break;
    }
    case 'delete-table-row': {
      if (tableOp.index < tableContent.length) {
        tableContent.delete(tableOp.index, 1);
      }
      break;
    }
    case 'insert-table-column': {
      for (let r = 0; r < tableContent.length; r++) {
        const row = tableContent.get(r) as CRDTArray<CRDTMap<unknown>>;
        const cell = this._adapter.createMap() as CRDTMap<unknown>;
        cell.set('content', this._adapter.createText());
        row.insert(tableOp.index, [cell]);
      }
      break;
    }
    case 'delete-table-column': {
      for (let r = 0; r < tableContent.length; r++) {
        const row = tableContent.get(r) as CRDTArray<CRDTMap<unknown>>;
        if (tableOp.index < row.length) {
          row.delete(tableOp.index, 1);
        }
      }
      break;
    }
    case 'merge-table-cells':
    case 'split-table-cell':
      // M2 scope — stub that marks dirty
      break;
  }

  return [tableOp.blockId];
}
```

Table ops operate on the `tableContent` `Y.Array<Y.Array<Y.Map>>` structure — rows of cells, each cell containing a `Y.Text` for content. Cell maps and text instances are created via `this._adapter.createMap()` and `this._adapter.createText()`, consistent with how `_insertBlock` creates block structures — never via constructor references. `merge-table-cells` and `split-table-cell` are deferred to M2 (layout milestone).

#### Helper Methods

```typescript
private _blockExists(blockId: string): boolean {
  return (this._doc.blocks as CRDTBlockMap).has(blockId);
}

private _opBlockId(op: DocumentOp): string | null {
  if ('blockId' in op) return (op as { blockId: string }).blockId;
  if ('targetBlockId' in op) return (op as { targetBlockId: string }).targetBlockId;
  if ('appId' in op) return null;
  return null;
}

updateDocument(doc: PenDocument): void {
  Object.assign(this, { _doc: doc });
}
```

---

### Module: `editor/editor.ts` — `createEditor()` Factory

The entry point (Spec Section 6.4). Wires together all editor internals and returns an `Editor` instance.

#### `EditorImpl` Class

```typescript
class EditorImpl implements Editor {
  private readonly _adapter: CRDTAdapter;
  private readonly _registry: SchemaRegistry;
  private readonly _engine: SchemaEngineImpl;
  private readonly _extensions: ExtensionManagerImpl;
  private readonly _selection: SelectionManagerImpl;
  private readonly _emitter: EventEmitter;
  private readonly _pipeline: ApplyPipeline;
  private readonly _documentState: DocumentStateImpl;
  private _doc: PenDocument;
  private _crdtDoc: CRDTDocument;
  private _unsubObserve: Unsubscribe | null = null;
  readonly undoManager: UndoManager;

  constructor(options: CreateEditorOptions = {}) {
    // 1. Schema
    this._registry = options.schema ?? getDefaultSchema();

    // 2. CRDT adapter + document
    this._adapter = options.crdt?.adapter ?? getDefaultAdapter();
    this._crdtDoc = options.crdt?.document
      ?? this._adapter.createDocument();
    this._doc = this._createPenDocument(this._crdtDoc);

    // 3. Internal modules
    this._emitter = new EventEmitter();
    this._engine = new SchemaEngineImpl(this._registry, this._doc, this._crdtDoc);
    this._selection = new SelectionManagerImpl(
      this._doc, this._crdtDoc, this._registry, this._emitter
    );
    this._pipeline = new ApplyPipeline(
      this._doc, this._crdtDoc, this._adapter, this._registry,
      this._engine, this._emitter, this._selection,
    );
    this._documentState = new DocumentStateImpl(
      this._doc, this._registry
    );

    // 4. Extensions
    this._extensions = new ExtensionManagerImpl(this._emitter);
    const allExtensions = this._resolveExtensions(options);
    for (const ext of allExtensions) {
      this._extensions.register(ext);
    }

    // 5. Undo manager — extracted from @pen/undo extension
    this.undoManager = this._extractUndoManager(allExtensions);

    // 6. CRDT observation
    // CRDTAdapter.observe() fires a singular CRDTEvent per Y.transact().
    // PenEventMap.change expects CRDTEvent[] (Wave 0 canonical contract).
    // The editor wraps each adapter event in an array, as specified in Wave 1:
    // "Higher layers that expose event arrays wrap this as [event]."
    this._unsubObserve = this._adapter.observe(
      this._crdtDoc,
      (event: CRDTEvent) => {
        if (this._pipeline.suppressObserver) return;
        this._documentState.incrementalUpdate(event.affectedBlocks);
        this._extensions.dispatchObserve([event], this);
        this._emitter.emit('change', [event]);
      },
    );

    // 7. Activate extensions
    this._extensions.activateAll(this);

    // 8. Initial normalization
    this._engine.normalizeAll();
  }

  get clientId(): number {
    return this._adapter.getClientId(this._crdtDoc);
  }
}
```

**Construction order matters:**

1. Schema must exist before the CRDT adapter (validation depends on it).
2. CRDT adapter and document must exist before internal modules (they all reference `_doc`).
3. Internal modules must exist before extensions (extensions use the editor API).
4. Extensions are registered after all internal modules are ready.
5. Undo manager is extracted from the extensions after registration.
6. CRDT observation is set up after extensions so that the first observation dispatch can reach all extensions.
7. Extensions are activated after observation is wired.
8. Initial normalization runs last — it may trigger observation events that extensions need to process.

#### Default Extension Resolution

```typescript
private _resolveExtensions(options: CreateEditorOptions): Extension[] {
  const without = new Set(options.without ?? []);
  const defaults: Extension[] = [];

  if (!without.has('document-ops')) {
    defaults.push(documentOpsExtension());
  }
  if (!without.has('delta-stream')) {
    defaults.push(deltaStreamExtension());
  }
  if (!without.has('undo')) {
    defaults.push(undoExtension());
  }

  const userExtensions = options.extensions ?? [];
  return [...defaults, ...userExtensions];
}
```

Default extensions (`@pen/document-ops`, `@pen/delta-stream`, `@pen/undo`) are always included unless explicitly listed in `without`. User-provided extensions are appended after defaults, so they can depend on defaults.

`without` filters by extension **name**, not package name. `createEditor({ without: ['undo'] })` excludes the undo extension. `createEditor({ without: ['undo'], extensions: [myCustomUndo()] })` replaces the default undo with a custom implementation.

#### `loadDocument(doc)`

```typescript
loadDocument(doc: CRDTDocument): void {
  // 1. Deactivate extensions
  this._extensions.deactivateAll(this);

  // 2. Remove old CRDT observer
  if (this._unsubObserve) {
    this._unsubObserve();
    this._unsubObserve = null;
  }

  // 3. Replace document
  this._crdtDoc = doc;
  this._doc = this._createPenDocument(doc);

  // 4. Update all internal modules
  this._engine.updateDocument(this._doc);
  this._selection.updateDocument(this._doc);
  this._pipeline.updateDocument(this._doc);
  this._documentState = new DocumentStateImpl(
    this._doc, this._registry
  );

  // 5. Re-wire observation
  this._unsubObserve = this._adapter.observe(
    this._crdtDoc,
    (event: CRDTEvent) => {
      if (this._pipeline.suppressObserver) return;
      this._documentState.incrementalUpdate(event.affectedBlocks);
      this._extensions.dispatchObserve([event], this);
      this._emitter.emit('change', [event]);
    },
  );

  // 6. Re-activate extensions
  this._extensions.activateAll(this);

  // 7. Normalize new document
  this._engine.normalizeAll();
}
```

Full teardown and rebuild. Extensions are deactivated and re-activated so they can re-initialize their state for the new document.

#### `destroy()`

```typescript
destroy(): void {
  // 1. Deactivate extensions in reverse dependency order
  this._extensions.deactivateAll(this);

  // 2. Destroy awareness (unsubscribes from WebSocket, releases timers)
  this._awareness?.destroy();

  // 3. Remove CRDT observer
  if (this._unsubObserve) {
    this._unsubObserve();
    this._unsubObserve = null;
  }

  // 4. Remove all event listeners
  this._emitter.removeAllListeners();
}
```

#### Block Traversal Methods

```typescript
*blocks(type?: string): Iterable<BlockHandle> {
  for (let i = 0; i < this._doc.blockOrder.length; i++) {
    const id = (this._doc.blockOrder as CRDTArray<string>).get(i) as string;
    if (type) {
      const blockMap = (this._doc.blocks as CRDTBlockMap).get(id);
      if (!blockMap || blockMap.get('type') !== type) continue;
    }
    yield createBlockHandle(id, this._doc, this._crdtDoc, this._registry);
  }
}

getBlock(blockId: string): BlockHandle | null {
  if (!(this._doc.blocks as CRDTBlockMap).has(blockId)) return null;
  return createBlockHandle(blockId, this._doc, this._crdtDoc, this._registry);
}

firstBlock(): BlockHandle | null {
  if (this._doc.blockOrder.length === 0) return null;
  const id = (this._doc.blockOrder as CRDTArray<string>).get(0) as string;
  return createBlockHandle(id, this._doc, this._crdtDoc, this._registry);
}

lastBlock(): BlockHandle | null {
  const len = this._doc.blockOrder.length;
  if (len === 0) return null;
  const id = (this._doc.blockOrder as CRDTArray<string>).get(len - 1) as string;
  return createBlockHandle(id, this._doc, this._crdtDoc, this._registry);
}

blockCount(): number {
  return this._doc.blockOrder.length;
}
```

`blocks()` is a generator that lazily yields `BlockHandle` instances. The optional `type` filter checks the block's `type` field before yielding.

#### Mutation Delegation

```typescript
apply(...ops: DocumentOp[]): void {
  this._pipeline.apply(ops, 'user');
}

apply(
  ops: DocumentOp[],
  options?: { origin?: OpOrigin; undoGroup?: boolean },
): void {
  const origin = options?.origin ?? 'user';
  this._pipeline.apply(ops, origin);
}

applyWithOrigin(origin: OpOrigin, ...ops: DocumentOp[]): void {
  this.apply(ops, { origin });
}
```

#### Selection Delegation

```typescript
setSelection(selection: SelectionState): void {
  this._selection.setSelection(selection);
}

getSelection(): SelectionState {
  return this._selection.getSelection();
}

selectBlock(blockId: string): void {
  this._selection.selectBlock(blockId);
}

selectBlocks(blockIds: string[]): void {
  this._selection.selectBlocks(blockIds);
}

selectText(blockId: string, from: number, to: number): void {
  this._selection.selectText(blockId, from, to);
}

selectAll(): void {
  this._selection.selectAll();
}

getSelectedText(): string {
  return this._selection.getSelectedText();
}

getSelectedBlocks(): BlockHandle[] {
  return this._selection.getSelectedBlocks();
}
```

#### Event Delegation

```typescript
on<K extends keyof PenEventMap>(
  event: K, handler: PenEventMap[K]
): Unsubscribe;
on(event: string, handler: (...args: unknown[]) => void): Unsubscribe;
on(event: string, handler: (...args: unknown[]) => void): Unsubscribe {
  return this._emitter.on(event, handler);
}

onDocumentChange(callback: PenEventMap['documentChange']): Unsubscribe {
  return this.on('documentChange', callback);
}

onSelectionChange(callback: PenEventMap['selectionChange']): Unsubscribe {
  return this.on('selectionChange', callback);
}

normalizeAll(): void {
  this._engine.normalizeAll();
}

getDecorations(): DecorationSet {
  return this._extensions.collectDecorations(
    this._documentState, this
  );
}

getExtensionState<T>(name: string): T | undefined {
  return this._extensions.getExtensionState<T>(name);
}
```

#### Top-Level Export

```typescript
export function createEditor(options?: CreateEditorOptions): Editor {
  return new EditorImpl(options);
}
```

Replaces the throw stub from Wave 0.

---

## Package 2: `@pen/undo`

Extension implementing undo/redo (Spec Section 9).

### File Structure

```
packages/undo/src/
├── undo-extension.ts
├── undo-manager.ts
└── index.ts
```

### Module: `undo-manager.ts` — UndoManagerImpl

Wraps the CRDT adapter's `CRDTUndoManager` with the `UndoManager` interface.

```typescript
export class UndoManagerImpl implements UndoManager {
  private readonly _crdtUndo: CRDTUndoManager;
  private readonly _listeners = new Set<() => void>();
  private _idleTimer: ReturnType<typeof setTimeout> | null = null;
  private _groupTimeout = 1000;

  constructor(crdtUndo: CRDTUndoManager) {
    this._crdtUndo = crdtUndo;
  }

  undo(): boolean {
    return this._crdtUndo.undo();
  }

  redo(): boolean {
    return this._crdtUndo.redo();
  }

  canUndo(): boolean {
    return this._crdtUndo.canUndo();
  }

  canRedo(): boolean {
    return this._crdtUndo.canRedo();
  }

  stopCapturing(): void {
    this._crdtUndo.stopCapturing();
    this._clearIdleTimer();
    this._notifyListeners();
  }

  setGroupTimeout(ms: number): void {
    this._groupTimeout = ms;
  }

  setTrackedOrigins(origins: OpOrigin[]): void {
    // Delegate to CRDT undo manager's configuration
    // Yjs UndoManager accepts trackedOrigins as a Set
    (this._crdtUndo as { trackedOrigins: Set<string> }).trackedOrigins = new Set(origins);
  }

  onStackChange(callback: () => void): Unsubscribe {
    this._listeners.add(callback);
    return () => { this._listeners.delete(callback); };
  }

  // Called by the extension after each CRDT write
  resetIdleTimer(): void {
    this._clearIdleTimer();
    this._idleTimer = setTimeout(() => {
      this._crdtUndo.stopCapturing();
      this._notifyListeners();
    }, this._groupTimeout);
  }

  private _clearIdleTimer(): void {
    if (this._idleTimer !== null) {
      clearTimeout(this._idleTimer);
      this._idleTimer = null;
    }
  }

  private _notifyListeners(): void {
    for (const cb of this._listeners) {
      try { cb(); } catch { /* ignore */ }
    }
  }

  destroy(): void {
    this._clearIdleTimer();
    this._listeners.clear();
  }
}
```

**Idle timeout.** After each CRDT write (observed via the extension's `observe()` hook), `resetIdleTimer()` is called. If no further writes occur within `_groupTimeout` ms (default 1000), `stopCapturing()` inserts an undo boundary. This creates "undo by phrase" rather than "undo by character."

### Module: `undo-extension.ts` — UndoExtension

```typescript
export interface UndoExtensionOptions {
  groupTimeout?: number;
  trackedOrigins?: OpOrigin[];
}

export function undoExtension(options?: UndoExtensionOptions): Extension {
  let manager: UndoManagerImpl | null = null;

  return defineExtension({
    name: 'undo',

    activateClient: async (ctx) => {
      const { adapter, crdtDoc } = ctx.editor.internals;

      const crdtUndo = adapter.createUndoManager(crdtDoc, {
        trackedOrigins: options?.trackedOrigins ?? ['user', 'ai'],
        captureTimeout: options?.groupTimeout ?? 1000,
      });

      manager = new UndoManagerImpl(crdtUndo);
      if (options?.groupTimeout !== undefined) {
        manager.setGroupTimeout(options.groupTimeout);
      }

      ctx.editor.internals.setSlot('undo:manager', manager);
    },

    deactivateClient: async () => {
      manager?.destroy();
      manager = null;
    },

    observe: (events, editor) => {
      if (!manager) return;

      // Reset idle timer on every write
      for (const event of events) {
        if (event.origin === 'user' || event.origin === 'ai') {
          manager.resetIdleTimer();
        }
      }

      // Notify stack change listeners
      (manager as { _notifyListeners: () => void })._notifyListeners();
    },
  });
}
```

**Capture boundary points** (Spec Section 9.1):

1. **Field editor activation/deactivation** — handled by the rendering layer (Wave 5). The field editor calls `editor.undoManager.stopCapturing()` on activation and deactivation.
2. **AI generation start/end** — handled by `@pen/delta-stream`. The streaming target calls `editor.undoManager.stopCapturing()` at `gen-start` and `gen-end`.
3. **Idle timeout** — handled by the `resetIdleTimer()` mechanism above.
4. **Paste** — handled by the field editor's paste handler (Wave 5). Calls `stopCapturing()` before and after paste.
5. **Programmatic** — consumers call `editor.undoManager.stopCapturing()` directly.

**Origin filtering.** The Yjs `UndoManager` is configured with `trackedOrigins: ['user', 'ai']`. Only operations with these origins are captured. Collaborator writes (`origin: 'collaborator'`) are excluded — one user's Ctrl+Z never undoes another user's changes.

**Normalization undo pollution (Spec Section 9.5).** Because normalization runs inside the same `Y.transact()` as the user's ops, normalization writes are grouped in the same undo step. On undo, both user writes and normalization are reversed. The document then needs re-normalization — but because normalization is idempotent (Wave 2 invariant), the re-normalization produces the correct pre-edit state without spurious mutations.

---

## Package 3: `@pen/document-ops`

Default extension for block CRUD (Spec Section 14.1). Registers tools with the ToolServer.

### File Structure

```
packages/document-ops/src/
├── document-ops-extension.ts
├── tool-server.ts
├── tool-context.ts
├── tools/
│   ├── read-document.ts
│   ├── write-document.ts
│   ├── get-context.ts
│   ├── search-document.ts
│   ├── list-block-types.ts
│   ├── insert-block.ts
│   ├── update-block.ts
│   ├── delete-block.ts
│   └── move-block.ts
└── index.ts
```

### Module: `tool-server.ts` — ToolServerImpl

```typescript
export class ToolServerImpl implements ToolServer {
  private readonly _tools = new Map<string, ToolDefinition>();

  registerTool(def: ToolDefinition): void {
    if (this._tools.has(def.name)) {
      throw new Error(`Tool "${def.name}" is already registered`);
    }
    this._tools.set(def.name, def);
  }

  unregisterTool(name: string): void {
    this._tools.delete(name);
  }

  listTools(): readonly ToolDefinition[] {
    return [...this._tools.values()];
  }

  async executeTool(
    name: string,
    input: unknown,
    ctx: ToolContext,
  ): Promise<unknown> | AsyncIterable<unknown> {
    const def = this._tools.get(name);
    if (!def) {
      throw new Error(`Unknown tool: "${name}"`);
    }

    // Validate input against the tool's inputSchema (JSON Schema).
    // LLM tool calls frequently send malformed input — validating here
    // prevents the handler from operating on corrupt data and producing
    // silent CRDT corruption.
    if (def.inputSchema) {
      const errors = validateInput(input, def.inputSchema);
      if (errors.length > 0) {
        throw new Error(
          `Invalid input for tool "${name}": ${errors.join('; ')}`
        );
      }
    }

    return def.handler(input, ctx);
  }
}

function validateInput(
  input: unknown,
  schema: Record<string, unknown>,
): string[] {
  const errors: string[] = [];
  if (typeof input !== 'object' || input === null) {
    errors.push('Input must be an object');
    return errors;
  }

  const required = (schema.required ?? []) as string[];
  const properties = (schema.properties ?? {}) as Record<string, any>;
  const inputObj = input as Record<string, unknown>;

  for (const key of required) {
    if (!(key in inputObj) || inputObj[key] === undefined) {
      errors.push(`Missing required field: "${key}"`);
    }
  }

  for (const [key, value] of Object.entries(inputObj)) {
    const propSchema = properties[key];
    if (!propSchema) continue;

    if (propSchema.type === 'string' && typeof value !== 'string') {
      errors.push(`Field "${key}" must be a string, got ${typeof value}`);
    }
    if (propSchema.type === 'number' && typeof value !== 'number') {
      errors.push(`Field "${key}" must be a number, got ${typeof value}`);
    }
    if (propSchema.type === 'boolean' && typeof value !== 'boolean') {
      errors.push(`Field "${key}" must be a boolean, got ${typeof value}`);
    }
    if (propSchema.enum && !propSchema.enum.includes(value)) {
      errors.push(`Field "${key}" must be one of: ${propSchema.enum.join(', ')}`);
    }
  }

  return errors;
}
```

The tool server is a simple registry. Input validation against `inputSchema` is intentionally lightweight in M0 — the schema is provided to the LLM via `ToolSchema` and most LLM providers validate outputs against the schema. Full server-side validation can be added via a validator extension.

### Module: `tool-context.ts` — ToolContextImpl

```typescript
export class ToolContextImpl implements ToolContext {
  readonly editor: Editor;
  readonly docId: string;
  private readonly _emitFn: (part: PenStreamPart) => void;
  private _activeZones = new Map<string, { blockId: string }>();

  constructor(
    editor: Editor,
    docId: string,
    emitFn: (part: PenStreamPart) => void,
  ) {
    this.editor = editor;
    this.docId = docId;
    this._emitFn = emitFn;
  }

  emit(part: PenStreamPart): void {
    this._emitFn(part);
  }

  insertBlock(
    blockType: string,
    props: Record<string, unknown>,
    position: Position,
  ): string {
    const blockId = crypto.randomUUID();

    this.emit({
      type: 'block-insert',
      blockId,
      blockType,
      props,
      position,
    } as PenStreamPart);

    this.editor.applyWithOrigin('ai', {
      type: 'insert-block',
      blockId,
      blockType,
      props,
      position,
    });

    return blockId;
  }

  updateBlock(blockId: string, props: Record<string, unknown>): void {
    this.emit({
      type: 'block-update',
      blockId,
      props,
    } as PenStreamPart);

    this.editor.applyWithOrigin('ai', {
      type: 'update-block',
      blockId,
      props,
    });
  }

  deleteBlock(blockId: string): void {
    this.emit({
      type: 'block-delete',
      blockId,
    } as PenStreamPart);

    this.editor.applyWithOrigin('ai', {
      type: 'delete-block',
      blockId,
    });
  }

  beginStreaming(blockId: string): string {
    const zoneId = crypto.randomUUID();
    this._activeZones.set(zoneId, { blockId });

    this.emit({ type: 'gen-start', zoneId, blockId } as PenStreamPart);

    // Coordinate with @pen/delta-stream if available
    const streaming = this.editor.internals.getSlot<StreamingTargetImpl>('delta-stream:target');
    if (streaming) {
      streaming.beginStreaming(zoneId, blockId);
    }

    return zoneId;
  }

  appendDelta(zoneId: string, text: string): void {
    this.emit({ type: 'gen-delta', zoneId, delta: text } as PenStreamPart);

    const streaming = this.editor.internals.getSlot<StreamingTargetImpl>('delta-stream:target');
    if (streaming) {
      streaming.appendDelta(text);
    }
  }

  endStreaming(
    zoneId: string,
    status: 'complete' | 'cancelled' | 'error',
  ): void {
    this.emit({ type: 'gen-end', zoneId, status } as PenStreamPart);

    const streaming = this.editor.internals.getSlot<StreamingTargetImpl>('delta-stream:target');
    if (streaming) {
      streaming.endStreaming(status);
    }

    this._activeZones.delete(zoneId);
  }
}
```

The convenience methods emit stream parts AND apply operations to the editor. This dual-write keeps the server's `Y.Doc` in sync with what the client receives via the stream (Mode A architecture, Spec Section 13.7).

### Module: `document-ops-extension.ts`

```typescript
export function documentOpsExtension(): Extension {
  let toolServer: ToolServerImpl | null = null;

  return defineExtension({
    name: 'document-ops',

    activateClient: async (ctx) => {
      toolServer = new ToolServerImpl();

      toolServer.registerTool(readDocumentTool(ctx.editor));
      toolServer.registerTool(writeDocumentTool(ctx.editor));
      toolServer.registerTool(getContextTool(ctx.editor));
      toolServer.registerTool(searchDocumentTool(ctx.editor));
      toolServer.registerTool(listBlockTypesTool(ctx.editor));
      toolServer.registerTool(insertBlockTool(ctx.editor));
      toolServer.registerTool(updateBlockTool(ctx.editor));
      toolServer.registerTool(deleteBlockTool(ctx.editor));
      toolServer.registerTool(moveBlockTool(ctx.editor));

      // Expose tool server for @pen/delta-stream and @pen/ai
      ctx.editor.internals.setSlot('document-ops:toolServer', toolServer);
    },

    deactivateClient: async () => {
      toolServer = null;
    },
  });
}
```

### Tool Implementations

Each tool is a function returning a `ToolDefinition`. Tools follow a common pattern: input schema (JSON Schema), handler function, description for the LLM.

```typescript
// tools/read-document.ts
export function readDocumentTool(editor: Editor): ToolDefinition {
  return {
    name: 'read_document',
    description: 'Read document content in the specified format.',
    inputSchema: {
      type: 'object',
      properties: {
        format: { type: 'string', enum: ['json', 'markdown', 'summary'], default: 'markdown' },
        range: {
          type: 'object',
          properties: {
            startBlockId: { type: 'string' },
            endBlockId: { type: 'string' },
          },
        },
      },
    },
    handler: async (input: any) => {
      const format = input?.format ?? 'markdown';
      const blocks: any[] = [];

      for (const handle of editor.blocks()) {
        if (input?.range?.startBlockId || input?.range?.endBlockId) {
          // Range filtering logic
        }
        blocks.push({
          id: handle.id,
          type: handle.type,
          props: handle.props,
          content: handle.textContent(),
        });
      }

      if (format === 'summary') {
        return {
          blockCount: editor.blockCount(),
          types: [...new Set(blocks.map(b => b.type))],
          preview: blocks.slice(0, 5).map(b => ({
            type: b.type, content: b.content.slice(0, 100),
          })),
        };
      }

      return blocks;
    },
  };
}

// tools/insert-block.ts
export function insertBlockTool(editor: Editor): ToolDefinition {
  return {
    name: 'insert_block',
    description: 'Insert a new block at the specified position.',
    inputSchema: {
      type: 'object',
      required: ['position', 'blockType'],
      properties: {
        position: {},
        blockType: { type: 'string' },
        props: { type: 'object' },
      },
    },
    handler: async (input: any) => {
      const blockId = crypto.randomUUID();
      editor.applyWithOrigin('ai', {
        type: 'insert-block',
        blockId,
        blockType: input.blockType,
        props: input.props ?? {},
        position: input.position,
      });
      return { blockId };
    },
  };
}

// tools/search-document.ts
export function searchDocumentTool(editor: Editor): ToolDefinition {
  return {
    name: 'search_document',
    description: 'Search for text in the document.',
    inputSchema: {
      type: 'object',
      required: ['query'],
      properties: {
        query: { type: 'string' },
        caseSensitive: { type: 'boolean', default: false },
        maxResults: { type: 'number', default: 20 },
      },
    },
    handler: async (input: any) => {
      const query = input.query as string;
      const caseSensitive = input.caseSensitive ?? false;
      const maxResults = input.maxResults ?? 20;
      const results: any[] = [];

      const searchStr = caseSensitive ? query : query.toLowerCase();

      for (const handle of editor.blocks()) {
        const text = handle.textContent();
        const compareText = caseSensitive ? text : text.toLowerCase();
        let offset = 0;

        while (results.length < maxResults) {
          const idx = compareText.indexOf(searchStr, offset);
          if (idx === -1) break;
          results.push({
            blockId: handle.id,
            offset: idx,
            length: query.length,
            snippet: text.slice(
              Math.max(0, idx - 30),
              Math.min(text.length, idx + query.length + 30)
            ),
          });
          offset = idx + 1;
        }

        if (results.length >= maxResults) break;
      }

      return results;
    },
  };
}
```

The remaining tools (`write_document`, `get_context`, `get_cursor_context`, `list_block_types`, `update_block`, `delete_block`, `move_block`) follow the same pattern: a thin wrapper around `editor.apply()` or `editor.blocks()` with proper origin tagging (`'ai'`).

---

## Package 4: `@pen/delta-stream`

Streaming extension (Spec Sections 14.4, 11).

### File Structure

```
packages/delta-stream/src/
├── delta-stream-extension.ts
├── streaming-target.ts
├── process-stream.ts
├── batch.ts
└── index.ts
```

### Module: `batch.ts` — BatchingBuffer

Token accumulation window for CRDT write batching.

```typescript
export class BatchingBuffer {
  private _buffer = '';
  private _timer: ReturnType<typeof setTimeout> | null = null;
  private readonly _flushCallback: (text: string) => void;
  private readonly _windowMs: number;

  constructor(
    flushCallback: (text: string) => void,
    windowMs = 50,
  ) {
    this._flushCallback = flushCallback;
    this._windowMs = windowMs;
  }

  append(delta: string): void {
    this._buffer += delta;

    if (this._timer === null) {
      this._timer = setTimeout(() => this.flush(), this._windowMs);
    }
  }

  flush(): void {
    if (this._timer !== null) {
      clearTimeout(this._timer);
      this._timer = null;
    }

    if (this._buffer.length === 0) return;

    const text = this._buffer;
    this._buffer = '';
    this._flushCallback(text);
  }

  get pending(): boolean {
    return this._buffer.length > 0;
  }

  destroy(): void {
    if (this._timer !== null) {
      clearTimeout(this._timer);
      this._timer = null;
    }
    this._buffer = '';
  }
}
```

**Window size.** Default 50ms. At 100 tokens/second, this batches ~5 tokens per CRDT write. The window is configurable: increase to 100ms for higher throughput with slightly more latency, or decrease to 20ms for lower latency at the cost of more CRDT operations.

The `flush()` method clears the buffer and calls `_flushCallback` with the accumulated text. The callback performs the actual `ytext.insert()` call. `flush()` is also called explicitly by `endStreaming()` to ensure no tokens are lost.

### Module: `streaming-target.ts` — StreamingTargetImpl

```typescript
export class StreamingTargetImpl implements StreamingTarget {
  private readonly _editor: Editor;
  private readonly _engine: SchemaEngineImpl;
  private _buffer: BatchingBuffer | null = null;
  private _zone: GenerationZone | null = null;
  private _blockId: string | null = null;

  constructor(editor: Editor, engine: SchemaEngineImpl) {
    this._editor = editor;
    this._engine = engine;
  }

  get generationZone(): GenerationZone | null {
    return this._zone;
  }

  beginStreaming(zoneId: string, blockId: string): void {
    // Insert undo boundary before generation
    this._editor.undoManager.stopCapturing();

    this._blockId = blockId;
    this._zone = {
      id: zoneId,
      blockId,
      startedAt: Date.now(),
      status: 'active',
    };

    // Defer normalization for this block during streaming
    this._engine.deferBlock(blockId);

    // Set up batching buffer
    this._buffer = new BatchingBuffer(
      (text) => this._flushToYText(text),
      50,
    );
  }

  appendDelta(delta: string): void {
    if (!this._buffer || !this._blockId) return;
    this._buffer.append(delta);
  }

  endStreaming(status: 'complete' | 'cancelled' | 'error'): void {
    // Flush remaining buffer
    this._buffer?.flush();
    this._buffer?.destroy();
    this._buffer = null;

    if (this._blockId) {
      // Mark block dirty and undefer normalization
      this._engine.markDirty(this._blockId);
      this._engine.undeferBlock(this._blockId);
    }

    // Insert undo boundary after generation
    this._editor.undoManager.stopCapturing();

    // Update zone status
    if (this._zone) {
      this._zone = { ...this._zone, status };
    }

    this._blockId = null;
    this._zone = null;
  }

  private _flushToYText(text: string): void {
    if (!this._blockId) return;

    const blockMap = (
      this._editor.internals.doc.blocks as CRDTBlockMap
    ).get(this._blockId);
    if (!blockMap) return;

    const content = blockMap.get('content');
    if (!content) return;

    const { adapter, crdtDoc } = this._editor.internals;

    adapter.transact(crdtDoc, () => {
      // Insert at end of current text
      const len = content.length as number;
      content.insert(len, text);

      // Mark dirty (but normalization is deferred)
      this._engine.markDirty(this._blockId!);
    }, 'ai');
  }
}
```

**Lifecycle:**

1. `beginStreaming(zoneId, blockId)` — inserts an undo boundary (`stopCapturing()`), creates the `GenerationZone`, defers normalization for the target block via `schemaEngine.deferBlock()`, and sets up the batching buffer.

2. `appendDelta(delta)` — appends the token to the buffer. The buffer flushes to `_flushToYText()` on the configured window (default 50ms). Each flush is a single `ytext.insert()` inside a `Y.transact()` with `'ai'` origin. The block is marked dirty on each flush, but normalization is deferred.

3. `endStreaming(status)` — flushes the remaining buffer, undeferrs the block (which triggers deferred normalization), inserts another undo boundary. The entire generation from `gen-start` through `gen-end` forms a single undo step.

**Mark boundary `expand` enforcement.** During streaming, text is always appended at the end of the block's `Y.Text`. Mark `expand` policies determine whether the new text inherits marks from the preceding text. `expand: 'after'` marks (bold, italic, etc.) naturally extend via Yjs's default behavior — inserting after a marked range inherits the mark. `expand: 'none'` marks (link, code) do not extend. The streaming target does not need explicit enforcement because Yjs's `Y.Text` handles `expand` natively via attribute retention at insert boundaries.

### Module: `process-stream.ts` — processStream()

Maps `AsyncIterable<PenStreamPart>` to editor operations.

```typescript
export async function processStream(
  stream: AsyncIterable<PenStreamPart>,
  editor: Editor,
  options?: {
    onPart?: (part: PenStreamPart) => void;
    signal?: AbortSignal;
  },
): Promise<void> {
  const streaming = editor.internals.getSlot<StreamingTargetImpl>('delta-stream:target')!;
  const toolServer = editor.internals.getSlot<ToolServerImpl>('document-ops:toolServer') ?? null;
  const dataStore = new Map<string, unknown>();

  for await (const part of stream) {
    if (options?.signal?.aborted) break;
    options?.onPart?.(part);

    switch (part.type) {
      case 'gen-start':
        streaming.beginStreaming(part.zoneId, part.blockId);
        break;

      case 'gen-delta':
        streaming.appendDelta(part.delta);
        break;

      case 'gen-end':
        streaming.endStreaming(part.status);
        break;

      case 'block-insert': {
        const blockId = part.blockId ?? crypto.randomUUID();
        editor.applyWithOrigin('ai', {
          type: 'insert-block',
          blockId,
          blockType: part.blockType,
          props: part.props ?? {},
          position: part.position,
        });
        break;
      }

      case 'block-update':
        editor.applyWithOrigin('ai', {
          type: 'update-block',
          blockId: part.blockId,
          props: part.props,
        });
        break;

      case 'block-delete':
        editor.applyWithOrigin('ai', {
          type: 'delete-block',
          blockId: part.blockId,
        });
        break;

      case 'block-move':
        editor.applyWithOrigin('ai', {
          type: 'move-block',
          blockId: part.blockId,
          position: part.position,
        });
        break;

      case 'tool-input-available': {
        if (!toolServer) break;
        try {
          const result = await toolServer.executeTool(
            part.toolName,
            part.input,
            new ToolContextImpl(
              editor,
              '',
              (emitted) => options?.onPart?.(emitted),
            ),
          );

          options?.onPart?.({
            type: 'tool-output',
            toolCallId: part.toolCallId,
            output: result,
          } as PenStreamPart);
        } catch (err) {
          options?.onPart?.({
            type: 'tool-error',
            toolCallId: part.toolCallId,
            error: String(err),
          } as PenStreamPart);
        }
        break;
      }

      case 'error':
        // Cancel any active generation
        if (streaming.generationZone) {
          streaming.endStreaming('error');
        }
        break;

      case 'abort':
        if (streaming.generationZone) {
          streaming.endStreaming('cancelled');
        }
        break;

      case 'ping':
        // Keepalive — no-op
        break;

      case 'done':
        // Stream complete
        break;

      default: {
        // Data parts: type matches `data-${string}`
        const partType = (part as { type: string }).type;
        if (partType.startsWith('data-')) {
          const dataPart = part as { type: string; id?: string; data: unknown; transient?: boolean };
          const key = dataPart.id ?? partType;
          dataStore.set(key, dataPart.data);
        }
        break;
      }
    }
  }

  // Ensure any active streaming is cleaned up
  if (streaming.generationZone) {
    streaming.endStreaming('error');
  }
}
```

**Part routing.** Each stream part type maps to a specific editor action:

| Part Type | Action |
|---|---|
| `gen-start` | `streaming.beginStreaming(zoneId, blockId)` |
| `gen-delta` | `streaming.appendDelta(delta)` (batched) |
| `gen-end` | `streaming.endStreaming(status)` |
| `block-insert` | validate against schema → `editor.applyWithOrigin('ai', ...)` |
| `block-update` | `editor.applyWithOrigin('ai', ...)` |
| `block-delete` | `editor.applyWithOrigin('ai', ...)` |
| `block-move` | `editor.applyWithOrigin('ai', ...)` |
| `tool-input-available` | `toolServer.executeTool()` → emit `tool-output` or `tool-error` |
| `data-*` | reconcile by `id` in data store (Map-based, replace on match) |
| `error` | cancel active generation |
| `abort` | cancel active generation |
| `ping` | no-op (keepalive) |
| `done` | stream complete |

**Error safety.** If the stream ends (iterator exhausts or is aborted) while a generation is active, `endStreaming('error')` is called to clean up state, flush buffers, and undefer normalization.

### Module: `delta-stream-extension.ts`

```typescript
export function deltaStreamExtension(): Extension {
  let streamingTarget: StreamingTargetImpl | null = null;

  return defineExtension({
    name: 'delta-stream',

    activateClient: async (ctx) => {
      const { engine } = ctx.editor.internals;
      streamingTarget = new StreamingTargetImpl(ctx.editor, engine);

      ctx.editor.internals.setSlot('delta-stream:target', streamingTarget);
    },

    deactivateClient: async () => {
      if (streamingTarget?.generationZone) {
        streamingTarget.endStreaming('error');
      }
      streamingTarget = null;
    },
  });
}
```

### Streaming Normalization Deferral

During active AI generation, the block being streamed into is normalized only when the generation completes. The mechanism relies on `SchemaEngineImpl.deferBlock()` / `undeferBlock()` (Wave 2):

1. `gen-start` → `schemaEngine.deferBlock(blockId)`. The block is added to `deferredBlockIds`.
2. Each `gen-delta` flush → `schemaEngine.markDirty(blockId)`. The block is added to `dirtyBlockIds`. `normalizeDirty()` skips it because it's in `deferredBlockIds`.
3. `gen-end` → `schemaEngine.undeferBlock(blockId)`. The block is removed from `deferredBlockIds`. If it's dirty, `normalizeBlock()` runs immediately.

**Remote peer coordination.** When a peer sees another peer's awareness state with `streaming: { blockId }`, it defers that block locally. This prevents two peers from fighting over normalization of a block being streamed into. The awareness state is set by the streaming target on `beginStreaming` and cleared on `endStreaming`.

```typescript
// In streaming-target.ts, beginStreaming:
const awareness = this._editor.internals.awareness;
if (awareness) {
  const local = awareness.getStates().get(this._editor.clientID) ?? {};
  awareness.setLocalState({
    ...local,
    streaming: { blockId, zoneId },
  });
}

// In streaming-target.ts, endStreaming:
const awareness = this._editor.internals.awareness;
if (awareness) {
  const local = awareness.getStates().get(this._editor.clientID) ?? {};
  const { streaming: _omit, ...rest } = local;
  awareness.setLocalState(rest);
}
```

**Error recovery.** If `gen-end` is never received (network failure, crash), the block remains in `deferredBlockIds` until the awareness state clears (awareness has a 30-second timeout). The editor's reconnection handler calls `undeferBlock` for blocks that were deferred by disconnected peers:

```typescript
// In the awareness change handler (editor internals):
import type { AwarenessChangeEvent } from '@pen/types';

const prevStates = new Map<number, Record<string, unknown>>();

awareness.on('change', ({ removed }: AwarenessChangeEvent) => {
  for (const clientId of removed) {
    const prev = prevStates.get(clientId);
    if (prev) {
      const streaming = (prev as { streaming?: { blockId?: string } }).streaming;
      if (streaming?.blockId) {
        engine.undeferBlock(streaming.blockId);
      }
      prevStates.delete(clientId);
    }
  }

  const nextStates = awareness.getStates();
  for (const [clientId, state] of nextStates) {
    prevStates.set(clientId, state);
  }
});
```

---

## Key Data Flow

### All Write Paths

```
User keystroke        → beforeinput → ytext.insert() ─┐
                                                       │
AI streaming token    → gen-delta → BatchingBuffer     │
                        → flush (50ms) → ytext.insert()┤
                                                       ├→ Y.transact() batch
Programmatic / LLM    → editor.apply(ops)              │   → Yjs observe fires (singular CRDTEvent)
tool call               → _validateOp()                │     → (suppressed during apply() path)
                        → _executeSingleOp()            │     → for remote: wrap [event], dispatch + emit
                        → markDirty + normalizeDirty ──┤     → UndoManager captures
                        → dispatchObserve + emit ──────┤     → EventEmitter emits 'change' with [event]
                                                       │
Collaborator          → Yjs binary update → apply ─────┘
```

### editor.apply() Detail

```
editor.apply({ type: 'insert-block', ... })
  │
  ├─ reentry check: _applying?
  │   yes → _queue.push({ ops, origin }), return
  │   no  → _applying = true
  │
  ├─ for each op:
  │   ├─ _validateOp(op)        → drop + emit 'validation-error' if invalid
  │   └─ _blockExists(blockId)  → drop + warn if non-existent (except insert-block)
  │
  ├─ adapter.transact(doc, () => {
  │   ├─ for each validated op:
  │   │   └─ _executeSingleOp(op) → CRDT writes (incl. set-meta)
  │   ├─ for each affected blockId:
  │   │   └─ engine.markDirty(blockId)
  │   └─ engine.normalizeDirty()
  │ }, origin)
  │
  ├─ construct CRDTEvent { origin, affectedBlocks, ops, timestamp }
  ├─ extensionManager.dispatchObserve([event], editor)
  ├─ emitter.emit('change', [event])   ← array, matches PenEventMap
  │
  └─ drain queue:
      while (_queue.length > 0)
        _executeOps(queue.shift().ops, queue.shift().origin)
      _applying = false
```

### AI Streaming Detail

```
processStream(AsyncIterable<PenStreamPart>)
  │
  ├─ gen-start { zoneId, blockId }
  │   ├─ undoManager.stopCapturing()
  │   ├─ engine.deferBlock(blockId)
  │   └─ new BatchingBuffer(flushToYText, 50ms)
  │
  ├─ gen-delta { delta } × N tokens
  │   └─ buffer.append(delta)
  │       └─ [after 50ms] flush:
  │           └─ transact('ai', ytext.insert(len, accumulated))
  │               └─ engine.markDirty(blockId) [deferred — no normalize]
  │
  └─ gen-end { status }
      ├─ buffer.flush() [final tokens]
      ├─ engine.undeferBlock(blockId)
      │   └─ normalizeBlock(blockId) [runs now]
      └─ undoManager.stopCapturing()
          └─ [entire generation = one undo step]
```

---

## Key Decisions

- **`editor.apply()` is the only programmatic mutation path.** User keystrokes and AI deltas bypass `apply()` — they write to `Y.Text` directly via `beforeinput` interception (keystrokes) or `StreamingTarget.appendDelta()` (AI). `apply()` is for structured operations: insert/delete/move blocks, format text, split/merge. This dual-path design is critical for performance — at 100+ tokens/second, each token cannot afford schema validation and normalization overhead. The `apply()` path validates and normalizes; the direct paths don't need to because they are structurally valid by construction.

- **Schema validation in `apply()` is strict.** Unknown block types, unknown inline node types, and invalid props are rejected. The op is dropped, not committed. A `validation-error` diagnostic event is emitted so the UI or debugging tools can surface the issue. This fail-fast approach catches LLM hallucinations (e.g., inventing a block type that doesn't exist) before they corrupt the document.

- **Reentry queuing, not blocking or throwing.** When `apply()` is called from within an `observe()` handler (which is called from within a `Y.transact()`), the ops are queued rather than executed immediately. Each dequeued batch gets its own `Y.transact()` with its own origin. Alternative: throw on reentrant `apply()` — rejected because extensions legitimately need to react to changes by applying more changes. Alternative: execute immediately within the same transaction — rejected because origin tracking would be wrong (extension-origin ops would merge into the user's undo group).

- **`@pen/document-ops` tools are the LLM's interface.** The LLM never calls `editor.apply()` directly. It calls tools like `write_document`, `insert_block`, `delete_block` through the `ToolServer`. These tools validate inputs, resolve positions, and translate between LLM-friendly formats (Markdown, JSON) and `DocumentOp` operations. This indirection provides a stable API contract, schema validation at the tool boundary, and streaming support for text content.

- **Extension error isolation.** Every extension hook (`observe`, `decorations`, `activateClient`, `deactivateClient`, `state.apply`) is wrapped in `try/catch`. A broken extension logs a warning in development mode and is silently caught in production. This is a hard requirement — one misbehaving extension must never prevent other extensions from functioning or the editor from operating.

- **DocumentState is incrementally updated.** `DocumentStateImpl.incrementalUpdate()` checks if affected blocks' cached positions are still valid. If the `blockOrder` length changed or positions are stale, a full rebuild runs. For the common case (text edits within existing blocks), no rebuild is needed. This keeps the hot path fast while handling structural changes correctly.

- **Normalization runs inside `Y.transact()`.** Normalization writes are grouped with the user's writes in the same Yjs transaction. This ensures they form a single undo step. The idempotency invariant from Wave 2 guarantees that undoing a normalized operation and re-normalizing produces the correct state without spurious mutations.

- **Streaming uses `'ai'` origin for all CRDT writes.** This ensures that AI-generated content is tracked separately from user content in the undo manager. The triggering client's `UndoManager` tracks both `'user'` and `'ai'` origins. Other collaborators' `UndoManagers` do not track `'ai'` from that client.

- **Block placement invariant: a block ID appears in exactly one of `blockOrder` or a parent's `children` array, never both.** `_insertBlock` inserts into one based on `Position` type (`parent` → `children`, everything else → `blockOrder`). `_deleteBlock` scans both to remove stale references (defensive). `_moveBlock` removes from both and re-inserts into one. This invariant is enforced by the op executors and checked by normalization Rule 9 (duplicate/cross-array deduplication).

- **`change` event always carries `CRDTEvent[]`.** Both the adapter observer path (wrapping the singular event as `[event]`) and the apply pipeline path emit arrays, matching the canonical `PenEventMap.change: (events: CRDTEvent[]) => void` contract from Wave 0. Consumers never need to handle both singular and array forms.

---

## Acceptance Criteria

1. `createEditor()` with no arguments returns a working editor with default schema, Yjs, and default extensions.
2. `editor.apply({ type: 'insert-block', blockId: 'b1', blockType: 'paragraph', props: {}, position: 'last' })` creates a block visible via `editor.getBlock('b1')`.
3. `editor.apply({ type: 'insert-text', blockId: 'b1', offset: 0, text: 'hello' })` → `editor.getBlock('b1').textContent()` returns `'hello'`.
4. `editor.apply({ type: 'split-block', blockId: 'b1', offset: 5, newBlockId: 'b2' })` splits correctly — original has first 5 chars, new block has the rest.
5. `editor.apply({ type: 'merge-blocks', targetBlockId: 'b1', sourceBlockId: 'b2' })` combines text and deletes source.
6. Applying an op with an unknown block type emits a `validation-error` diagnostic and does not modify the CRDT.
7. Extension `observe()` fires after `apply()` with correct `CRDTEvent`.
8. Undo reverses the most recent capture window. Redo restores it.
9. Undo after field editor activation/deactivation boundaries are correct (separate undo steps).
10. `processStream()` with a sequence of `gen-start`, `gen-delta`, `gen-end` parts produces text in the CRDT.
11. Streaming batching: multiple rapid `gen-delta` parts are accumulated and flushed in one CRDT write.
12. `editor.on('change', handler)` fires after mutations.
13. `editor.on('selectionChange', handler)` fires after `setSelection()`.
14. Extension dependency resolution: registering an extension with a missing dependency throws.
15. Reentry safety: calling `apply()` from within an `observe()` handler does not throw; ops are queued and executed after the current batch.
16. `editor.blocks()` generator yields handles in document order.
17. `editor.getBlock(id)` returns `null` for non-existent block IDs.
18. `convert-block` from `content: 'inline'` to `content: 'inline'` preserves the block's text content.
19. `convert-block` from `content: 'inline'` to `content: 'none'` discards the block's content.
20. `move-block` with `{ after: 'b1' }` places the block immediately after `b1` in `blockOrder`.
21. `move-block` with `{ before: 'b1' }` places the block immediately before `b1` in `blockOrder`.
22. `processStream()` with a `block-insert` part creates a block with schema validation (unknown types are rejected).
23. Token batching: 10 rapid `gen-delta` parts within 50ms produce a single CRDT write containing all 10 tokens.
24. `editor.destroy()` deactivates extensions in reverse dependency order.
25. `loadDocument()` re-initializes all extensions with new document state; `editor.getBlock()` reflects the new document.
26. Tool server `executeTool()` with an unknown tool name throws.
27. `createDecorationSet([])` returns `emptyDecorationSet()`.
28. `DecorationSet.map(mapping)` returns the same instance when no decorations are affected.
29. `selectText(blockId, from, to)` clamps offsets to `Y.Text.length`.
30. Circular extension dependencies are detected and throw at registration time.
31. `editor.apply({ type: 'set-meta', blockId: 'b1', namespace: 'suggestion', data: { action: 'insert-block' } })` writes to the block's `meta` Y.Map, and `editor.getBlock('b1').meta('suggestion')` returns the data.
32. `editor.apply({ type: 'set-meta', blockId: 'b1', namespace: 'suggestion', data: null })` removes the namespace from `meta`.
33. `editor.on('change', handler)` receives `CRDTEvent[]` (array), not a singular event — matching `PenEventMap.change` contract.
34. `getSelectedText()` returns correct text for backwards selections (focus before anchor).
35. `replaceSelection(blocks)` with `Block[]` content inserts all blocks at the correct position after deleting the selection.

---

## Known Errata (Fix During Implementation)

These issues were identified during pre-build review and must be addressed when implementing this wave:

1. **`documentChange` event must be emitted by the apply pipeline.** After `_executeOps` completes and normalization runs, emit `documentChange` with the processed ops, origin, and affected block IDs. Wave 5's rendering subscribes to this event.

2. **`onBeforeApply` hooks must be invoked.** The apply pipeline must call registered `onBeforeApply` hooks in priority order before executing ops. Wave 7 (suggest mode, priority 200) and Wave 9 (input rules, priority 300) depend on this. Store hooks in a priority-sorted array; each hook transforms ops sequentially. **Hooks run before validation** — the transformed ops are what gets validated and executed.

3. **`DocumentStateImpl` must implement the full `DocumentState` interface.** Add `blocks: Iterable<BlockHandle>`, `isEmpty: boolean`, and `allBlocks(): Iterable<BlockHandle>` — all required by Wave 0's interface definition. `allBlocks()` must recursively walk layout children, not just `blockOrder`. Note: `blockAt()` returns `string | null` per the corrected Wave 0 interface.

4. **`_splitBlock` must use `initBlockMap` (or equivalent) to create new blocks.** The current manual block map creation skips the `meta` Y.Map, violating Wave 1's invariant that meta is always present.

5. **`replaceSelection` must batch delete + insert ops in a single `apply()` call.** Separate `apply()` calls create separate undo steps and separate transactions.

6. **`requestDecorationUpdate()` must be implemented on `EditorImpl`.** Wave 0 defines it. Extensions like search (W9), collab (W8), and track changes (W7) call it.

7. **The `editor.schema` getter must be exposed.** `EditorImpl` stores `_registry` internally but must expose `schema: SchemaRegistry` per the Wave 0 interface.

8. **`set-meta` stores data as plain JSON values, not nested Y.Maps.** When `_executeSingleOp` handles `set-meta`, the `data` record is stored as a plain JSON value under the namespace key in the block's `meta` Y.Map (`metaMap.set(namespace, data)`). This means metadata is last-writer-wins per namespace — not collaboratively mergeable at the field level. This is intentional: metadata is typically owned by a single extension, and field-level merging would require each extension to declare its metadata schema. Extensions that need collaborative merging within metadata should use the CRDT adapter's `createMap()` factory to create a nested Y.Map and store it via `adapter.transact()` directly.

9. **`editor.clientId` must be exposed.** The `EditorImpl` constructor should cache `adapter.getClientId(crdtDoc)` and expose it as `readonly clientId: number` per the corrected Wave 0 interface. The streaming target (Wave 3), undo manager, and awareness publisher all use this.

10. ~~**`EditorInternals.engine` must be typed as `SchemaEngine` (interface), not `SchemaEngineImpl`.**~~ Fixed inline. Extensions needing concrete methods like `deferBlock`/`undeferBlock` access them via `editor.internals.getSlot<SchemaEngineImpl>('core:engine')`.

11. ~~**`EditorImpl.destroy()` must call `awareness?.destroy()`.**~~ Fixed inline — awareness is destroyed after extensions are deactivated but before the CRDT observer is removed, ensuring extensions can still read awareness state during their `deactivate` hooks.

12. **`importer-utils.ts` must be implemented in this wave.** Wave 4's markdown and HTML importers both depend on `blocksToOps()` and `PendingBlock` from `@pen/core/importer-utils.ts`. This module converts an array of `PendingBlock` objects (type, props, content, children) into `DocumentOp[]` (insert-block + insert-text ops). Must be implemented and exported from `@pen/core` before Wave 4 can begin.
