# Wave 2 — Schema Engine, BlockHandle, Default Schema, Test Harness

**Milestone:** M0 · **Packages:** `@pen/core` (schema engine), `@pen/schema-default`, `@pen/test`, `@pen/assets-memory` · **Depends on:** Waves 0-1

---

## Goal

Build the schema engine that validates, normalizes, and resolves block types. Build the `BlockHandle` read-only projection API. Define all default block and inline schemas. Ship the test harness so every subsequent wave has tests from day one.

---

## Package 1: `@pen/core` — Schema Engine

Three new modules inside `packages/core/src/schema/`. Wave 0 creates `@pen/types` with all type definitions and lightweight helpers; Wave 2 adds the first *runtime* modules to `@pen/core` that operate on those types.

```
packages/core/src/
├── schema/
│   ├── registry.ts  (SchemaRegistryImpl + mergeSchemas)
│   ├── normalize.ts (SchemaEngineImpl + all 11 rules)
│   ├── handles.ts   (createBlockHandle + createAppHandle)
│   └── system-marks/
│       └── suggestion.ts  (core system mark — always registered)
└── index.ts         (re-exports @pen/types + schema runtime)
```

### Wave 0 Type Changes Required by This Wave

The following additions to `@pen/types` must land in Wave 0 (or early in Wave 2 before the runtime modules are implemented). They are listed here so the dependency is explicit.

| Interface | Change | Rationale |
|---|---|---|
| `ComposableSchema` | Widen `extend` parameter from `BlockSchema[]` to `(BlockSchema \| InlineSchema)[]` | Consumers need to add inline schemas via `extend()`, not just blocks. |
| `ComposableSchema` | Add `overrideSystemMark(type: string, schema: InlineSchema): ComposableSchema` | Consumers need to replace system mark behavior without removing them. |
| `SchemaRegistry` | Add `allBlockDisplays(): readonly (BlockSchema & { display: BlockDisplay })[]` | Slash menu needs to query blocks with display metadata. |
| `SchemaRegistry` | Add `BlockDisplay` type (`{ title, description?, icon?, group?, aliases? }`) | Referenced by `allBlockDisplays()` and `BlockSchema.display`. |

### Prerequisites: CRDT Type Access

The normalization engine and `BlockHandle` operate on concrete Yjs types (`Y.Array<string>`, `Y.Map<Y.Map<unknown>>`, etc.), not the abstract `PenDocument` interface from `@pen/core` which types `blockOrder`, `blocks`, `apps`, and `metadata` as `unknown`.

Wave 1 defines `YjsPenDocument` with concrete types (see wave-01-crdt-layer.md, `YjsPenDocument` interface):

```typescript
interface YjsPenDocument extends PenDocument {
  readonly blockOrder: Y.Array<string>;
  readonly blocks: Y.Map<Y.Map<unknown>>;
  readonly apps: Y.Map<Y.Map<unknown>>;
  readonly metadata: Y.Map<unknown>;
  readonly adapter: CRDTAdapter;
}
```

All code in `schema/normalize.ts` and `schema/handles.ts` accepts `PenDocument` at the public interface boundary, then narrows internally to `YjsPenDocument` via the Wave 1 `isYjsCRDTDocument` type guard. This mirrors Wave 1's own `asYjsDoc()` pattern. The code examples in this spec show the narrowed types directly for clarity.

**CRDT type construction:** When normalization or handles need to create new CRDT shared types (e.g. `Y.Map` for a new props map, `Y.Text` for empty inline content), they call the `CRDTAdapter.createMap()`, `createArray()`, and `createText()` factory methods — NOT Yjs constructors directly. This preserves the adapter abstraction so that `@pen/core` has zero runtime import of `yjs`. See Wave 1, Section 3 for the `DocumentStore` factory methods.

### Import DAG (schema modules)

```
types/schema.ts          ← (type definitions only)
types/handles.ts         ← (type definitions only)
types/crdt.ts            ← (type definitions only)
schema/registry.ts       ← types/schema (BlockSchema, InlineSchema, AppSchema,
                            ComposableSchema, SchemaRegistry, BlockDisplay, LayoutSchema)
                         ← schema/system-marks/suggestion (core system mark)
schema/normalize.ts      ← types/schema (SchemaEngine, SchemaRegistry, BlockSchema, InlineSchema)
                         ← types/crdt (PenDocument)
                         ← @pen/crdt-yjs (YjsPenDocument — type-only for narrowing)
schema/handles.ts        ← types/handles (BlockHandle, AppHandle)
                         ← types/crdt (PenDocument)
                         ← types/schema (SchemaRegistry)
                         ← types/block (AppPlacement)
                         ← types/layout (LayoutProps)
                         ← @pen/crdt-yjs (YjsPenDocument — type-only for narrowing)
```

No cycles.

---

### Module: `schema/system-marks/suggestion.ts` — Core System Mark

The `suggestion` system mark is defined in `@pen/core`, not `@pen/schema-default`. The v01 spec (Section 4.3) explicitly states: "System marks use the same `InlineSchema` interface but are not part of `@pen/schema-default`." The core system mark is `suggestion`.

```typescript
import type { InlineSchema } from '../../types/schema.js';
import { prop } from '../../prop.js';

export const suggestion: InlineSchema = {
  type: 'suggestion',
  propSchema: {
    id: prop.string().default('').describe('Unique suggestion identifier'),
    action: prop.enum(['insert', 'delete']).default('insert')
      .describe('Whether marked text was inserted or deleted'),
    author: prop.string().default('').describe('Author identifier'),
    authorType: prop.enum(['user', 'ai']).default('user')
      .describe('Whether the author is a human or AI'),
    createdAt: prop.number().default(0).describe('Unix timestamp'),
    model: prop.string().optional().describe('AI model identifier'),
  },
  kind: 'mark',
  system: true,
  expand: 'none',
  serialize: {
    toMarkdown: (text, props) =>
      props?.action === 'delete' ? `{--${text}--}` : `{++${text}++}`,
    toHTML: (text, props) =>
      props?.action === 'delete'
        ? `<del data-suggestion-id="${props?.id ?? ''}">${text}</del>`
        : `<ins data-suggestion-id="${props?.id ?? ''}">${text}</ins>`,
  },
  aiDescription: 'Track changes suggestion mark (system)',
};
```

Key properties:
- `system: true` — always registered, excluded from LLM schema view.
- `expand: 'none'` — suggestions have explicit boundaries managed by the track changes system.
- Markdown uses CriticMarkup notation (`{++inserted++}`, `{--deleted--}`).
- HTML uses `<ins>` / `<del>` tags with `data-suggestion-id` for cross-referencing.

The `SchemaRegistryImpl` constructor auto-includes this mark in `_systemMarks` as a baseline. Consumer-provided `systemMarks` in `SchemaRegistryConfig` are merged on top (last wins for the same type key), so the suggestion mark can be overridden via `overrideSystemMark()` but never accidentally removed.

---

### Module: `schema/registry.ts` — SchemaRegistry

Implements the `SchemaRegistry` and `ComposableSchema` interfaces (Spec Section 4.9).

#### Internal Data Structures

```typescript
import { suggestion as coreSuggestionMark } from './system-marks/suggestion.js';

class SchemaRegistryImpl implements ComposableSchema {
  private readonly _blocks: ReadonlyMap<string, BlockSchema>;
  private readonly _inlines: ReadonlyMap<string, InlineSchema>;
  private readonly _apps: ReadonlyMap<string, AppSchema>;
  private readonly _systemMarks: ReadonlyMap<string, InlineSchema>;
  private readonly _onUnknownBlock?: (type: string, raw: unknown) =>
    BlockSchema | 'drop' | 'passthrough';
  private readonly _onUnknownInline?: (type: string, raw: unknown) =>
    InlineSchema | 'drop' | 'passthrough';

  constructor(config: SchemaRegistryConfig) {
    this._blocks = new Map(config.blocks?.map(s => [s.type, s]));
    this._inlines = new Map(config.inlines?.map(s => [s.type, s]));
    this._apps = new Map(config.apps?.map(s => [s.type, s]));

    // Core system marks are always present as a baseline.
    // Consumer-provided systemMarks merge on top (last wins).
    const systemMarks = new Map<string, InlineSchema>([
      [coreSuggestionMark.type, coreSuggestionMark],
    ]);
    if (config.systemMarks) {
      for (const s of config.systemMarks) {
        systemMarks.set(s.type, s);
      }
    }
    this._systemMarks = systemMarks;

    this._onUnknownBlock = config.onUnknownBlock;
    this._onUnknownInline = config.onUnknownInline;
  }

  allApps(): readonly AppSchema[] {
    return [...this._apps.values()];
  }
}

interface SchemaRegistryConfig {
  blocks?: readonly BlockSchema[];
  inlines?: readonly InlineSchema[];
  apps?: readonly AppSchema[];
  systemMarks?: readonly InlineSchema[];
  onUnknownBlock?: (type: string, raw: unknown) =>
    BlockSchema | 'drop' | 'passthrough';
  onUnknownInline?: (type: string, raw: unknown) =>
    InlineSchema | 'drop' | 'passthrough';
}
```

`SchemaRegistryConfig` is not exported — consumers create registries via `createDefaultSchema()` (in `@pen/schema-default`) or via `extend()`/`mergeSchemas()`.

`allApps()` is part of the `SchemaRegistry` interface, allowing `mergeSchemas` to access app schemas from any registry implementation without `instanceof` checks (which break across package boundaries in pnpm monorepos).

#### Immutability Strategy

All composition methods (`extend`, `without`, `override`, `overrideSystemMark`) return new `SchemaRegistryImpl` instances. Internally they shallow-copy the relevant `Map` into a new `Map`, apply mutations to the copy, then pass it to the constructor. The original maps are never mutated.

Cost is O(n) where n is the number of schemas in the affected map. This is acceptable because:
- Registries are created once per editor instance, not per operation.
- Typical schema sets are small (12 blocks, 11 inlines for default).
- No deep cloning — `BlockSchema` and `InlineSchema` objects are already frozen (produced by `defineBlock`/`defineInline`).

#### Lookup Methods

**`resolve(type: string): BlockSchema | null`**

```typescript
resolve(type: string): BlockSchema | null {
  const schema = this._blocks.get(type);
  if (schema) return schema;

  if (this._onUnknownBlock) {
    const result = this._onUnknownBlock(type, undefined);
    if (result === 'drop') return null;
    if (result === 'passthrough') return passthroughBlockSchema(type);
    return result;  // BlockSchema returned by handler
  }

  return null;
}
```

The `onUnknownBlock` result is NOT cached. The registry is immutable — caching would require mutable state. Each lookup for an unknown type re-invokes the handler. This is intentional: the handler may return different results based on external state (e.g. a remote schema registry that resolves lazily).

**Passthrough schema shape.** When `onUnknownBlock` returns `'passthrough'`, the registry returns a minimal schema that preserves the block's data without validation:

```typescript
function passthroughBlockSchema(type: string): BlockSchema {
  return {
    type,
    propSchema: {},
    content: 'none',
    serialize: {},
    display: { title: type },
  };
}
```

This allows unknown blocks to survive round-trips (paste, sync, import) without data loss. The block renders as an opaque container. Consumers see the raw type in dev tools.

**`resolveInline(type: string): InlineSchema | null`**

Checks `_inlines` first, then `_systemMarks`. System marks are always resolvable regardless of schema composition. If neither has the type, calls `_onUnknownInline` with the same drop/passthrough semantics.

**`resolveApp(type: string): AppSchema | null`**

Checks `_apps`. No unknown-app handler — apps are always explicitly registered.

**`resolveLayout(type: string): LayoutSchema | null`**

Finds the block schema via `resolve(type)`, returns `schema.layout ?? null`. For M0 this always returns null — layout blocks are M2 scope. The method exists for interface completeness.

**`allBlocks(): readonly BlockSchema[]`**

Returns `[...this._blocks.values()]`. New array on each call — no shared mutable reference.

**`allInlines(): readonly InlineSchema[]`**

Returns `[...this._inlines.values(), ...this._systemMarks.values()]`. Merges both maps. System marks are always included in the full inline list.

**`allBlockDisplays(): readonly (BlockSchema & { display: BlockDisplay })[]`**

```typescript
allBlockDisplays(): readonly (BlockSchema & { display: BlockDisplay })[] {
  const result: (BlockSchema & { display: BlockDisplay })[] = [];
  for (const schema of this._blocks.values()) {
    if (schema.display) {
      result.push(schema as BlockSchema & { display: BlockDisplay });
    }
  }
  return result;
}
```

