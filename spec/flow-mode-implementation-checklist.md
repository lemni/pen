# Flow Mode Implementation Checklist

This checklist turns `spec/flow-mode-rfc.md` into a concrete implementation plan mapped to packages and symbols.

It assumes Pen remains fully block-native and that flow mode is implemented as a profile and policy layer on top of the existing document model.

## Implementation Strategy

Build this in five layers:

1. define flow mode configuration and profile boundaries
2. finish canonical multi-block text behavior in core
3. add flow-aware rendering and field-editor policy
4. add flow-aware commands, clipboard, and menus
5. ship presets, playground coverage, and docs

Do not introduce a second document root model while implementing this checklist.

## Phase 0: Spec Alignment

- [ ] Add references to `spec/flow-mode-rfc.md`
  - Package: `spec`
  - Files:
    - `spec/cross-block-selection-rfc.md`
    - optionally `spec/v01.md`
    - optionally `spec/wave-05-react-rendering.md`
  - Outcome:
    - the spec set clearly describes flow mode as a block-native profile.

## Phase 1: Flow Mode Configuration

- [ ] Add persisted document-profile configuration
  - Package: `@pen/types`
  - Files:
    - `packages/types/src/types/editor.ts`
    - `packages/types/src/types/crdt.ts` if profile metadata belongs there
  - Symbols to add:
    - `DocumentProfile = "structured" | "flow"`
    - `CreateEditorOptions.documentProfile?`
  - Outcome:
    - flow semantics are part of document identity, not only a local editor option.

- [ ] Add optional local view-mode configuration for presentation-only differences
  - Package: `@pen/types`
  - Files:
    - `packages/types/src/types/editor.ts`
  - Symbols to add:
    - `EditorViewMode = "structured" | "flow"`
    - optional `CreateEditorOptions.editorViewMode?`
  - Outcome:
    - chrome and presentation can vary without changing authoring semantics.

- [ ] Expose the configured profile and view mode on the editor surface
  - Package: `@pen/types`
  - Files:
    - `packages/types/src/types/editor.ts`
  - Symbols to update:
    - `Editor`
    - `EditorInternals` if needed
  - Suggested additions:
    - `Editor.documentProfile`
    - `Editor.editorViewMode`
  - Outcome:
    - renderer and command layers can branch cleanly on persisted semantics versus local presentation.

- [ ] Define flow-mode profile defaults
  - Packages:
    - `@pen/core`
    - default schema package
  - Files:
    - `packages/core/src/index.ts`
    - `packages/schema/default/src/defs.ts`
  - Outcome:
    - flow mode has a predictable default set of allowed block types and behaviors.

- [ ] Persist and load `documentProfile` from document metadata
  - Packages:
    - `@pen/core`
    - `@pen/crdt-yjs`
  - Files:
    - `packages/core/src/editor/editor.ts`
    - `packages/crdt/yjs/src/document.ts`
    - `packages/crdt/yjs/src/adapter.ts`
  - Outcome:
    - all editors attached to the same document agree on flow semantics.

## Phase 2: Canonical Multi-Block Text Semantics

- [ ] Audit all remaining single-block assumptions in core selection
  - Package: `@pen/core`
  - Files:
    - `packages/core/src/editor/selection.ts`
    - `packages/core/src/editor/range.ts`
    - `packages/core/src/__tests__/editorCore.test.ts`
  - Symbols to update:
    - `SelectionManagerImpl`
    - `DocumentRangeImpl`
    - `getSelectedText()`
    - `getSelectedBlocks()`
    - `replaceSelection()`
    - `deleteSelection()`
  - Outcome:
    - multi-block text ranges are truly first-class in headless core.

- [ ] Keep block-addressed `TextSelection` as the canonical selection shape
  - Package: `@pen/types`
  - Files:
    - `packages/types/src/types/selection.ts`
  - Symbols to preserve:
    - `TextSelection`
    - `BlockSelection`
    - `CellSelection`
  - Outcome:
    - flow mode remains compatible with Pen's existing selection model.

- [ ] Ensure commit events and extension observation remain block-native
  - Package: `@pen/core`
  - Files:
    - `packages/core/src/editor/editor.ts`
    - extension-facing docs/specs as needed
  - Symbols to preserve:
    - `DocumentCommitEvent.affectedBlocks`
    - block revision tracking
  - Outcome:
    - flow mode does not create a split event model.

- [ ] Define flow capability classes in shared schema helpers
  - Package: `@pen/types`
  - Files:
    - `packages/types/src/types/schema.ts`
    - `packages/types/src/types/fieldEditorCapabilities.ts`
  - Symbols to add:
    - `FlowCapability = "flow-inline" | "flow-structural" | "flow-delegated" | "flow-disallowed"`
    - helpers for resolving block flow capability
  - Outcome:
    - mixed-content behavior is derived from a consistent capability model instead of ad hoc renderer checks.

## Phase 3: Flow-Aware Rendering Policy

