# Block Drag-and-Drop RFC

## Status

Proposed.

## Summary

This RFC defines a first-class block drag-and-drop architecture for Pen's React rendering layer.

The core decision is:

- Pen keeps block reordering on the existing `move-block` operation
- block drag-and-drop is configured at the React/editor-surface layer, not as a new document profile
- structured presentations enable block drag-and-drop by default
- flow presentations disable block drag-and-drop by default
- consumers opt into visible drag controls by rendering `Pen.Editor.BlockHandle` or using `useBlockDragHandle()`

This is the recommended architecture because it matches Pen's existing split between:

- persisted authoring semantics in `documentProfile`
- presentation policy in `editorViewMode`
- headless document mutation through `editor.apply()`

## Problem

Pen already has the ingredients for block drag-and-drop, but not yet a coherent product-level API.

Today:

- core supports `move-block`
- `Pen.Editor.BlockHandle` exists as a primitive
- `Pen.Editor.DragOverlay` exists as a primitive
- the default editor surface does not wire block drag-and-drop in as a policy
- consumers do not have a documented headless API for adding custom drag handles

This creates three gaps:

1. Structured mode should expose stronger block affordances, but drag-and-drop is not currently modeled as a first-class structured-mode option.
2. Flow mode should reduce block interaction affordances, but there is no explicit policy surface for disabling block drag-and-drop.
3. Headless consumers need a behavior-only API for custom drag controls, not only a fixed component.

## Goals

- Add an explicit configuration surface for block drag-and-drop in `@pen/react`.
- Make structured presentations support block drag-and-drop by default.
- Allow consumers to disable drag-and-drop without replacing the rest of the editor surface.
- Add a headless custom-handle API for unstyled consumer-owned controls.
- Support multi-block drag when the current canonical selection is a block selection.
- Keep all reordering on the canonical `editor.apply([{ type: "move-block", ... }])` path.
- Preserve nested editor boundaries and canonical selection semantics.
- Keep the architecture compatible with future richer drop targeting such as `before`, `after`, and `{ parent, index }`.

## Non-Goals

- This RFC does not introduce a second reorder operation beyond `move-block`.
- This RFC does not make drag-and-drop a persisted document capability by itself.
- This RFC does not introduce keyboard reordering in this phase.
- This RFC does not replace the existing transfer pipeline for image and external drops.

## Existing Constraints

This RFC assumes and preserves the following existing Pen decisions:

- Pen has one authored document model.
- `documentProfile` controls authoring semantics.
- `editorViewMode` controls presentation policy.
- React primitives remain headless and composable.
- document writes must continue to go through `editor.apply()`.
- nested editors remain hard interaction boundaries.
- canonical selection remains the source of truth for editor semantics.

## Current State

Today, the implementation is split across three layers:

### 1. Core already supports reordering

`move-block` already exists and supports:

- `first`
- `last`
- `{ before: blockId }`
- `{ after: blockId }`
- `{ parent: blockId, index }`

This is sufficient as the semantic mutation primitive for block drag-and-drop.

### 2. React already has drag primitives

`Pen.Editor.BlockHandle` exists and can initiate a drag.

`Pen.Editor.DragOverlay` exists and can render a client-side drag ghost.

However, these primitives are not yet coordinated by a first-class drag-and-drop policy layer.

### 3. Default rendering does not provide a full DnD story

The default editor content and block wrappers do not currently provide:

- a root-level enable or disable flag
- built-in default-handle policy
- a shared drag session controller
- a documented headless API for consumer-owned drag handles

## Architectural Decision

Block drag-and-drop should be a React-layer editor-surface policy, not a new persisted document feature.

### Drag Payload Rule

If the question is:

- should the current editor presentation show a drag handle
- should this view expose drag-and-drop affordances

then the answer belongs to `@pen/react` presentation policy.

If the question is:

- is this move semantically allowed
- should this block or container be reorderable in this document
- should non-UI writers be prevented from making the same move

then the answer belongs below the React layer, through shared policy or mutation guardrails.

## Proposed Public API

Add a new `EditorRoot` prop:

```ts
export interface BlockDragAndDropOptions {
  enabled?: boolean;
}

export interface EditorRootProps {
  blockDragAndDrop?: BlockDragAndDropOptions;
}
```

### Semantics

`enabled`

- `true` means the editor view accepts block drag-and-drop reordering
- `false` means no block drag session can start or complete in this view

### Recommended defaults

If `blockDragAndDrop` is omitted:

- structured presentation resolves to `{ enabled: true }`
- flow presentation resolves to `{ enabled: false }`

This should resolve from `editorViewMode`, not `documentProfile`, because handle visibility and affordance density are presentation policy.

### Concrete root API

The implementation should resolve root props into a fully concrete internal policy shape:

```ts
export interface ResolvedBlockDragAndDropOptions {
  enabled: boolean;
}

function resolveBlockDragAndDrop(
  editorViewMode: EditorViewMode,
  options?: BlockDragAndDropOptions,
): ResolvedBlockDragAndDropOptions;
```

Resolution rules:

- start from `editorViewMode` defaults
- apply explicit user overrides

## Why This Belongs In `editorViewMode` Policy

The flow-mode RFC already establishes that handle visibility is presentation policy.

Block drag-and-drop sits across two concerns:

- the existence of reorder affordances in a given editor view
- the semantic validity of a reorder operation

This RFC defines only the first concern as a default policy:

- structured views expose more explicit block controls
- flow views reduce block chrome and generally suppress default drag affordances

The second concern remains available for deeper policy enforcement if needed.

## Headless Custom Handle API

Pen should support both:

- a convenience component for common cases
- a lower-level hook for fully custom controls

### Keep `Pen.Editor.BlockHandle`

`Pen.Editor.BlockHandle` remains the standard convenience primitive.

It should become a thin wrapper over the shared drag-and-drop controller.

### Add `useBlockDragHandle(blockId)`

Add a React hook:

```ts
export interface BlockDragHandleHookResult {
  disabled: boolean;
  isDragging: boolean;
  dragBlockIds: readonly string[];
  props: {
    draggable: boolean;
    role: "button";
    "aria-label": string;
    "data-pen-block-handle": string;
    "data-block-id": string;
    "data-dragging"?: string;
    "data-pen-ignore-pointer-gesture": string;
    onDragStart: (event: React.DragEvent<HTMLElement>) => void;
    onDragEnd: (event: React.DragEvent<HTMLElement>) => void;
  };
}

function useBlockDragHandle(blockId: string): BlockDragHandleHookResult;
```

This hook allows consumers to:

- render custom controls in block toolbars
- render hover-only handles
- render drag handles inside custom renderer shells
- keep styling and control placement fully consumer-owned

### Hook behavior

`useBlockDragHandle(blockId)` should:

- return the full dragged block id set for the current gesture source
- use the active `BlockSelection` when `blockId` is selected
- fall back to `[blockId]` when `blockId` is not selected
- return inert props when drag-and-drop is disabled or the editor is readonly

The convenience `Pen.Editor.BlockHandle` component should be implemented on top of this hook so that the hook and component can never diverge.

## Default Handle Strategy

Pen should not auto-render block handles.

Visible drag controls should remain consumer-owned, either by:

- rendering `Pen.Editor.BlockHandle`
- using `useBlockDragHandle(blockId)` inside custom renderer shells or toolbars

### Why

This is more aligned with Pen's headless model:

- the library owns behavior and mutation semantics
- consumers own visible control placement and styling
- `BlockRenderContext` remains free of React-specific handle concerns

Built-in renderers remain pure render functions and the editor block wrapper remains behavior-focused.

## Drag Session Ownership

Pen should introduce a shared block drag session in `@pen/react`.

This session should track:

- dragged block ids in document order
- current drop target
- current drop position
- whether the session is active
- pointer coordinates for the overlay

This session becomes the single source of truth for:

- `Pen.Editor.BlockHandle`
- `Pen.Editor.DragOverlay`
- drop-preview attributes on block wrappers
- future custom drop indicators

### Concrete session shape

The internal session should use a concrete shape close to:

```ts
export type BlockDropPosition = "before" | "after";

export interface DraggedBlockSet {
  anchorBlockId: string;
  blockIds: readonly string[];
}

export interface BlockDragSessionState {
  active: boolean;
  dragged: DraggedBlockSet | null;
  dropTargetBlockId: string | null;
  dropPosition: BlockDropPosition | null;
  pointer: { x: number; y: number } | null;
}
```

Expected controller operations:

```ts
startDrag(dragged: DraggedBlockSet, pointer?: { x: number; y: number }): void;
updatePointer(pointer: { x: number; y: number }): void;
setDropTarget(blockId: string, position: BlockDropPosition): void;
clearDropTarget(): void;
endDrag(): void;
```

### Source of truth rule

During an active drag:

- the React drag session is the source of truth for block ids, preview, and overlay state
- `dataTransfer` is treated as a transport and compatibility layer, not the primary state container