Used by `Pen.SlashMenu` for auto-population. Only returns blocks with explicit `display` metadata — blocks without `display` are hidden from the UI but still resolvable.

#### Composition Methods

**`extend(schemas: readonly (BlockSchema | InlineSchema)[]): ComposableSchema`**

```typescript
extend(schemas: readonly (BlockSchema | InlineSchema)[]): ComposableSchema {
  const blocks = new Map(this._blocks);
  const inlines = new Map(this._inlines);

  for (const schema of schemas) {
    if ('kind' in schema) {
      inlines.set(schema.type, schema as InlineSchema);
    } else {
      blocks.set(schema.type, schema as BlockSchema);
    }
  }

  return new SchemaRegistryImpl({
    blocks: [...blocks.values()],
    inlines: [...inlines.values()],
    apps: [...this._apps.values()],
    systemMarks: [...this._systemMarks.values()],
    onUnknownBlock: this._onUnknownBlock,
    onUnknownInline: this._onUnknownInline,
  });
}
```

Discriminates block vs inline by the presence of `kind` (`InlineSchema` has `kind: 'mark' | 'node'` as a required field; `BlockSchema` never has `kind`). This is robust because `kind` is part of the `InlineSchema` interface definition. If a type already exists, the new schema replaces it (extend is also update).

**`without(types: readonly string[]): ComposableSchema`**

```typescript
without(types: readonly string[]): ComposableSchema {
  const typeSet = new Set(types);
  const blocks = new Map(this._blocks);
  const inlines = new Map(this._inlines);

  for (const type of typeSet) {
    blocks.delete(type);
    inlines.delete(type);
  }

  return new SchemaRegistryImpl({
    blocks: [...blocks.values()],
    inlines: [...inlines.values()],
    apps: [...this._apps.values()],
    systemMarks: [...this._systemMarks.values()],
    onUnknownBlock: this._onUnknownBlock,
    onUnknownInline: this._onUnknownInline,
  });
}
```

Cannot remove system marks via `without()` — they live in `_systemMarks`, not `_inlines`. Use `overrideSystemMark()` to replace system mark behavior.

**`override(type: string, patch: Partial<BlockSchema>): ComposableSchema`**

```typescript
override(type: string, patch: Partial<BlockSchema>): ComposableSchema {
  const existing = this._blocks.get(type);
  if (!existing) {
    throw new Error(`Cannot override unknown block type: ${type}`);
  }

  const merged: BlockSchema = { ...existing, ...patch, type: existing.type };
  if (patch.serialize) {
    merged.serialize = { ...existing.serialize, ...patch.serialize };
  }

  const blocks = new Map(this._blocks);
  blocks.set(type, merged);

  return new SchemaRegistryImpl({
    blocks: [...blocks.values()],
    inlines: [...this._inlines.values()],
    apps: [...this._apps.values()],
    systemMarks: [...this._systemMarks.values()],
    onUnknownBlock: this._onUnknownBlock,
    onUnknownInline: this._onUnknownInline,
  });
}
```