- [ ] Add flow-mode rendering policy to editor context
  - Package: `@pen/react`
  - Files:
    - `packages/rendering/react/src/context/editorContext.ts`
    - `packages/rendering/react/src/penEditor.tsx`
    - `packages/rendering/react/src/primitives/editor/root.tsx`
  - Outcome:
    - primitives can alter UI behavior based on mode.

- [ ] Add flow-aware behavior to `EditorContent`
  - Package: `@pen/react`
  - Files:
    - `packages/rendering/react/src/primitives/editor/content.tsx`
  - Areas to adjust:
    - click-above / click-below insertion behavior
    - placeholder behavior
    - selection expansion bias
    - range fallback policy
    - mixed-content transitions using flow capability classes
  - Outcome:
    - the editor surface feels more continuous in flow mode.

- [ ] Reduce block chrome in flow mode
  - Package: `@pen/react`
  - Files:
    - `packages/rendering/react/src/primitives/editor/block.tsx`
    - `packages/rendering/react/src/primitives/editor/blockHandle.tsx`
    - relevant renderer components
  - Outcome:
    - drag handles and structural affordances are hidden or minimized by default in flow mode.

- [ ] Add block drag-and-drop view policy and headless custom-handle support
  - Package: `@pen/react`
  - Files:
    - `packages/rendering/react/src/context/editorContext.ts`
    - `packages/rendering/react/src/primitives/editor/root.tsx`
    - `packages/rendering/react/src/primitives/editor/block.tsx`
    - `packages/rendering/react/src/primitives/editor/blockHandle.tsx`
    - `packages/rendering/react/src/primitives/editor/dragOverlay.tsx`
    - `packages/rendering/react/src/hooks/`
  - Areas to adjust:
    - add a root-level `blockDragAndDrop` policy surface
    - resolve structured versus flow defaults from `editorViewMode`
    - centralize drag session state and block-level drop targeting
    - support multi-block drag from canonical `BlockSelection`
    - preserve dragged block order when serializing `move-block` ops
    - keep visible drag controls consumer-owned through `Pen.Editor.BlockHandle` and `useBlockDragHandle()`
    - add a headless hook for consumer-owned drag controls
  - Outcome:
    - structured views expose single-block and multi-block drag-and-drop by default, flow views suppress it by default, and consumers can opt into headless custom handles without forking reorder logic.

- [ ] Make flow mode prefer expanded text surfaces
  - Package: `@pen/react`
  - Files:
    - `packages/rendering/react/src/field-editor/fieldEditorImpl.ts`
    - `packages/rendering/react/src/field-editor/crossBlock.ts`
    - `packages/rendering/react/src/field-editor/selectionBridge.ts`
  - Outcome:
    - adjacent prose-like blocks behave as one writing surface more often.

- [ ] Define and test the mixed-content behavior matrix
  - Package: `@pen/react`
  - Files:
    - `packages/rendering/react/src/field-editor/crossBlock.ts`
    - `packages/rendering/react/src/field-editor/selectionBridge.ts`
    - relevant test files
  - Matrix must cover:
    - `flow-inline`
    - `flow-structural`
    - `flow-delegated`
    - `flow-disallowed`
  - Outcome:
    - selection and fallback rules are deterministic for mixed documents.

## Phase 4: Flow-Aware Commands and Input

- [ ] Add flow-aware command routing
  - Package: `@pen/react`
  - Files:
    - `packages/rendering/react/src/field-editor/commands.ts`
    - `packages/rendering/react/src/field-editor/keyHandling.ts`
  - Areas to adjust:
    - Enter
    - Backspace
    - Arrow navigation
    - select-all behavior
    - behavior at transitions between flow capability classes
  - Outcome:
    - writing interactions feel continuous without changing the underlying ops.

- [ ] Add flow-aware select-all policy
  - Package: `@pen/react`
  - Files:
    - `packages/rendering/react/src/constants/selectAll.ts`
    - `packages/rendering/react/src/field-editor/fieldEditorImpl.ts`
  - Outcome:
    - flow mode prefers whole-document text selection first.

- [ ] Tune slash menu and toolbar defaults for flow mode
  - Package: `@pen/react`
  - Files:
    - toolbar and slash-menu state/components
  - Outcome:
    - prose-oriented formatting and lightweight structure come first.

- [ ] Enforce flow semantics for non-UI mutation paths
  - Packages:
    - `@pen/core`
    - `@pen/document-ops`
  - Files:
    - `packages/core/src/editor/editor.ts`
    - `packages/core/src/editor/apply.ts`
    - document-ops tool entrypoints
  - Mechanisms:
    - profile-aware command/tool policy
    - optional `onBeforeApply` guardrails
  - Outcome:
    - flow profile is respected by AI, tools, importers, and programmatic writes.

## Phase 5: Clipboard, Import, and Export

- [ ] Make clipboard behavior prose-first in flow mode
  - Package: `@pen/react`
  - Files:
    - `packages/rendering/react/src/field-editor/clipboard.ts`
  - Outcome:
    - copying and pasting adjacent text blocks feels natural for writing documents.

- [ ] Tune importers for flow-friendly block shaping
  - Packages:
    - `@pen/extensions/import-html`
    - markdown importer package if present
  - Outcome:
    - imported prose prefers paragraphs/headings/lists over heavier block structures.