## Drop Target Ownership

Drop target handling should move to the editor block wrapper layer.

`Pen.Editor.Block` is the correct place to resolve:

- whether a dragged block can be dropped here
- whether the preview is `before` or `after`
- whether the block should display drop-target state

This is a better fit than handle-to-handle drops because:

- the full block surface becomes the reorder target
- `Pen.Editor.BlockHandle` and custom handles both use the same drop pipeline
- preview logic stays centralized
- richer target resolution can be added later without changing consumer APIs

## Multi-Block Drag Semantics

Multi-block drag should follow canonical block selection rather than introducing a separate drag-only grouping model.

### Rule

If a drag starts from a block handle or custom drag control on a block that is currently part of the active `BlockSelection`, the drag payload should include the full selected block set in document order.

If a drag starts from a block that is not part of the active `BlockSelection`, the drag payload should include only the initiating block.

### Selection Model Rationale

This keeps block drag aligned with Pen's existing selection model:

- block selection remains the canonical way to express "these blocks are selected"
- drag-and-drop becomes an action on that selection
- consumers do not need a second concept such as a temporary drag group

### Required behavior

- drag from selected block -> drag all selected block ids in document order
- drag from unselected block -> drag only the initiating block
- text selection does not implicitly become a block-drag payload
- region selection may participate only once it resolves to canonical `BlockSelection`

### Concrete payload shape

The native drag payload should use a dedicated MIME type with a JSON body:

```ts
type SerializedBlockDragPayload = {
  type: "pen-block-drag";
  viewId: string;
  anchorBlockId: string;
  blockIds: string[];
};
```

Recommended `dataTransfer` writes:

- `application/x-pen-block-drag` -> serialized JSON payload
- `application/x-pen-block-id` -> anchor block id for compatibility with the existing primitive path

The JSON payload should be the only format read by the new implementation. The legacy single-id MIME entry should be written only for compatibility during migration.

### Cross-root safety

`viewId` should match the current editor root's internal view identity.

Drop targets must ignore payloads whose `viewId` does not match the active root. This provides a hard boundary for nested editors and sibling editors mounted in the same document.

## Mutation Path

All completed drops must resolve to one `editor.apply()` call containing one or more `move-block` operations.

```ts
editor.apply(
  moveOps,
  { origin: "user" },
);
```

### Requirement

UI-initiated block drag-and-drop must always set `origin: "user"`.

This preserves:

- undo grouping expectations
- diagnostics consistency
- collaboration semantics
- extension observability

### Multi-block ordering rule

When applying multi-block drags, Pen must preserve the dragged blocks' document order in the final result.

For top-level before or after insertion, the implementation should build ordered `move-block` ops using these rules:

- drop `before` target -> apply `move-block` ops in document order
- drop `after` target -> apply `move-block` ops in reverse document order

This keeps the final block order stable without introducing a second reorder op.

### Concrete move-op builder

The implementation should centralize move-op serialization in one helper:

```ts
function buildMoveBlockOps(args: {
  blockIds: readonly string[];
  targetBlockId: string;
  dropPosition: BlockDropPosition;
}): MoveBlockOp[];
```

Expected behavior:

- for `"before"`, emit one op per dragged block in document order
- for `"after"`, emit one op per dragged block in reverse document order
- do not emit no-op moves for blocks that would remain in place

This helper should be used by both `Pen.Editor.BlockHandle` and custom handles via the shared drop pipeline.

## Target Resolution

The initial implementation should support both single-block and multi-block reordering at top-level or sibling scope.

However, the architecture must prepare for richer positions because `move-block` already supports them.

### Phase 1 required targets

- drop before a block
- drop after a block
- preserve order for dragged multi-block selections

### Phase 2 optional targets

- drop into a parent container at `{ parent, index }`
- container-aware child insertion
- better nested block reordering heuristics

The API must not assume that all drops resolve to `{ before: blockId }`.

### Concrete block-wrapper behavior

`Pen.Editor.Block` should own drop resolution for the current block wrapper.

For the first implementation:

- measure the block wrapper rect
- resolve `"before"` when the pointer is in the upper half
- resolve `"after"` when the pointer is in the lower half
- publish that preview into the shared drag session

This keeps the initial algorithm simple while leaving room for richer container-aware heuristics later.

## Selection And Gesture Rules

Block drag-and-drop must not fight Pen's selection model.

### Rules