`override` shallow-merges the patch into the existing schema. `serialize` is merged one level deeper so consumers can override `toMarkdown` without losing `toHTML`. The `type` field is never overridden (it's the identity key).

Throws if the type doesn't exist — use `extend()` to add new types.

**`overrideSystemMark(type: string, schema: InlineSchema): ComposableSchema`**

```typescript
overrideSystemMark(type: string, schema: InlineSchema): ComposableSchema {
  const systemMarks = new Map(this._systemMarks);
  systemMarks.set(type, { ...schema, system: true });

  return new SchemaRegistryImpl({
    blocks: [...this._blocks.values()],
    inlines: [...this._inlines.values()],
    apps: [...this._apps.values()],
    systemMarks: [...systemMarks.values()],
    onUnknownBlock: this._onUnknownBlock,
    onUnknownInline: this._onUnknownInline,
  });
}
```

Forces `system: true` on the replacement — consumers cannot accidentally un-system a system mark.

#### `mergeSchemas(...registries)` — Top-Level Export

Currently a throw stub in `@pen/core`. Implement in this wave:

```typescript
export function mergeSchemas(...registries: SchemaRegistry[]): ComposableSchema {
  const blocks = new Map<string, BlockSchema>();
  const inlines = new Map<string, InlineSchema>();
  const apps = new Map<string, AppSchema>();
  const systemMarks = new Map<string, InlineSchema>();

  for (const registry of registries) {
    for (const schema of registry.allBlocks()) {
      blocks.set(schema.type, schema);
    }
    for (const schema of registry.allInlines()) {
      if ((schema as InlineSchema).system) {
        systemMarks.set(schema.type, schema);
      } else {
        inlines.set(schema.type, schema);
      }
    }
    for (const schema of registry.allApps()) {
      apps.set(schema.type, schema);
    }
  }

  return new SchemaRegistryImpl({
    blocks: [...blocks.values()],
    inlines: [...inlines.values()],
    apps: [...apps.values()],
    systemMarks: [...systemMarks.values()],
  });
}
```

Iterates left-to-right. Later entries override earlier for the same type key. System marks are detected via the `system` flag on `InlineSchema` and routed to the dedicated `systemMarks` map.

App schemas are accessed via the `allApps()` method on `SchemaRegistryImpl`. For non-`SchemaRegistryImpl` registries, app schemas are skipped — this is a known limitation documented in the API.

#### Exports from `schema/registry.ts`

```typescript
export { SchemaRegistryImpl, mergeSchemas };
export type { SchemaRegistryConfig };
```

Re-exported from `packages/core/src/index.ts`:
- `mergeSchemas` — replaces the throw stub.
- `SchemaRegistryImpl` — exported for `@pen/schema-default` to construct the default registry.
- `suggestion` — re-exported from `schema/system-marks/suggestion.ts` for consumers that need direct access.

---

### Module: `schema/normalize.ts` — SchemaEngine + Normalization

Implements `SchemaEngine` (Spec Section 4.8). The most complex module in Wave 2.

#### Architecture

```typescript
import type { YjsPenDocument } from '@pen/crdt-yjs';

export class SchemaEngineImpl implements SchemaEngine {
  private readonly registry: SchemaRegistry;
  private readonly doc: PenDocument;
  private readonly crdtDoc: CRDTDocument;
  private readonly dirtyBlockIds = new Set<string>();
  private readonly deferredBlockIds = new Set<string>();

  constructor(registry: SchemaRegistry, doc: PenDocument, crdtDoc: CRDTDocument) {
    this.registry = registry;
    this.doc = doc;
    this.crdtDoc = crdtDoc;
  }

  markDirty(blockId: string): void {
    this.dirtyBlockIds.add(blockId);
  }

  deferBlock(blockId: string): void {
    this.deferredBlockIds.add(blockId);
  }

  undeferBlock(blockId: string): void {
    this.deferredBlockIds.delete(blockId);
    if (this.dirtyBlockIds.has(blockId)) {
      this.normalizeBlock(blockId);
      this.dirtyBlockIds.delete(blockId);
    }
  }

  normalizeDirty(): void { /* ... */ }
  normalizeAll(): void { /* ... */ }
  private normalizeBlock(blockId: string): void { /* ... */ }
}
```

The constructor takes both `PenDocument` (for reading block data via the narrowed `YjsPenDocument`) and `CRDTDocument` (for passing to `adapter.transact()`). The `CRDTAdapter.transact` signature requires `(doc: CRDTDocument, fn: () => void, origin?: string)` — the doc parameter cannot be omitted.

**`deferBlock` / `undeferBlock`:** Not part of the `SchemaEngine` interface (which is the public API). These are called internally by the editor's streaming pipeline: `gen-start` calls `deferBlock`, `gen-end` calls `undeferBlock`. Exposed as public methods on `SchemaEngineImpl` (the concrete class), not on the interface.

#### Internal Utilities

Helper functions used throughout the normalization pipeline:

```typescript
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (typeof a !== typeof b) return false;
  if (typeof a !== 'object') return false;

  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    return a.every((v, i) => deepEqual(v, b[i]));
  }

  const keysA = Object.keys(a as Record<string, unknown>);
  const keysB = Object.keys(b as Record<string, unknown>);
  if (keysA.length !== keysB.length) return false;
  return keysA.every(k =>
    deepEqual(
      (a as Record<string, unknown>)[k],
      (b as Record<string, unknown>)[k],
    )
  );
}

function arraysEqual(a: readonly unknown[], b: readonly unknown[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function sortDeltaAttributes(
  attributes: Record<string, unknown>,
  registry: SchemaRegistry,
): Record<string, unknown> {
  const keys = Object.keys(attributes);
  if (keys.length < 2) return attributes;

  const sorted = [...keys].sort((a, b) => {
    const schemaA = registry.resolveInline(a);
    const schemaB = registry.resolveInline(b);
    if (schemaA?.system || schemaB?.system) return 0;
    return (schemaA?.priority ?? 0) - (schemaB?.priority ?? 0);
  });

  const result: Record<string, unknown> = {};
  for (const key of sorted) {
    result[key] = attributes[key];
  }
  return result;
}
```

`deepEqual` handles primitives, plain objects (recursive), arrays (recursive), `null`, and `undefined`. It does NOT handle Yjs types (`Y.Map`, `Y.Array`), Dates, or circular references — props are always serialized to plain values in the CRDT.

`sortDeltaAttributes` is the read-time attribute ordering utility used by Rule 1. It sorts non-system mark keys by priority, returning a new object with correctly ordered keys.

Block order helpers used by Rules 6, 9, and 11:

```typescript
private removeFromBlockOrder(blockId: string): void {
  const arr = this.doc.blockOrder as Y.Array<string>;
  for (let i = arr.length - 1; i >= 0; i--) {
    if (arr.get(i) === blockId) {
      arr.delete(i, 1);
      return;
    }
  }
}

private insertIntoBlockOrder(blockId: string, index: number): void {
  (this.doc.blockOrder as Y.Array<string>).insert(index, [blockId]);
}

private getBlockOrderIndex(blockId: string): number {
  const arr = this.doc.blockOrder as Y.Array<string>;
  for (let i = 0; i < arr.length; i++) {
    if (arr.get(i) === blockId) return i;
  }
  return -1;
}
```

#### `normalizeDirty()` Algorithm

```typescript
normalizeDirty(): void {
  const MAX_ITERATIONS = 1000;
  let iterations = 0;

  while (this.dirtyBlockIds.size > 0 && iterations < MAX_ITERATIONS) {
    iterations++;
    const snapshot = [...this.dirtyBlockIds];
    this.dirtyBlockIds.clear();

    this.doc.adapter.transact(this.crdtDoc, () => {
      for (const blockId of snapshot) {
        if (this.deferredBlockIds.has(blockId)) {
          this.dirtyBlockIds.add(blockId);
          continue;
        }
        this.normalizeBlock(blockId);
      }
    });
  }

  if (iterations >= MAX_ITERATIONS) {
    console.warn(
      'SchemaEngine: normalizeDirty exceeded max iterations. ' +
      'Possible infinite normalization loop.'
    );
  }
}
```

Key design decisions:

1. **Snapshot-then-clear.** Copy `dirtyBlockIds` into an array, clear the set, then process. If `normalizeBlock` dirties additional blocks (e.g. orphan promotion marks children dirty), those new entries go into the now-empty set and are processed in the next iteration of the outer `while` loop.

2. **CRDT transaction boundary.** Each iteration of the outer loop runs inside a single `adapter.transact()` call. Note the correct signature: `adapter.transact(this.crdtDoc, fn)` — the `CRDTAdapter.transact` method requires the `CRDTDocument` as its first argument. This batches all CRDT mutations from one normalization pass into a single update event, preventing intermediate states from triggering observers or sync.

3. **Max-iterations guard.** Protects against infinite loops caused by two normalize rules that dirty each other. The limit of 1000 is generous — a well-behaved normalization should converge in 1-2 passes.

4. **Deferred blocks re-added.** Blocks in `deferredBlockIds` are skipped but re-added to `dirtyBlockIds` so they're processed when `undeferBlock` is called.

#### `normalizeAll()`

```typescript
normalizeAll(): void {
  for (const blockId of (this.doc.blocks as Y.Map<unknown>).keys()) {
    this.dirtyBlockIds.add(blockId);
  }
  this.normalizeDirty();
}
```

Iterates the full `blocks` map (not just `blockOrder`) to ensure every block in the document is normalized on load, including layout-nested blocks that only exist in `children` arrays and never appear in `blockOrder`. Only runs on document load or explicit migration.

#### `normalizeBlock(blockId)` Pipeline

A single block normalization runs the rules in a fixed order. The order matters — structural rules must run before content rules because structural fixes may change which blocks exist or which arrays they belong to.

```typescript
private normalizeBlock(blockId: string): void {
  const blockMap = this.doc.blocks.get(blockId) as Y.Map<unknown> | undefined;
  if (!blockMap) {
    this.handleDeletedBlock(blockId);  // Rule 10
    return;
  }

  const type = blockMap.get('type') as string;
  const schema = this.registry.resolve(type);
  if (!schema) return;  // unknown type, no normalization

  // Phase 1: Structural rules (document-level)
  this.deduplicateBlockIds(blockId);          // Rule 9
  this.enforceCrossArrayMembership(blockId);  // Rule 11

  // Phase 2: Block-level rules
  this.stripDefaultProps(blockId, schema);    // Rule 4
  this.runBlockNormalize(blockId, schema);    // Rule 5

  if (this.normalizeLayout(blockId, schema)) return;  // Rule 6 (may delete block)

  this.ensureNonEmptyContent(blockId, schema);  // Rule 3

  // Phase 3: Inline content rules (read-time only — no CRDT mutations)
  // Rule 1 (mark ordering) is enforced at read time via sortDeltaAttributes(),
  // not as a CRDT mutation. See Rule 1 section below.
  // Rule 2 (superfluous stripping) runs as a CRDT mutation.
  if (schema.content === 'inline') {
    this.stripSuperfluousMarks(blockId);     // Rule 2
    // Rule 8: system marks are excluded from rule 2 internally
  }

  // Rule 7: metadata — no-op (explicitly skipped)
}
```

**Rule 6 early return:** `normalizeLayout` returns `true` if it deleted the block (empty container collapse or single-child unwrap). When this happens, the pipeline bails immediately — subsequent rules must not operate on a deleted block.

#### Rule Execution Order Rationale

| Phase | Rules | Why first |
|---|---|---|
| Structural | 9, 11 | Fix array-level inconsistencies. A duplicate block ID in `blockOrder` would cause later rules to process the same block twice. Cross-array membership must be resolved before per-block rules inspect `blockOrder` position. |
| Block-level | 4, 5, 6, 3 | Operate on the block's own `Y.Map`. Rule 4 strips defaults before Rule 5 runs custom normalization (which may depend on sparse props). Rule 6 before Rule 3: layout unwrapping may delete the block entirely (early return). Rule 3 last because prior rules may have emptied the content. |
| Inline content | 1, 2 | Rule 1 is read-time only (no mutations). Rule 2 strips null-valued attributes. System marks (Rule 8) are handled by exclusion within Rule 2. |

Rule 10 (orphan promotion) is NOT in the per-block pipeline. It triggers when `normalizeBlock` detects a deleted block — see `handleDeletedBlock()`.

Rule 7 (metadata excluded) is a no-op. The pipeline never touches `blockMap.get('meta')`.

---

#### Per-Rule Implementation Details

##### Rule 1: Inline Mark Ordering (Read-Time)

**Input:** Block's `Y.Text` deltas, read during serialization or decoration production.

**Yjs semantics clarification:** Yjs stores inline mark attributes as a flat `Record<string, unknown>` per delta (e.g. `{ bold: true, italic: true }`). JavaScript object key order has no semantic effect on Yjs behavior — `{ bold: true, italic: true }` and `{ italic: true, bold: true }` are identical in the CRDT. The concept of "bold wraps outside italic" is a serialization and rendering concern, not a CRDT storage concern.

**Therefore, Rule 1 produces zero CRDT writes.** It is enforced at **read time**, not as a CRDT mutation. The normalization pipeline does not call an `orderInlineMarks` method. Instead, all code that reads `Y.Text` deltas for serialization or decoration production uses the `sortDeltaAttributes()` utility to sort attribute keys by priority before processing:

```typescript
// Used in serialization, decoration, and export code paths:
const deltas = content.toDelta();
const orderedDeltas = deltas.map(delta => {
  if (!delta.attributes || Object.keys(delta.attributes).length < 2) return delta;
  return { ...delta, attributes: sortDeltaAttributes(delta.attributes, registry) };
});
```

**Idempotency:** Rule 1 produces zero CRDT writes by design — it is a read-time concern. The idempotency invariant is trivially satisfied.

**Rule 8 interaction:** System marks are excluded from sorting within `sortDeltaAttributes`. The `sort` comparator returns 0 for any pair involving a system mark, preserving their relative position.

##### Rule 2: Strip Superfluous Wrappers

**Input:** Block's `Y.Text` deltas.

**Algorithm:** Iterate deltas. For each delta with mark attributes, check if any mark attribute is redundant — i.e. the same mark with the same value exists on the enclosing context. In the flat Yjs model, "enclosing context" means the mark is present on adjacent deltas with identical values, creating a contiguous range where the mark adds no new formatting.

```typescript
private stripSuperfluousMarks(blockId: string): void {
  const blockMap = this.doc.blocks.get(blockId) as Y.Map<unknown>;
  const content = blockMap.get('content');
  if (!(content instanceof Y.Text)) return;

  const deltas = content.toDelta();
  if (deltas.length < 2) return;

  let offset = 0;
  for (const delta of deltas) {
    const len = typeof delta.insert === 'string' ? delta.insert.length : 1;
    if (delta.attributes) {
      for (const [mark, value] of Object.entries(delta.attributes)) {
        const schema = this.registry.resolveInline(mark);
        if (schema?.system) continue;  // Rule 8: never strip system marks
        if (value === null || value === false) {
          content.format(offset, len, { [mark]: null });
        }
      }
    }
    offset += len;
  }
}
```

**Idempotency:** After stripping, no redundant marks remain. Second pass finds nothing to strip.

**Edge case:** `value === null` in Yjs deltas indicates explicit mark removal. These are artifacts of concurrent editing where one user adds a mark and another removes it on overlapping ranges. The normalization strips the null-valued attribute.

##### Rule 3: No Empty Containers

**Input:** Block's `Y.Text` for `content: 'inline'` blocks.

**Algorithm:**

```typescript
private ensureNonEmptyContent(blockId: string, schema: BlockSchema): void {
  if (schema.content !== 'inline') return;

  const blockMap = this.doc.blocks.get(blockId) as Y.Map<unknown>;
  let content = blockMap.get('content');

  if (!(content instanceof Y.Text)) {
    const ytext = this.doc.adapter.createText();
    blockMap.set('content', ytext);
    content = ytext;
  }

  if ((content as Y.Text).length > 0) return;

  (content as Y.Text).insert(0, '\u200B');
}
```

**Zero-width space (`\u200B`) as placeholder:** Simplifies cursor placement and LLM operations. The field editor strips it on the first real keystroke. The serializer ignores it (zero-width space is not visible and does not contribute to `textContent()`).

**Idempotency:** If content already has the placeholder (or any content), the length check passes and no write occurs.

##### Rule 4: Strip Default Props

**Input:** Block's props `Y.Map` and the `BlockSchema.propSchema`.

**Algorithm:**

```typescript
private stripDefaultProps(blockId: string, schema: BlockSchema): void {
  const blockMap = this.doc.blocks.get(blockId) as Y.Map<unknown>;
  const props = blockMap.get('props') as Y.Map<unknown> | undefined;
  if (!props) return;

  for (const [key, propSchema] of Object.entries(schema.propSchema)) {
    if (!props.has(key)) continue;
    const value = props.get(key);
    const defaultValue = (propSchema as Record<string, unknown>).default;
    if (defaultValue !== undefined && deepEqual(value, defaultValue)) {
      props.delete(key);
    }
  }
}
```

**Idempotency:** After stripping, no prop equals its default. Second pass finds nothing to delete.

**Why strip defaults:** Reduces CRDT state size and token count. A heading with `{ level: 1 }` (the default) stores no `level` prop. The `BlockHandle.props` getter fills defaults from the schema when reading, so consumers always see complete props.

##### Rule 5: Block-Type-Specific Normalization

**Input:** The block's `Y.Map` and `BlockSchema.normalize` function (if defined).

**Algorithm:**

```typescript
private runBlockNormalize(blockId: string, schema: BlockSchema): void {
  if (!schema.normalize) return;

  const blockMap = this.doc.blocks.get(blockId) as Y.Map<unknown>;
  const type = blockMap.get('type') as string;
  const props = this.readPropsWithDefaults(blockMap, schema);
  const content = blockMap.get('content');

  const block: Block = {
    id: blockId,
    type,
    props,
    content: content instanceof Y.Text ? content.toString() : '',
  };

  const normalized = schema.normalize(block);
  if (normalized === block) return;  // identity check — no changes

  const propsMap = blockMap.get('props') as Y.Map<unknown>;
  if (propsMap && normalized.props !== block.props) {
    for (const [key, value] of Object.entries(normalized.props)) {
      if (!deepEqual(value, block.props[key])) {
        propsMap.set(key, value);
      }
    }
  }
}
```

The `normalize` function receives a plain `Block` snapshot and returns a (possibly modified) `Block`. If the returned object is identity-equal (`===`) to the input, no CRDT writes occur. This is the custom hook point for block-specific invariants (e.g. clamping `heading.level` to 1-6).

**Idempotency:** The `normalize` function MUST be idempotent. The schema engine does not enforce this — it's a contract. The acceptance tests verify it by calling `normalize` twice and asserting zero CRDT writes on the second call.

##### Rule 6: Layout Normalization

**Input:** Block's `Y.Map`, `BlockSchema.layout` definition.

**Returns `true` if the block was deleted** (empty container collapse or single-child unwrap). The caller must bail immediately when this returns `true`.

**Algorithm:**

```typescript
private normalizeLayout(blockId: string, schema: BlockSchema): boolean {
  if (!schema.layout) return false;

  const blockMap = this.doc.blocks.get(blockId) as Y.Map<unknown>;
  const children = blockMap.get('children') as Y.Array<string> | undefined;
  if (!children) return false;

  // Empty layout container -> collapse (delete the block)
  if (children.length === 0) {
    this.doc.blocks.delete(blockId);
    this.removeFromBlockOrder(blockId);
    return true;  // block deleted
  }

  // Single-child row/column -> unwrap (move child out, delete container)
  // Read direction from the block's runtime layout props, not the schema declaration.
  // LayoutSchema has modes/defaultMode; direction lives in LayoutProps (the block's layout Y.Map).
  const layoutMap = blockMap.get('layout') as Y.Map<unknown> | undefined;
  const layoutDir = (layoutMap?.get('direction') as string) ?? 'column';
  if (children.length === 1 && (layoutDir === 'row' || layoutDir === 'column')) {
    const childId = children.get(0);
    const idx = this.getBlockOrderIndex(blockId);
    this.removeFromBlockOrder(blockId);
    if (idx >= 0) this.insertIntoBlockOrder(childId, idx);
    this.doc.blocks.delete(blockId);
    this.dirtyBlockIds.add(childId);
    return true;  // block deleted
  }

  // Strip layout props that match defaults
  const layoutProps = blockMap.get('layout') as Y.Map<unknown> | undefined;
  if (layoutProps) {
    for (const [key, value] of [...layoutProps.entries()]) {
      const defaultValue = (schema.layout as Record<string, unknown>)?.[key];
      if (defaultValue !== undefined && deepEqual(value, defaultValue)) {
        layoutProps.delete(key);
      }
    }
  }

  return false;  // block still exists
}
```

**M0 note:** Layout blocks are M2 scope. For M0, no default blocks have `layout` defined, so this rule is effectively a no-op. The implementation is included now for correctness and to enable testing with custom layout blocks.

**Idempotency:** After collapsing empty containers and unwrapping single-child containers, neither condition can trigger again. Default-stripping is idempotent by the same logic as Rule 4.

##### Rule 7: Metadata Excluded

No-op. The `normalizeBlock` pipeline never reads or writes `blockMap.get('meta')`. Documented here for spec completeness.

Metadata is the extension author's domain. The `BlockHandle.meta(namespace)` read accessor provides the read API; writes go through `editor.apply({ type: 'set-meta', ... })`. The normalization engine treats metadata as opaque.

##### Rule 8: System Mark Preservation

Not a standalone rule — it's enforced by exclusion within Rule 1 and Rule 2.

**In Rule 1 (mark ordering):** System marks are excluded from the sort comparator in `sortDeltaAttributes`. Their relative position among mark attributes is preserved regardless of priority.

**In Rule 2 (superfluous stripping):** Marks with `schema.system === true` are skipped entirely. System marks are never stripped.

**Verification (debug mode only):** In development builds, after normalization, assert that all system mark attributes in the `Y.Text` deltas are unchanged from the pre-normalization snapshot. This catches bugs in Rule 2 that inadvertently modify system mark boundaries.

##### Rule 9: No Duplicate Block IDs

**Input:** `doc.blockOrder` Y.Array and the current block's `children` Y.Array.

**Scope:** This rule only deduplicates `blockId` (the block currently being normalized), not a global scan of all IDs. This is correct because the dirty set always includes the affected block: `block-insert` and `move-block` operations add the moved block to the dirty set, so any newly-created duplicate is normalized in the same pass.

**Algorithm:**

```typescript
private deduplicateBlockIds(blockId: string): void {
  this.deduplicateArray(this.doc.blockOrder, blockId);

  const blockMap = this.doc.blocks.get(blockId) as Y.Map<unknown>;
  const children = blockMap?.get('children') as Y.Array<string> | undefined;
  if (children) {
    this.deduplicateArray(children, blockId);
  }
}

private deduplicateArray(arr: Y.Array<string>, targetId: string): void {
  const indices: number[] = [];
  for (let i = 0; i < arr.length; i++) {
    if (arr.get(i) === targetId) {
      indices.push(i);
    }
  }
  if (indices.length <= 1) return;

  // Keep the last occurrence, delete earlier ones (reverse order to preserve indices)
  for (let i = indices.length - 2; i >= 0; i--) {
    arr.delete(indices[i], 1);
  }
}
```

**Why last-writer-wins:** Yjs implements `move-block` as delete + insert on `Y.Array`. Concurrent moves of the same block produce two inserts. The last insert (by Yjs timestamp ordering) represents the "newest" position. Keeping the last occurrence aligns with Yjs's conflict resolution model.

**Loro note:** The Loro adapter's native movable tree CRDT handles this structurally. This rule is a no-op when the CRDT backend supports atomic moves.

**Idempotency:** After dedup, each ID appears at most once. Second pass finds no duplicates.

##### Rule 10: Orphan Promotion

**Input:** A deleted block's ID and all blocks with `parentId` pointing to it.

**Algorithm:**

```typescript
private handleDeletedBlock(blockId: string): void {
  for (const [id, blockMap] of this.doc.blocks.entries()) {
    const props = blockMap.get('props') as Y.Map<unknown> | undefined;
    if (!props) continue;
    const parentId = props.get('parentId');
    if (parentId === blockId) {
      props.delete('parentId');
      this.dirtyBlockIds.add(id);
    }
  }
}
```

Called when `normalizeBlock` finds that `this.doc.blocks.get(blockId)` returns `undefined` — the block was deleted but its children still reference it.

**Promoted blocks are marked dirty** so they're re-normalized in the next pass (they may need default-stripping on the now-absent `parentId`).

**Container detection:** The rule applies to toggle, callout, and blockquote blocks. These are the container types that use `parentId` for visual nesting (Section 4.4.1). Layout containers use `children` Y.Array, not `parentId`, so they're handled by Rule 6 (empty container collapse) and Rule 11 (cross-array membership).

**Idempotency:** After promotion, no blocks have `parentId` pointing to a deleted block. Second pass finds nothing to promote.

##### Rule 11: No Cross-Array Membership

**Input:** `doc.blockOrder` Y.Array and all blocks' `children` Y.Arrays.

**Scope:** Like Rule 9, this only checks `blockId` (the block currently being normalized), not a global scan. The dirty set includes the affected block because any operation that creates a cross-array membership (`block-insert`, `move-block`) adds the block to the dirty set.

**Algorithm:**

```typescript
private enforceCrossArrayMembership(blockId: string): void {
  const inBlockOrder = this.isInBlockOrder(blockId);
  const parentEntry = this.findParentWithChild(blockId);

  if (inBlockOrder && parentEntry) {
    this.removeFromBlockOrder(blockId);
  }
}

private isInBlockOrder(blockId: string): boolean {
  for (let i = 0; i < this.doc.blockOrder.length; i++) {
    if (this.doc.blockOrder.get(i) === blockId) return true;
  }
  return false;
}

private findParentWithChild(blockId: string): string | null {
  for (const [id, blockMap] of this.doc.blocks.entries()) {
    const children = blockMap.get('children') as Y.Array<string> | undefined;
    if (!children) continue;
    for (let i = 0; i < children.length; i++) {
      if (children.get(i) === blockId) return id;
    }
  }
  return null;
}
```

**Why `children` wins:** A block in a `children` array is structurally owned by its parent (layout nesting). A block in `blockOrder` is a top-level document member. The `children` relationship is more specific, so it takes precedence.

**Loro note:** Same as Rule 9 — the Loro adapter's movable tree CRDT prevents this structurally.

**Idempotency:** After removal from `blockOrder`, the block only exists in `children`. Second pass finds no cross-array membership.

---

#### Streaming Deferral Mechanism

During active AI generation, the block being streamed into is normalized only when the generation completes.

**Lifecycle:**

1. `gen-start` stream part received -> `schemaEngine.deferBlock(blockId)`.
2. `gen-delta` stream parts received -> the block accumulates content. `markDirty(blockId)` is called on each delta flush, but `normalizeDirty()` skips deferred blocks.
3. `gen-end` stream part received -> `schemaEngine.undeferBlock(blockId)`. This immediately normalizes the block if it's dirty.

**Remote peer coordination:** The `streaming` flag is shared via Yjs awareness state. When a peer sees another peer's awareness state with `streaming: { blockId }`, it does NOT call `normalizeDirty()` on that block. This prevents two peers from fighting over normalization of a block that's still being written to.

```typescript
// In the awareness change handler (editor internals, Wave 3):
awareness.on('change', ({ updated }) => {
  for (const clientId of updated) {
    const state = awareness.getStates().get(clientId);
    if (state?.streaming?.blockId) {
      schemaEngine.deferBlock(state.streaming.blockId);
    }
  }
});
```

**Error handling:** If `gen-end` is never received (network failure, crash), the block remains in `deferredBlockIds` until the awareness state clears (awareness has a 30s timeout). The editor's reconnection handler calls `undeferBlock` for any blocks that were deferred by disconnected peers.

---

#### Idempotency Testing Strategy

Every normalization rule MUST pass the following test pattern:

```typescript
test('rule N is idempotent', () => {
  const { ydoc, doc } = createTestDocument([/* block triggering rule N */]);
  const engine = new SchemaEngineImpl(defaultSchema, doc, crdtDoc);

  engine.markDirty('block-1');
  engine.normalizeDirty();

  const svBefore = Y.encodeStateVector(ydoc);

  engine.markDirty('block-1');
  engine.normalizeDirty();

  const svAfter = Y.encodeStateVector(ydoc);

  // State vectors are identical — no new CRDT operations
  expect(svAfter).toEqual(svBefore);
});
```

This uses Yjs state vector comparison to detect any CRDT mutations. State vectors encode per-client operation counters. If the second normalization pass produces any writes, the state vector will have incremented counters. Byte-identical state vectors mean zero operations were produced.

#### Exports from `schema/normalize.ts`

```typescript
export { SchemaEngineImpl };
export { deepEqual, sortDeltaAttributes };
```

Re-exported from `packages/core/src/index.ts`. The `SchemaEngine` interface (in `types/editor.ts`) is the public API; `SchemaEngineImpl` is for internal construction by the editor factory. `sortDeltaAttributes` is exported for use in serialization and decoration code.

---

### Module: `schema/handles.ts` — BlockHandle API

Implements `BlockHandle` and `AppHandle` (Spec Section 4.7).

Handles are read-only projections — lightweight views computed on demand from CRDT state. Mutations go through the editor API, which validates, normalizes, and commits to the CRDT document.

**Exception: `setMeta`.** `setMeta` is removed from `BlockHandle` as a write method. The canonical mutation path for metadata is `editor.apply({ type: 'set-meta', blockId, namespace, data })`. This ensures auth guards, undo grouping, audit hooks, and CRDT transactions all see metadata changes consistently. Metadata is still excluded from normalization (Rule 7).

Handles expose `meta(namespace)` as a read-only accessor. To write metadata, use `editor.apply()`:

```typescript
editor.apply({ type: 'set-meta', blockId: handle.id, namespace: 'my-ext', data: { key: 'value' } });
```

#### Factory Functions

```typescript
import type { YjsPenDocument } from '@pen/crdt-yjs';

export function createBlockHandle(
  blockId: string,
  doc: PenDocument,
  crdtDoc: CRDTDocument,
  registry: SchemaRegistry,
): BlockHandle {
  return new BlockHandleImpl(blockId, doc, crdtDoc, registry);
}

export function createAppHandle(
  appId: string,
  doc: PenDocument,
  crdtDoc: CRDTDocument,
  registry: SchemaRegistry,
): AppHandle {
  return new AppHandleImpl(appId, doc, crdtDoc, registry);
}
```

#### `BlockHandleImpl` — Internal Class

The handle is a lightweight proxy over CRDT state. Every property access reads from the `Y.Map` — no caching, no stale state.

```typescript
class BlockHandleImpl implements BlockHandle {
  constructor(
    private readonly _id: string,
    private readonly _doc: PenDocument,
    private readonly _crdtDoc: CRDTDocument,
    private readonly _registry: SchemaRegistry,
  ) {}

  get id(): string { return this._id; }

  get type(): string {
    return this.blockMap.get('type') as string;
  }

  get props(): Readonly<Record<string, unknown>> {
    const schema = this._registry.resolve(this.type);
    const raw = this.blockMap.get('props') as Y.Map<unknown> | undefined;
    const props: Record<string, unknown> = {};

    if (schema?.propSchema) {
      for (const [key, propDef] of Object.entries(schema.propSchema)) {
        props[key] = (propDef as Record<string, unknown>).default;
      }
    }
    if (raw) {
      for (const [key, value] of raw.entries()) {
        props[key] = value;
      }
    }
    return props;
  }

  get index(): number {
    for (let i = 0; i < this._doc.blockOrder.length; i++) {
      if (this._doc.blockOrder.get(i) === this._id) return i;
    }
    return -1;
  }

  get prev(): BlockHandle | null {
    const idx = this.index;
    if (idx <= 0) return null;
    return new BlockHandleImpl(
      this._doc.blockOrder.get(idx - 1),
      this._doc,
      this._crdtDoc,
      this._registry,
    );
  }

  get next(): BlockHandle | null {
    const idx = this.index;
    if (idx < 0 || idx >= this._doc.blockOrder.length - 1) return null;
    return new BlockHandleImpl(
      this._doc.blockOrder.get(idx + 1),
      this._doc,
      this._crdtDoc,
      this._registry,
    );
  }

  get parent(): BlockHandle | null {
    const parentId = (this.props as Record<string, unknown>).parentId as string | undefined;
    if (parentId && this._doc.blocks.has(parentId)) {
      return new BlockHandleImpl(parentId, this._doc, this._crdtDoc, this._registry);
    }

    for (const [id, blockMap] of this._doc.blocks.entries()) {
      const children = blockMap.get('children') as Y.Array<string> | undefined;
      if (!children) continue;
      for (let i = 0; i < children.length; i++) {
        if (children.get(i) === this._id) {
          return new BlockHandleImpl(id, this._doc, this._crdtDoc, this._registry);
        }
      }
    }

    return null;
  }

  get children(): readonly BlockHandle[] {
    // Two mutually exclusive child models:
    // 1. parentId-based: toggle/callout blocks whose children appear in blockOrder
    //    with a parentId prop pointing back to this block.
    // 2. children Y.Array: layout containers (row, column, stack, card) whose
    //    children are NOT in blockOrder and are owned by the container.
    // A block uses one model or the other, never both.
    const result: BlockHandle[] = [];

    for (let i = 0; i < this._doc.blockOrder.length; i++) {
      const childId = this._doc.blockOrder.get(i);
      const childMap = this._doc.blocks.get(childId) as Y.Map<unknown>;
      const childProps = childMap?.get('props') as Y.Map<unknown> | undefined;
      if (childProps?.get('parentId') === this._id) {
        result.push(new BlockHandleImpl(childId, this._doc, this._crdtDoc, this._registry));
      }
    }

    const blockMap = this.blockMap;
    const childrenArr = blockMap.get('children') as Y.Array<string> | undefined;
    if (childrenArr) {
      for (let i = 0; i < childrenArr.length; i++) {
        result.push(new BlockHandleImpl(
          childrenArr.get(i),
          this._doc,
          this._crdtDoc,
          this._registry,
        ));
      }
    }

    return result;
  }

  // ── Traversal ──────────────────────────────────────────

  *descendants(type?: string): Iterable<BlockHandle> {
    for (const child of this.children) {
      if (!type || child.type === type) yield child;
      yield* child.descendants(type);
    }
  }

  *ancestors(): Iterable<BlockHandle> {
    let current: BlockHandle | null = this.parent;
    while (current) {
      yield current;
      current = current.parent;
    }
  }

  *siblings(): Iterable<BlockHandle> {
    const par = this.parent;
    if (par) {
      for (const child of par.children) {
        if (child.id !== this._id) yield child;
      }
    } else {
      for (let i = 0; i < this._doc.blockOrder.length; i++) {
        const sibId = this._doc.blockOrder.get(i);
        if (sibId === this._id) continue;
        const sibMap = this._doc.blocks.get(sibId) as Y.Map<unknown>;
        const sibProps = sibMap?.get('props') as Y.Map<unknown> | undefined;
        if (!sibProps?.get('parentId')) {
          yield new BlockHandleImpl(sibId, this._doc, this._crdtDoc, this._registry);
        }
      }
    }
  }

  // ── Layout queries ─────────────────────────────────────

  get layout(): LayoutProps | null {
    const blockMap = this.blockMap;
    const layoutMap = blockMap.get('layout') as Y.Map<unknown> | undefined;
    if (!layoutMap) return null;
    const result: Record<string, unknown> = {};
    for (const [key, value] of layoutMap.entries()) {
      result[key] = value;
    }
    return result as LayoutProps;
  }

  get isLayoutChild(): boolean {
    return this.layoutParent() !== null;
  }

  layoutParent(): BlockHandle | null {
    for (const [id, blockMap] of this._doc.blocks.entries()) {
      const children = blockMap.get('children') as Y.Array<string> | undefined;
      if (!children) continue;
      for (let i = 0; i < children.length; i++) {
        if (children.get(i) === this._id) {
          return new BlockHandleImpl(id, this._doc, this._crdtDoc, this._registry);
        }
      }
    }
    return null;
  }

  // ── App queries ────────────────────────────────────────

  anchoredApps(): readonly AppHandle[] {
    const result: AppHandle[] = [];
    for (const [appId, appMap] of this._doc.apps.entries()) {
      const placement = appMap.get('placement') as AppPlacement | undefined;
      if (placement?.blockId === this._id) {
        result.push(new AppHandleImpl(appId, this._doc, this._crdtDoc, this._registry));
      }
    }
    return result;
  }

  // ── Content access ─────────────────────────────────────

  textContent(options?: { resolved?: boolean }): string {
    const blockMap = this.blockMap;
    const content = blockMap.get('content');
    if (content instanceof Y.Text) {
      const text = content.toString();
      if (text === '\u200B') return '';
      if (options?.resolved) {
        return this.resolveText(content);
      }
      return text;
    }
    return '';
  }

  textDeltas(): Array<{ insert: string; attributes?: Record<string, unknown> }> {
    const blockMap = this.blockMap;
    const content = blockMap.get('content');
    if (content instanceof Y.Text) {
      return content.toDelta().map((d: any) => ({
        insert: typeof d.insert === 'string' ? d.insert : '',
        ...(d.attributes ? { attributes: d.attributes } : {}),
      }));
    }
    return [];
  }

  private resolveText(content: Y.Text): string {
    const deltas = content.toDelta();
    let result = '';
    for (const d of deltas) {
      if (typeof d.insert !== 'string') continue;
      const suggestion = d.attributes?.suggestion as { action?: string } | undefined;
      if (suggestion?.action === 'delete') continue;
      result += d.insert;
    }
    return result;
  }

  length(): number {
    return this.textContent().length;
  }

  // Export/serialization code should use textContent() and textDeltas() rather than
  // accessing Y.Text directly, to stay CRDT-agnostic and support suggestion resolution.

  // ── Metadata ───────────────────────────────────────────

  meta(namespace: string): Readonly<Record<string, unknown>> | null {
    const metaMap = this.blockMap.get('meta') as Y.Map<unknown> | undefined;
    if (!metaMap) return null;
    const nsData = metaMap.get(namespace);
    if (!nsData) return null;
    if (nsData instanceof Y.Map) {
      const result: Record<string, unknown> = {};
      for (const [key, value] of nsData.entries()) {
        result[key] = value;
      }
      return result;
    }
    return nsData as Record<string, unknown>;
  }

  setMeta(_namespace: string, _data: Record<string, unknown>): void {
    throw new Error(
      'BlockHandle.setMeta() has been removed. Use editor.apply({ type: "set-meta", blockId, namespace, data }) instead.',
    );
  }

  // ── Internal ───────────────────────────────────────────

  private get blockMap(): Y.Map<unknown> {
    const map = this._doc.blocks.get(this._id) as Y.Map<unknown>;
    if (!map) throw new Error(`Block not found: ${this._id}`);
    return map;
  }
}
```

#### Traversal Order Guarantees

| Method | Order | Description |
|---|---|---|
| `descendants(type?)` | Depth-first pre-order | Parent before children. Recursive descent through `children`. |
| `ancestors()` | Leaf-to-root | Starting from `this.parent`, ascending. |
| `siblings()` | `blockOrder` position | Ordered by document position. |
| `children` | Visual children first (by `blockOrder` position), then structural children (by `children` array order). |

#### `AppHandleImpl`

```typescript
class AppHandleImpl implements AppHandle {
  constructor(
    private readonly _id: string,
    private readonly _doc: PenDocument,
    private readonly _crdtDoc: CRDTDocument,
    private readonly _registry: SchemaRegistry,
  ) {}

  get id(): string { return this._id; }

  get type(): string {
    return this.appMap.get('type') as string;
  }

  get placement(): AppPlacement {
    return this.appMap.get('placement') as AppPlacement;
  }

  get config(): Readonly<Record<string, unknown>> {
    const configMap = this.appMap.get('config') as Y.Map<unknown> | undefined;
    if (!configMap) return {};
    const result: Record<string, unknown> = {};
    for (const [key, value] of configMap.entries()) {
      result[key] = value;
    }
    return result;
  }

  get anchorBlock(): BlockHandle | null {
    const placement = this.placement;
    if (placement && 'blockId' in placement && placement.blockId) {
      return createBlockHandle(
        placement.blockId as string,
        this._doc,
        this._crdtDoc,
        this._registry,
      );
    }
    return null;
  }

  private get appMap(): Y.Map<unknown> {
    const map = this._doc.apps.get(this._id) as Y.Map<unknown>;
    if (!map) throw new Error(`App not found: ${this._id}`);
    return map;
  }
}
```

#### Performance Considerations

`BlockHandle` is intentionally lazy and uncached. Key performance characteristics:

| Property | Cost | Notes |
|---|---|---|
| `id`, `type` | O(1) | Direct map lookup. |
| `props` | O(k) | k = number of prop schema keys. |
| `index` | O(n) | Linear scan of `blockOrder`. |
| `prev`, `next` | O(n) | Requires `index` lookup. |
| `parent` (via `parentId`) | O(1) | Direct map lookup. |
| `parent` (via `children` scan) | O(b*c) | b = blocks, c = avg children per block. |
| `children` | O(n + c) | Scan `blockOrder` for `parentId` matches + `children` array. |
| `descendants` | O(tree size) | Full subtree traversal. |
| `textContent()` | O(t) | t = text length. |

For hot paths in the editor (e.g. rendering visible blocks), Wave 3 introduces a cached `DocumentState` that pre-indexes `blockOrder` positions and `parentId` relationships. `BlockHandle` reads from that index when available, falling back to linear scan otherwise.

#### Exports from `schema/handles.ts`

```typescript
export { createBlockHandle, createAppHandle };
```

---

## Package 2: `@pen/schema-default`

### File Structure

```
packages/schema/default/src/
├── blocks/
│   ├── paragraph.ts
│   ├── heading.ts
│   ├── bullet-list-item.ts
│   ├── numbered-list-item.ts
│   ├── check-list-item.ts
│   ├── code-block.ts
│   ├── image.ts
│   ├── table.ts
│   ├── divider.ts
│   ├── callout.ts
│   ├── toggle.ts
│   └── blockquote.ts
├── inlines/
│   ├── marks.ts
│   └── nodes.ts
├── registry.ts
└── index.ts
```

Note: no `system-marks/` directory. System marks live in `@pen/core` (see `schema/system-marks/suggestion.ts` above) and are auto-registered by `SchemaRegistryImpl`.

### Module: `blocks/` — Content Block Schemas

Each block is defined via `defineBlock` from `@pen/core`. Every block includes full `propSchema`, `content`, `fieldEditor`, `display`, and `serialize` definitions.

#### `blocks/paragraph.ts`

```typescript
import { defineBlock } from '@pen/types';

export const paragraph = defineBlock('paragraph', {
  content: 'inline',
  fieldEditor: 'richtext',
  display: {
    title: 'Paragraph',
    description: 'Plain text paragraph',
    group: 'basic',
    aliases: ['p', 'text'],
  },
  serialize: {
    toMarkdown: (block) => block.content ?? '',
    toHTML: (block) => `<p>${block.content ?? ''}</p>`,
  },
});
```

The simplest block. No custom props — `propSchema` defaults to `{}`. Baseline pattern for all content blocks.

#### `blocks/heading.ts`

```typescript
import { defineBlock, prop } from '@pen/types';

export const heading = defineBlock('heading', {
  props: {
    level: prop.enum([1, 2, 3, 4, 5, 6]).default(1).describe('Heading level'),
  },
  content: 'inline',
  fieldEditor: 'richtext',
  display: {
    title: 'Heading',
    description: 'Large section heading',
    group: 'basic',
    aliases: ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'title'],
  },
  serialize: {
    toMarkdown: (block) => `${'#'.repeat(block.props.level ?? 1)} ${block.content ?? ''}`,
    toHTML: (block) => {
      const level = block.props.level ?? 1;
      return `<h${level}>${block.content ?? ''}</h${level}>`;
    },
  },
  normalize: (block) => {
    const level = block.props.level ?? 1;
    if (level < 1 || level > 6) {
      return { ...block, props: { ...block.props, level: Math.max(1, Math.min(6, level)) } };
    }
    return block;
  },
});
```

Custom `normalize` clamps `level` to valid range. This catches malformed LLM output (e.g. `level: 7`).

#### `blocks/bullet-list-item.ts`

```typescript
import { defineBlock, prop } from '@pen/types';

export const bulletListItem = defineBlock('bulletListItem', {
  props: {
    indent: prop.number().default(0).min(0).describe('Nesting depth'),
    parentId: prop.string().optional().describe('Container parent block'),
  },
  content: 'inline',
  fieldEditor: 'richtext',
  display: {
    title: 'Bullet List',
    description: 'Unordered list item',
    group: 'lists',
    aliases: ['ul', 'bullet', 'unordered'],
  },
  serialize: {
    toMarkdown: (block) => {
      const indent = '  '.repeat(block.props.indent ?? 0);
      return `${indent}- ${block.content ?? ''}`;
    },
    toHTML: (block) => `<li>${block.content ?? ''}</li>`,
  },
});
```

Flat list model — no wrapper block. `indent` controls visual nesting. See Section 4.4.1.

#### `blocks/numbered-list-item.ts`

```typescript
import { defineBlock, prop } from '@pen/types';

export const numberedListItem = defineBlock('numberedListItem', {
  props: {
    indent: prop.number().default(0).min(0).describe('Nesting depth'),
    parentId: prop.string().optional().describe('Container parent block'),
    start: prop.number().optional().describe('Restart numbering from this value'),
  },
  content: 'inline',
  fieldEditor: 'richtext',
  display: {
    title: 'Numbered List',
    description: 'Ordered list item',
    group: 'lists',
    aliases: ['ol', 'numbered', 'ordered'],
  },
  serialize: {
    toMarkdown: (block) => {
      const indent = '  '.repeat(block.props.indent ?? 0);
      const start = block.props.start ?? 1;
      return `${indent}${start}. ${block.content ?? ''}`;
    },
    toHTML: (block) => `<li>${block.content ?? ''}</li>`,
  },
});
```

`start` prop allows restarting numbering mid-list.

#### `blocks/check-list-item.ts`

```typescript
import { defineBlock, prop } from '@pen/types';

export const checkListItem = defineBlock('checkListItem', {
  props: {
    indent: prop.number().default(0).min(0).describe('Nesting depth'),
    parentId: prop.string().optional().describe('Container parent block'),
    checked: prop.boolean().default(false).describe('Whether the item is checked'),
  },
  content: 'inline',
  fieldEditor: 'richtext',
  display: {
    title: 'Check List',
    description: 'To-do list item with checkbox',
    group: 'lists',
    aliases: ['todo', 'checkbox', 'task'],
  },
  serialize: {
    toMarkdown: (block) => {
      const indent = '  '.repeat(block.props.indent ?? 0);
      const check = block.props.checked ? 'x' : ' ';
      return `${indent}- [${check}] ${block.content ?? ''}`;
    },
    toHTML: (block) => {
      const checked = block.props.checked ? ' checked' : '';
      return `<li><input type="checkbox"${checked} disabled />${block.content ?? ''}</li>`;
    },
  },
});
```

#### `blocks/code-block.ts`

```typescript
import { defineBlock, prop } from '@pen/types';

export const codeBlock = defineBlock('codeBlock', {
  props: {
    language: prop.string().optional().describe('Programming language for syntax highlighting'),
  },
  content: 'inline',
  fieldEditor: 'code',
  display: {
    title: 'Code Block',
    description: 'Code with syntax highlighting',
    group: 'basic',
    aliases: ['code', 'pre', 'monospace'],
  },
  serialize: {
    toMarkdown: (block) => {
      const lang = block.props.language ?? '';
      return `\`\`\`${lang}\n${block.content ?? ''}\n\`\`\``;
    },
    toHTML: (block) => {
      const lang = block.props.language ?? '';
      const langAttr = lang ? ` class="language-${lang}"` : '';
      return `<pre><code${langAttr}>${block.content ?? ''}</code></pre>`;
    },
  },
});
```

`fieldEditor: 'code'` signals the rendering layer to use the code-specific field editor (tab handling, line numbers, no rich text marks).

#### `blocks/image.ts`

```typescript
import { defineBlock, prop } from '@pen/types';