- [ ] Make importers explicitly profile-aware
  - Packages:
    - importer packages
    - `@pen/core`
  - Outcome:
    - imports target the active `documentProfile` instead of treating flow as a UI-only concern.

- [ ] Ensure export remains linear and prose-friendly
  - Packages:
    - `@pen/types`
    - `@pen/core`
    - default schema package
  - Outcome:
    - Markdown and HTML export from flow documents read naturally without a second exporter architecture.

- [ ] Make `@pen/document-ops` and AI-facing tools profile-aware
  - Package:
    - `@pen/document-ops`
  - Outcome:
    - tool surfaces do not accidentally produce structured-mode writes inside flow documents.

## Phase 6: Productization

- [ ] Add a flow-mode preset
  - Packages:
    - `@pen/core`
    - `@pen/react`
    - default schema package
  - Possible API shapes:
    - `createEditor({ editorMode: "flow" })`
    - `createFlowEditor()`
  - Outcome:
    - consumers can adopt the simple editor experience with minimal setup.

- [ ] Add playground coverage
  - Package: playground
  - Files:
    - `playground/src/App.tsx`
    - supporting styles/components
  - Outcome:
    - structured mode and flow mode can be compared side by side.

- [ ] Add docs/examples for both modes
  - Package: docs/spec/readme surface
  - Files:
    - `README.md`
    - relevant docs/examples
  - Outcome:
    - Pen's product story is clear: one engine, multiple editing profiles.

## Testing Checklist

- [ ] Add core tests for multi-block replacement and deletion
  - Package: `@pen/core`
  - Files:
    - `packages/core/src/__tests__/editorCore.test.ts`

- [ ] Add renderer tests for flow-mode selection and key behavior
  - Package: `@pen/react`
  - Files:
    - existing field-editor and selection tests
    - `packages/rendering/react/src/__tests__/regionSelection.test.tsx`
    - adjacent key-handling test files

- [ ] Add block drag-and-drop policy tests
  - Package: `@pen/react`
  - Files:
    - editor primitive and interaction test files
  - Cases:
    - structured default enables drag-and-drop
    - flow default disables drag-and-drop
    - explicit `Pen.Editor.BlockHandle` and custom-hook handles both respect the same DnD policy
    - dragging from a selected block drags the full selected block set
    - dragging from an unselected block drags only the initiating block
    - completed single-block and multi-block drags apply `move-block` with `origin: "user"`
    - multi-block reorders preserve document order
    - nested editor roots reject cross-root drag targets
    - image and external drop behavior remains unchanged

- [ ] Add clipboard tests for flow mode
  - Package: `@pen/react`

- [ ] Add importer/exporter tests for prose documents in flow mode
  - Packages:
    - importer packages
    - serializer/export packages

- [ ] Add tests that non-UI writes respect `documentProfile`
  - Packages:
    - `@pen/core`
    - `@pen/document-ops`
  - Cases:
    - direct `editor.apply()`
    - tool-server writes
    - importer writes
    - extension-transformed writes

## High-Risk Files

- [ ] `packages/core/src/editor/selection.ts`
  - Risk:
    - hidden single-block assumptions still exist here

- [ ] `packages/core/src/editor/apply.ts`
  - Risk:
    - multi-block replacement and deletion must stay correct for undo and diagnostics

- [ ] `packages/rendering/react/src/primitives/editor/content.tsx`
  - Risk:
    - many gesture and insertion behaviors still emphasize block boundaries

- [ ] `packages/rendering/react/src/field-editor/fieldEditorImpl.ts`
  - Risk:
    - flow mode likely wants different expansion and select-all bias

- [ ] `packages/rendering/react/src/field-editor/keyHandling.ts`
  - Risk:
    - continuity lives or dies on keyboard feel

## Suggested First Pull Requests

- [ ] PR 1: persisted `documentProfile`, optional `editorViewMode`, and profile metadata loading
  - Packages:
    - `@pen/types`
    - `@pen/core`
    - `@pen/crdt-yjs`

- [ ] PR 2: complete multi-block core selection and replacement semantics
  - Packages:
    - `@pen/core`

- [ ] PR 3: flow capability classes plus flow-aware content and field-editor behavior
  - Packages:
    - `@pen/types`
    - `@pen/react`

- [ ] PR 4: flow-aware commands, non-UI enforcement, clipboard, import/export, and preset
  - Packages:
    - `@pen/core`
    - `@pen/document-ops`
    - `@pen/react`
    - importer/export packages
    - default schema package
    - playground

## Definition Of Done

- [ ] Pen can present the same block-native document as either a structured editor or a flow-oriented editor profile
- [ ] flow mode feels like a simple rich-text editor for prose-oriented documents
- [ ] cross-block text editing is canonical and reliable
- [ ] no second document root or CRDT model was introduced
- [ ] advanced block-native features remain compatible with the same engine
- [ ] flow semantics are enforced consistently across UI, tools, importers, AI writes, and programmatic mutations
