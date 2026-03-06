# Wave 0 — Foundation Types & Build Verification

**Milestone:** M0 · **Packages:** `@pen/types` (all types + lightweight helpers), `@pen/core` (re-exports `@pen/types`, holds throw-stubs for later waves) · **Depends on:** nothing

---

## Goal

Restructure the existing 960-line single-file stub into a clean multi-file architecture, fix all gaps against the spec, and implement the three runtime modules (`prop` builder, `defineBlock`, `defineExtension`). These types and helpers live in `@pen/types` — the zero-dependency contract surface that every other package imports from. `@pen/core` re-exports everything from `@pen/types` and holds throw-stubs for runtime modules implemented in later waves (Waves 2-3). After this wave, `pnpm build` and `pnpm typecheck` pass monorepo-wide, and the runtime helpers produce correct output.

---

## Current State

`packages/core/src/index.ts` already contains flat stubs of most types. The problems:

1. **Single file.** 960 lines in one `index.ts` — no module boundaries, hard to navigate.
2. **Stream parts diverge from spec.** Several part types have wrong fields (e.g., `StepStartPart` uses `stepId` instead of `stepIndex`, `GenDeltaPart` is missing `zoneId`, `GenEndPart` is missing `zoneId`, `DataPart` uses `key`/`value` instead of the spec's `type: 'data-${string}'` pattern with `id`/`data`/`transient`, `BlockInsertPart.props` is required but should be optional).
3. **`prop` builder is a no-op stub.** Returns empty objects.
4. **`defineBlock` / `defineExtension` / `mergeSchemas` / `createEditor` throw.** The first three are Wave 0 scope; `createEditor` is Wave 3.
5. **`Transport` interface diverges from spec.** Missing `connect()`, `disconnect()`, `connected`, `onConnectionChange()`, `reconnect()`.
6. **`BlockSchema` missing `display` and `keyBindings`.** The stub has no `BlockDisplay` interface and no `keyBindings` field.
7. **`BlockSuggestion` type missing.** Block-level suggestion metadata (Section 5.5) is not defined.
8. **`Persistence` types missing.** `PenPersistence`, `VersionMetadata`, `VersionEntry` not present.
9. **`Exporter` / `Importer` interfaces missing.**
10. **`ToolServer` / `ToolDefinition` interfaces missing.** `ToolContext` exists but `ToolServer` and `ToolDefinition` do not.
11. **`ModelAdapter` / `ModelStreamEvent` interfaces missing.**
12. **`CellSelection` missing.**
13. **Table ops missing** from `DocumentOp` union (`insert-table-row`, etc.).
14. **`ReplaceTextOp` and `InsertInlineNodeOp` / `RemoveInlineNodeOp` missing.**
15. **`BlockRenderContext` missing** (needed by `@pen/react`).
16. **`InputBackend` / `StreamingTarget` missing.**

---

## File Structure

Split the single file into focused modules across two packages. `@pen/types` owns all type definitions and lightweight runtime helpers. `@pen/core` re-exports `@pen/types` and holds stubs for runtime modules added in later waves.

```
packages/types/src/
├── types/
│   ├── ids.ts              Branded ID types + factory helpers
│   ├── utility.ts          Unsubscribe, Spacing, BorderDef
│   ├── block.ts            Block, App, Range, AppPlacement, AnchorPosition
│   ├── selection.ts        SelectionState, TextSelection, BlockSelection, AppSelection, CellSelection
│   ├── document-range.ts   DocumentRange interface
│   ├── layout.ts           LayoutSchema, LayoutProps, LayoutChildProps
│   ├── input.ts            KeyBinding, InputRule
│   ├── ops.ts              DocumentOp union (all 25 op types), OpOrigin, Position, ApplyOptions
│   ├── stream.ts           PenStreamPart union (all part types), PenStreamRequest
│   ├── schema.ts           BlockSchema, InlineSchema, ContentType, BlockDisplay, AppSchema, PropSchema, ComposableSchema, SchemaRegistry, isNestedContent
│   ├── handles.ts          BlockHandle, AppHandle
│   ├── field-editor.ts     FieldEditor, FieldEditorFactory, FieldEditorContext, InputBackend, StreamingTarget
│   ├── crdt.ts             CRDTAdapter, CRDTDocument, PenDocument, CRDTUndoManager, Awareness, CRDTEvent, GenerationZone, AttributionRange
│   ├── extension.ts        Extension, ExtensionStateSpec, contexts
│   ├── editor.ts           Editor, EditorInternals, CreateEditorOptions, DocumentState, PenEventMap, UndoManager, ApplyOptions
│   ├── tools.ts            ToolServer, ToolDefinition, ToolContext, ModelAdapter, ModelStreamEvent, ModelMessage, ToolSchema
│   ├── persistence.ts      PenPersistence, VersionMetadata, VersionEntry, AssetProvider, AssetRef
│   ├── decorations.ts      Decoration, InlineDecoration, BlockDecoration, AppDecoration, DecorationSet, PositionMapping
│   ├── transport.ts        PenTransport, ServerConfig
│   ├── serialization.ts    MarkdownNode, XMLElement, Exporter, Importer, ExportOptions, ImportOptions
│   ├── rendering.ts        BlockRenderContext, BlockRenderer
│   ├── suggestions.ts      BlockSuggestion
│   └── index.ts            Barrel — re-exports everything
├── prop.ts                 prop builder (runtime)
├── define-block.ts         defineBlock helper (runtime)
├── define-extension.ts     defineExtension helper (runtime)
└── index.ts                Package entry — re-exports types/ barrel + runtime modules

packages/core/src/
└── index.ts                Re-exports @pen/types + throw-stubs for createEditor, mergeSchemas, etc.
```

**Why two packages?** Every package in the monorepo imports types from `@pen/core`. By Wave 3, `@pen/core` also contains the schema engine, editor factory, apply pipeline, and extension manager — heavy runtime code. Splitting types into `@pen/types` means downstream packages that only need types and lightweight helpers (`defineBlock`, `prop`, `defineExtension`) take zero dependency on the runtime. `@pen/core` re-exports everything from `@pen/types` for backwards compatibility, so existing `import { ... } from '@pen/core'` statements continue to work.

### Import DAG (no cycles — all within `@pen/types`)

```
utility.ts           ← (no imports)
ids.ts               ← (no imports)
block.ts             ← utility
selection.ts         ← block
document-range.ts    ← selection
layout.ts            ← utility (Spacing, BorderDef)
input.ts             ← editor (type-only for Editor in KeyBinding handler)
ops.ts               ← block, selection, utility, layout (type-only for LayoutProps)
stream.ts            ← block, ops, selection, utility, layout (type-only for LayoutUpdatePart)
schema.ts            ← block, utility, serialization (type-only: MarkdownNode, XMLElement), layout, input (type-only), field-editor (type-only: FieldEditorFactory), selection (type-only)
field-editor.ts      ← schema (type-only: BlockSchema), editor (type-only: Editor), selection (type-only), crdt (GenerationZone)
handles.ts           ← block (AppPlacement), layout (LayoutProps)
crdt.ts              ← ops, utility, document-range
extension.ts         ← crdt, schema, input, decorations, editor (type-only for Editor)
editor.ts            ← block, selection, crdt, ops, decorations, extension, handles, utility
decorations.ts       ← utility
tools.ts             ← stream, editor, ops, schema (PropSchema), utility
persistence.ts       ← utility
transport.ts         ← stream, selection, utility
serialization.ts     ← block, utility, crdt (PenDocument), editor (type-only for Editor), ops (Position), handles (BlockHandle)
rendering.ts         ← handles (BlockHandle), decorations
suggestions.ts       ← ops, utility
```

**Cycle resolution strategy:**

- `schema.ts` ↔ `field-editor.ts`: Both sides use **type-only imports** (`import type`). `schema.ts` imports `FieldEditorFactory` from `field-editor.ts`, and `field-editor.ts` imports `BlockSchema` from `schema.ts`. Type-only imports are erased at runtime and do not create a module dependency.
- `extension.ts` → `editor.ts`: Same pattern — `extension.ts` imports `Editor` as `import type { Editor }`.
- `input.ts` → `editor.ts`: Same pattern — `input.ts` imports `Editor` as `import type { Editor }` for the `KeyBinding` handler signature.
- The old `schema.ts` ↔ `extension.ts` cycle via `KeyBinding` is eliminated by placing `KeyBinding` and `InputRule` in the standalone `input.ts` leaf module.

---

## Module-by-Module Spec

### `types/ids.ts`

```typescript
export type BlockId = string & { readonly __brand: 'BlockId' };
export type AppId   = string & { readonly __brand: 'AppId' };
export type ZoneId  = string & { readonly __brand: 'ZoneId' };
export type DocId   = string & { readonly __brand: 'DocId' };

export function blockId(raw: string): BlockId { return raw as BlockId; }
export function appId(raw: string): AppId     { return raw as AppId; }
export function zoneId(raw: string): ZoneId   { return raw as ZoneId; }
export function docId(raw: string): DocId     { return raw as DocId; }
```

Factory helpers are identity casts — zero runtime cost. They exist for type narrowing at call sites.

### `types/utility.ts`

```typescript
export type Unsubscribe = () => void;

export type Spacing =
  | number
  | { top?: number; right?: number; bottom?: number; left?: number };

export type BorderDef = {
  width?: number;
  style?: string;
  color?: string;
};
```

### `types/block.ts`

No change from current stub except: re-import `Spacing`, `BorderDef` from `utility.ts`. Keep `Block`, `App`, `Range`, `AppPlacement`, `AnchorPosition` exactly as they are.

### `types/selection.ts`

Add `CellSelection` (Spec Section 4.1.1):

```typescript
export interface CellSelection {
  type: 'cell';
  blockId: string;
  anchor: { row: number; col: number };
  head: { row: number; col: number };
}
```

> **Note:** The main spec uses `type: 'CellSelection'` (PascalCase), but all other selection variants use lowercase (`'text'`, `'block'`, `'app'`). We normalize to `'cell'` for consistency.

Update the `SelectionState` union:

```typescript
export type SelectionState =
  | TextSelection
  | BlockSelection
  | AppSelection
  | CellSelection
  | null;
```

### `types/document-range.ts`

No change from current stub. Interface only — implementation in Wave 3.

### `types/layout.ts`

Extracted from `schema.ts` to keep each module focused on a single domain. Layout types define the layout schema configuration and CSS flex/grid mapped runtime properties for container blocks.

**Types (all exist in the stub unchanged):**

- `LayoutSchema` — declares how a container block can arrange children: `{ modes: readonly ('flex' | 'grid')[]; defaultMode: 'flex' | 'grid'; allowedChildren?: string[]; minChildren?: number; maxChildren?: number; }`. This is the **schema declaration** (used in `BlockSchema.layout`), not the runtime CSS props. Matches v01 Section 4.10.
- `LayoutProps` — flex/grid CSS-mapped **runtime properties** stored in the block's `layout` Y.Map (`display`, `direction`, `wrap`, `gap`, `alignItems`, `justifyContent`, `columns`, `rows`, `padding`, `margin`, `background`, `border`, `borderRadius`, `width`, `maxWidth`, `minHeight`, `overflow`). Matches v01 Section 4.10.
- `LayoutChildProps` — per-child flex/grid properties (`flex`, `alignSelf`, `order`, `gridColumn`, `gridRow`, `colSpan`). Already correct.

Imports: `Spacing`, `BorderDef` from `utility.ts`.

### `types/input.ts`

Extracted from `schema.ts` as a standalone leaf module. Both `schema.ts` (`BlockSchema.keyBindings`) and `extension.ts` (`Extension.keyBindings`) reference `KeyBinding`, so placing it here avoids either depending on the other for this type.

**Types (both exist in the stub unchanged — just moving files):**

```typescript
export interface KeyBinding {
  key: string;
  handler: (editor: Editor) => boolean;
  description?: string;
}

export interface InputRuleContext {
  editor: Editor;
  blockId: string;
  blockType: string;
  textBefore: string;
  fullText: string;
}

export type InputRuleHandler = (
  match: RegExpMatchArray,
  context: InputRuleContext,
) => DocumentOp[] | null;

export interface InputRule {
  id: string;
  match: RegExp;
  handler: InputRuleHandler;
  blockTypes?: string[];
}
```

Imports: `import type { Editor } from './editor.js'` (type-only — no runtime dependency).

### `types/ops.ts`

**Add the 6 missing op types** to the `DocumentOp` union:

```typescript
// Text ops (additions)
export interface ReplaceTextOp {
  type: 'replace-text';
  blockId: string;
  offset: number;
  length: number;
  text: string;
  marks?: Record<string, unknown>;
}

export interface InsertInlineNodeOp {
  type: 'insert-inline-node';
  blockId: string;
  offset: number;
  nodeType: string;
  props: Record<string, unknown>;
}

export interface RemoveInlineNodeOp {
  type: 'remove-inline-node';
  blockId: string;
  offset: number;
}

// Table ops
export interface InsertTableRowOp    { type: 'insert-table-row';    blockId: string; index: number; }
export interface DeleteTableRowOp    { type: 'delete-table-row';    blockId: string; index: number; }
export interface InsertTableColumnOp { type: 'insert-table-column'; blockId: string; index: number; }
export interface DeleteTableColumnOp { type: 'delete-table-column'; blockId: string; index: number; }
export interface MergeTableCellsOp {
  type: 'merge-table-cells';
  blockId: string;
  anchor: { row: number; col: number };
  head: { row: number; col: number };
}
export interface SplitTableCellOp {
  type: 'split-table-cell';
  blockId: string;
  row: number;
  col: number;
}
```

**Add `SetMetaOp`** (required by Waves 7–8 for block-level suggestion tracking and extension metadata):

```typescript
export interface SetMetaOp {
  type: 'set-meta';
  blockId: string;
  namespace: string;
  data: Record<string, unknown> | null;
}
```

`set-meta` writes to the block's `meta` Y.Map under the given namespace key. Setting `data: null` removes the namespace entry. This op is needed because metadata mutations must participate in the op pipeline — they must be groupable in undo groups, part of CRDT transactions, and filterable by auth guards. Using `BlockHandle.setMeta()` directly bypasses all of these.

**Add `OpOrigin`** (canonical definition matching Spec Section 6.1):

```typescript
export type OpOrigin = 'user' | 'ai' | 'collaborator' | 'extension' | 'history' | 'input-rule' | 'app' | 'import' | 'system';
```

**Add `ApplyOptions`** (used by `editor.apply()` and `onBeforeApply` hooks):

```typescript
export interface ApplyOptions {
  origin?: OpOrigin;
  undoGroup?: boolean;
}
```

**Add `Position` type** (canonical definition — used by all op types, importers, and tools):

```typescript
export type Position =
  | 'first'
  | 'last'
  | { before: string }
  | { after: string }
  | { parent: string; index: number };
```

The `{ parent, index }` variant is needed by Wave 10's layout system for inserting blocks into container children. It inserts the block at `index` within the parent's `children` Y.Array. The parent block must exist and have `content: BlockSchema[]` (nested content). All five variants are supported by `_insertBlock` and `_moveBlock` in the apply pipeline (Wave 3).

Add all ops to the `DocumentOp` union. Total: 25 op types (15 existing + 10 new: 3 text, 6 table, 1 meta). The existing `SetSelectionOp` (`type: 'set-selection'`) is already in the stub and remains part of the union.

> **Layout ops.** The existing `update-layout` op type in the stub is an M0 placeholder. Wave 10 replaces it with two finer-grained ops: `set-layout` (container-level layout properties) and `set-layout-child` (per-child layout properties). During Wave 10 implementation, `update-layout` is removed from the union and replaced with the two new types, bringing the total from 25 to 26. The Wave 0 count of 25 is correct for M0.
>
> **Naming clarification:** v01 Section 6.1 uses `update-layout` as the op type name. Wave 10 splits this into `set-layout` and `set-layout-child` for precision — one mutates the container's layout Y.Map, the other mutates a child's layout-child props. The split is necessary because container layout and child layout are stored in different Y.Maps and have independent schemas.

**Add `PenStreamRequest`** (Spec Section 11.1, used by `PenTransport.stream()` in Wave 4):

```typescript
export interface PenStreamRequest {
  prompt: string;
  context?: {
    editor?: unknown;
    docId?: string;
    selection?: SelectionState;
    blockId?: string;
  };
  tools?: ToolSchema[];
  toolCalls?: Array<{
    toolCallId: string;
    name: string;
    input: unknown;
  }>;
  messages?: ModelMessage[];
  signal?: AbortSignal;
  streamId?: string;
}
```

### `types/stream.ts`

**Fix divergences from spec (Section 11.1):**

| Part | Current | Spec | Fix |
|---|---|---|---|
| `GenDeltaPart` | missing `zoneId` | has `zoneId` | Add `zoneId: string` |
| `GenEndPart` | missing `zoneId` | has `zoneId` | Add `zoneId: string` |
| `BlockInsertPart` | `props` (required) | `props?` (optional) | Make `props` optional |
| `StepStartPart` | `stepId`, `label?` | `stepIndex: number` | Rename to `stepIndex` |
| `StepEndPart` | `stepId` | `stepIndex: number` | Rename to `stepIndex` |
| `ToolInputStartPart` | `toolName` | `toolCallId`, `toolName` | Add `toolCallId` |
| `ToolInputDeltaPart` | `delta` | `toolCallId`, `inputDelta` | Add `toolCallId`, rename `delta` → `inputDelta` |
| `ToolInputAvailablePart` | `toolName`, `input` | `toolCallId`, `toolName`, `input: any` | Add `toolCallId` |
| `ToolOutputPart` | `toolName`, `output` | `toolCallId`, `output` | Replace `toolName` with `toolCallId` |
| `ToolErrorPart` | `toolName`, `error` | `toolCallId`, `error` | Replace `toolName` with `toolCallId` |
| `DataPart` | `key`, `value` | `type: 'data-${string}'`, `id?`, `data`, `transient?` | Rewrite per spec |
| `ErrorPart` | `message` | `errorText`, `code?` | Rename `message` → `errorText`, add `code?` |
| `AbortPart` | no `reason` | `reason: string` | Add `reason` |

**Corrected `DataPart`:**

```typescript
export interface DataPart {
  type: `data-${string}`;
  id?: string;
  data: unknown;
  transient?: boolean;
}
```

### `types/schema.ts`

Core schema definitions. The previous revision overloaded this module (~15 types) by absorbing `KeyBinding`, `InputRule`, `LayoutProps`, `LayoutChildProps`, `LayoutSchema`, `FieldEditor`, `FieldEditorFactory`, and `FieldEditorContext` to break circular dependencies. This revision extracts those into `layout.ts`, `input.ts`, and `field-editor.ts` respectively, using **type-only imports** to break cycles without merging unrelated concerns.

**Add `BlockDisplay` interface** (currently missing):

```typescript
export interface BlockDisplay {
  title: string;
  description?: string;
  icon?: string;
  group?: string;
  aliases?: string[];
}
```

**Add `keyBindings` and `display` to `BlockSchema`:**

```typescript
export interface BlockSchema<...> {
  // ... existing fields ...
  keyBindings?: readonly KeyBinding[];   // import type from input.ts
  display?: BlockDisplay;
  fieldEditor?: FieldEditorFactory | 'richtext' | 'plaintext' | 'code' | 'table' | 'none';
  isContainer?: boolean;                 // true for layout containers (section, row, column, stack, card)
}
```

`fieldEditor` accepts either a `FieldEditorFactory` function (for custom field editors) or a string tag (`'richtext'`, `'code'`, `'table'`, `'none'`) for built-in field editor types. String tags are resolved to factory functions by the rendering layer (Wave 5). `'none'` disables editing for the block type.

**Add lookup methods and `allBlockDisplays()` to `SchemaRegistry`:**

```typescript
export interface SchemaRegistry {
  // ── Lookup ─────────────────────────────────────────────
  resolve(type: string): BlockSchema | null;
  resolveInline(type: string): InlineSchema | null;
  resolveApp(type: string): AppSchema | null;
  resolveLayout(type: string): LayoutSchema | null;

  // ── Enumeration ────────────────────────────────────────
  allBlocks(): readonly BlockSchema[];
  allInlines(): readonly InlineSchema[];
  allApps(): readonly AppSchema[];
  allBlockDisplays(): readonly (BlockSchema & { display: BlockDisplay })[];

  // ── Unknown type handlers ──────────────────────────────
  onUnknownBlock?: (type: string, raw: unknown) =>
    | BlockSchema | 'drop' | 'passthrough';

  onUnknownInline?: (type: string, raw: unknown) =>
    | InlineSchema | 'drop' | 'passthrough';
}
```

**Add `overrideSystemMark()` to `ComposableSchema`:**

```typescript
export interface ComposableSchema extends SchemaRegistry {
  // ... existing ...
  overrideSystemMark(type: string, schema: InlineSchema): ComposableSchema;
}
```

**`PropSchema` type.** Keep as the current inline type (a JSON Schema 7 subset). Do NOT depend on `@types/json-schema` — the full `JSONSchema7` type is too broad and drags in nullable unions. The current slim `PropSchema` type is correct and sufficient.

**Existing types to keep as-is (already correct in stub):**

- `InlineSchema` — full interface with `kind`, `expand`, `system`, `priority`, `apply`, `remove`, `query`, `serialize`, `aiDescription` fields. No changes needed.
- `ContentType` — union of `'inline' | 'none' | 'table' | BlockSchema[]`. No changes needed.
- `isNestedContent(content: ContentType): content is BlockSchema[]` — type guard function, already implemented in stub. No changes needed.
- `AppSchema` — generic interface for app schemas. Already in stub. No changes needed.
- `ComposableSchema` — extends `SchemaRegistry` with `extend()`, `without()`, `override()`, and `overrideSystemMark()`. Already in stub (minus `overrideSystemMark` — add it).

**Imports:** `block.ts`, `utility.ts`, `serialization.ts` (type-only: `MarkdownNode`, `XMLElement`), `layout.ts` (re-exports: `LayoutProps`, `LayoutChildProps`, `LayoutSchema`), `input.ts` (type-only: `KeyBinding`), `field-editor.ts` (type-only: `FieldEditorFactory`), `selection.ts` (type-only).

### `types/handles.ts`

**`BlockHandle` and `AppHandle`** — already defined in the stub (lines 335–369). These are high-traffic interfaces used by `rendering.ts`, `serialization.ts`, `editor.ts`, and `DocumentState`. They get their own module to avoid bloating `schema.ts` and to keep the import DAG clean.

No changes needed to the interfaces themselves — the existing stub definitions are correct, with two exceptions:

1. `setMeta` is removed as a write method. The canonical mutation path for metadata is `editor.apply({ type: 'set-meta', blockId, namespace, data })`, which ensures auth guards, undo grouping, and CRDT transactions all see metadata changes. `BlockHandle` retains `meta(namespace)` as a read-only accessor, and `setMeta` becomes a throw-stub directing callers to `editor.apply()`.

2. `textContent` gains an optional `options` parameter:

```typescript
interface BlockHandle {
  // ... existing ...
  textContent(options?: { resolved?: boolean }): string;
  textDeltas(): Array<{ insert: string; attributes?: Record<string, unknown> }>;
}
```

When `resolved: true`, suggestion marks are resolved: `action: 'insert'` suggestions are kept (displayed as accepted), `action: 'delete'` suggestions are stripped (displayed as if the delete went through). This is needed by Wave 7's track changes export and diff view. Default is `false` (raw text, including both insert and delete suggestion content).

**`textDeltas()`** returns the block's inline content as an array of attributed text segments — the same shape as a `Y.Text.toDelta()` but CRDT-agnostic. Each segment has an `insert` string and optional `attributes` (mark names to values). This method is the canonical way for serialization, export, and decoration code to read inline content with formatting without importing CRDT types directly. The `CRDTAdapter` abstraction is preserved: `@pen/crdt-yjs` implements this by calling `Y.Text.toDelta()`, a future `@pen/crdt-loro` would call Loro's equivalent. Code that needs formatted inline content MUST use `textDeltas()`, not `adapter.raw<Y.Doc>(doc)` casts.

Just move them from the monolithic `index.ts` to this dedicated file.

`BlockHandle` depends on: `LayoutProps` (from `layout.ts`), `AppPlacement` (from `block.ts`), `AppHandle` (co-located).
`AppHandle` depends on: `AppPlacement` (from `block.ts`), `BlockHandle` (co-located).

### `types/crdt.ts`

The existing `CRDTAdapter`, `CRDTDocument`, `PenDocument`, `CRDTUndoManager`, `Awareness`, `CRDTEvent`, `GenerationZone`, `UndoManagerOptions` are correct.

**`PenDocument` must define minimal iterable contracts.** Downstream code (Wave 2 normalization, Wave 3 document state, Wave 4 exporters) reads `blockOrder`, `blocks`, `apps`, and `metadata` using array/map-like methods (`.get()`, `.length`, `.entries()`, `.has()`, `.keys()`). The `PenDocument` interface must specify these contracts so that both Yjs and Loro adapters know what to implement:

```typescript
export interface CRDTArray<T> {
  readonly length: number;
  get(index: number): T;
  toArray(): T[];
  [Symbol.iterator](): Iterator<T>;
}

export interface CRDTMap<T> {
  get(key: string): T | undefined;
  has(key: string): boolean;
  entries(): IterableIterator<[string, T]>;
  keys(): IterableIterator<string>;
  readonly size: number;
}

export interface PenDocument {
  readonly blockOrder: CRDTArray<string>;
  readonly blocks: CRDTMap<unknown>;
  readonly apps: CRDTMap<unknown>;
  readonly metadata: CRDTMap<unknown>;
  readonly adapter: CRDTAdapter;
}
```

`CRDTArray` and `CRDTMap` are the minimal abstract contracts. `Y.Array` and `Y.Map` already satisfy these. This replaces the previous `unknown` typing and eliminates the need for unsafe casts in Wave 2's normalization engine and handle factories. Code in `@pen/core` operates on these interfaces; only `@pen/crdt-yjs` modules cast to concrete Yjs types via `asYjsDoc()`.

**Add `destroy()` to `Awareness`:** Every CRDT adapter's awareness implementation needs cleanup (unsubscribe from WebSocket, release timers, etc.). Rather than requiring consumers to narrow via `isYjsCRDTDocument`, add `destroy()` to the base interface so the `Editor` teardown path can call it generically:

```typescript
export interface AwarenessChangeEvent {
  added: number[];
  updated: number[];
  removed: number[];
}

export interface Awareness {
  // ... existing methods (getLocalState, setLocalState, getStates) ...
  on(event: 'change', callback: (changes: AwarenessChangeEvent) => void): void;
  off(event: 'change', callback: (changes: AwarenessChangeEvent) => void): void;
  destroy(): void;
}
```

> **Change event payload.** The `on('change')` callback receives `AwarenessChangeEvent` with `added`, `updated`, and `removed` client ID arrays. This matches the y-protocols `Awareness` event shape and is required by Wave 8's collaboration extension for remote cursor tracking. Previous versions of this spec used a no-arg callback; that was incorrect — consumers need to know which clients changed to efficiently update cursor decorations.

**Add `AttributionRange`** (required by Wave 8 for per-character blame):

```typescript
export interface AttributionRange {
  offset: number;
  length: number;
  clientId: number;
}
```

**Add `getAttributionRanges` to `CRDTAdapter`:**

```typescript
interface CRDTAdapter {
  // ... existing methods ...

  // ── Factory methods (CRDT-agnostic construction) ────────
  createMap(): unknown;
  createArray(): unknown;
  createText(): unknown;
  initBlockMap(doc: CRDTDocument, blockId: string, blockType: string, contentType: 'inline' | 'nested' | 'table' | 'none'): unknown;

  // ── Attribution (per-character authorship) ──────────────
  getAttributionRanges?(doc: CRDTDocument, blockId: string): AttributionRange[];
}
```

This is optional (`?`) because not all CRDT backends expose per-character attribution. `@pen/crdt-yjs` implements it by walking `Y.Text`'s internal linked list; `@pen/crdt-loro` uses Loro's native attribution API. Callers must check availability before use.

### `types/extension.ts`

`KeyBinding` and `InputRule` now live in `input.ts`. `extension.ts` imports them from there. The remaining types (`Extension`, `ExtensionStateSpec`, `ServerExtensionContext`, `ClientExtensionContext`) are correct. No other changes needed.

Imports: `crdt`, `schema`, `input` (`KeyBinding`, `InputRule`), `decorations`, `editor` (type-only for `Editor`).

### `types/editor.ts`

Current stub is correct. Includes `Editor`, `CreateEditorOptions`, `PenEventMap`, `UndoManager`, `DocumentState`, `SchemaEngine`. The `Editor` interface retains all v01 methods (`apply`, `blocks`, `getBlock`, `firstBlock`, `lastBlock`, `blockCount`, `setSelection`, `getSelection`, `selectBlock`, `selectBlocks`, `selectText`, `selectAll`, `getSelectedText`, `getSelectedBlocks`, `replaceSelection`, `deleteSelection`, `on`, `undoManager`, `normalizeAll`, `destroy`).

**Add `blockOrder` to `DocumentState`:**

The `DocumentState` interface must expose `blockOrder` for efficient block iteration. This is required by Wave 3's `DocumentStateImpl`, Wave 5's `useBlockList` hook, and Wave 4's exporters.

> **Important: `blockOrder` contains top-level block IDs only.** Layout container children (Wave 10) live in the container's `children` Y.Array and are NOT in `blockOrder`. Any code that must visit ALL blocks in the document — exporters, search, history, JSON serialization — MUST walk the block tree recursively via `BlockHandle.children` or `BlockHandle.descendants()`, not just iterate `blockOrder`. `DocumentState.blocks` returns ALL blocks (including nested layout children) and is the correct iteration target for exhaustive traversal.

```typescript
export interface DocumentState {
  readonly blockOrder: readonly string[];
  readonly blockCount: number;
  readonly blocks: Iterable<BlockHandle>;
  readonly isEmpty: boolean;
  /** Walk all blocks depth-first, including layout children not in blockOrder. */
  allBlocks(): Iterable<BlockHandle>;
  /** Get block ID at the given index in blockOrder. Returns null if out of bounds. */
  blockAt(index: number): string | null;
  /** Get the index of a block in blockOrder. Returns -1 if not found. */
  indexOf(blockId: string): number;
  /** Get the parent block ID (if any) for a given block. */
  parentOf(blockId: string): string | null;
}
```

> **`blockAt` returns `string | null`, not `BlockHandle | null`.** This is intentional — `DocumentState` is a lightweight index, not a handle factory. Callers that need a handle use `editor.getBlock(documentState.blockAt(i))`. Returning handles here would require `DocumentState` to hold a reference to the schema registry and CRDT document, coupling it to the handle factory.

**Add `ApplyOptions` import** from `ops.ts`.

**Add `documentChange` and `decorationsChange` to `PenEventMap`:**

- `change` — raw CRDT events from the wave-01 observer. Fires for all mutations (local, remote, system).
- `documentChange` — post-pipeline editor event. Fires after `apply()` completes (ops executed, normalization done). Payload includes the processed ops, origin, and affected block IDs.
- `decorationsChange` — fires when the decoration `generation` counter increments (after `requestDecorationUpdate()` or internal decoration invalidation).

**Add `DiagnosticEvent`** (referenced by `PenEventMap` but not defined in the stub):

```typescript
export interface DiagnosticEvent {
  level: 'warn' | 'error' | 'info';
  source: string;
  message: string;
  code?: string;
  error?: unknown;
  [key: string]: unknown;
}
```

```typescript
interface PenEventMap {
  change: (events: CRDTEvent[]) => void;
  documentChange: (event: { ops: DocumentOp[]; origin: OpOrigin; affectedBlocks: string[] }) => void;
  decorationsChange: (generation: number) => void;
  selectionChange: (selection: SelectionState) => void;
  focus: (event: { blockId: string | null }) => void;
  blur: (event: { blockId: string | null }) => void;
  diagnostic: (event: DiagnosticEvent) => void;

  // CRDT integrity events (Wave 1 — surfaced at editor level)
  'crdt:corruption': (errors: DocumentValidationError[]) => void;
  'crdt:recovered': (method: 'snapshot' | 'repair' | 'reimport') => void;
}

/** Validation error produced by document health checks (Wave 1). */
interface DocumentValidationError {
  code: 'MISSING_SHARED_TYPE' | 'INVALID_BLOCK_STRUCTURE' | 'ORPHAN_BLOCK'
      | 'DUPLICATE_BLOCK_ORDER' | 'UNKNOWN_CONTENT_TYPE' | 'MISSING_BLOCK_MAP_KEY';
  blockId?: string;
  message: string;
  severity: 'error' | 'warning';
}
```

This `PenEventMap` shape is the canonical contract for all later waves. Downstream specs must not narrow `change` to a single `CRDTEvent` payload.

**Add `schema`, `selection`, `documentState`, `requestDecorationUpdate`, `scrollToBlock`, `onBeforeApply`, convenience event methods, and `internals` to `Editor` interface:**

```typescript
interface Editor {
  // ... existing methods ...

  readonly schema: SchemaRegistry;
  readonly selection: SelectionState;
  readonly documentState: DocumentState;

  /** The local CRDT client identifier. Shorthand for internals.adapter.getClientId(internals.crdtDoc). */
  readonly clientId: number;

  // ── Apply with explicit origin (shorthand) ─────────────
  applyWithOrigin(origin: OpOrigin, ...ops: DocumentOp[]): void;

  // ── Apply hook ─────────────────────────────────────────
  onBeforeApply(
    hook: (ops: DocumentOp[], options: ApplyOptions) => DocumentOp[],
    options?: { priority?: number },
  ): Unsubscribe;

  // ── Convenience event subscriptions ────────────────────
  onDocumentChange(callback: PenEventMap['documentChange']): Unsubscribe;
  onSelectionChange(callback: PenEventMap['selectionChange']): Unsubscribe;

  requestDecorationUpdate(): void;
  scrollToBlock?(blockId: string): void;

  // ── Internals (escape hatch for extensions) ────────────
  readonly internals: EditorInternals;
}

interface EditorInternals {
  readonly adapter: CRDTAdapter;
  readonly crdtDoc: CRDTDocument;
  /** PenDocument — the application-level document (wraps crdtDoc with blocks/blockOrder/meta). */
  readonly doc: PenDocument;
  readonly engine: SchemaEngine;
  readonly awareness: Awareness | null;
  getSlot<T>(key: string): T | undefined;
  setSlot(key: string, value: unknown): void;
}
```

> **`clientId` on `Editor`.** Added as a convenience property. The streaming target, undo manager, and awareness publisher all need the local client ID. Routing through `editor.internals.adapter.getClientId(editor.internals.crdtDoc)` is verbose and error-prone. The implementation caches the client ID at construction time (it's stable for the lifetime of a `Y.Doc`).
>
> **`EditorInternals.engine` is typed as `SchemaEngine` (the interface), not `SchemaEngineImpl`.** Extensions that need `deferBlock`/`undeferBlock` (which are not on the interface) access them via `editor.internals.getSlot<SchemaEngineImpl>('core:engine')` or through the streaming extension's API. This keeps the internals contract stable across CRDT adapter implementations.

**Hook priority constants:**

```typescript
export const HOOK_PRIORITY_AUTH       = 100;
export const HOOK_PRIORITY_SUGGEST    = 200;
export const HOOK_PRIORITY_INPUT_RULE = 300;
export const HOOK_PRIORITY_DEFAULT    = 500;
```

`onBeforeApply` is a transform hook. Hooks run in **priority order** (lowest number first). Within the same priority, hooks run in registration order. The `priority` option defaults to `HOOK_PRIORITY_DEFAULT` (500), so consumer hooks run after all built-in hooks.

**Hooks run before validation.** The apply pipeline order is: (1) run `onBeforeApply` hooks in priority order, transforming the ops array sequentially, (2) validate each transformed op, (3) execute validated ops inside a CRDT transaction. This ordering is critical because:
- **Suggest mode** (priority 200) transforms `delete-text` ops into `format-text` ops. The new `format-text` ops must be validated (not the original `delete-text`).
- **Auth guard** (priority 100) may filter ops entirely. Filtered ops must not reach validation or execution.
- **Input rules** (priority 300) may queue additional ops as microtasks — those are applied in a separate `apply()` call and go through the full hook → validate → execute pipeline again.

The priority ordering matters because hooks transform ops sequentially:
- **Auth guard** (Wave 12, priority 100) runs first — it must see the original ops to evaluate authorization. Denied ops are filtered out before any transformation.
- **Suggest mode** (Wave 7, priority 200) runs next — it transforms `insert-text` ops to include suggestion marks and converts `delete-text` ops to `format-text` ops. It only sees ops that passed auth.
- **Input rules** (Wave 9, priority 300) run last — they inspect `insert-text` ops and queue conversion ops as a microtask. They see the final transformed ops.

Hooks can add, remove, or transform ops. Hooks that return an empty array effectively cancel the apply.

**Hook interaction contract:** When suggest mode (priority 200) is active, `insert-text` ops are transformed to include `suggestion` marks. Input rules (priority 300) see the already-transformed ops. Input rules that trigger block conversion (e.g. `# ` → heading) queue their conversion ops as a **microtask** rather than returning them synchronously — this prevents the suggest-mode hook from wrapping conversion ops in suggestion marks. The microtask approach means: (1) the original `insert-text` op completes and flushes to the CRDT, (2) input rule conversion ops apply in a separate `editor.apply()` call with origin `'input-rule'`, (3) suggest mode does NOT intercept ops with origin `'input-rule'`.

**Add `requestDecorationUpdate` to `Editor`** (needed by extensions that produce decorations):

```typescript
interface Editor {
  // ... existing ...
  requestDecorationUpdate(): void;
}
```

This signals the rendering layer to re-collect decorations from all extensions. Used by search (Wave 9), collab (Wave 8), and track changes (Wave 7).

**Keep `createEditor` as a throw-stub.** It's Wave 3 scope. The function signature must exist so downstream packages can import it.

### `types/tools.ts`

**Add `ToolServer` interface** (Spec Section 13.2):

```typescript
export interface ToolServer {
  registerTool(def: ToolDefinition): void;
  unregisterTool(name: string): void;
  listTools(): readonly ToolDefinition[];
  executeTool(name: string, input: unknown, ctx: ToolContext): Promise<unknown> | AsyncIterable<unknown>;
}
```

**Add `ToolDefinition`:**

```typescript
export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: PropSchema;
  handler: (input: unknown, ctx: ToolContext) => Promise<unknown> | AsyncIterable<unknown>;
}
```

**Add `ModelAdapter` and `ModelStreamEvent`** (Spec Section 13.2):

```typescript
export interface ModelAdapter {
  stream(options: {
    messages: ModelMessage[];
    tools: ToolSchema[];
    signal?: AbortSignal;
  }): AsyncIterable<ModelStreamEvent>;
}

export type ModelStreamEvent =
  | { type: 'text-delta'; delta: string }
  | { type: 'tool-call'; toolCallId: string; toolName: string; input: unknown }
  | { type: 'done'; usage?: { promptTokens: number; completionTokens: number } }
  | { type: 'error'; error: unknown };

export interface ToolSchema {
  name: string;
  description: string;
  inputSchema: PropSchema;
}

export interface ModelMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | ModelMessagePart[];
  toolCallId?: string;
  toolName?: string;
}

export type ModelMessagePart =
  | { type: 'text'; text: string }
  | { type: 'tool-call'; toolCallId: string; toolName: string; input: unknown }
  | { type: 'tool-result'; toolCallId: string; result: unknown; isError?: boolean };
```

`ModelMessage` is provider-neutral. The `content` field accepts either a string (simple messages) or `ModelMessagePart[]` (structured messages with tool calls and results). Each `ModelAdapter` implementation translates this to the provider's native format (OpenAI, Anthropic, Gemini, etc.).

### `types/persistence.ts`

**Add `PenPersistence`** (Spec Section 10.2):

```typescript
export interface PenPersistence {
  loadDocument(docId: string): Promise<Uint8Array | null>;
  saveSnapshot(docId: string, state: Uint8Array): Promise<void>;
  appendUpdate(docId: string, update: Uint8Array): Promise<void>;
  getUpdates(docId: string, since?: Uint8Array): Promise<Uint8Array[]>;
  compact(docId: string): Promise<void>;
  saveVersionSnapshot(docId: string, snapshot: Uint8Array, metadata: VersionMetadata): Promise<void>;
  listVersions(docId: string, options?: { limit?: number; before?: string }): Promise<VersionEntry[]>;
  loadVersion(docId: string, versionId: string): Promise<{ state: Uint8Array; snapshot: Uint8Array }>;
}

export interface VersionMetadata {
  label?: string;
  trigger: 'auto' | 'manual' | 'ai-generation' | 'import';
  clientId: number;
  timestamp: number;
}

export interface VersionEntry {
  id: string;
  metadata: VersionMetadata;
  createdAt: number;
}
```

Keep `AssetProvider`, `AssetRef`, `AssetUploadOptions` as-is. Their definitions (already in the current stub):

```typescript
export interface AssetRef {
  id: string;
  url: string;
  mimeType: string;
  size: number;
}

export interface AssetUploadOptions {
  mimeType?: string;
  maxSize?: number;
  onProgress?: (progress: number) => void;
}

export interface AssetProvider {
  upload(file: File | Blob, options?: AssetUploadOptions): Promise<AssetRef>;
  resolve(ref: AssetRef): string;
  delete(ref: AssetRef): Promise<void>;
}
```

### `types/decorations.ts`

Current stub is correct. Keep `Decoration`, `InlineDecoration`, `BlockDecoration`, `AppDecoration`, `DecorationSet`, `PositionMapping`.

**Update `PositionMapping`** to include `affectedBlocks` and `mapOffset` — these are required by Wave 3's `DecorationSetImpl.map()`:

```typescript
export interface PositionMapping {
  readonly affectedBlocks: readonly string[];
  mapOffset(blockId: string, offset: number): number;
}
```

**Keep `createDecorationSet` and `emptyDecorationSet` as throw-stubs.** Implementation is Wave 3. The signatures must exist for downstream import.

### `types/field-editor.ts`

This module owns all field-editor types. The previous revision moved `FieldEditor`, `FieldEditorContext`, and `FieldEditorFactory` to `schema.ts` to break a circular dependency. This revision moves them back here and uses **type-only imports** on both sides instead, which is a cleaner separation:

- `schema.ts` does `import type { FieldEditorFactory } from './field-editor.js'`
- `field-editor.ts` does `import type { BlockSchema } from './schema.js'` and `import type { Editor } from './editor.js'`

Type-only imports are erased at runtime, so there is no module-level cycle.

**`FieldEditorFactory`:**

```typescript
export type FieldEditorFactory = (ctx: FieldEditorContext) => FieldEditor;
```

**`FieldEditorContext`:**

```typescript
export interface FieldEditorContext {
  blockId: string;
  schema: BlockSchema;   // import type from schema.ts
  editor: Editor;        // import type from editor.ts
}
```

**`FieldEditor`** — the abstract behavioral interface for the type system. Wave 05's `FieldEditorImpl` extends this with concrete editing state (multi-block expansion, input mode):

```typescript
export interface FieldEditor {
  readonly activeBlockId: string | null;
  readonly activeBlockIds: readonly string[];
  readonly isEditing: boolean;
  readonly inputMode: 'richtext' | 'code' | 'table' | 'none';
  selection: SelectionState | null;

  focus(): void;
  blur(): void;
  activate(blockId: string): void;
  deactivate(): void;
  expandTo(blockId: string): void;
  contractToFocused(): void;

  attachElement(el: HTMLElement): void;
  delegate(blockSchema: BlockSchema): boolean;
  destroy(): void;
}
```

**`InputBackend`** (Spec Section 5.1):

```typescript
export interface InputBackend {
  activate(element: HTMLElement, ytext: unknown): void;
  deactivate(): void;
  updateSelection(relPos: unknown): void;
}
```

Uses `unknown` for CRDT types — the concrete `Y.Text` / `Y.RelativePosition` types come from `@pen/crdt-yjs`.

**`StreamingTarget`** (Spec Section 5.1):

```typescript
export interface StreamingTarget {
  readonly generationZone: GenerationZone | null;
  beginStreaming(zoneId: string, blockId: string): void;
  appendDelta(delta: string): void;
  endStreaming(status: 'complete' | 'cancelled' | 'error'): void;
}
```

Imports: `schema.ts` (type-only: `BlockSchema`), `editor.ts` (type-only: `Editor`), `selection.ts` (type-only: `SelectionState`), `crdt.ts` (`GenerationZone`).

### `types/transport.ts`

**Replace current `Transport` with `PenTransport`** (Spec Section 11.3):

```typescript
export interface PenTransport {
  stream(request: PenStreamRequest): AsyncIterable<PenStreamPart>;
  reconnect?(streamId: string): AsyncIterable<PenStreamPart>;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  readonly connected: boolean;
  onConnectionChange(callback: (connected: boolean) => void): Unsubscribe;
}
```

`reconnect(streamId)` resumes a specific stream from where it left off. This is distinct from `connect()` which establishes the underlying connection. For SSE transports, `reconnect` is implemented using `Last-Event-ID` replay. For in-process transports (`@pen/transport-direct`), `reconnect` is not needed and is omitted (it's optional).

### `types/serialization.ts`

Keep `MarkdownNode`, `XMLElement`.

**Add `Exporter` and `Importer`** (Spec Section 15):

```typescript
export interface Exporter<Output = string> {
  name: string;
  mimeType: string;
  fileExtension: string;
  export(editor: Editor, options?: ExportOptions): Output | Promise<Output>;
  exportFragment?(blocks: BlockHandle[], options?: ExportOptions): Output;
}

export interface ExportOptions<Extra extends Record<string, unknown> = Record<string, never>> {
  includeApps?: boolean;
  includeLayout?: boolean;
  includeMetadata?: boolean;
  includeSuggestions?: boolean;
  prettyPrint?: boolean;
  extra?: Extra;
}

export interface Importer<Input = string> {
  name: string;
  mimeType: string;
  import(input: Input, editor: Editor, options?: ImportOptions): void | Promise<void>;
}

export interface ImportOptions {
  position?: Position;
  replace?: boolean;
  validate?: boolean;
  normalize?: boolean;
}
```

### `types/rendering.ts`

**Add `BlockRenderContext` and `BlockRenderer`** (Spec Section 6.3):

```typescript
export interface BlockRenderContext {
  editable: boolean;
  selected: boolean;
  decorations: readonly Decoration[];
  ref: unknown;  // React.Ref<HTMLElement> — framework-agnostic in core
}

export type BlockRenderer<Props = Record<string, unknown>> = (
  block: BlockHandle,
  ctx: BlockRenderContext,
) => unknown;  // ReactElement — framework-agnostic in core
```

### `types/suggestions.ts`

**Add `BlockSuggestion`** (Spec Section 5.5):

```typescript
export interface BlockSuggestion {
  id: string;
  action: 'insert-block' | 'delete-block' | 'move-block' | 'convert-block';
  author: string;
  authorType: 'user' | 'ai';
  createdAt: number;
  model?: string;
  previousState?: {
    type?: string;
    position?: Position;
    props?: Record<string, unknown>;
  };
}
```

---

## Runtime Modules

### `prop.ts` — `prop` builder

Full implementation. The builder returns `PropSchema` objects using a chainable pattern.

**Architecture:** A single internal `PropChainImpl` class that stores schema data in a private `_schema` record. Each chainable method mutates `_schema` and returns `this`. The object exposes the schema via `toJSON()` (for `JSON.stringify` compatibility) and a `toSchema()` method that returns a plain `PropSchema`. To satisfy direct usage as a `PropSchema` value (no explicit `.build()` call), `defineBlock`'s `generateValidator` and `prop.object()`/`prop.array()` call `toSchema()` internally when they receive a `PropChainImpl` instance.

```typescript
class PropChainImpl {
  private _schema: Record<string, unknown>;

  constructor(init: Record<string, unknown>) {
    this._schema = { ...init };
  }

  default(value: unknown): this   { this._schema.default = value; return this; }
  describe(text: string): this    { this._schema.description = text; return this; }
  min(value: number): this        { this._schema.minimum = value; return this; }
  max(value: number): this        { this._schema.maximum = value; return this; }
  optional(): PropChainImpl {
    const currentType = this._schema.type;
    this._schema.type = currentType ? [currentType, 'null'] : 'null';
    return this;
  }

  toSchema(): PropSchema { return { ...this._schema } as PropSchema; }
  toJSON(): Record<string, unknown> { return { ...this._schema }; }
}

function resolveSchema(value: unknown): PropSchema {
  return value instanceof PropChainImpl ? value.toSchema() : value as PropSchema;
}
```

**`prop` namespace object:**

```typescript
export const prop = {
  string()  { return new PropChainImpl({ type: 'string', default: '' }); },
  number()  { return new PropChainImpl({ type: 'number', default: 0 }); },
  boolean() { return new PropChainImpl({ type: 'boolean', default: false }); },
  enum(values: readonly (string | number)[]) {
    const inferredType = values.length > 0 && typeof values[0] === 'number' ? 'number' : 'string';
    return new PropChainImpl({ type: inferredType, default: values[0], enum: [...values] });
  },
  array(items: PropChainImpl | PropSchema) {
    return new PropChainImpl({ type: 'array', default: [], items: resolveSchema(items) });
  },
  object(properties: Record<string, PropChainImpl | PropSchema>) {
    const resolved: Record<string, PropSchema> = {};
    for (const [k, v] of Object.entries(properties)) {
      resolved[k] = resolveSchema(v);
    }
    return new PropChainImpl({
      type: 'object',
      default: computeDefaults(resolved),
      properties: resolved,
    });
  },
  json()    { return new PropChainImpl({}); },
  optional(inner: PropChainImpl): PropChainImpl { return inner.optional(); },
};
```

**`computeDefaults`** iterates `properties` and reads `default` from each resolved `PropSchema` to build the object default.

**Why a private backing store:** The previous design used `this.default = value` inside a `default()` method, which overwrites the method itself on first call — breaking further chaining. The `_schema` record avoids this by keeping method names and schema keys in separate namespaces. `toSchema()` / `toJSON()` bridge the gap when a plain `PropSchema` object is needed.

### `define-block.ts`

Full implementation. Supports two call patterns (both used in the main spec):

```typescript
// Form 1: type as first positional arg, config uses `props` key
defineBlock('heading', { props: { level: prop.enum([1, 2, 3]) }, content: 'inline' })

// Form 2: single object arg, uses `type` and `propSchema` keys
defineBlock({ type: 'table', propSchema: { hasHeaderRow: prop.boolean() }, content: 'table' })
```

**Implementation with overloads:**

```typescript
export function defineBlock<Type extends string>(
  type: Type,
  config: DefineBlockConfig,
): BlockSchema<Type>;
export function defineBlock<Type extends string>(
  config: DefineBlockConfig & { type: Type },
): BlockSchema<Type>;
export function defineBlock<Type extends string>(
  typeOrConfig: Type | (DefineBlockConfig & { type: Type }),
  maybeConfig?: DefineBlockConfig,
): BlockSchema<Type> {
  const type = typeof typeOrConfig === 'string' ? typeOrConfig : typeOrConfig.type;
  const config = typeof typeOrConfig === 'string' ? maybeConfig! : typeOrConfig;
  const props = resolveProps(config);

  return {
    type,
    propSchema: props,
    content: config.content ?? 'inline',
    layout: config.layout,
    serialize: config.serialize ?? {},
    normalize: config.normalize,
    validateProps: Object.keys(props).length > 0 ? generateValidator(props) : undefined,
    fieldEditor: config.fieldEditor,
    keyBindings: config.keyBindings,
    display: config.display ?? { title: typeNameToTitle(type) },
    aiDescription: config.aiDescription ?? generateAIDescription(type, props),
  };
}
```

**`resolveProps(config)`** — normalizes the `props` / `propSchema` naming inconsistency. Accepts either key, resolves any `PropChainImpl` instances to plain `PropSchema` objects via `resolveSchema()`:

```typescript
function resolveProps(config: DefineBlockConfig): Record<string, PropSchema> {
  const raw = config.props ?? config.propSchema ?? {};
  const resolved: Record<string, PropSchema> = {};
  for (const [k, v] of Object.entries(raw)) {
    resolved[k] = resolveSchema(v);
  }
  return resolved;
}
```

`DefineBlockConfig` accepts both `props` and `propSchema` (mutually exclusive, `props` preferred for new code):

```typescript
type DefineBlockConfig = Omit<Partial<BlockSchema>, 'type' | 'propSchema' | 'validateProps' | 'aiDescription'> & {
  props?: Record<string, PropChainImpl | PropSchema>;
  propSchema?: Record<string, PropChainImpl | PropSchema>;
};
```

**`typeNameToTitle(type)`** — converts camelCase to title case: `'bulletListItem'` → `'Bullet List Item'`. Simple regex split on uppercase boundaries.

**`generateAIDescription(type, props)`** — concatenates `type` with prop descriptions: `"heading: level (Heading level)"`. Overridable via explicit `aiDescription`.

**`generateValidator(propSchemas)`** — returns a function `(raw) => validatedProps` that:
1. Iterates each key in `propSchemas`.
2. If the raw value is missing, uses the schema `default`.
3. Type-checks against the schema `type` field (loose — coerce string "3" to number 3 if schema says number).
4. Clamps numbers to `minimum`/`maximum` if present.
5. Validates `enum` membership if present.
6. Returns the validated props object.

This is intentionally a lightweight validator, not a full JSON Schema validator. It covers Pen's conventions (every prop has a default, types are simple). For full JSON Schema validation, consumers use `toZod()`.

**Coercion behavior** is intentional — LLM outputs and form data often produce strings for numeric fields. The validator coerces when the target type is unambiguous (e.g. `"3"` → `3` when schema type is `'number'`). This matches the spec's expectation that validation is lenient at the prop level. Strict validation via `toZod()` is available when needed.

### `define-extension.ts`

Full implementation. Trivial:

```typescript
export function defineExtension<TConfig = void>(
  config: DefineExtensionConfig<TConfig>,
): Extension {
  return {
    version: '0.0.0',
    ...config,
  };
}

type DefineExtensionConfig<TConfig = void> = Omit<Extension, 'version' | 'setup'> & {
  version?: string;
  setup?: TConfig extends void
    ? (editor: Editor) => ExtensionCleanup | void
    : (editor: Editor, config: TConfig) => ExtensionCleanup | void;
};

type ExtensionCleanup = {
  expose?: Record<string, unknown>;
  destroy?: () => void;
  decorations?: (state: DocumentState) => DecorationSet;
};
```

When `TConfig` is `void` (default), `setup(editor)` takes no config — backwards compatible with extensions that don't need config. When a generic is provided (e.g. `defineExtension<CollabConfig>({ ... })`), `setup(editor, config)` receives the typed config.

The `decorations` field in `ExtensionCleanup` allows extensions to provide a decoration factory function that is called by the editor's decoration collection pipeline. Extensions like search (Wave 9), collaboration (Wave 8), and track changes (Wave 7) use this to produce inline and block decorations. The function receives the current `DocumentState` and returns a `DecorationSet`.

---

## Error Handling Principles

These principles apply across all waves. Later wave specs reference this section rather than defining their own error behavior.

- **Ops never throw.** An invalid op (referencing a non-existent block, wrong type, malformed payload) is silently dropped. The editor emits a `diagnostic` event with `{ level: 'warn', source: 'apply', message, op }` for observability. The remaining ops in the batch continue to apply.
- **Extensions are isolated.** A throwing `observe()` or `decorations()` callback does not crash the editor. The error is caught, reported via `diagnostic` with `{ level: 'error', source: 'extension', extensionName, error }`, and the call is skipped for that cycle.
- **Normalization is non-fatal.** If a `BlockSchema.normalize` function throws for a given block, that block is skipped for the current normalization pass. The error is reported via `diagnostic`. The block remains in its pre-normalization state.
- **Streaming is recoverable.** If a `gen-delta` batch flush fails (CRDT write error, normalization error), the generation zone emits `gen-end` with `status: 'error'` and `reason`. The zone is cleaned up (deferred normalization is released, dirty set is flushed).

These events use the existing `PenEventMap` mechanism (`editor.on('diagnostic', handler)`). The `diagnostic` event type is added to `PenEventMap` in `types/editor.ts`.

---

## Throw Stubs to Keep

These functions must exist for downstream import but are implemented in later waves:

| Function | Wave |
|---|---|
| `createEditor()` | Wave 3 |
| `createDecorationSet()` | Wave 3 |
| `emptyDecorationSet()` | Wave 3 |
| `mergeSchemas()` | Wave 2 |
| `toZod()` | Wave 2 (or later) |

Keep them as `throw new Error('Not implemented')` with correct signatures.

---

## `index.ts` — `@pen/types` Package Entry Point

Simple barrel:

```typescript
// Types
export * from './types/index.js';

// Runtime
export { prop } from './prop.js';
export { defineBlock } from './define-block.js';
export { defineExtension } from './define-extension.js';
```

## `@pen/core` Package Entry Point

`@pen/core` re-exports everything from `@pen/types` and adds throw-stubs for runtime modules implemented in later waves. This means existing `import { ... } from '@pen/core'` statements work without changes. Downstream packages that only need types and helpers can depend on `@pen/types` directly for a lighter dependency.

```typescript
// Re-export the entire @pen/types surface
export * from '@pen/types';

// Stubs (to be implemented in later waves)
export { createEditor } from './create-editor.js';
export { createDecorationSet, emptyDecorationSet } from './decorations.js';
export { mergeSchemas } from './merge-schemas.js';
export { toZod } from './to-zod.js';
```

---

## Dependencies

**`@pen/types`:** No runtime dependencies. The `prop` builder, `defineBlock`, and `defineExtension` are pure functions with zero imports.

**`@pen/core`:** Depends on `@pen/types` (`"@pen/types": "workspace:*"`). No other runtime dependencies in Wave 0. Stubs are throw-only.

---

## Acceptance Criteria

1. **Build passes.** `pnpm build` succeeds for `@pen/types`, `@pen/core`, and all downstream packages.
2. **Typecheck passes.** `pnpm typecheck` succeeds monorepo-wide.
3. **All spec types exported.** Every type from Spec Section 3.2 has a corresponding export from `@pen/types` (and from `@pen/core` via re-export).
4. **`prop` builder produces correct JSON Schema (via `toSchema()`):**
   - `prop.string().toSchema()` → `{ type: 'string', default: '' }`
   - `prop.string().default('hello').describe('A title').toSchema()` → `{ type: 'string', default: 'hello', description: 'A title' }`
   - `prop.number().min(0).max(100).toSchema()` → `{ type: 'number', default: 0, minimum: 0, maximum: 100 }`
   - `prop.enum(['bar', 'line', 'pie']).toSchema()` → `{ type: 'string', default: 'bar', enum: ['bar', 'line', 'pie'] }`
   - `prop.enum([1, 2, 3, 4, 5, 6]).toSchema()` → `{ type: 'number', default: 1, enum: [1, 2, 3, 4, 5, 6] }`
   - `prop.array(prop.string()).toSchema()` → `{ type: 'array', default: [], items: { type: 'string', default: '' } }`
   - `prop.object({ x: prop.number() }).toSchema()` → `{ type: 'object', default: { x: 0 }, properties: { x: { type: 'number', default: 0 } } }`
   - `prop.optional(prop.string()).toSchema()` → `{ type: ['string', 'null'], default: '' }`
   - `JSON.stringify(prop.string())` produces valid JSON Schema (via `toJSON()`)
5. **`defineBlock` produces correct `BlockSchema`:**
   - Form 1: `defineBlock('heading', { props: { level: prop.enum([1,2,3]) }, content: 'inline' })` returns a `BlockSchema` with:
     - `type: 'heading'`
     - `propSchema.level` is a valid `PropSchema`
     - `validateProps` is a function that returns `{ level: 1 }` for `{}`
     - `aiDescription` contains `'heading'` and `'level'`
     - `display.title` is `'Heading'`
   - Form 2: `defineBlock({ type: 'table', propSchema: { hasHeaderRow: prop.boolean() }, content: 'table' })` returns a `BlockSchema` with `type: 'table'` and resolved `propSchema`
   - `defineBlock('bulletListItem', { content: 'inline' })` → `display.title` is `'Bullet List Item'`
   - `prop.enum([1, 2, 3])` used in `defineBlock` results in `propSchema` with `type: 'number'`
6. **`defineExtension` produces correct `Extension`:**
   - `defineExtension({ name: 'my-ext' })` returns `{ name: 'my-ext', version: '0.0.0' }`
   - `defineExtension({ name: 'x', version: '1.0.0', inputRules: [...] })` preserves all fields.
7. **Stream part types match spec.** `GenDeltaPart` has `zoneId`, `StepStartPart` has `stepIndex`, `DataPart` has `id`/`data`/`transient`, etc.
8. **`DocumentOp` union has 25 members** including `replace-text`, inline node ops, all 6 table ops, and `set-meta`. Layout ops (`set-layout`, `set-layout-child`) are M2 scope and will be added in Wave 10.
9. **`PenTransport` matches spec** with `connect()`, `disconnect()`, `connected`, `onConnectionChange()`, `reconnect()`.
10. **Tests pass.** Unit tests for `prop`, `defineBlock`, `defineExtension` added in `packages/types/src/__tests__/`.
11. **`Editor` interface includes `onBeforeApply`** with correct `(ops, options) => ops` transform signature.
12. **`Editor` interface includes `internals`** exposing `adapter`, `crdtDoc`, `doc`, `engine`, `awareness`, `getSlot`, `setSlot`.
13. **`ModelMessage` supports structured content** via `ModelMessagePart[]` union.
14. **`CRDTAdapter` includes optional `getAttributionRanges`** for per-character blame.
15. **`ApplyOptions` is defined** and used by `onBeforeApply` and `editor.apply()`.
16. **`PenStreamRequest` is defined** with `prompt`, `context`, `tools`, `toolCalls`, `messages`, `signal`, `streamId` fields.
17. **`FieldEditor` interface includes `activeBlockIds`** for cross-block selection tracking (v01 Section 5.1).
18. **`AssetProvider`, `AssetRef`, `AssetUploadOptions`** are exported from `types/persistence.ts`.