export const image = defineBlock('image', {
  props: {
    src: prop.string().default('').describe('Image URL or asset reference'),
    alt: prop.string().optional().describe('Alt text for accessibility'),
    caption: prop.string().optional().describe('Image caption'),
    width: prop.number().optional().describe('Display width in pixels'),
  },
  content: 'none',
  fieldEditor: 'none',
  display: {
    title: 'Image',
    description: 'Embedded image',
    group: 'media',
    aliases: ['img', 'picture', 'photo'],
  },
  serialize: {
    toMarkdown: (block) => {
      const alt = block.props.alt ?? '';
      return `![${alt}](${block.props.src})`;
    },
    toHTML: (block) => {
      const alt = block.props.alt ? ` alt="${block.props.alt}"` : '';
      const width = block.props.width ? ` width="${block.props.width}"` : '';
      return `<img src="${block.props.src}"${alt}${width} />`;
    },
  },
});
```

`content: 'none'` — no editable content. The image block is a props-only block. `src` stores the `AssetRef.url` (or ID for `resolve()` indirection).

#### `blocks/table.ts`

```typescript
import { defineBlock, prop } from '@pen/types';

export const table = defineBlock('table', {
  props: {
    hasHeaderRow: prop.boolean().default(false).describe('First row is a header'),
    hasHeaderColumn: prop.boolean().default(false).describe('First column is a header'),
    columnWidths: prop.array(prop.number()).optional().describe('Column widths in pixels'),
  },
  content: 'table',
  fieldEditor: 'table',
  display: {
    title: 'Table',
    description: 'Data table with rows and columns',
    group: 'advanced',
    aliases: ['grid', 'spreadsheet'],
  },
  serialize: {
    toMarkdown: (block) => '[table]',
    toHTML: (block) => '<table></table>',
  },
});
```

`content: 'table'` — the CRDT structure is `rows * cells` of `Y.Text`. Table serialization requires access to the cell structure, which is handled by the table field editor. The `serialize` methods here are fallback stubs.

#### `blocks/divider.ts`

```typescript
import { defineBlock } from '@pen/types';