- Dragging must start from explicit drag handles or explicit consumer-owned controls.
- Native text drag inside field-editor surfaces remains suppressed.
- Dragging a block handle must not implicitly create a second shadow selection model.
- Dragging from a selected block must preserve the current `BlockSelection` as the drag payload.
- Nested editor roots must reject drag interactions from outer editors.
- Region selection and block drag gestures must remain separable.

### Rationale

Pen already treats cross-block text selection, block selection, and region selection as canonical interaction models. Drag-and-drop is an action layered on top of those models, not a replacement for them.

## Eligibility And Semantic Guardrails

This RFC intentionally separates view policy from semantic policy.

### View policy

Handled in `@pen/react`:

- whether drag-and-drop is enabled in this editor view
- what preview UI appears during a drag

### Semantic policy

Handled below the React layer when needed:

- whether specific block types are reorderable
- whether specific containers accept children
- whether specific document profiles should reject certain moves

If Pen later needs hard reorder restrictions for tools, AI, importers, or collaborators, those restrictions must be enforced through shared policy or pre-apply guardrails, not only by hiding handles.

## Behavior Matrix

### Structured presentation

Default behavior:

- drag-and-drop enabled
- consumers may render explicit block affordances

### Flow presentation

Default behavior:

- drag-and-drop disabled
- block chrome reduced

### Fully disabled mode

Consumer configuration:

- `enabled: false`

Behavior:

- no drag session can begin
- no drop previews render
- consumer-mounted handles become inert

## Relationship To Existing Specs

### `spec/flow-mode-rfc.md`

This RFC refines what "hide or reduce drag handles" means operationally:

- flow mode should resolve to a lighter default drag-and-drop policy
- structured mode should resolve to a more explicit default drag-and-drop policy

### `spec/wave-05-react-rendering.md`

This RFC extends the existing `Pen.Editor.BlockHandle` and `Pen.Editor.DragOverlay` primitives with a shared controller and an explicit root-level policy surface.

### `spec/cross-block-selection-rfc.md`

This RFC preserves canonical selection ownership and keeps drag-and-drop as a handle-driven action that does not replace text, block, or region selection semantics.

## Implementation Outline

### Phase 1

- add `blockDragAndDrop` to `Pen.Editor.Root`
- resolve defaults from `editorViewMode`
- add shared block drag session state in `@pen/react`
- serialize a multi-block HTML5 drag payload with `viewId`, `anchorBlockId`, and ordered `blockIds`
- move drop target behavior to `Pen.Editor.Block`
- update `Pen.Editor.BlockHandle` to use the shared session
- update `Pen.Editor.DragOverlay` to use the shared session
- support multi-block drag driven by canonical `BlockSelection`

### Phase 2

- add `useBlockDragHandle(blockId)`
- support consumer-owned visible handles
- add better drop-position previews
- add playground coverage for structured, flow, and custom-handle configurations

### Phase 3

- add semantic reorder policy if required by block/container rules
- add container-aware child insertion and richer parent/index targeting if needed

## Testing Requirements

Add coverage for:

- structured default enables drag-and-drop
- flow default disables drag-and-drop
- `enabled: false` prevents drag start and drop completion
- drag completion applies `move-block` with `{ origin: "user" }`
- dragging a selected block drags the full selected block set
- dragging an unselected block drags only that block
- multi-block drop preserves document order
- cross-root payloads are ignored via mismatched `viewId`
- nested editor roots reject cross-root drag targets
- existing image/external drop behavior remains unchanged
- `Pen.Editor.BlockHandle` and custom-handle flows use the same underlying reorder behavior

## Acceptance Criteria

This RFC is successfully implemented when:

1. Pen exposes an explicit block drag-and-drop configuration on `Pen.Editor.Root`.
2. Structured presentations enable block drag-and-drop by default.
3. Flow presentations disable block drag-and-drop by default.
4. Consumers can disable drag-and-drop without replacing the editor surface.
5. Consumers can attach custom drag controls through `Pen.Editor.BlockHandle` or `useBlockDragHandle()`.
6. Single-block and multi-block drag-and-drop reorders resolve through `move-block` using one `editor.apply(..., { origin: "user" })` call.
7. The architecture remains compatible with richer target resolution and future semantic guardrails.

## Final Recommendation

The optimal architecture is:

- React-layer policy for drag affordances
- existing `move-block` as the semantic mutation primitive
- central block-level drop targeting
- an explicit `BlockHandle` primitive
- a headless `useBlockDragHandle()` API for custom controls

This keeps Pen headless, composable, and aligned with the current spec direction while finally making block drag-and-drop a first-class part of the structured editing surface.
