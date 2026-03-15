# Wave 3 — Editor Core

**Milestone:** M0 · **Packages:** `@pen/core`, `@pen/undo` · **Depends on:** Waves 0-2

---

## Goal

Implement the editor runtime that owns mutation authority, schema validation, selection, document state, extension dispatch, and undo integration.

After this wave, Pen can:

- create an editor with a schema and CRDT document
- apply validated document operations through one canonical pipeline
- maintain incremental document and selection state
- host extensions through a stable lifecycle
- group and replay undoable mutations coherently

This wave defines the editor kernel. It does not define AI product UX, chat surfaces, or agent workflows.

---

## Scope

### In scope

- `Editor` implementation and `createEditor()`
- apply pipeline and bounded pre-apply transforms
- document profile enforcement
- document state and block-handle integration
- selection state and document ranges
- extension manager and typed internal slots
- event emission
- decoration aggregation
- undo integration as an extension

### Out of scope

- document-aware tool packages
- model transports
- AI session UX
- command menus and toolbars
- review product surfaces
- app execution or branching

Those build on the core kernel later.

---

## Package Boundary

### `@pen/core`

`@pen/core` owns the editor host and runtime authority:

- `createEditor()`
- the apply pipeline
- schema engine integration
- document state
- selection
- extension dispatch
- decoration aggregation
- document profile policy enforcement

### `@pen/undo`

`@pen/undo` remains an extension package, not a second editor kernel.

It should plug into the core runtime through extension hooks and typed editor slots.

### Adjacent packages

`@pen/document-ops` and `@pen/delta-stream` depend on this wave, but they are not part of the architecture defined here.

If the current runtime wires convenience extensions by default, that is an integration choice, not a reason to blur ownership in the spec.

---

## Required File Areas

```text
packages/core/src/
├── schema/                  (from Wave 2)
├── editor/
│   ├── editor.ts
│   ├── apply.ts
│   ├── extension-manager.ts
│   ├── selection.ts
│   ├── range.ts
│   ├── decorations.ts
│   ├── events.ts
│   └── document-state.ts
└── index.ts

packages/undo/src/
├── undo-extension.ts
├── undo-manager.ts
└── index.ts
```

No cycles.

---

## Architectural Center

This wave should center on five runtime objects:

1. `Editor`
2. `ApplyPipeline`
3. `ExtensionManager`
4. `SelectionState`
5. `DocumentState`

Everything else in this wave exists to support those objects.

---

## Core Invariants

### `editor.apply()` is the only mutation authority

All durable writes inside the editor boundary must resolve into:

```ts
editor.apply(ops, { origin })
```

No extension or renderer should bypass this path for document mutation.

### The CRDT document is the source of truth

The runtime reads from and writes to the CRDT-backed document model.

Cached editor state such as document indexes, block handles, and decorations are derived projections.

### Schema enforcement is mandatory

All applied operations must pass through:

- schema validation
- normalization
- document profile enforcement

Invalid mutations should fail safely or be reduced to valid subsets when that behavior is already defined by policy.

### Before-apply hooks stay bounded

`onBeforeApply` exists for editor-local transforms such as:

- suggest-mode interception
- auth or policy filtering
- input-rule transforms

These hooks must remain:

- deterministic
- bounded
- side-effect-light
- subordinate to the canonical apply path

### Runtime state stays incremental

`DocumentState` and related caches must prefer incremental updates over full rebuilds.

The kernel should assume that apply, selection, and extension observation are hot paths.

---

## `Editor` Responsibilities

The `Editor` runtime should own:

- document loading and initialization
- the schema registry reference
- the CRDT document and adapter references
- extension activation and teardown
- public events
- selection and range APIs
- document profile metadata
- internal slots for extension cooperation

The public editor API should stay smaller than the full internal implementation.

---

## Apply Pipeline

### Canonical flow

The apply pipeline should execute in this order:

1. receive `DocumentOp[]`
2. run bounded pre-apply hooks
3. validate against schema and document profile
4. apply to the CRDT document in a grouped transaction
5. collect affected blocks and revisions
6. normalize incrementally
7. update document state
8. notify extensions
9. emit commit and change events
10. invalidate and recompute decorations as needed

### Required guarantees

- mutation order is deterministic
- invalid operations do not silently corrupt document state
- commit metadata is rich enough for downstream undo, review, and diagnostics
- extension observation happens after durable mutation, not before

---

## Selection And Read Model

### Selection

This wave owns canonical selection state for:

- text selections
- block selections
- cross-block ranges

Selection is a first-class runtime concern because commands, tools, AI, and rendering all depend on it.

### Document state

`DocumentState` is the runtime read model for:

- block order
- block lookup
- position indexes
- handle creation
- downstream structured inspection

The read model should be optimized for frequent queries and bounded incremental updates.

---

## Extension Model

### Extension manager

The extension manager should:

- activate and deactivate extensions
- coordinate extension state
- collect decorations
- expose namespaced custom events
- support key bindings and input rules

### Typed internal slots

Extensions often need shared runtime services such as undo managers or tool runtimes.

Those should be exposed through typed editor internal slots rather than monkey-patching arbitrary fields.

Slot usage should be:

- explicit
- namespaced
- documented as internal API

---

## Undo And Redo

Undo belongs in the architecture from the start.

This wave should support:

- grouped transactions
- origin-aware history behavior
- extension-safe undo integration
- coherent replay of logical edits rather than renderer-local changes

This becomes especially important later for AI turns, but the kernel support belongs here.

---

## Performance And DX Requirements

This wave must optimize for:

- low overhead in `editor.apply()`
- incremental document state maintenance
- bounded extension observation costs
- predictable decoration invalidation
- easy headless testing
- explicit, easy-to-debug runtime contracts

The design should prefer:

- derived state over duplicated state
- small runtime interfaces over wide convenience surfaces
- explicit commit metadata over hidden side effects

The design should avoid:

- whole-document recomputation on common edits
- renderer-owned semantics leaking into core
- feature packages redefining editor authority

---

## Acceptance Criteria

1. `createEditor()` can construct a working headless editor with schema, CRDT document, and extensions.
2. All durable document mutation flows through `editor.apply()`.
3. The apply pipeline enforces schema and document profile constraints before durable mutation completes.
4. The runtime maintains incremental document state suitable for block lookup and downstream tooling.
5. Selection state supports text, block, and cross-block ranges.
6. Extensions activate through a stable lifecycle and can cooperate through typed internal slots.
7. Undo integration works as an extension and preserves coherent grouped mutations.
8. Decoration aggregation and event emission remain part of the runtime host rather than renderer-specific behavior.
9. This wave does not define AI product surfaces, tool UIs, or workflow chrome.

---

## Key Decisions

1. **`Editor` is the authority boundary.** Feature packages compose around it.
2. **`DocumentOp[]` is the canonical mutation contract.** No second write path.
3. **Extension composition beats feature-specific coupling.** Shared services use typed slots.
4. **Undo is infrastructural.** It belongs with the kernel, even if implemented as an extension package.
5. **Performance is part of correctness.** Hot-path costs must influence the design.

---

## Follow-on

Later waves may add document tools, transports, AI mutation infrastructure, and rendering primitives, but those should build on the kernel defined here rather than reshaping it.