export const divider = defineBlock('divider', {
  content: 'none',
  fieldEditor: 'none',
  display: {
    title: 'Divider',
    description: 'Visual separator',
    group: 'basic',
    aliases: ['hr', 'separator', 'line'],
  },
  serialize: {
    toMarkdown: () => '---',
    toHTML: () => '<hr />',
  },
});
```

Simplest block alongside paragraph. No props, no content.

#### `blocks/callout.ts`

```typescript
import { defineBlock, prop } from '@pen/types';

export const callout = defineBlock('callout', {
  props: {
    type: prop.enum(['info', 'warning', 'error']).default('info').describe('Callout severity'),
    parentId: prop.string().optional().describe('Container parent block'),
  },
  content: 'inline',
  fieldEditor: 'richtext',
  display: {
    title: 'Callout',
    description: 'Highlighted callout box',
    group: 'basic',
    aliases: ['alert', 'notice', 'admonition'],
  },
  serialize: {
    toMarkdown: (block) => {
      const prefix = block.props.type === 'warning' ? '> **Warning:**'
        : block.props.type === 'error' ? '> **Error:**'
        : '> **Note:**';
      return `${prefix} ${block.content ?? ''}`;
    },
    toHTML: (block) => {
      const type = block.props.type ?? 'info';
      return `<div class="callout callout-${type}">${block.content ?? ''}</div>`;
    },
  },
});
```

Container block — child blocks reference it via `parentId`.

#### `blocks/toggle.ts`

```typescript
import { defineBlock, prop } from '@pen/types';

export const toggle = defineBlock('toggle', {
  props: {
    open: prop.boolean().default(false).describe('Whether the toggle content is expanded'),
    parentId: prop.string().optional().describe('Container parent block'),
  },
  content: 'inline',
  fieldEditor: 'richtext',
  display: {
    title: 'Toggle',
    description: 'Collapsible content block',
    group: 'basic',
    aliases: ['collapsible', 'accordion', 'details'],
  },
  serialize: {
    toMarkdown: (block) => `<details>\n<summary>${block.content ?? ''}</summary>\n</details>`,
    toHTML: (block) => {
      const open = block.props.open ? ' open' : '';
      return `<details${open}><summary>${block.content ?? ''}</summary></details>`;
    },
  },
});
```

#### `blocks/blockquote.ts`

```typescript
import { defineBlock, prop } from '@pen/types';

export const blockquote = defineBlock('blockquote', {
  props: {
    parentId: prop.string().optional().describe('Container parent block'),
  },
  content: 'inline',
  fieldEditor: 'richtext',
  display: {
    title: 'Quote',
    description: 'Block quotation',
    group: 'basic',
    aliases: ['quote', 'blockquote', 'pullquote'],
  },
  serialize: {
    toMarkdown: (block) => `> ${block.content ?? ''}`,
    toHTML: (block) => `<blockquote>${block.content ?? ''}</blockquote>`,
  },
});
```

---

### Module: `inlines/marks.ts` — Inline Mark Schemas

#### Priority Scale

Marks are ordered by `priority` for consistent serialization and decoration output (Rule 1). Lower priority = outer wrapper in serialized output. The default scale uses 100-increments for extension points:

| Mark | Priority | Rationale |
|---|---|---|
| `bold` | 100 | Outermost formatting. |
| `italic` | 200 | Inside bold. |
| `underline` | 300 | After bold/italic. |
| `strikethrough` | 400 | Decorative, after structural. |
| `highlight` | 500 | Background effect. |
| `textColor` | 600 | Foreground color. |
| `backgroundColor` | 700 | Full background. |
| `link` | 800 | Wraps inner formatting. |
| `code` | 900 | Innermost — code suppresses all inner marks. |

Consumers can override priority via `InlineSchema.priority`. The 100-increment spacing allows custom marks to be inserted between any two defaults.

#### Mark Definitions

```typescript
import type { InlineSchema } from '@pen/types';
import { prop } from '@pen/types';

export const bold: InlineSchema = {
  type: 'bold',
  propSchema: {},
  kind: 'mark',
  expand: 'after',
  priority: 100,
  serialize: {
    toMarkdown: (text) => `**${text}**`,
    toHTML: (text) => `<strong>${text}</strong>`,
  },
  aiDescription: 'Bold text formatting',
};

export const italic: InlineSchema = {
  type: 'italic',
  propSchema: {},
  kind: 'mark',
  expand: 'after',
  priority: 200,
  serialize: {
    toMarkdown: (text) => `*${text}*`,
    toHTML: (text) => `<em>${text}</em>`,
  },
  aiDescription: 'Italic text formatting',
};

export const underline: InlineSchema = {
  type: 'underline',
  propSchema: {},
  kind: 'mark',
  expand: 'after',
  priority: 300,
  serialize: {
    toMarkdown: (text) => `<u>${text}</u>`,
    toHTML: (text) => `<u>${text}</u>`,
  },
  aiDescription: 'Underlined text',
};

export const strikethrough: InlineSchema = {
  type: 'strikethrough',
  propSchema: {},
  kind: 'mark',
  expand: 'after',
  priority: 400,
  serialize: {
    toMarkdown: (text) => `~~${text}~~`,
    toHTML: (text) => `<s>${text}</s>`,
  },
  aiDescription: 'Strikethrough text',
};

export const highlight: InlineSchema = {
  type: 'highlight',
  propSchema: {
    color: prop.string().default('yellow').describe('Highlight color'),
  },
  kind: 'mark',
  expand: 'after',
  priority: 500,
  serialize: {
    toMarkdown: (text) => `==${text}==`,
    toHTML: (text, props) =>
      `<mark style="background-color: ${props?.color ?? 'yellow'}">${text}</mark>`,
  },
  aiDescription: 'Highlighted text with configurable color',
};

export const textColor: InlineSchema = {
  type: 'textColor',
  propSchema: {
    color: prop.string().default('').describe('CSS color value'),
  },
  kind: 'mark',
  expand: 'after',
  priority: 600,
  serialize: {
    toMarkdown: (text) => text,
    toHTML: (text, props) =>
      `<span style="color: ${props?.color ?? 'inherit'}">${text}</span>`,
  },
  aiDescription: 'Colored text',
};

export const backgroundColor: InlineSchema = {
  type: 'backgroundColor',
  propSchema: {
    color: prop.string().default('').describe('CSS background-color value'),
  },
  kind: 'mark',
  expand: 'after',
  priority: 700,
  serialize: {
    toMarkdown: (text) => text,
    toHTML: (text, props) =>
      `<span style="background-color: ${props?.color ?? 'transparent'}">${text}</span>`,
  },
  aiDescription: 'Text with background color',
};

export const link: InlineSchema = {
  type: 'link',
  propSchema: {
    href: prop.string().default('').describe('Link URL'),
    title: prop.string().optional().describe('Link title attribute'),
  },
  kind: 'mark',
  expand: 'none',
  priority: 800,
  serialize: {
    toMarkdown: (text, props) => {
      const title = props?.title ? ` "${props.title}"` : '';
      return `[${text}](${props?.href ?? ''}${title})`;
    },
    toHTML: (text, props) => {
      const title = props?.title ? ` title="${props.title}"` : '';
      return `<a href="${props?.href ?? ''}"${title}>${text}</a>`;
    },
  },
  aiDescription: 'Hyperlink with URL and optional title',
};

export const code: InlineSchema = {
  type: 'code',
  propSchema: {},
  kind: 'mark',
  expand: 'none',
  priority: 900,
  serialize: {
    toMarkdown: (text) => `\`${text}\``,
    toHTML: (text) => `<code>${text}</code>`,
  },
  aiDescription: 'Inline code span',
};
```

#### Summary Table

| Mark | `kind` | `expand` | `priority` | Props |
|---|---|---|---|---|
| `bold` | `mark` | `after` | 100 | -- |
| `italic` | `mark` | `after` | 200 | -- |
| `underline` | `mark` | `after` | 300 | -- |
| `strikethrough` | `mark` | `after` | 400 | -- |
| `highlight` | `mark` | `after` | 500 | `color: string` |
| `textColor` | `mark` | `after` | 600 | `color: string` |
| `backgroundColor` | `mark` | `after` | 700 | `color: string` |
| `link` | `mark` | `none` | 800 | `href: string`, `title?: string` |
| `code` | `mark` | `none` | 900 | -- |

---

### Module: `inlines/nodes.ts` — Inline Node Schemas

```typescript
import type { InlineSchema } from '@pen/types';
import { prop } from '@pen/types';

export const mention: InlineSchema = {
  type: 'mention',
  propSchema: {
    id: prop.string().default('').describe('Referenced entity ID'),
    label: prop.string().default('').describe('Display name'),
  },
  kind: 'node',
  serialize: {
    toMarkdown: (_, props) => `@${props?.label ?? ''}`,
    toHTML: (_, props) =>
      `<span class="mention" data-id="${props?.id ?? ''}">${props?.label ?? ''}</span>`,
  },
  aiDescription: 'Mention of a user, page, or entity',
};

export const inlineApp: InlineSchema = {
  type: 'inlineApp',
  propSchema: {
    appType: prop.string().default('').describe('App type identifier'),
    config: prop.json().describe('App configuration'),
  },
  kind: 'node',
  serialize: {
    toMarkdown: (_, props) => `[app:${props?.appType ?? ''}]`,
    toHTML: (_, props) =>
      `<span class="inline-app" data-type="${props?.appType ?? ''}"></span>`,
  },
  aiDescription: 'Inline embedded application',
};
```

Nodes are atomic — they don't have boundary expansion behavior (`expand` is N/A). They render as indivisible units in the text flow.

---

### Module: `registry.ts` — Default Schema Composition

Assembles all blocks and inlines into the default `ComposableSchema`. System marks are not passed — the `SchemaRegistryImpl` constructor auto-registers the core `suggestion` mark.

```typescript
import { SchemaRegistryImpl } from '@pen/core';

import { paragraph } from './blocks/paragraph.js';
import { heading } from './blocks/heading.js';
import { bulletListItem } from './blocks/bullet-list-item.js';
import { numberedListItem } from './blocks/numbered-list-item.js';
import { checkListItem } from './blocks/check-list-item.js';
import { codeBlock } from './blocks/code-block.js';
import { image } from './blocks/image.js';
import { table } from './blocks/table.js';
import { divider } from './blocks/divider.js';
import { callout } from './blocks/callout.js';
import { toggle } from './blocks/toggle.js';
import { blockquote } from './blocks/blockquote.js';

import {
  bold, italic, underline, strikethrough,
  code, link, highlight, textColor, backgroundColor,
} from './inlines/marks.js';
import { mention, inlineApp } from './inlines/nodes.js';

export function createDefaultSchema(): ComposableSchema {
  return new SchemaRegistryImpl({
    blocks: [
      paragraph, heading,
      bulletListItem, numberedListItem, checkListItem,
      codeBlock, image, table, divider,
      callout, toggle, blockquote,
    ],
    inlines: [
      bold, italic, underline, strikethrough,
      code, link, highlight, textColor, backgroundColor,
      mention, inlineApp,
    ],
    // systemMarks not passed — SchemaRegistryImpl auto-registers the core
    // suggestion mark. Additional system marks can be added via
    // overrideSystemMark() on the returned ComposableSchema.
  });
}
```

This is the only place outside `@pen/core` that directly constructs `SchemaRegistryImpl`. All other registries are derived via `extend()` / `without()` / `override()`.

### Module: `index.ts` — Package Entry

```typescript
export { createDefaultSchema } from './registry.js';

import { createDefaultSchema } from './registry.js';
export const defaultSchema = createDefaultSchema();

export { paragraph } from './blocks/paragraph.js';
export { heading } from './blocks/heading.js';
export { bulletListItem } from './blocks/bullet-list-item.js';
export { numberedListItem } from './blocks/numbered-list-item.js';
export { checkListItem } from './blocks/check-list-item.js';
export { codeBlock } from './blocks/code-block.js';
export { image } from './blocks/image.js';
export { table } from './blocks/table.js';
export { divider } from './blocks/divider.js';
export { callout } from './blocks/callout.js';
export { toggle } from './blocks/toggle.js';
export { blockquote } from './blocks/blockquote.js';

export {
  bold, italic, underline, strikethrough,
  code, link, highlight, textColor, backgroundColor,
} from './inlines/marks.js';
export { mention, inlineApp } from './inlines/nodes.js';
```

`defaultSchema` is a singleton — safe because `SchemaRegistryImpl` is immutable. Multiple imports resolve to the same instance.

The `suggestion` system mark is re-exported from `@pen/core`, not from this package.

---

## Package 3: `@pen/test`

Headless testing utilities (Spec Section 18.1).

### File Structure

```
packages/tooling/test/src/
├── create-test-document.ts
├── assert-doc-equals.ts
├── create-test-editor.ts
├── create-test-collaboration.ts
├── simulation.ts
├── helpers.ts
├── types.ts
└── index.ts
```

### Dependencies

Update `package.json`:

```json
{
  "dependencies": {
    "@pen/core": "workspace:*",
    "@pen/crdt-yjs": "workspace:*",
    "@pen/schema-default": "workspace:*"
  }
}
```

### Module: `types.ts` — Test Types

```typescript
import type { CreateEditorOptions, PenDocument, SchemaRegistry, BlockHandle } from '@pen/types';
import type * as Y from 'yjs';

export interface TestBlock {
  id?: string;
  type: string;
  props?: Record<string, unknown>;
  content?: string;
  children?: TestBlock[];
}

export interface TestEditorOptions extends Partial<CreateEditorOptions> {
  blocks?: TestBlock[];
  doc?: Y.Doc;
}

export interface TestEditor {
  readonly schema: SchemaRegistry;
  readonly document: PenDocument;
  readonly ydoc: Y.Doc;
  readonly crdtDoc: CRDTDocument;

  getBlock(blockId: string): BlockHandle;
  normalizeAll(): void;
  markDirty(blockId: string): void;
  normalizeDirty(): void;

  // Wave 3 stubs — these throw until the editor factory exists
  apply(...args: unknown[]): never;
  setSelection(...args: unknown[]): never;
  getSelectedText(...args: unknown[]): never;
  getExtensionState(...args: unknown[]): never;
  getDecorations(...args: unknown[]): never;
  simulateKeypress(...args: unknown[]): never;
  simulateTyping(...args: unknown[]): never;
  loadDocument(...args: unknown[]): never;
}

export interface TestCollaboration {
  editorA: TestEditor;
  editorB: TestEditor;
  sync(): void;
}
```

`TestEditor` is a dedicated type — it does not pretend to be a full `Editor`. It exposes the Wave 2 subset (schema, handles, normalization) plus test-specific additions (`ydoc`, `markDirty`). Wave 3 methods are typed as `never`-returning stubs.

### Module: `helpers.ts` — Internal Utilities

```typescript
import * as Y from 'yjs';

let testIdCounter = 0;

export function generateTestId(): string {
  return `test-block-${++testIdCounter}`;
}

export function resetTestIdCounter(): void {
  testIdCounter = 0;
}

export function toYMap(obj: Record<string, unknown>): Y.Map<unknown> {
  const map = new Y.Map<unknown>();
  for (const [key, value] of Object.entries(obj)) {
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      map.set(key, toYMap(value as Record<string, unknown>));
    } else if (Array.isArray(value)) {
      const arr = new Y.Array<unknown>();
      arr.push(value);
      map.set(key, arr);
    } else {
      map.set(key, value);
    }
  }
  return map;
}
```

`generateTestId()` is deterministic (counter-based). Call `resetTestIdCounter()` in `beforeEach` for reproducible test IDs.

`toYMap()` recursively converts plain objects to `Y.Map` and plain arrays to `Y.Array`. Primitives are stored directly.

### Module: `create-test-document.ts`

```typescript
import * as Y from 'yjs';
import { yjsAdapter, wrapYjsDocument, initBlockMap } from '@pen/crdt-yjs';
import { generateTestId } from './helpers.js';
import type { TestBlock } from './types.js';

export function createTestDocument(blocks: TestBlock[]): {
  ydoc: Y.Doc;
  doc: PenDocument;
} {
  const ydoc = new Y.Doc();
  const adapter = yjsAdapter();
  const blockOrder = ydoc.getArray<string>('blockOrder');
  const blocksMap = ydoc.getMap('blocks');
  // Ensure apps and metadata shared types exist (PenDocument contract)
  ydoc.getMap('apps');
  ydoc.getMap('metadata');

  ydoc.transact(() => {
    for (const block of blocks) {
      const id = block.id ?? generateTestId();

      blockOrder.push([id]);

      // Use initBlockMap to ensure consistent block structure (props + meta always created)
      const contentType = block.children ? 'nested' : 'inline';
      initBlockMap(blocksMap as any, id, block.type, contentType);
      const blockMap = blocksMap.get(id) as Y.Map<unknown>;

      if (block.props && Object.keys(block.props).length > 0) {
        const propsMap = blockMap.get('props') as Y.Map<unknown>;
        for (const [key, value] of Object.entries(block.props)) {
          propsMap.set(key, value);
        }
      }

      if (block.content !== undefined) {
        const content = blockMap.get('content') as Y.Text;
        if (content) {
          content.insert(0, block.content);
        }
      }

      if (block.children) {
        const childrenArr = blockMap.get('children') as Y.Array<string>;
        for (const child of block.children) {
          const childId = child.id ?? generateTestId();
          childrenArr.push([childId]);
          initBlockMap(blocksMap as any, childId, child.type, 'inline');
          const childMap = blocksMap.get(childId) as Y.Map<unknown>;
          if (child.props && Object.keys(child.props).length > 0) {
            const childPropsMap = childMap.get('props') as Y.Map<unknown>;
            for (const [key, value] of Object.entries(child.props)) {
              childPropsMap.set(key, value);
            }
          }
          if (child.content !== undefined) {
            const childContent = childMap.get('content') as Y.Text;
            if (childContent) {
              childContent.insert(0, child.content);
            }
          }
        }
      }
    }
  });

  const crdtDoc = wrapYjsDocument(adapter, ydoc);
  return { ydoc, doc: crdtDoc.penDocument };
}
```

All mutations run inside a single `Y.Doc.transact()` to produce a single CRDT update. Block creation uses `initBlockMap` from `@pen/crdt-yjs` to ensure the `meta` Y.Map and content keys are always present (matching Wave 1's per-block structure invariant). The returned `ydoc` gives tests direct access for Yjs-level assertions; `doc` is the `PenDocument` wrapper for schema engine and handle operations.

### Module: `assert-doc-equals.ts`

```typescript
import type { PenDocument } from '@pen/types';
import { deepEqual } from '@pen/core';
import type { TestBlock, TestEditor } from './types.js';

export function assertDocEquals(
  editorOrA: TestEditor | { document: PenDocument },
  expectedOrB: TestBlock[] | TestEditor | { document: PenDocument },
): void {
  const blocksA = extractBlocks(editorOrA);
  const blocksB = Array.isArray(expectedOrB)
    ? expectedOrB
    : extractBlocks(expectedOrB);

  if (blocksA.length !== blocksB.length) {
    throw new PenAssertionError(
      `Document length mismatch: got ${blocksA.length} blocks, expected ${blocksB.length}`
    );
  }

  for (let i = 0; i < blocksA.length; i++) {
    compareBlock(blocksA[i], blocksB[i], i);
  }
}

function extractBlocks(source: TestEditor | { document: PenDocument }): TestBlock[] {
  const doc = source.document;

  const result: TestBlock[] = [];
  const blockOrder = doc.blockOrder;

  for (let i = 0; i < blockOrder.length; i++) {
    const id = blockOrder.get(i);
    const blockMap = doc.blocks.get(id) as Y.Map<unknown>;
    if (!blockMap) continue;

    const type = blockMap.get('type') as string;
    const propsMap = blockMap.get('props') as Y.Map<unknown> | undefined;
    const content = blockMap.get('content');

    const block: TestBlock = { type };
    if (propsMap && propsMap.size > 0) {
      block.props = {};
      for (const [key, value] of propsMap.entries()) {
        block.props[key] = value;
      }
    }
    if (content instanceof Y.Text) {
      const text = content.toString();
      if (text && text !== '\u200B') {
        block.content = text;
      }
    }
    result.push(block);
  }
  return result;
}

function compareBlock(actual: TestBlock, expected: TestBlock, index: number): void {
  if (actual.type !== expected.type) {
        throw new PenAssertionError(
          `Block ${index}: type mismatch -- got "${actual.type}", expected "${expected.type}"`
        );
  }

  if (expected.props) {
    for (const [key, value] of Object.entries(expected.props)) {
      const actualValue = actual.props?.[key];
      if (!deepEqual(actualValue, value)) {
        throw new PenAssertionError(
          `Block ${index} (${actual.type}): prop "${key}" mismatch -- ` +
          `got ${JSON.stringify(actualValue)}, expected ${JSON.stringify(value)}`
        );
      }
    }
  }

  if (expected.content !== undefined) {
    if ((actual.content ?? '') !== expected.content) {
        throw new PenAssertionError(
          `Block ${index} (${actual.type}): content mismatch -- ` +
          `got "${actual.content ?? ''}", expected "${expected.content}"`
        );
    }
  }
}

class PenAssertionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PenAssertionError';
  }
}
```

> **Note:** The class is named `PenAssertionError` to avoid collision with Node.js's built-in `assert.AssertionError`. Consumers can catch it via `error.name === 'PenAssertionError'`.

Comparison is intentionally lenient:
- Props on actual blocks that are NOT in `expected.props` are ignored (default-stripped props).
- Content comparison strips the zero-width space placeholder.
- The assertion produces a human-readable error message with block index, type, and the specific field that mismatched.

### Module: `create-test-editor.ts`

Partial implementation — full editor API requires Wave 3's `createEditor()`.

```typescript
import { defaultSchema } from '@pen/schema-default';
import { SchemaEngineImpl, createBlockHandle } from '@pen/core';
import { yjsAdapter, wrapYjsDocument } from '@pen/crdt-yjs';
import { createTestDocument } from './create-test-document.js';
import type { TestEditor, TestEditorOptions } from './types.js';

export function createTestEditor(options?: TestEditorOptions): TestEditor {
  const schema = options?.schema ?? defaultSchema;
  const adapter = yjsAdapter();

  const { ydoc, doc, crdtDoc } = options?.doc
    ? (() => {
        const wrapped = wrapYjsDocument(adapter, options.doc!);
        return { ydoc: options.doc!, doc: wrapped.penDocument, crdtDoc: wrapped };
      })()
    : (() => {
        const result = createTestDocument(options?.blocks ?? []);
        const wrapped = wrapYjsDocument(adapter, result.ydoc);
        return { ydoc: result.ydoc, doc: wrapped.penDocument, crdtDoc: wrapped };
      })();

  const engine = new SchemaEngineImpl(schema, doc, crdtDoc);

  engine.normalizeAll();

  return {
    schema,
    document: doc,
    ydoc,

    getBlock(blockId: string) {
      return createBlockHandle(blockId, doc, crdtDoc, schema);
    },

    normalizeAll() { engine.normalizeAll(); },
    markDirty(blockId: string) { engine.markDirty(blockId); },
    normalizeDirty() { engine.normalizeDirty(); },

    apply: notImplemented('apply'),
    setSelection: notImplemented('setSelection'),
    getSelectedText: notImplemented('getSelectedText'),
    getExtensionState: notImplemented('getExtensionState'),
    getDecorations: notImplemented('getDecorations'),
    simulateKeypress: notImplemented('simulateKeypress'),
    simulateTyping: notImplemented('simulateTyping'),
    loadDocument: notImplemented('loadDocument'),
  };
}

function notImplemented(name: string) {
  return (..._args: unknown[]): never => {
    throw new Error(`TestEditor.${name} is not implemented until Wave 3`);
  };
}
```

**What works in Wave 2:**
- Schema resolution via `schema.resolve(type)`
- Document loading via `createTestDocument`
- Block handles via `getBlock(id)` — full `BlockHandle` API
- Normalization via `normalizeAll()` / `markDirty()` / `normalizeDirty()`
- Direct CRDT access via `ydoc` for low-level assertions

**What's deferred to Wave 3:**
- `apply()` — requires the editor's operation pipeline
- `setSelection()` / `getSelectedText()` — requires selection manager
- `simulateKeypress()` / `simulateTyping()` — requires input backend
- `getExtensionState()` / `getDecorations()` — requires extension host

### Module: `create-test-collaboration.ts`

```typescript
import * as Y from 'yjs';
import { createTestEditor } from './create-test-editor.js';
import type { TestEditorOptions, TestCollaboration } from './types.js';

export function createTestCollaboration(
  options?: TestEditorOptions,
): TestCollaboration {
  const docA = new Y.Doc();
  const docB = new Y.Doc();

  const editorA = createTestEditor({ ...options, doc: docA });
  const editorB = createTestEditor({ ...options, doc: docB });

  return {
    editorA,
    editorB,
    sync() {
      const stateA = Y.encodeStateAsUpdate(docA);
      const stateB = Y.encodeStateAsUpdate(docB);
      Y.applyUpdate(docA, stateB);
      Y.applyUpdate(docB, stateA);
    },
  };
}
```

`sync()` exchanges full state updates between the two `Y.Doc` instances. After `sync()`, both docs should contain identical CRDT state (Yjs convergence guarantee). The test then verifies via `assertDocEquals(editorA, editorB)`.

### Module: `simulation.ts` — Deferred Stubs

```typescript
export function simulateKeypress(_key: string): void {
  throw new Error('simulateKeypress requires Wave 3 editor input pipeline');
}

export function simulateTyping(_text: string): void {
  throw new Error('simulateTyping requires Wave 3 editor input pipeline');
}
```

### Module: `index.ts` — Package Entry

```typescript
export type { TestBlock, TestEditorOptions, TestEditor, TestCollaboration } from './types.js';
export { createTestDocument } from './create-test-document.js';
export { createTestEditor } from './create-test-editor.js';
export { assertDocEquals } from './assert-doc-equals.js';
export { createTestCollaboration } from './create-test-collaboration.js';
export { simulateKeypress, simulateTyping } from './simulation.js';
export { resetTestIdCounter } from './helpers.js';
```

---

## Package 4: `@pen/assets-memory`

Trivial in-memory `AssetProvider` (Spec Section 10.3). Used for testing and demos.

### Implementation

```typescript
import type { AssetProvider, AssetRef, AssetUploadOptions } from '@pen/types';

export function memoryAssets(): AssetProvider {
  const store = new Map<string, { blob: Blob; ref: AssetRef }>();

  return {
    async upload(file: File | Blob, options?: AssetUploadOptions): Promise<AssetRef> {
      const id = crypto.randomUUID();
      const url = typeof URL.createObjectURL === 'function'
        ? URL.createObjectURL(file)
        : `blob:memory/${id}`;
      const ref: AssetRef = {
        id,
        url,
        mimeType: options?.mimeType ?? (file as File).type ?? 'application/octet-stream',
        size: file.size,
      };
      store.set(id, { blob: file, ref });
      options?.onProgress?.(1);
      return ref;
    },

    resolve(ref: AssetRef): string {
      return store.get(ref.id)?.ref.url ?? ref.url;
    },

    async delete(ref: AssetRef): Promise<void> {
      const entry = store.get(ref.id);
      if (entry) {
        if (typeof URL.revokeObjectURL === 'function') {
          URL.revokeObjectURL(entry.ref.url);
        }
        store.delete(ref.id);
      }
    },
  };
}
```

Key implementation notes:
- `URL.createObjectURL` creates a `blob:` URL from the `Blob`. Falls back to a `blob:memory/` URL in Node.js test environments where `URL.createObjectURL` is not available.
- `onProgress` is called with `1` (100%) immediately — there's no actual upload.
- `resolve()` returns the stored `blob:` URL. Falls back to `ref.url` if the entry is missing (handles refs from other providers).
- `delete()` calls `URL.revokeObjectURL()` to free the blob URL (when available), then removes from the store.
- No `maxSize` enforcement — this is a testing provider.

---

## Key Decisions

- **SchemaRegistry is immutable.** `extend()`, `without()`, `override()` return new instances. The original is never mutated. This enables safe sharing between editor instances.

- **SchemaRegistryImpl is a class, not a plain object.** Enables `instanceof` checks for `mergeSchemas` (accessing `allApps()` method). Gives a clear construction pattern. The `ComposableSchema` interface is what consumers see; the class is the internal implementation.

- **Core system marks live in `@pen/core`, not `@pen/schema-default`.** The `suggestion` mark is auto-registered by `SchemaRegistryImpl`. This aligns with the v01 spec (Section 4.3) which states system marks are not part of the default schema. `@pen/schema-default` only contains content blocks and formatting inlines.

- **Normalization is per-block, not per-document.** The dirty-flag approach is critical for the 1000+ block performance target. A document where the LLM edits 3 blocks normalizes 3 blocks, not 1000.

- **Normalization rule execution order matters.** Structural rules (9, 11) run first, then block-level rules (4, 5, 6, 3), then inline rules (2). Rule 6 can delete the block (early return). Rule 1 is read-time only. Rule 10 is triggered on deleted-block detection.

- **Rule 1 (mark ordering) is read-time, not a CRDT mutation.** Yjs attribute objects are flat key-value records where key order has no semantic effect. Mark priority ordering is enforced at serialization and decoration read time via `sortDeltaAttributes()`, not by rewriting the CRDT.

- **Priority scale for inline marks.** The default scale uses 100-increments (bold=100, italic=200, ..., code=900). The spacing allows custom marks to be inserted between any two defaults. Consumers override via `InlineSchema.priority`.

- **BlockHandle is lazy.** `prev`/`next` traverse `blockOrder` on access. `children` filters `blockOrder` by `parentId` on access. No precomputed linked list. This avoids stale state. Hot-path caching comes in Wave 3 via `DocumentState`.

- **BlockHandle.setMeta is the sole write exception on the handle API, not a pipeline bypass.** Metadata remains excluded from normalization (Rule 7), but metadata writes must flow through `set-meta` in the editor pipeline.

- **`resolveLayout()` returns null for M0.** Layout blocks are M2 scope. The method exists on the `SchemaRegistry` interface for completeness and to prevent breaking API changes later.

- **`@pen/test` defines `TestEditor`, not `Editor`.** `createTestEditor` returns a `TestEditor` type that exposes the Wave 2 subset (schema, handles, normalization) plus test-specific additions. It does not pretend to satisfy the full `Editor` interface.

- **`mergeSchemas` uses `allApps()` method, not private field access.** App schemas are accessed via the public `allApps()` method on `SchemaRegistryImpl`, avoiding `as any` casts on private fields.

- **`normalizeAll()` iterates the blocks map, not just blockOrder.** This ensures layout-nested blocks in `children` arrays are also normalized on document load.

---

## Acceptance Criteria

1. `SchemaRegistry` resolves all default block and inline types by name.
2. `defaultSchema.without(['table']).resolve('table')` returns `null`.
3. `defaultSchema.extend([myCustomBlock]).resolve('myCustomBlock')` returns the schema.
4. `normalizeDirty()` on a block with props equal to defaults strips those props from CRDT storage.
5. `normalizeDirty()` called twice on the same block produces zero CRDT writes on the second call (idempotency, verified via state vector comparison).
6. `normalizeDirty()` on a block with duplicate IDs in `blockOrder` keeps only the last occurrence.
7. `BlockHandle.textContent()` returns the full text of an inline block.
8. `BlockHandle.prev` / `BlockHandle.next` navigate the block list correctly.
9. `createTestDocument([{ type: 'heading', props: { level: 1 }, content: 'Hello' }])` produces a valid CRDT document with one heading block.
10. `assertDocEquals` correctly detects matching and non-matching documents.
11. Every block in `@pen/schema-default` has `serialize.toMarkdown()` that produces valid output.
12. All 11 normalization rules have individual unit tests with idempotency verification.
13. Rule 10 (orphan promotion): deleting a toggle block promotes its children (clears `parentId`) to top-level.
14. Rule 9 (dedup): concurrent `move-block` producing duplicate IDs in `blockOrder` keeps only the last occurrence.
15. Rule 1 (mark ordering): `sortDeltaAttributes` produces correctly ordered attribute keys for serialization.
16. Streaming deferral: a block being streamed is NOT normalized until `gen-end`.
17. `SchemaRegistryImpl` resolves all 12 default block types, 9 marks, 2 nodes, and 1 system mark.
18. `mergeSchemas(a, b)` where `b` overrides `a`'s heading schema returns `b`'s version for `resolve('heading')`.
19. `defaultSchema.allBlockDisplays()` returns entries for all 12 blocks (all default blocks have `display` metadata).
20. `memoryAssets().upload(blob)` returns a valid `AssetRef` and `resolve()` returns a usable URL.
21. `createTestDocument` + `assertDocEquals` round-trip: create doc, assert equals expected, passes.
22. `createTestCollaboration` sync: concurrent edits converge after `sync()` -- `assertDocEquals(editorA, editorB)` passes.
23. Mark priority ordering: `bold.priority < italic.priority < underline.priority < ... < code.priority`.
24. `paragraph.serialize.toMarkdown()` returns plain text content, `heading.serialize.toMarkdown()` returns `# `-prefixed text.
25. `suggestion` system mark has `system: true`, `expand: 'none'`, and is always resolvable via `resolveInline('suggestion')` even after `without()`.
