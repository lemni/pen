# Wave 5 — React Rendering Layer

**Milestone:** M0 · **Package:** `@pen/react` · **Depends on:** Waves 0-4

---

## Goal

Implement the full React rendering layer: editor primitives, the field editor with its dual-backend input strategy, hooks, toolbar, slash menu, clipboard pipeline, and block renderers. After this wave, Pen is a usable editor in the browser.

**This is the highest-risk wave.** The field editor dual-backend, IME handling, DOM-CRDT reconciler, and cross-block selection are the hardest pieces in the entire project. Budget 3-4x the time of any other wave.

---

## File Structure

```
packages/react/src/
├── context/
│   ├── editor-context.ts        React context for Editor instance
│   ├── field-editor-context.ts  React context for FieldEditor state
│   └── toolbar-context.ts       React context for toolbar state
├── primitives/
│   ├── editor/
│   │   ├── root.tsx             Pen.Editor.Root — top-level context provider
│   │   ├── content.tsx          Pen.Editor.Content — block list + field editor host
│   │   ├── block.tsx            Pen.Editor.Block — single block wrapper
│   │   ├── inline-content.tsx   Pen.Editor.InlineContent — Y.Text render target
│   │   ├── block-handle.tsx     Pen.Editor.BlockHandle — drag handle
│   │   ├── drag-overlay.tsx     Pen.Editor.DragOverlay — drag ghost
│   │   ├── selection-rect.tsx   Pen.Editor.SelectionRect — block selection overlay
│   │   ├── field-editor.tsx     Pen.Editor.FieldEditor — field editor wrapper
│   │   └── index.ts             Barrel
│   ├── toolbar/
│   │   ├── root.tsx             Pen.Toolbar.Root
│   │   ├── group.tsx            Pen.Toolbar.Group
│   │   ├── button.tsx           Pen.Toolbar.Button
│   │   ├── toggle.tsx           Pen.Toolbar.Toggle
│   │   ├── select.tsx           Pen.Toolbar.Select
│   │   ├── separator.tsx        Pen.Toolbar.Separator
│   │   └── index.ts             Barrel
│   ├── slash-menu/
│   │   ├── root.tsx             Pen.SlashMenu.Root
│   │   ├── input.tsx            Pen.SlashMenu.Input
│   │   ├── list.tsx             Pen.SlashMenu.List
│   │   ├── group.tsx            Pen.SlashMenu.Group
│   │   ├── item.tsx             Pen.SlashMenu.Item
│   │   ├── empty.tsx            Pen.SlashMenu.Empty
│   │   └── index.ts             Barrel
│   └── index.ts                 Namespace barrel (Pen.Editor.*, Pen.Toolbar.*, Pen.SlashMenu.*)
├── field-editor/
│   ├── field-editor-impl.ts     FieldEditorImpl — lifecycle, activation, delegation
│   ├── edit-context-backend.ts  EditContextBackend (Chromium 133+)
│   ├── contenteditable-backend.ts ContentEditableBackend (fallback)
│   ├── reconciler.ts            CRDT→DOM incremental reconciler
│   ├── selection-bridge.ts      DOM↔CRDT selection mapping
│   ├── mark-boundary.ts         InlineSchema.expand enforcement
│   ├── cross-block.ts           Cross-block expansion/contraction
│   └── clipboard.ts             Copy/cut/paste pipeline
├── hooks/
│   ├── use-editor.ts            useEditor() — create/wrap editor instance
│   ├── use-field-editor.ts      useFieldEditor() — field editor state
│   ├── use-selection.ts         useSelection() — current SelectionState
│   ├── use-decorations.ts       useDecorations() — merged DecorationSet
│   ├── use-extension-state.ts   useExtensionState() — extension state subscription
│   ├── use-toolbar.ts           useToolbar() — toolbar context (active marks, block type)
│   ├── use-slash-menu.ts        useSlashMenu() — slash menu state
│   ├── use-block-list.ts        useBlockList() — block ID array subscription
│   ├── use-visual-viewport.ts   useVisualViewport() — visual viewport dimensions (mobile keyboard-aware)
│   └── index.ts                 Barrel
├── renderers/
│   ├── paragraph.tsx
│   ├── heading.tsx
│   ├── bullet-list-item.tsx
│   ├── numbered-list-item.tsx
│   ├── check-list-item.tsx
│   ├── code-block.tsx
│   ├── image.tsx
│   ├── table.tsx
│   ├── divider.tsx
│   ├── callout.tsx
│   ├── toggle.tsx
│   ├── blockquote.tsx
│   ├── default-renderer.tsx     Fallback for unknown block types
│   └── index.ts                 Renderer registry (type → component map)
├── utils/
│   ├── as-child.ts              asChild composition utility
│   ├── compose-refs.ts          Ref merging utility
│   ├── data-attributes.ts       data-* attribute helpers
│   └── use-sync-external-store-with-selector.ts
├── pen-editor.tsx               PenEditor convenience component
└── index.ts                     Package entry
```

### Import DAG (top-level)

```
context/*           ← (@pen/core types)
utils/*             ← (react)
hooks/*             ← context/*, (@pen/core), (react)
field-editor/*      ← context/*, hooks/*, utils/*, (@pen/core), (yjs)
renderers/*         ← context/*, hooks/*, utils/*, (@pen/core)
primitives/*        ← context/*, hooks/*, field-editor/*, renderers/*, utils/*
pen-editor.tsx      ← primitives/*
index.ts            ← pen-editor.tsx, primitives/*, hooks/*
```

No cycles. `field-editor/` depends on `@pen/core` and `yjs` for CRDT operations. Renderers depend on context and hooks only. Primitives compose everything.

---

## Sub-wave 5a: Editor Primitives & Context

### Module: `context/editor-context.ts`

```typescript
import { createContext, useContext } from 'react';
import type { Editor } from '@pen/types';

interface EditorContextValue {
  editor: Editor;
  readonly: boolean;
}

export const EditorContext = createContext<EditorContextValue | null>(null);

export function useEditorContext(): EditorContextValue {
  const ctx = useContext(EditorContext);
  if (!ctx) {
    if (process.env.NODE_ENV !== 'production') {
      console.error(
        'Pen: useEditorContext must be used within <Pen.Editor.Root>. ' +
        'Wrap your editor components in <Pen.Editor.Root editor={editor}>.',
      );
    }
    throw new Error('Missing Pen.Editor.Root context');
  }
  return ctx;
}
```

Development-mode diagnostics: `console.error` with actionable message before throwing.

### Module: `context/field-editor-context.ts`

```typescript
import { createContext, useContext } from 'react';
import type { FieldEditor } from '@pen/types';

export const FieldEditorContext = createContext<FieldEditor | null>(null);

export function useFieldEditorContext(): FieldEditor | null {
  return useContext(FieldEditorContext);
}
```

`FieldEditorContext` is nullable — it's only populated when the field editor is active.

### Module: `utils/as-child.ts`

The `asChild` composition utility. When `asChild` is `true`, the primitive merges its props, ref, and event handlers onto its single child element instead of rendering a wrapper.

```typescript
import React from 'react';
import { composeRefs } from './compose-refs.js';

interface AsChildProps {
  asChild?: boolean;
  children?: React.ReactNode;
}

export function renderAsChild<P extends Record<string, unknown>>(
  props: P & AsChildProps & { ref?: React.Ref<HTMLElement> },
  defaultTag: keyof React.JSX.IntrinsicElements,
  primitiveProps: Record<string, unknown>,
): React.ReactElement {
  const { asChild, children, ref, ...restProps } = props;

  if (asChild && React.isValidElement(children)) {
    const child = React.Children.only(children) as React.ReactElement<any>;
    return React.cloneElement(child, {
      ...primitiveProps,
      ...restProps,
      ...child.props,
      ref: composeRefs(ref, (child as { ref?: React.Ref<unknown> }).ref),
    });
  }

  return React.createElement(
    defaultTag,
    { ...primitiveProps, ...restProps, ref },
    children,
  );
}
```

### Module: `utils/compose-refs.ts`

```typescript
import type { Ref, MutableRefObject } from 'react';

export function composeRefs<T>(
  ...refs: (Ref<T> | undefined | null)[]
): (node: T | null) => void {
  return (node) => {
    for (const ref of refs) {
      if (!ref) continue;
      if (typeof ref === 'function') {
        ref(node);
      } else {
        (ref as MutableRefObject<T | null>).current = node;
      }
    }
  };
}
```

### Primitive: `Pen.Editor.Root`

```typescript
interface EditorRootProps {
  editor: Editor;
  readonly?: boolean;
  children: React.ReactNode;
  asChild?: boolean;
  importers?: PasteImporters;
}

interface PasteImporters {
  html?: { import(input: string, editor: Editor, options?: { undoGroup?: boolean; position?: import('@pen/types').Position }): void };
  markdown?: { import(input: string, editor: Editor, options?: { undoGroup?: boolean; position?: import('@pen/types').Position }): void };
}

// Data attributes:
// [data-pen-editor-root]
// [data-focused]       - editor has focus
// [data-readonly]      - editor is in read-only mode
// [data-empty]         - document has no content blocks
```

**Implementation outline:**

1. Provides `EditorContext` with editor instance, `readonly` flag, and `importers`.
2. Subscribes to editor focus/blur events for `data-focused`.
3. Subscribes to `editor.documentState.blockOrder` for `data-empty` (length === 0 or all blocks empty).
4. Forwards ref to the root DOM element (default: `<div>`).
5. Sets `role="textbox"`, `aria-multiline="true"` on the root element.
6. All children receive editor context automatically.
7. `importers` are stored on the editor via `editor.internals.setSlot('paste:importers', importers)` so the paste handler can retrieve them without threading through React context. If no importers are provided, pasting HTML or Markdown is a no-op (the lossless `application/x-pen-blocks` format still works). This eliminates the implicit dependency on `@pen/import-html` and `@pen/import-markdown`.

### Primitive: `Pen.Editor.Content`

```typescript
interface EditorContentProps {
  virtualize?: boolean | { overscan?: number; estimatedHeight?: number };
  children?: React.ReactNode;
  asChild?: boolean;
}

// Data attributes:
// [data-pen-editor-content]
// [data-empty]
```

**Implementation outline:**

1. Reads `EditorContext` to access the editor.
2. Subscribes to `editor.on('documentChange')` to get the block list.
3. Renders the block list: maps `blockOrder` IDs to `<Pen.Editor.Block>` instances.
4. Hosts the `FieldEditorContext.Provider` — the field editor lives here.
5. **Virtualization (opt-in):** When `virtualize` is truthy, uses `IntersectionObserver` to mount/unmount blocks outside the viewport + overscan buffer. Placeholder divs with cached heights maintain scroll position. Default: off for <100 blocks, on above.
6. **Block rendering:** For each block ID, resolves the block type from the CRDT, looks up the renderer from the renderer registry, and renders `<Pen.Editor.Block>` with the correct renderer.

### Primitive: `Pen.Editor.Block`

```typescript
interface EditorBlockProps {
  blockId: string;
  children?: React.ReactNode;
  asChild?: boolean;
}

// Data attributes:
// [data-pen-editor-block]
// [data-block-id]         - the block's ID
// [data-block-type]       - the block's schema type
// [data-selected]         - block is in the current selection
// [data-ai-generating]    - AI is streaming into this block
```

**Implementation outline:**

1. Reads `EditorContext` and `FieldEditorContext`.
2. Creates a `BlockHandle` for this block.
3. Builds `BlockRenderContext`: `{ editable, selected, decorations, ref }`.
4. `editable` is `true` when the field editor is active for this block.
5. `selected` is `true` when this block is part of the current `BlockSelection` or `TextSelection`.
6. Calls the registered `BlockRenderer` with the handle and context.
7. Registers a `ResizeObserver` on the block element for virtualization height tracking.

### Primitive: `Pen.Editor.InlineContent`

```typescript
interface InlineContentProps {
  blockId: string;
  placeholder?: string;
  asChild?: boolean;
}

// Data attributes:
// [data-pen-inline-content]
// [data-placeholder-visible]  - block content is empty, showing placeholder
```

**Implementation outline:**

1. This is the field editor's **mount target**. When the field editor activates for this block, it attaches its input backend (EditContext or contenteditable) to this element.
2. When the field editor is NOT active (block at rest), renders the Y.Text content as static HTML. The reconciler (see 5b) converts `Y.Text.toDelta()` into a DOM tree with marks nested by priority.
3. Placeholder text renders when the block's `Y.Text` is empty (or contains only `\u200B`).
4. The element receives a ref that the field editor captures on activation.

### Primitive: `Pen.Editor.FieldEditor`

```typescript
interface FieldEditorProps {
  children?: React.ReactNode;
  asChild?: boolean;
}

// Data attributes:
// [data-pen-field-editor]
// [data-active]          - field editor is currently active
// [data-input-mode]      - 'keyboard' | 'ime' | 'voice' | 'ai-stream'
// [data-streaming]       - AI streaming is active
// [data-expanded]        - cross-block expansion is active
// [data-block-count]     - number of blocks in expanded range
```

Wrapper component that exposes field editor state via data attributes. Does not render content — it wraps the content area.

### Primitive: `PenEditor`

Convenience sugar:

```typescript
export function PenEditor({ editor, readonly, importers, ...props }: PenEditorProps) {
  return (
    <EditorRoot editor={editor} readonly={readonly} importers={importers}>
      <EditorContent {...props} />
    </EditorRoot>
  );
}
```

### Other Primitives

**`Pen.Editor.BlockHandle`** — drag handle. Renders a grabbable element per block. Sets `data-dragging` during drag. Implements HTML5 drag-and-drop for block reordering.

**`Pen.Editor.DragOverlay`** — ghost element during drag. Client-only (SSR renders null). Follows the pointer with a translucent clone of the dragged block.

**`Pen.Editor.SelectionRect`** — visual overlay for block selection. Renders a rectangle covering selected blocks. Sets `data-selecting` during active selection gestures.

---

## Sub-wave 5b: Field Editor — The Hard Part

### Module: `field-editor/field-editor-impl.ts`

The `FieldEditorImpl` manages the field editor lifecycle. It is NOT a React component — it is a framework-agnostic behavioral controller instantiated once per editor. React hooks observe its state.

```typescript
import type {
  FieldEditor, Editor, BlockSchema, SelectionState,
  Unsubscribe, InputBackend,
} from '@pen/types';

export class FieldEditorImpl implements FieldEditor {
  private _activeBlockId: string | null = null;
  private _activeBlockIds: string[] = [];
  private _isEditing = false;
  private _selection: SelectionState = null;
  private _inputMode: 'keyboard' | 'ime' | 'voice' | 'ai-stream' = 'keyboard'; // input method; distinct from FieldEditor.inputMode ('richtext'|'code'|'table'|'none') which describes editing mode
  private _backend: InputBackend | null = null;
  private _editor: Editor;
  private _activateListeners = new Set<(blockIds: string[]) => void>();
  private _deactivateListeners = new Set<(blockIds: string[]) => void>();
  private _selectionListeners = new Set<(sel: SelectionState) => void>();

  constructor(editor: Editor) {
    this._editor = editor;
  }

  get activeBlockId(): string | null { return this._activeBlockId; }
  get activeBlockIds(): readonly string[] { return this._activeBlockIds; }
  get isEditing(): boolean { return this._isEditing; }
  get selection(): SelectionState { return this._selection; }
  get inputMode() { return this._inputMode; }
  get delegate(): BlockSchema | null {
    if (!this._activeBlockId) return null;
    return this._editor.schema.resolve(
      this._editor.getBlock(this._activeBlockId).type,
    );
  }

  activate(blockId: string): void {
    if (this._activeBlockId === blockId) return;
    if (this._isEditing) this.deactivate();

    const block = this._editor.getBlock(blockId);
    if (!block) return;

    const schema = this._editor.schema.resolve(block.type);
    if (schema?.fieldEditor === 'none') return;

    this._activeBlockId = blockId;
    this._activeBlockIds = [blockId];
    this._isEditing = true;

    this._backend = this.createBackend();
    // Backend activation happens when the React layer provides the DOM element
    // via attachElement(). See content.tsx.

    for (const cb of this._activateListeners) cb([blockId]);
  }

  deactivate(): void {
    if (!this._isEditing) return;

    const blockIds = [...this._activeBlockIds];
    this._backend?.deactivate();
    this._backend = null;

    this._activeBlockId = null;
    this._activeBlockIds = [];
    this._isEditing = false;
    this._selection = null;

    for (const cb of this._deactivateListeners) cb(blockIds);
  }

  attachElement(element: HTMLElement, blockId: string): void {
    if (!this._backend || this._activeBlockId !== blockId) return;

    const adapter = this._editor.internals.adapter;
    const doc = this._editor.internals.crdtDoc;
    const ydoc = adapter.raw(doc);
    const blockMap = ydoc.getMap('blocks').get(blockId);
    const ytext = blockMap?.get('content');
    if (!ytext) return;

    this._backend.activate(element, ytext);
  }

  // ── Cross-block expansion ────────────────────────────────

  expandTo(blockId: string): void {
    if (!this._isEditing) return;
    if (this._activeBlockIds.includes(blockId)) return;

    const doc = this._editor.documentState;
    const startIdx = this.getBlockIndex(this._activeBlockIds[0]);
    const endIdx = this.getBlockIndex(blockId);
    if (startIdx < 0 || endIdx < 0) return;

    const low = Math.min(startIdx, endIdx);
    const high = Math.max(startIdx, endIdx);
    const blockIds: string[] = [];
    for (let i = low; i <= high; i++) {
      blockIds.push(doc.blockOrder.get(i) as string);
    }

    this._activeBlockIds = blockIds;
    for (const cb of this._activateListeners) cb(blockIds);
  }

  contractToFocused(): void {
    if (this._activeBlockIds.length <= 1) return;
    const focused = this._activeBlockId;
    if (!focused) return;
    this._activeBlockIds = [focused];
    for (const cb of this._activateListeners) cb([focused]);
  }

  // ── Events ───────────────────────────────────────────────

  onActivate(cb: (blockIds: string[]) => void): Unsubscribe {
    this._activateListeners.add(cb);
    return () => this._activateListeners.delete(cb);
  }

  onDeactivate(cb: (blockIds: string[]) => void): Unsubscribe {
    this._deactivateListeners.add(cb);
    return () => this._deactivateListeners.delete(cb);
  }

  onSelectionChange(cb: (sel: SelectionState) => void): Unsubscribe {
    this._selectionListeners.add(cb);
    return () => this._selectionListeners.delete(cb);
  }

  // ── Internal ─────────────────────────────────────────────

  private createBackend(): InputBackend {
    if ('EditContext' in globalThis) {
      return new EditContextBackend(this._editor, this);
    }
    return new ContentEditableBackend(this._editor, this);
  }

  private getBlockIndex(blockId: string): number {
    const doc = this._editor.documentState;
    for (let i = 0; i < doc.blockOrder.length; i++) {
      if (doc.blockOrder[i] === blockId) return i;
    }
    return -1;
  }
}
```

### Module: `field-editor/edit-context-backend.ts`

The EditContext backend (Chromium 133+, Android Chrome 144+). Decouples text input from DOM entirely.

```typescript
import type { InputBackend, Editor } from '@pen/types';
import type { FieldEditorImpl } from './field-editor-impl.js';

declare class EditContext {
  constructor(options?: { text?: string; selectionStart?: number; selectionEnd?: number });
  updateText(start: number, end: number, text: string): void;
  updateSelection(start: number, end: number): void;
  addEventListener(type: string, handler: (event: unknown) => void): void;
  removeEventListener(type: string, handler: (event: unknown) => void): void;
  readonly text: string;
}

export class EditContextBackend implements InputBackend {
  private editContext: EditContext | null = null;
  private element: HTMLElement | null = null;
  private ytext: any = null;
  private observer: any = null;
  private editor: Editor;
  private fieldEditor: FieldEditorImpl;

  constructor(editor: Editor, fieldEditor: FieldEditorImpl) {
    this.editor = editor;
    this.fieldEditor = fieldEditor;
  }

  activate(element: HTMLElement, ytext: unknown): void {
    this.element = element;
    this.ytext = ytext;

    this.editContext = new EditContext({
      text: this.ytext.toString(),
      selectionStart: 0,
      selectionEnd: 0,
    });

    (element as HTMLElement & { editContext: EditContext | null }).editContext = this.editContext;

    this.editContext.addEventListener('textupdate', this.handleTextUpdate);
    this.editContext.addEventListener('textformatupdate', this.handleTextFormatUpdate);
    this.editContext.addEventListener('characterboundsupdate', this.handleCharacterBoundsUpdate);

    this.observer = this.ytext.observe(
      (event: any) => this.handleYTextChange(event),
    );

    fullReconcileToDOM(this.ytext, element, this.editor.schema);
  }

  deactivate(): void {
    if (this.editContext) {
      this.editContext.removeEventListener('textupdate', this.handleTextUpdate);
      this.editContext.removeEventListener('textformatupdate', this.handleTextFormatUpdate);
      this.editContext.removeEventListener('characterboundsupdate', this.handleCharacterBoundsUpdate);
    }
    if (this.observer && this.ytext) {
      this.ytext.unobserve(this.observer);
    }
    if (this.element) {
      (this.element as HTMLElement & { editContext: EditContext | null }).editContext = null;
    }
    this.editContext = null;
    this.element = null;
    this.ytext = null;
    this.observer = null;
  }

  updateSelection(relPos: unknown): void {
    // Convert Y.RelativePosition to absolute offset, update EditContext selection
    if (!this.editContext) return;
    // Implementation: Y.createAbsolutePositionFromRelativePosition(relPos, ydoc)
  }

  private handleTextUpdate = (event: any): void => {
    const { updateRangeStart, updateRangeEnd, text } = event;
    const blockId = this.fieldEditor.activeBlockId;
    if (!blockId) return;

    const block = this.editor.getBlock(blockId);
    if (!block) {
      this.fieldEditor.deactivate();
      return;
    }

    this.editor.internals.adapter.transact(
      this.editor.internals.crdtDoc,
      () => {
        if (updateRangeEnd > updateRangeStart) {
          this.ytext.delete(updateRangeStart, updateRangeEnd - updateRangeStart);
        }
        if (text.length > 0) {
          const marks = this.resolveActiveMarks(updateRangeStart);
          this.ytext.insert(updateRangeStart, text, marks);
        }
      },
      'user',
    );
  };

  private handleTextFormatUpdate = (_event: any): void => {
    // IME underline rendering — update decorations for composition visualization
  };

  private handleCharacterBoundsUpdate = (_event: any): void => {
    // IME candidate window positioning — provide character geometries
  };

  private handleYTextChange = (event: any): void => {
    if (!this.editContext || !this.element) return;

    // Incrementally update the EditContext text buffer using the delta
    // instead of replacing the entire buffer on every keystroke.
    const delta = event.delta as { retain?: number; insert?: string; delete?: number }[];
    let offset = 0;
    for (const entry of delta) {
      if (entry.retain != null) {
        offset += entry.retain;
      } else if (typeof entry.insert === 'string') {
        this.editContext.updateText(offset, offset, entry.insert);
        offset += entry.insert.length;
      } else if (entry.delete != null) {
        this.editContext.updateText(offset, offset + entry.delete, '');
      }
    }

    // Reconcile DOM using the event delta (fast path).
    // Falls back to full reconciliation on structural mark changes.
    const applied = applyDeltaToDOM(event.delta, this.element, this.editor.schema);
    if (!applied) {
      fullReconcileToDOM(this.ytext, this.element, this.editor.schema);
    }
  };

  private resolveActiveMarks(offset: number): Record<string, unknown> | undefined {
    return resolveMarksAtPosition(
      this.ytext,
      offset,
      this.editor.schema,
    );
  }
}
```

### Module: `field-editor/contenteditable-backend.ts`

The ContentEditable backend (Firefox, Safari, older browsers). Three-mode input strategy.

**Mode 1 (Direct):** `beforeinput` with `preventDefault()` for recognized `inputType` values.

**Mode 2 (Composition):** During IME, let browser mutate DOM. On `compositionend`, diff DOM against Y.Text.

**Mode 3 (Observation):** `MutationObserver` fallback for unrecognized inputs or Safari edge cases.

```typescript
import type { InputBackend, Editor } from '@pen/types';
import type { FieldEditorImpl } from './field-editor-impl.js';

export class ContentEditableBackend implements InputBackend {
  private element: HTMLElement | null = null;
  private ytext: any = null;
  private observer: any = null;
  private mutationObserver: MutationObserver | null = null;
  private isComposing = false;
  private editor: Editor;
  private fieldEditor: FieldEditorImpl;

  constructor(editor: Editor, fieldEditor: FieldEditorImpl) {
    this.editor = editor;
    this.fieldEditor = fieldEditor;
  }

  activate(element: HTMLElement, ytext: unknown): void {
    this.element = element;
    this.ytext = ytext;

    element.contentEditable = 'true';

    element.addEventListener('beforeinput', this.handleBeforeInput);
    element.addEventListener('compositionstart', this.handleCompositionStart);
    element.addEventListener('compositionend', this.handleCompositionEnd);
    element.addEventListener('keydown', this.handleKeyDown);

    this.mutationObserver = new MutationObserver(this.handleMutations);
    this.mutationObserver.observe(element, {
      childList: true,
      subtree: true,
      characterData: true,
      characterDataOldValue: true,
    });

    this.observer = this.ytext.observe(
      (event: any) => this.handleYTextChange(event),
    );

    fullReconcileToDOM(this.ytext, element, this.editor.schema);
  }

  deactivate(): void {
    if (this.element) {
      this.element.contentEditable = 'false';
      this.element.removeEventListener('beforeinput', this.handleBeforeInput);
      this.element.removeEventListener('compositionstart', this.handleCompositionStart);
      this.element.removeEventListener('compositionend', this.handleCompositionEnd);
      this.element.removeEventListener('keydown', this.handleKeyDown);
    }
    if (this.mutationObserver) {
      this.mutationObserver.disconnect();
      this.mutationObserver = null;
    }
    if (this.observer && this.ytext) {
      this.ytext.unobserve(this.observer);
    }
    this.element = null;
    this.ytext = null;
    this.observer = null;
  }

  updateSelection(_relPos: unknown): void {
    // Update contenteditable selection from CRDT relative position
  }

  // ── Mode 1: Direct ────────────────────────────────────────

  private handleBeforeInput = (event: InputEvent): void => {
    if (this.isComposing) return; // Mode 2 handles this

    const blockId = this.fieldEditor.activeBlockId;
    if (!blockId || !this.editor.getBlock(blockId)) {
      this.fieldEditor.deactivate();
      return;
    }

    const inputType = event.inputType;
    const handler = DIRECT_HANDLERS[inputType];

    if (handler) {
      event.preventDefault();
      handler(event, this.editor, this.ytext, this.fieldEditor);
      return;
    }

    // Unrecognized inputType → Mode 3 (let mutation observer handle it)
  };

  // ── Mode 2: Composition ───────────────────────────────────

  private handleCompositionStart = (): void => {
    this.isComposing = true;
  };

  private handleCompositionEnd = (): void => {
    this.isComposing = false;

    if (!this.element || !this.ytext) return;

    const domText = extractTextFromDOM(this.element);
    const crdtText = this.ytext.toString();

    if (domText !== crdtText) {
      const diff = computeTextDiff(crdtText, domText);
      this.editor.internals.adapter.transact(
        this.editor.internals.crdtDoc,
        () => {
          for (const op of diff) {
            if (op.type === 'delete') {
              this.ytext.delete(op.offset, op.length);
            } else if (op.type === 'insert') {
              const marks = resolveMarksAtPosition(
                this.ytext, op.offset, this.editor.schema,
              );
              this.ytext.insert(op.offset, op.text, marks);
            }
          }
        },
        'user',
      );
    }
  };

  // ── Mode 3: Observation ───────────────────────────────────

  private handleMutations = (mutations: MutationRecord[]): void => {
    if (this.isComposing) return;

    // Same diff strategy as Mode 2, triggered by DOM mutations
    // for unrecognized input types
    if (!this.element || !this.ytext) return;

    const domText = extractTextFromDOM(this.element);
    const crdtText = this.ytext.toString();

    if (domText !== crdtText) {
      const diff = computeTextDiff(crdtText, domText);
      this.editor.internals.adapter.transact(
        this.editor.internals.crdtDoc,
        () => {
          for (const op of diff) {
            if (op.type === 'delete') {
              this.ytext.delete(op.offset, op.length);
            } else if (op.type === 'insert') {
              const marks = resolveMarksAtPosition(
                this.ytext, op.offset, this.editor.schema,
              );
              this.ytext.insert(op.offset, op.text, marks);
            }
          }
        },
        'user',
      );
    }
  };

  // ── CRDT→DOM reconciliation ───────────────────────────────

  private handleYTextChange = (event: any): void => {
    if (this.isComposing) return; // Don't reconcile during composition
    if (!this.element || !this.ytext) return;

    // Fast path: apply the incremental delta directly to the DOM.
    const applied = applyDeltaToDOM(event.delta, this.element, this.editor.schema);
    if (!applied) {
      // Fallback: full reconciliation with selection preservation.
      // saveSelection returns (blockId, characterOffset) pairs — not live DOM nodes —
      // so the saved state survives the full DOM replacement below.
      const savedSelection = saveSelection(this.element);
      fullReconcileToDOM(this.ytext, this.element, this.editor.schema);
      restoreSelection(this.element, savedSelection);
    }
  };

  private handleKeyDown = (event: KeyboardEvent): void => {
    // Route keyboard shortcuts to editor key bindings
    const bindings = this.editor.schema.collectKeyBindings?.() ?? [];
    for (const binding of bindings) {
      if (matchesKey(binding.key, event)) {
        if (binding.handler(this.editor)) {
          event.preventDefault();
          return;
        }
      }
    }
  };
}

const DIRECT_HANDLERS: Record<
  string,
  (event: InputEvent, editor: Editor, ytext: any, fe: FieldEditorImpl) => void
> = {
  insertText: (event, editor, ytext, fe) => {
    const text = event.data ?? '';
    if (!text) return;
    const range = getSelectionOffsets(fe);
    if (!range) return;

    editor.internals.adapter.transact(editor.internals.crdtDoc, () => {
      if (range.start !== range.end) {
        ytext.delete(range.start, range.end - range.start);
      }
      const marks = resolveMarksAtPosition(ytext, range.start, editor.schema);
      ytext.insert(range.start, text, marks);
    }, 'user');
  },

  deleteContentBackward: (_event, editor, ytext, fe) => {
    const range = getSelectionOffsets(fe);
    if (!range) return;

    editor.internals.adapter.transact(editor.internals.crdtDoc, () => {
      if (range.start !== range.end) {
        ytext.delete(range.start, range.end - range.start);
      } else if (range.start > 0) {
        ytext.delete(range.start - 1, 1);
      }
    }, 'user');
  },

  deleteContentForward: (_event, editor, ytext, fe) => {
    const range = getSelectionOffsets(fe);
    if (!range) return;

    editor.internals.adapter.transact(editor.internals.crdtDoc, () => {
      if (range.start !== range.end) {
        ytext.delete(range.start, range.end - range.start);
      } else if (range.start < ytext.length) {
        ytext.delete(range.start, 1);
      }
    }, 'user');
  },

  insertParagraph: (_event, editor, _ytext, fe) => {
    const blockId = fe.activeBlockId;
    if (!blockId) return;
    // Split block at cursor position via editor.apply()
    editor.apply([{ type: 'split-block', blockId, offset: getCaretOffset(fe) }]);
  },

  historyUndo: (_event, editor) => {
    editor.undo();
  },

  historyRedo: (_event, editor) => {
    editor.redo();
  },

  insertFromPaste: (event, editor, _ytext, fe) => {
    handlePaste(event, editor, fe, editor.internals.getSlot<PasteImporters>('paste:importers') ?? undefined);
  },
};
```

### Module: `field-editor/reconciler.ts`

The CRDT→DOM reconciler. One-way: always CRDT → DOM. Never DOM → CRDT (that's the input backend's job).

**Dual-mode design.** Yjs's `Y.Text.observe()` passes a `Y.YTextEvent` to the callback. The event's `.delta` property contains the *incremental* change — e.g., `[{ retain: 42 }, { insert: 'x' }]` for a single character insert at position 42. The reconciler uses this delta to patch only the affected DOM nodes (the **fast path**). When the fast path cannot handle a change — mark nesting restructuring, initial activation, or composition end — it falls back to a **full reconciliation** that re-reads the entire Y.Text.

This makes the common case (typing, backspace, remote character insert) O(changed_spans) instead of O(total_spans). For a paragraph with 12 mark spans, a single character insert touches exactly 1 text node.

```typescript
import type { SchemaRegistry } from '@pen/types';
import { sortDeltaAttributes } from '@pen/core';

// ── Fast path: event-driven delta application ──────────────

export function applyDeltaToDOM(
  delta: readonly { retain?: number; insert?: string; delete?: number;
                    attributes?: Record<string, unknown> }[],
  element: HTMLElement,
  registry: SchemaRegistry,
): boolean {
  // Returns true if delta was applied successfully, false if fallback needed.
  //
  // DOM model: element.childNodes is a flat list of either:
  //   - Text nodes (plain text, no marks)
  //   - Element wrappers (mark hierarchy containing a single leaf Text node)
  //
  // The walker tracks a (childIndex, textOffset) cursor into this flat list.
  // Each "span" is one childNode with its total text length.

  let childIndex = 0;
  let textOffset = 0;

  for (const entry of delta) {
    if (entry.retain != null) {
      // Advance cursor by `retain` characters.
      let remaining = entry.retain;
      while (remaining > 0 && childIndex < element.childNodes.length) {
        const span = element.childNodes[childIndex];
        const spanText = span.textContent ?? '';
        const available = spanText.length - textOffset;

        if (remaining < available) {
          textOffset += remaining;
          remaining = 0;
        } else {
          remaining -= available;
          childIndex++;
          textOffset = 0;
        }
      }
      if (remaining > 0) return false; // cursor overran DOM — bail

      // If the retain entry also carries attributes, this is a format-text
      // change. Check whether it requires restructuring.
      if (entry.attributes != null) {
        return false; // format changes restructure mark wrappers — use fallback
      }
    }

    else if (typeof entry.insert === 'string') {
      const text = entry.insert;

      if (!entry.attributes) {
        // Plain text insert — splice into the current text node or create one.
        const span = element.childNodes[childIndex];
        if (span && span.nodeType === Node.TEXT_NODE) {
          const existing = span.textContent ?? '';
          span.textContent =
            existing.slice(0, textOffset) + text + existing.slice(textOffset);
          textOffset += text.length;
        } else if (span && span.nodeType === Node.ELEMENT_NODE) {
          // Cursor is inside a mark wrapper — find the leaf text node.
          const leaf = deepLeafText(span);
          if (!leaf) return false;
          const existing = leaf.textContent ?? '';
          leaf.textContent =
            existing.slice(0, textOffset) + text + existing.slice(textOffset);
          textOffset += text.length;
        } else {
          // Past the end of children — append a new text node.
          element.appendChild(document.createTextNode(text));
          childIndex = element.childNodes.length - 1;
          textOffset = text.length;
        }
      } else {
        // Attributed insert — create a new wrapped node and insert at position.
        const sorted = sortDeltaAttributes(entry.attributes, registry);
        let node: Node = document.createTextNode(text);
        node = wrapWithMarks(node, sorted, registry);

        if (textOffset === 0) {
          // At the start of a span boundary — insert before current child.
          const ref = element.childNodes[childIndex] ?? null;
          element.insertBefore(node, ref);
          childIndex++;
        } else {
          // Mid-span: must split the current span, insert between halves.
          // This restructures the local span — bail to fallback.
          return false;
        }
      }
    }

    else if (entry.delete != null) {
      let remaining = entry.delete;
      while (remaining > 0 && childIndex < element.childNodes.length) {
        const span = element.childNodes[childIndex];
        const leaf = span.nodeType === Node.TEXT_NODE
          ? span : deepLeafText(span);
        if (!leaf) return false;
        const existing = leaf.textContent ?? '';
        const available = existing.length - textOffset;

        if (remaining < available) {
          // Partial delete within this span.
          leaf.textContent =
            existing.slice(0, textOffset) + existing.slice(textOffset + remaining);
          remaining = 0;
        } else {
          if (textOffset === 0) {
            // Delete the entire span node.
            element.removeChild(span);
            remaining -= existing.length;
            // childIndex stays — next child shifted into position.
          } else {
            // Delete from textOffset to end of this span.
            leaf.textContent = existing.slice(0, textOffset);
            remaining -= available;
            childIndex++;
            textOffset = 0;
          }
        }
      }
    }
  }
  return true;
}

function deepLeafText(node: Node): Text | null {
  if (node.nodeType === Node.TEXT_NODE) return node as Text;
  for (let i = 0; i < node.childNodes.length; i++) {
    const found = deepLeafText(node.childNodes[i]);
    if (found) return found;
  }
  return null;
}

// ── Full reconciliation fallback ───────────────────────────

export function fullReconcileToDOM(
  ytext: any,
  element: HTMLElement,
  registry: SchemaRegistry,
): void {
  const deltas = ytext.toDelta();
  const orderedDeltas = deltas.map((d: any) => {
    if (!d.attributes || Object.keys(d.attributes).length < 2) return d;
    return { ...d, attributes: sortDeltaAttributes(d.attributes, registry) };
  });

  const savedSelection = saveSelection(element);

  const fragment = document.createDocumentFragment();
  for (const delta of orderedDeltas) {
    if (typeof delta.insert !== 'string') continue;
    let node: Node = document.createTextNode(delta.insert);
    if (delta.attributes) {
      node = wrapWithMarks(node, delta.attributes, registry);
    }
    fragment.appendChild(node);
  }

  patchDOM(element, fragment);
  restoreSelection(element, savedSelection);
}

// ── Shared helpers ─────────────────────────────────────────

function wrapWithMarks(
  node: Node,
  attributes: Record<string, unknown>,
  registry: SchemaRegistry,
): Node {
  let wrapped = node;

  const entries = Object.entries(attributes)
    .filter(([_, v]) => v !== null && v !== false)
    .sort(([a], [b]) => {
      const schemaA = registry.resolveInline(a);
      const schemaB = registry.resolveInline(b);
      return (schemaA?.priority ?? 0) - (schemaB?.priority ?? 0);
    });

  for (const [markType, markProps] of entries) {
    const el = createMarkElement(markType, markProps);
    el.appendChild(wrapped);
    wrapped = el;
  }

  return wrapped;
}

function createMarkElement(
  markType: string,
  props: unknown,
): HTMLElement {
  switch (markType) {
    case 'bold': return document.createElement('strong');
    case 'italic': return document.createElement('em');
    case 'underline': return document.createElement('u');
    case 'strikethrough': return document.createElement('s');
    case 'code': return document.createElement('code');
    case 'link': {
      const a = document.createElement('a');
      if (typeof props === 'object' && props !== null) {
        const p = props as Record<string, unknown>;
        if (p.href) a.href = p.href as string;
        if (p.title) a.title = p.title as string;
      }
      return a;
    }
    case 'highlight': {
      const mark = document.createElement('mark');
      if (typeof props === 'object' && props !== null) {
        const p = props as Record<string, unknown>;
        if (p.color) mark.style.backgroundColor = p.color as string;
      }
      return mark;
    }
    default: {
      const span = document.createElement('span');
      span.dataset.markType = markType;
      return span;
    }
  }
}

function patchDOM(target: HTMLElement, source: DocumentFragment): void {
  const targetNodes = Array.from(target.childNodes);
  const sourceNodes = Array.from(source.childNodes);

  let ti = 0;
  let si = 0;

  while (si < sourceNodes.length) {
    const sourceNode = sourceNodes[si];

    if (ti < targetNodes.length) {
      const targetNode = targetNodes[ti];

      if (nodesStructurallyEqual(targetNode, sourceNode)) {
        updateTextContent(targetNode, sourceNode);
        ti++;
        si++;
      } else {
        const cloned = sourceNode.cloneNode(true);
        target.replaceChild(cloned, targetNode);
        ti++;
        si++;
      }
    } else {
      target.appendChild(sourceNode.cloneNode(true));
      si++;
    }
  }

  while (target.childNodes.length > sourceNodes.length) {
    target.removeChild(target.lastChild!);
  }
}

function nodesStructurallyEqual(a: Node, b: Node): boolean {
  if (a.nodeType !== b.nodeType) return false;
  if (a.nodeType === Node.TEXT_NODE) return true;
  if (a.nodeType === Node.ELEMENT_NODE) {
    const elA = a as Element;
    const elB = b as Element;
    if (elA.tagName !== elB.tagName) return false;
    if (elA.attributes.length !== elB.attributes.length) return false;
    for (let i = 0; i < elA.attributes.length; i++) {
      const attr = elA.attributes[i];
      if (elB.getAttribute(attr.name) !== attr.value) return false;
    }
    if (elA.childNodes.length !== elB.childNodes.length) return false;
    for (let i = 0; i < elA.childNodes.length; i++) {
      if (!nodesStructurallyEqual(elA.childNodes[i], elB.childNodes[i])) return false;
    }
    return true;
  }
  return true;
}

function updateTextContent(target: Node, source: Node): void {
  if (target.nodeType === Node.TEXT_NODE && source.nodeType === Node.TEXT_NODE) {
    if (target.textContent !== source.textContent) {
      target.textContent = source.textContent;
    }
    return;
  }
  if (target.nodeType === Node.ELEMENT_NODE && source.nodeType === Node.ELEMENT_NODE) {
    for (let i = 0; i < target.childNodes.length; i++) {
      updateTextContent(target.childNodes[i], source.childNodes[i]);
    }
  }
}

function saveSelection(_element: HTMLElement): any {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0);
  return { startOffset: range.startOffset, endOffset: range.endOffset, startContainer: range.startContainer, endContainer: range.endContainer };
}

function restoreSelection(_element: HTMLElement, saved: any): void {
  if (!saved) return;
  try {
    const sel = window.getSelection();
    if (!sel) return;
    const range = document.createRange();
    range.setStart(saved.startContainer, saved.startOffset);
    range.setEnd(saved.endContainer, saved.endOffset);
    sel.removeAllRanges();
    sel.addRange(range);
  } catch {
    // Selection restoration can fail if DOM structure changed significantly
  }
}
```

**Performance model.** The `applyDeltaToDOM` fast path handles the three common keystroke scenarios — plain text insert, plain text delete, and text insert with inherited marks — without reading the full Y.Text or rebuilding the DOM tree. It walks `element.childNodes` with a `(childIndex, textOffset)` cursor driven by the delta's `retain`/`insert`/`delete` entries.

**Fallback triggers.** The fast path returns `false` (bail to `fullReconcileToDOM`) in these cases:

1. **`format-text` attribute changes** (retain with attributes). These restructure mark wrapper nesting and are not common enough to optimize at the DOM-walking level.
2. **Mid-span attributed inserts** (inserting bold text into the middle of a plain text node). Requires splitting the span and wrapping one half — more complex than the fast path should handle.
3. **Cursor overrun** (delta references more characters than the DOM contains). Indicates a desync — the fallback will rebuild from the CRDT source of truth.

For a document with N mark spans, a plain character insert touches exactly 1 text node. The fallback path (used for formatting, initial render, composition end) is the same O(N) behavior as before — no regression.

**`Pen.Editor.InlineContent` static rendering.** Blocks at rest (field editor not active) continue to use `fullReconcileToDOM` for their one-time render. The fast path only applies inside active field editor backends where the `Y.YTextEvent` is available.

### Module: `field-editor/mark-boundary.ts`

Enforces `InlineSchema.expand` policy at every text insertion point (Spec Section 4.3).

> **Note on IME composition handling:** The composition lifecycle and CRDT update deferral strategy are specified in the "IME and Composition Event Handling" section below. The ContentEditable backend's Mode 2 (Composition) implements the core strategy; this section covers the cross-cutting concerns.

```typescript
import type { SchemaRegistry } from '@pen/types';

export function resolveMarksAtPosition(
  ytext: any,
  offset: number,
  registry: SchemaRegistry,
): Record<string, unknown> | undefined {
  const deltas = ytext.toDelta();
  let currentOffset = 0;
  let activeAttributes: Record<string, unknown> | null = null;

  for (const delta of deltas) {
    const len = typeof delta.insert === 'string' ? delta.insert.length : 1;

    if (offset >= currentOffset && offset <= currentOffset + len) {
      activeAttributes = delta.attributes ?? null;

      if (offset === currentOffset + len) {
        // At the END of this delta's range — check expand policy
        const filtered: Record<string, unknown> = {};
        if (activeAttributes) {
          for (const [mark, value] of Object.entries(activeAttributes)) {
            const schema = registry.resolveInline(mark);
            if (!schema) {
              filtered[mark] = value;
              continue;
            }
            if (schema.expand === 'after' || schema.expand === 'both') {
              filtered[mark] = value;
            }
            // expand: 'none' → exclude (don't propagate mark past boundary)
          }
        }
        return Object.keys(filtered).length > 0 ? filtered : undefined;
      }

      if (offset === currentOffset) {
        // At the START of this delta's range — check expand: 'before' | 'both'
        const filtered: Record<string, unknown> = {};
        if (activeAttributes) {
          for (const [mark, value] of Object.entries(activeAttributes)) {
            const schema = registry.resolveInline(mark);
            if (!schema) {
              filtered[mark] = value;
              continue;
            }
            if (schema.expand === 'before' || schema.expand === 'both' || schema.expand === 'after') {
              filtered[mark] = value;
            }
          }
        }
        return Object.keys(filtered).length > 0 ? filtered : undefined;
      }

      // Inside the delta — all marks apply
      return activeAttributes ?? undefined;
    }

    currentOffset += len;
  }

  return undefined;
}
```

### Module: `field-editor/clipboard.ts`

Copy, cut, and paste pipeline (Spec Section 5.9).

```typescript
import type { Editor } from '@pen/types';
import type { FieldEditorImpl } from './field-editor-impl.js';

export function handlePaste(
  event: InputEvent,
  editor: Editor,
  fieldEditor: FieldEditorImpl,
  importers?: PasteImporters,
): void {
  const dataTransfer = event.dataTransfer;
  if (!dataTransfer) return;

  // Delete current selection before inserting pasted content
  editor.deleteSelection();

  // Determine paste position from the field editor's cursor
  const sel = editor.selection;
  const position = sel?.type === 'text'
    ? { after: sel.anchor.blockId }
    : undefined;

  // Priority 1: Pen's lossless custom MIME
  const penPayload = dataTransfer.getData('application/x-pen-blocks');
  if (penPayload) {
    try {
      const blocks = JSON.parse(penPayload);
      applyPastedBlocks(editor, blocks, position);
      return;
    } catch { /* fall through */ }
  }

  // Backward compatibility: lossless format embedded in HTML payload
  const html = dataTransfer.getData('text/html');
  if (html) {
    const penMatch = html.match(/data-pen-blocks="([^"]*)"/);
    if (penMatch) {
      try {
        const blocks = JSON.parse(atob(penMatch[1]));
        applyPastedBlocks(editor, blocks, position);
        return;
      } catch { /* fall through to HTML import */ }
    }

    // Priority 2: HTML (requires @pen/import-html passed via importers)
    if (importers?.html) {
      importers.html.import(html, editor, { undoGroup: true, position });
      return;
    }
  }

  // Priority 3: Plain text as Markdown (requires @pen/import-markdown passed via importers)
  const text = dataTransfer.getData('text/plain');
  if (text && importers?.markdown) {
    importers.markdown.import(text, editor, { undoGroup: true, position });
  }
}

export function handleCopy(editor: Editor): void {
  const selection = editor.selection;
  if (!selection) return;

  const blocks = editor.getSelectedBlocks();
  if (blocks.length === 0) return;

  const htmlParts: string[] = [];
  const mdParts: string[] = [];
  const penBlocks: unknown[] = [];

  for (const block of blocks) {
    const schema = editor.schema.resolve(block.type);
    if (schema?.serialize?.toHTML) {
      htmlParts.push(schema.serialize.toHTML(block));
    }
    if (schema?.serialize?.toMarkdown) {
      mdParts.push(schema.serialize.toMarkdown(block));
    }
    penBlocks.push({
      type: block.type,
      props: block.props,
      content: block.textContent(),
    });
  }

  const htmlContent = htmlParts.join('\n');
  const penBlocksJson = JSON.stringify(penBlocks);
  const htmlWithPenData = `<meta data-pen-blocks="${btoa(penBlocksJson)}" />${htmlContent}`;

  navigator.clipboard.write([
    new ClipboardItem({
      'application/x-pen-blocks': new Blob([penBlocksJson], { type: 'application/x-pen-blocks' }),
      'text/html': new Blob([htmlWithPenData], { type: 'text/html' }),
      'text/plain': new Blob([mdParts.join('\n')], { type: 'text/plain' }),
    }),
  ]);
}

function applyPastedBlocks(editor: Editor, blocks: unknown[], position?: Position): void {
  // Validate against schema, then apply as single undo group
  const ops: import('@pen/types').DocumentOp[] = [];
  // ... block → op conversion (same pattern as importers)
  editor.apply(ops, { origin: 'user', undoGroup: true });
}
```

---

## Sub-wave 5c: Hooks

### `useEditor`

```typescript
import { useRef, useEffect } from 'react';
import { createEditor, type CreateEditorOptions, type Editor } from '@pen/core';

export function useEditor(optionsOrEditor?: CreateEditorOptions | Editor): Editor {
  const editorRef = useRef<Editor | null>(null);

  if (!editorRef.current) {
    if (optionsOrEditor && 'apply' in optionsOrEditor) {
      editorRef.current = optionsOrEditor as Editor;
    } else {
      editorRef.current = createEditor(optionsOrEditor);
    }
  }

  useEffect(() => {
    return () => {
      editorRef.current?.destroy?.();
    };
  }, []);

  return editorRef.current;
}
```

Creates or wraps an editor instance. Created once (ref-stable), destroyed on unmount.

### `useSelection`

```typescript
import { useSyncExternalStore } from 'react';
import type { Editor, SelectionState } from '@pen/types';

export function useSelection(editor: Editor): SelectionState {
  return useSyncExternalStore(
    (callback) => editor.on('selectionChange', callback),
    () => editor.selection,
    () => null, // server snapshot
  );
}
```

### `useDecorations`

```typescript
import { useSyncExternalStore } from 'react';
import type { Editor, DecorationSet } from '@pen/types';

export function useDecorations(editor: Editor): DecorationSet {
  return useSyncExternalStore(
    (callback) => editor.on('decorationsChange', callback),
    () => editor.getDecorations(),
    () => editor.getDecorations(), // server snapshot
  );
}
```

### `useToolbar`

```typescript
import { useSyncExternalStore } from 'react';
import type { Editor } from '@pen/types';

interface ToolbarState {
  activeMarks: Record<string, unknown>;
  blockType: string | null;
  canBold: boolean;
  canItalic: boolean;
  canUnderline: boolean;
  canStrikethrough: boolean;
  canCode: boolean;
  canLink: boolean;
}

export function useToolbar(editor: Editor): ToolbarState {
  return useSyncExternalStore(
    (callback) => {
      const unsubs = [
        editor.on('selectionChange', callback),
        editor.on('documentChange', callback),
      ];
      return () => unsubs.forEach(u => u());
    },
    () => computeToolbarState(editor),
    () => EMPTY_TOOLBAR_STATE,
  );
}
```

### `useSlashMenu`

```typescript
interface SlashMenuState {
  open: boolean;
  query: string;
  items: Array<{ type: string; display: import('@pen/types').BlockDisplay }>;
  selectedIndex: number;
}

export function useSlashMenu(editor: Editor): SlashMenuState & {
  setQuery: (q: string) => void;
  select: (index: number) => void;
  confirm: () => void;
  dismiss: () => void;
} {
  // Internal state management for slash menu
  // Opens on '/' in empty paragraph, filters via fuzzy match
  // against allBlockDisplays(), keyboard navigation
}
```

### `useBlockList`

```typescript
export function useBlockList(editor: Editor): readonly string[] {
  const subscribe = (callback: () => void) => editor.on('documentChange', callback);

  const getSnapshot = (): readonly string[] => {
    // DocumentStateImpl.blockOrder returns a cached readonly string[]
    // that is only rebuilt when blockOrder actually changes.
    // This is stable across calls when no change occurred,
    // so useSyncExternalStore skips re-renders correctly.
    return editor.documentState.blockOrder;
  };

  return useSyncExternalStore(subscribe, getSnapshot, () => []);
}
```

**Why not build a new array.** The previous approach built a fresh `string[]` on every `getSnapshot` call. `useSyncExternalStore` compares snapshots by reference (`===`). A new array on every call means every comparison fails, triggering infinite re-renders. `editor.documentState.blockOrder` returns the same array reference until `blockOrder` actually changes (see `DocumentStateImpl.rebuild()`), giving correct referential equality.

---

## Sub-wave 5d: Toolbar Primitives

```
Pen.Toolbar.Root / Group / Button / Toggle / Select / Separator
```

Standard Radix-style compound component (Spec Section 5.3).

**`Pen.Toolbar.Root`** — `role="toolbar"`, `aria-label="Formatting"`. Provides toolbar context.

**`Pen.Toolbar.Group`** — `role="group"`. Visual grouping of toolbar items.

**`Pen.Toolbar.Button`** — Generic toolbar button. Forwards `onClick` to editor commands.

**`Pen.Toolbar.Toggle`** — Tracks active state from editor selection. `format` prop specifies which inline mark to toggle. `data-active` when the current selection has the mark active.

**`Pen.Toolbar.Select`** — Dropdown for block type switching. `format="blockType"` switches the current block's type via `editor.apply({ type: 'convert-block', ... })`.

**`Pen.Toolbar.Separator`** — Visual separator. Renders `<div role="separator">`.

All primitives support `asChild`, forward refs, render no styles, and expose `data-*` attributes.

---

## Sub-wave 5e: Slash Menu Primitives

```
Pen.SlashMenu.Root / Input / List / Group / Item / Empty
```

(Spec Section 5.4).

**`Pen.SlashMenu.Root`** — Context provider. Controlled (`open`, `onOpenChange`) or uncontrolled. `role="listbox"`.

**`Pen.SlashMenu.Input`** — Filter input. Drives the `query` state. Renders as `<input>` (or merges via `asChild`).

**`Pen.SlashMenu.List`** — **Two modes:**
- **Auto mode** (no children): Populates from `registry.allBlockDisplays()`. Groups by `BlockDisplay.group`. Filters by fuzzy match against `display.title`, `display.description`, and `display.aliases`.
- **Manual mode** (has children): Consumer provides explicit `Item` and `Group` children.

**`Pen.SlashMenu.Group`** — `heading` prop for group label.

**`Pen.SlashMenu.Item`** — `blockType` prop. `role="option"`. On select: converts current block or inserts new block of the specified type.

**`Pen.SlashMenu.Empty`** — Renders when filter produces no matches.

**Trigger:** The slash menu opens when the user types `/` in an empty paragraph. This is detected by an input rule registered by the `SlashMenu.Root` component. Keyboard navigation: Arrow keys move `selectedIndex`, Enter confirms, Escape dismisses.

**Fuzzy filtering:** Uses a simple substring match on `display.title`, `display.description`, and all `display.aliases`. Case-insensitive. Matches are scored by position (earlier match = higher score) and sorted.

---

## Sub-wave 5f: Clipboard Pipeline

Fully specified in `field-editor/clipboard.ts` above. Summary:

**Paste priority:** `application/x-pen-blocks` > `text/html` > `text/plain`.

**Copy:** Serialize selected blocks to three MIME types. Write via `navigator.clipboard.write()`.

**Cut:** Copy + delete selection.

**All clipboard operations** are single undo groups.

---

## Sub-wave 5g: Default Block Renderers

Built-in renderers for all `@pen/schema-default` blocks. Each receives `BlockHandle` + `BlockRenderContext` and returns `ReactElement`.

**Single render function mandate:** Static and editable renders produce identical DOM structure. The `editable` flag in `BlockRenderContext` controls whether `InlineContent` is interactive.

### Renderer Pattern

Every renderer follows the same structure:

```typescript
export function ParagraphRenderer(
  block: BlockHandle,
  ctx: BlockRenderContext,
): React.ReactElement {
  return (
    <div
      ref={ctx.ref}
      data-block-type="paragraph"
      data-selected={ctx.selected || undefined}
    >
      <InlineContent blockId={block.id} />
    </div>
  );
}
```

### Renderer Registry

```typescript
const RENDERER_MAP: Record<string, BlockRenderer> = {
  paragraph: ParagraphRenderer,
  heading: HeadingRenderer,
  bulletListItem: BulletListItemRenderer,
  numberedListItem: NumberedListItemRenderer,
  checkListItem: CheckListItemRenderer,
  codeBlock: CodeBlockRenderer,
  image: ImageRenderer,
  table: TableRenderer,
  divider: DividerRenderer,
  callout: CalloutRenderer,
  toggle: ToggleRenderer,
  blockquote: BlockquoteRenderer,
};

export function resolveRenderer(blockType: string): BlockRenderer {
  return RENDERER_MAP[blockType] ?? DefaultRenderer;
}
```

### Individual Renderers

**HeadingRenderer** — Renders `<h1>`-`<h6>` based on `block.props.level`. Contains `<InlineContent>` for editable text.

**BulletListItemRenderer** — Renders list item with bullet marker. `indent` prop controls `paddingLeft`. No wrapper `<ul>` — flat model.

**NumberedListItemRenderer** — Same as bullet but with numeric marker. Uses CSS `counter-reset`/`counter-increment` on the parent for auto-numbering.

**CheckListItemRenderer** — Checkbox + inline content. Checkbox toggles `checked` prop via `editor.apply({ type: 'update-block', ... })`.

**CodeBlockRenderer** — `<pre><code>` with `<InlineContent>` in code mode. The field editor delegates to a code-specific backend (no rich text marks, tab handling, optional line numbers).

**ImageRenderer** — `<figure>` with `<img>` and optional `<figcaption>`. No `InlineContent` (`content: 'none'`). Click selects the block. Resize handles when selected.

**TableRenderer** — `<table>` structure. Each cell contains its own `InlineContent` instance. Cell selection via `CellSelection`. Tab navigation between cells.

**DividerRenderer** — `<hr />`. No content, no interaction beyond selection.

**CalloutRenderer** — Styled container with icon based on `type` prop. Contains `<InlineContent>` for the callout body and renders children (blocks with matching `parentId`).

**ToggleRenderer** — `<details><summary>` pattern. Summary contains `<InlineContent>`. Body renders children. `open` prop synced to `<details>` attribute.

**BlockquoteRenderer** — `<blockquote>` with `<InlineContent>`. Renders children.

**DefaultRenderer** — Fallback for unknown block types. Renders block type name and raw props as JSON. Development-mode only — production should never hit this if schemas are correct.

---

## IME and Composition Event Handling

**This is the #1 source of bugs in every React + CRDT editor.** TipTap, Plate, BlockNote, and Lexical all have long-standing IME bugs because they try to maintain a virtual model synchronized with DOM during composition. Pen's dual-backend design avoids the worst of these, but the composition lifecycle still requires precise handling.

### The Fundamental Problem

IME (Input Method Editor) composition is a multi-step process where the browser temporarily owns the DOM. During composition:

1. The browser inserts provisional characters (e.g., pinyin syllables, kana candidates) into the DOM.
2. These characters may be replaced, extended, or deleted multiple times before the user confirms.
3. The browser fires `compositionstart`, `compositionupdate`, and `compositionend` events.
4. `beforeinput` events fire during composition but with `inputType: 'insertCompositionText'` — and the browser may ignore `preventDefault()` on these events.

The invariant that must hold: **no CRDT writes during active composition.** If the editor writes to Y.Text during composition, the CRDT observer fires, which triggers DOM reconciliation, which destroys the browser's composition state, which causes duplicated or lost characters.

### Composition Lifecycle

```
User starts typing (e.g., Chinese pinyin):
  compositionstart fires
    → set isComposing = true
    → suppress all CRDT writes
    → suppress all CRDT→DOM reconciliation
    → the browser owns the DOM

  compositionupdate fires (0-N times)
    → browser updates provisional text in DOM
    → editor does nothing (DOM is "dirty" relative to CRDT)

  compositionend fires
    → set isComposing = false
    → diff DOM text against CRDT text
    → apply the diff as a single CRDT transaction
    → CRDT observer fires → reconcile DOM (now in sync)
```

### Backend-Specific Handling

#### EditContext Backend (Chromium 133+)

EditContext eliminates the composition problem almost entirely. The browser communicates text changes through `textupdate` events, not through DOM mutations. During composition:

1. `textformatupdate` events provide composition underline ranges for visual feedback.
2. `textupdate` events provide the incremental text changes.
3. The editor renders composition underlines as decorations.
4. CRDT writes happen through `textupdate` — the same code path as non-composition input.

**Key advantage:** Since EditContext decouples input from DOM, there is no "browser owns the DOM" phase. The editor can write to the CRDT during composition without causing DOM conflicts.

**Composition visual feedback:** `textformatupdate` provides ranges with `underlineStyle` and `underlineThickness`. The editor renders these as ephemeral inline decorations (not CRDT marks). These decorations are removed when `textupdate` confirms the final text.

**Character bounds for candidate window positioning:** `characterboundsupdate` requests character geometries so the browser can position the IME candidate window. The editor must provide accurate `DOMRect` values for each character in the composition range by walking the DOM nodes.

```typescript
private handleCharacterBoundsUpdate = (event: CharacterBoundsUpdateEvent): void => {
  if (!this.element || !this.editContext) return;

  const rects: DOMRect[] = [];
  const { rangeStart, rangeEnd } = event;

  for (let i = rangeStart; i < rangeEnd; i++) {
    const rect = getCharacterRect(this.element, i);
    rects.push(rect);
  }

  this.editContext.updateCharacterBounds(rangeStart, rects);
};
```

#### ContentEditable Backend (Firefox, Safari)

The ContentEditable backend uses the three-mode strategy (Direct, Composition, Observation). Mode 2 (Composition) is the critical path.

**Composition event sequence (detailed):**

```
compositionstart
  → isComposing = true
  → record the pre-composition CRDT text snapshot
  → record the pre-composition DOM selection offset
  → suppress handleBeforeInput (early return when isComposing)
  → suppress handleYTextChange (early return when isComposing)
  → suppress handleMutations (early return when isComposing)

[browser mutates DOM freely — provisional text appears/changes]

compositionend
  → isComposing = false
  → read the final DOM text
  → diff against the pre-composition CRDT text snapshot
  → apply diff as a single CRDT transaction (origin: 'user')
  → the CRDT observer fires → handleYTextChange runs → reconcile DOM
```

**Critical implementation details:**

1. **The pre-composition snapshot must be the CRDT text, not the DOM text.** The DOM may already be "ahead" of the CRDT due to a pending reconciliation. Always snapshot `this.ytext.toString()`.

2. **The diff must handle replacement, not just insertion.** IME composition can replace existing text. For example, typing "nihao" in pinyin, then selecting "你好" from the candidate list, replaces the provisional "nihao" with "你好". The diff must detect the replacement region and emit delete + insert ops.

3. **Mark inheritance during composition.** The text inserted by the IME inherits marks from the insertion position (via `resolveMarksAtPosition`). Since the diff runs after composition ends, marks are resolved once for the final text — not for each provisional update.

4. **`compositionend` timing varies by browser and platform.**
   - Chrome (desktop): fires `compositionend` after the final text is committed to DOM.
   - Safari (desktop): fires `compositionend` BEFORE the final DOM update on some versions. Work around: schedule the diff to run on `requestAnimationFrame` after `compositionend`.
   - Firefox: fires `compositionend` reliably after DOM update.
   - **Safari workaround implementation:**

   ```typescript
   private handleCompositionEnd = (): void => {
     this.isComposing = false;
     // Safari may fire compositionend before the final DOM mutation.
     // Defer the diff to the next animation frame to ensure the DOM is settled.
     requestAnimationFrame(() => {
       if (this.isComposing) return; // new composition started — skip
       this.reconcileAfterComposition();
     });
   };
   ```

5. **Nested/interrupted compositions.** On some platforms, a `compositionstart` can fire while a previous composition is still active (e.g., switching between IME candidates). The editor must handle this gracefully: discard the previous composition state and start fresh.

6. **Composition cancellation.** The user can cancel a composition (Escape key, clicking elsewhere). This fires `compositionend` with the DOM restored to the pre-composition state. The diff will show no changes, and no CRDT write occurs. This is correct behavior.

### Remote Edits During Composition

**The hardest edge case.** While User A is composing (isComposing = true), User B inserts text into the same block via a remote CRDT update.

**Without handling:** The CRDT observer fires, `handleYTextChange` runs, and DOM reconciliation attempts to update the DOM — which destroys A's composition state.

**Required behavior:** Remote edits to the composing block are DEFERRED during composition. They accumulate in a buffer and are applied after `compositionend`.

```typescript
private deferredRemoteDeltas: Array<{ delta: any[] }> = [];

private handleYTextChange = (event: any): void => {
  if (this.isComposing) {
    // Is this a remote edit? Check the transaction origin.
    if (event.transaction?.origin === 'remote' || event.transaction?.origin === 'collaborator') {
      this.deferredRemoteDeltas.push({ delta: event.delta });
    }
    // Local composition changes are ignored — the DOM is already correct.
    return;
  }

  // ... normal reconciliation path ...
};

private reconcileAfterComposition(): void {
  // 1. Apply the composition diff to CRDT.
  // 2. Apply any deferred remote deltas.
  // 3. Full reconcile to bring DOM and CRDT into sync.
  this.applyCompositionDiff();

  if (this.deferredRemoteDeltas.length > 0) {
    this.deferredRemoteDeltas = [];
    // Remote deltas are already applied to the CRDT (they came through Y.applyUpdate).
    // We just need to reconcile the DOM to reflect them.
    fullReconcileToDOM(this.ytext, this.element!, this.editor.schema);
  }
}
```

**Position shift after deferred reconciliation.** If remote edits shift the cursor position (e.g., text inserted before the composition point), the editor must compute the new cursor position after reconciliation and set it explicitly.

### Android GBoard Specifics

Android's GBoard IME has behaviors that differ from desktop Chrome:

1. **Auto-correction replaces text without composition events.** GBoard may fire `deleteContentBackward` + `insertText` instead of a composition sequence when auto-correcting. The editor must handle these `beforeinput` events normally (Mode 1) — they will work correctly since no composition is active.

2. **GBoard prediction bar inserts text at an unexpected offset.** The prediction bar can insert a word that replaces the current word, but the `beforeinput` event's `getTargetRanges()` may not match the visible selection. **Workaround:** Always use `getTargetRanges()` from the `InputEvent` rather than reading `window.getSelection()`.

3. **GBoard fires `compositionstart` → `compositionend` for every keystroke in some modes.** This creates rapid composition start/end cycles. The editor must handle these efficiently — don't trigger a full diff + reconciliation for every character. **Optimization:** Skip the diff if the time between `compositionstart` and `compositionend` is <50ms and the DOM change is a single character insert (common case for GBoard key-by-key composition).

4. **GBoard swipe typing.** Swipe gestures produce a composition that replaces a whole word. The composition events are standard — `compositionstart`, `compositionupdate` (provisional candidates), `compositionend` (final word). This works with Mode 2 as specified.

### iOS Safari Specifics

1. **iOS Safari fires `compositionstart` for long-press accent menus** (e.g., holding "e" to select "é"). These are short compositions where `compositionend` fires immediately after the accent is selected. No special handling needed — Mode 2 handles this correctly.

2. **iOS dictation input** fires composition events with `inputType: 'insertFromDictation'`. This is handled by Mode 1 (Direct) if not composing, or Mode 2 if during composition.

3. **iOS selection handles can move the cursor during composition.** If the user taps elsewhere while a composition is active, Safari fires `compositionend` (cancel) followed by a selection change. The editor's `compositionend` handler must be robust to this — the DOM text after cancellation should match the pre-composition snapshot.

### Testing Strategy

IME bugs are notoriously hard to test in automated environments. Required test approaches:

1. **Synthetic composition events.** Fire `compositionstart`, `compositionupdate`, and `compositionend` with controlled `data` payloads. Verify that CRDT writes only occur after `compositionend`.

2. **Remote edit during composition.** Start a composition, apply a remote CRDT update to the same block, then end the composition. Verify: (a) no crash, (b) composition text is preserved, (c) remote edit is visible after composition ends.

3. **Platform-specific CI.** Run composition tests on: Chrome (EditContext backend), Firefox (ContentEditable backend), Safari (ContentEditable backend with requestAnimationFrame workaround). Android and iOS require real device testing — cannot be reliably tested in headless browsers.

4. **Stress test: rapid composition cycles.** Fire 100 start/end pairs in quick succession with single-character changes. Verify no duplicated or lost characters. This catches GBoard-style rapid composition behavior.

---

## Mobile Considerations

Mobile support is the second-hardest part of building a browser-based editor, after IME handling (which itself is largely a mobile problem). This section documents mobile-specific behaviors, known platform quirks, and explicit M0/M1 scope boundaries.

### M0 Scope: Functional but Not Optimized

M0 targets **desktop browsers** as the primary platform. Mobile browsers will work for basic editing (typing, formatting, block operations) but with known limitations:

| Feature | M0 Status | Notes |
|---|---|---|
| Basic text input | Supported | Via ContentEditable backend |
| IME composition | Supported | See IME section above |
| Touch to position cursor | Supported | Browser-native behavior |
| Touch selection handles | Partial | Browser-native handles work, but custom selection UI does not interact with them |
| Virtual keyboard interaction | Partial | Keyboard appears on focus, but viewport resizing may cause layout issues |
| Block drag-and-drop | Not supported | HTML5 drag API doesn't work on mobile touch events |
| Block selection gestures | Not supported | Desktop uses shift-click; mobile needs long-press + drag |
| Slash menu | Partial | Trigger works, but positioning relative to virtual keyboard is not optimized |
| Toolbar positioning | Not optimized | Toolbar may be obscured by virtual keyboard |

### M1 Scope: First-Class Mobile

M1 adds dedicated mobile interaction patterns:

1. **Touch-native block selection** via long-press + drag gesture recognizer.
2. **Floating toolbar** that avoids the virtual keyboard.
3. **Touch-native block reordering** via long-press + drag (replacing HTML5 drag-and-drop).
4. **Viewport-aware positioning** for slash menu and command menu.

### Virtual Keyboard and Viewport

When the virtual keyboard appears, the browser resizes the viewport (or the visual viewport, depending on browser and meta viewport settings). This affects:

1. **Scroll position.** The browser auto-scrolls to keep the focused element visible. But if the editor has custom scroll handling (virtualization), the scroll position may be incorrect.

2. **Fixed-position elements.** Toolbars, menus, and overlays positioned with `position: fixed` are affected by viewport resizing. On iOS Safari, `position: fixed` elements are positioned relative to the visual viewport when the keyboard is open, which can cause them to overlap content or disappear behind the keyboard.

3. **`visualViewport` API.** Use `window.visualViewport.height` and `window.visualViewport.offsetTop` to detect the keyboard's presence and size. Subscribe to `visualViewport.onresize` and `visualViewport.onscroll` for dynamic updates.

**M0 implementation (minimal):**

```typescript
function useVisualViewport(): { height: number; offsetTop: number } {
  return useSyncExternalStore(
    (callback) => {
      const vv = window.visualViewport;
      if (!vv) return () => {};
      vv.addEventListener('resize', callback);
      vv.addEventListener('scroll', callback);
      return () => {
        vv.removeEventListener('resize', callback);
        vv.removeEventListener('scroll', callback);
      };
    },
    () => ({
      height: window.visualViewport?.height ?? window.innerHeight,
      offsetTop: window.visualViewport?.offsetTop ?? 0,
    }),
    () => ({ height: 800, offsetTop: 0 }),
  );
}
```

This hook is exposed from `@pen/react` for consumers to build keyboard-aware layouts. Pen's built-in primitives don't use it in M0 — consumers handle layout themselves.

### iOS Safari `contentEditable` Quirks

iOS Safari has a long list of `contentEditable` behaviors that differ from desktop:

1. **Caret positioning after programmatic DOM changes.** After the editor programmatically modifies the DOM (e.g., CRDT→DOM reconciliation), Safari may place the caret at position 0 instead of preserving the previous position. The selection restoration logic in the reconciler handles this, but must be tested specifically on iOS.

2. **`-webkit-user-select` interaction.** Non-editable elements inside a `contentEditable` container need `user-select: none` (prefixed `-webkit-user-select: none` on Safari) to prevent selection from entering them. Block handles and decorations must have this set.

3. **Scroll behavior during programmatic focus.** Calling `element.focus()` on iOS Safari scrolls the element into view AND opens the keyboard. The `preventScroll` option (`element.focus({ preventScroll: true })`) is supported since iOS 15 but has inconsistent behavior. M0 does not override this — the browser's default scroll-on-focus behavior is acceptable.

4. **Touch callout suppression.** Long-press on text in `contentEditable` shows Safari's text selection callout (copy/paste/lookup). This cannot be fully suppressed in M0. M1 will implement a custom context menu that replaces the native callout via `-webkit-touch-callout: none` + custom UI.

5. **Safe area insets.** On devices with a notch or home indicator, `env(safe-area-inset-bottom)` affects toolbar positioning. M0 documents this for consumers; M1 applies it to built-in primitives.

6. **`beforeinput` event support.** iOS Safari 14.5+ supports `beforeinput` events. The ContentEditable backend's Mode 1 (Direct) works, but `getTargetRanges()` returns empty arrays for some `inputType` values. The fallback to Mode 3 (Observation) handles these cases.

### Android Chrome/WebView Quirks

1. **`beforeinput` event cancellation.** Android Chrome supports `preventDefault()` on `beforeinput` for most `inputType` values, but GBoard may ignore it for `insertCompositionText`. The composition-aware early return in `handleBeforeInput` handles this.

2. **`getTargetRanges()` reliability.** On Android, `getTargetRanges()` occasionally returns stale or incorrect ranges, particularly after auto-correction or prediction insertion. The ContentEditable backend should cross-check against `window.getSelection()` and fall back to Mode 3 (Observation) if they disagree.

3. **Selection change timing.** Android Chrome sometimes fires `selectionchange` before the DOM has been updated by the browser's input handling. The selection bridge must debounce `selectionchange` processing by one microtask (`queueMicrotask`) to ensure the DOM is settled.

4. **EditContext availability.** EditContext is available on Android Chrome 144+ but NOT on Android WebView. The feature detection (`'EditContext' in globalThis`) correctly handles this — WebView falls back to ContentEditable.

### Touch Selection Handles (M1)

M0 relies entirely on the browser's native touch selection handles. These work but have limitations:

- The handles are styled by the browser and don't match the editor's design.
- The handles don't interact with block boundaries — dragging a handle across block boundaries selects text in the underlying `contentEditable`, which may not match the editor's block selection model.
- The handles can't be intercepted or customized.

M1 will implement custom selection handles using `PointerEvent`:

```typescript
interface TouchSelectionHandle {
  position: 'start' | 'end';
  blockId: string;
  offset: number;
  rect: DOMRect;
}
```

These handles:
1. Render as absolutely-positioned elements at the start and end of the selection.
2. Respond to `pointerdown` + `pointermove` + `pointerup` for dragging.
3. Map pointer coordinates to `(blockId, offset)` using `document.caretPositionFromPoint()` (or `document.caretRangeFromPoint()` on WebKit).
4. Support cross-block selection by expanding the field editor range as the handle crosses block boundaries.
5. Provide haptic feedback on iOS via `navigator.vibrate()` (where available).

### Performance on Mobile

Mobile devices have less CPU headroom than desktops. Key performance constraints:

1. **Reconciler must avoid layout thrashing.** Batch DOM reads and writes. Never read `offsetHeight` or `getBoundingClientRect()` between DOM writes.
2. **Virtualization is more important on mobile.** Default to virtualization enabled for documents >50 blocks on mobile (vs. >100 on desktop). Detect mobile via `'ontouchstart' in window` or `navigator.maxTouchPoints > 0`.
3. **60fps during scroll.** The reconciler must not block the main thread during scroll events. Passive event listeners for scroll and touch.
4. **Memory pressure.** Mobile Safari aggressively reclaims memory. The editor should not hold large in-memory caches (e.g., rendered DOM for all blocks). Virtualization handles this by unmounting off-screen blocks.

---

## Dependencies

```json
{
  "dependencies": {
    "@pen/core": "workspace:*",
    "@pen/schema-default": "workspace:*"
  },
  "peerDependencies": {
    "react": "^18.0.0 || ^19.0.0",
    "react-dom": "^18.0.0 || ^19.0.0",
    "@pen/import-html": "workspace:*",
    "@pen/import-markdown": "workspace:*"
  },
  "peerDependenciesMeta": {
    "@pen/import-html": { "optional": true },
    "@pen/import-markdown": { "optional": true }
  }
  }
}
```

React 18+ for `useSyncExternalStore`. No other runtime dependencies. The package does NOT depend on `yjs` directly — all CRDT access goes through `@pen/core`'s `CRDTAdapter` interface. The field editor accesses `Y.Text` via `editor.internals.adapter.raw(editor.internals.crdtDoc)` on the hot path (within the blast radius budget from Spec Section 10.1).

---

## Key Decisions

1. **No ProseMirror, Slate, or Lexical.** Pen uses its own CRDT-first input strategy. Transaction-based editors create double-source-of-truth problems with CRDTs.

2. **EditContext is preferred.** Available in Chromium 133+, it eliminates entire classes of IME bugs. The contenteditable fallback ensures broad browser support. Backend selection is per-activation, not per-session.

3. **Reconciler is event-driven.** The active field editor uses `Y.YTextEvent.delta` to patch only the DOM nodes affected by each change — O(changed_spans), not O(total_spans). Falls back to full reconciliation on mark-boundary restructuring, composition end, and initial activation. The ContentEditable backend saves/restores selection only on the fallback path; the EditContext backend never needs it (it owns selection separately). See `applyDeltaToDOM` and `fullReconcileToDOM` in `reconciler.ts`.

4. **Cross-block expansion is lazy.** Only expands on drag/shift-click gestures. Single-block editing is the common case and is cheap. >50 blocks uses `BlockSelection` instead of contenteditable expansion.

5. **All hooks use `useSyncExternalStore`.** No `useEffect` + `useState` for subscription patterns. This provides tear-safe rendering with React 18+ concurrent features.

6. **`BlockHandle.textDeltas()` for inline rendering.** The `InlineContent` component must use `handle.textDeltas()` to read formatted text segments, not raw `Y.Text.toDelta()`. This preserves CRDT adapter abstraction and ensures the rendering layer works with any CRDT backend. The field editor backends (EditContext, ContentEditable) are exempt from this rule — they are `raw()` blast-radius modules that require direct CRDT access for performance.

7. **No React Compiler interference.** Per project rules, no manual `useCallback`/`useMemo` — the compiler handles memoization. Event handlers and callbacks are plain functions.

8. **Single render function per block type.** Static and editable modes use the same renderer. The `editable` flag controls `InlineContent` behavior, not the component tree structure. This eliminates render-mode divergence bugs.

9. **Renderers are pure functions, not classes.** Each renderer is a `(block: BlockHandle, ctx: BlockRenderContext) => ReactElement` function. No component state, no lifecycle — all state lives in the editor.

10. **Slash menu auto-mode.** Zero-config: `<Pen.SlashMenu.List />` with no children auto-populates from the schema registry. Consumers can override with explicit `Item` children.

11. **Clipboard uses three MIME types.** `application/x-pen-blocks` for lossless round-trip, `text/html` for rich paste into other apps, `text/plain` for Markdown fallback.

12. **CRDT writes are fully suppressed during IME composition.** The ContentEditable backend defers all Y.Text mutations until `compositionend`. Remote edits to the composing block are buffered and applied after composition ends. This is the single most important rule for avoiding IME duplication/loss bugs.

13. **EditContext eliminates the composition deferral problem.** On Chromium 133+, EditContext decouples input from DOM, allowing CRDT writes during composition without DOM conflicts. This is the primary reason EditContext is the preferred backend — it eliminates an entire class of bugs.

14. **Safari `compositionend` timing workaround.** The ContentEditable backend schedules composition reconciliation on `requestAnimationFrame` after `compositionend` to handle Safari's pre-DOM-update firing. This adds one frame of latency for Safari IME input, which is imperceptible.

15. **Mobile is functional but not optimized in M0.** Touch input, virtual keyboard, and IME all work. But touch selection handles, mobile-optimized toolbar positioning, and touch block reordering are deferred to M1. This is a deliberate scope decision, not an oversight.

16. **`useVisualViewport` is exposed for keyboard-aware layouts.** Pen provides the hook but does not automatically reposition primitives in M0. Consumers handle layout. M1 adds built-in keyboard-aware positioning for toolbar and menus.

---

## Acceptance Criteria

### Primitives (5a)

1. `<PenEditor editor={editor} />` renders the editor with default schema blocks.
2. `<Pen.Editor.Root>` provides editor context to all descendants. Using a primitive outside `Root` produces a development-mode error.
3. `data-focused` attribute on `Root` reflects editor focus state.
4. `data-readonly` attribute reflects the `readonly` prop.
5. `data-block-type` on `Block` reflects the block's schema type.
6. `data-selected` on `Block` reflects selection state.
7. All primitives support `asChild` — merging behavior onto a single child element.
8. All primitives forward refs to their underlying DOM element.
9. Server-safe primitives render on the server. Client-only primitives render null during SSR.

### Field Editor (5b)

10. Clicking a paragraph activates the field editor — text is editable.
11. Typing inserts characters into the CRDT (verified via `editor.getBlock(id).textContent()`).
12. Backspace deletes characters from the CRDT.
13. Bold shortcut (Ctrl/Cmd+B) toggles bold mark on selected text.
14. Pressing Enter splits the current block into two blocks.
15. Backspace at block start merges with previous block.
16. IME input (Chinese/Japanese) works without duplication or loss. Composition is handled by Mode 2.
17. EditContext backend is selected when `'EditContext' in globalThis` is true.
18. ContentEditable backend is used as fallback.
19. Block existence guard: writing to a deleted block silently deactivates the field editor.
20. Mark boundary `expand` enforcement: typing at the end of a link does NOT extend the link mark.
21. Mark boundary `expand` enforcement: typing at the end of bold text DOES extend the bold mark.

### Cross-block (5b)

22. Shift-clicking from block 3 to block 7 selects blocks 3-7.
23. Typing while blocks are selected replaces the selection.
24. Cross-block selection announces range via aria-live.

### Hooks (5c)

25. `useEditor()` creates a stable editor instance across re-renders.
26. `useEditor(existingEditor)` wraps without creating a new instance.
27. `useSelection(editor)` re-renders when selection changes.
28. `useDecorations(editor)` re-renders when decorations change.
29. `useToolbar(editor)` returns current active marks and block type.

### Toolbar (5d)

30. `Pen.Toolbar.Toggle format="bold"` shows `data-active` when selection has bold.
31. Clicking the toggle toggles the mark.
32. `Pen.Toolbar.Select format="blockType"` changes the current block type.

### Slash Menu (5e)

33. Slash menu appears on `/` in an empty paragraph.
34. Typing filters items via fuzzy match against `display.title`, `description`, `aliases`.
35. Arrow keys navigate items, Enter selects, Escape dismisses.
36. Auto-mode (no children on `List`) populates from `allBlockDisplays()`.
37. Selected item inserts a new block of that type.

### Clipboard (5f)

38. Copy/paste round-trips text with formatting preserved (bold, italic, link).
39. Paste from external HTML (e.g., Google Docs) produces valid blocks with formatting.
40. Paste with `<script>` tags strips the scripts (via `@pen/import-html` sanitization).
41. Paste writes three MIME types to clipboard.
42. Each paste operation is a single undo group.
43. Cut = copy + delete selection.

### Renderers (5g)

44. All 12 default block types render correctly in both static and editable modes.
45. Heading renders as `<h1>`-`<h6>` based on `level` prop.
46. CheckListItem checkbox toggles `checked` prop.
47. CodeBlock renders `<pre><code>` with language class.
48. Image renders `<img>` with `src`, `alt`, and optional caption.
49. Unknown block types render via `DefaultRenderer` with type name.

### Integration

50. Undo (Ctrl+Z) reverses the last editing action.
51. AI streaming (`gen-delta` parts) renders tokens in real-time.
52. `data-ai-generating` attribute appears on blocks during AI streaming.
53. `data-*` attributes reflect correct state on all primitives throughout the editing lifecycle.
54. Toolbar toggle reflects current selection's active marks in real-time.
55. Virtualization (when enabled) correctly mounts/unmounts blocks based on viewport.

### IME / Composition (5b)

56. Chinese pinyin input: type "nihao", select "你好" from candidates → CRDT contains "你好" (no duplicates, no garbage characters).
57. Japanese romaji→kana→kanji: type "toukyou", confirm "東京" → CRDT contains "東京".
58. No CRDT write occurs between `compositionstart` and `compositionend` (verified by observing CRDT transaction count).
59. Remote edit during active composition: other peer inserts text in the same block → local composition completes successfully, remote edit visible after `compositionend`.
60. Composition cancellation (Escape during IME): DOM returns to pre-composition state, no CRDT write occurs.
61. Rapid composition cycles (GBoard-style): 100 start/end pairs with single-character changes → no duplicated or lost characters.
62. Safari `compositionend` timing: composition text is correct even when `compositionend` fires before DOM update (verified on Safari).
63. EditContext backend: composition underlines render via `textformatupdate` decorations. IME candidate window is correctly positioned via `characterboundsupdate`.
64. Mark inheritance during composition: composing text at the end of a bold range → composed text inherits bold mark.

### Mobile (basic, M0)

65. Touch to position cursor works on iOS Safari and Android Chrome.
66. Virtual keyboard appears when tapping an editable block.
67. Basic text input (typing, backspace, enter) works with on-screen keyboard.
68. IME input (Chinese, Japanese) works on mobile browsers (see IME criteria above).
69. `useVisualViewport` hook reports correct viewport dimensions when virtual keyboard is open/closed.
70. Virtualization activates at >50 blocks on mobile (vs >100 on desktop).

---

## Known Errata (Fix During Implementation)

1. ~~**`FieldEditorImpl` extends the `FieldEditor` interface significantly.**~~ Fixed in Wave 0 — the `FieldEditor` interface now includes `inputMode`, `attachElement()`, and `contractToFocused()`.

2. **`BlockSchema.fieldEditor` is now `FieldEditorFactory | 'richtext' | 'code' | 'table' | 'none'`** (fixed in Wave 0). Resolve string tags to built-in factory functions in the rendering layer: `'richtext'` → RichtextFieldEditor, `'code'` → CodeFieldEditor, etc.

3. **Specify `cross-block.ts`** — the cross-block expansion module. Must handle: expanding the contenteditable scope across multiple blocks, managing shared Y.Text observation, and contracting back to a single block.

4. **Specify `selection-bridge.ts`** — DOM-to-CRDT selection mapping. Must handle: converting `window.getSelection()` ranges to `(blockId, offset)` pairs, and vice versa for restoring CRDT selection to DOM.

5. **Specify `computeTextDiff` algorithm.** The ContentEditable backend's mutation observer depends on this to diff observed DOM text against expected CRDT text. **Implementation:** Use a simple O(n) scan from both ends of the strings to find the changed region, producing a single delete+insert pair. For the common case (single character typed/deleted, or IME composition result), this is optimal. Falls back to Myers diff only if the simple scan produces a region larger than 256 characters. Return type: `Array<{ type: 'insert'; offset: number; text: string } | { type: 'delete'; offset: number; length: number }>`.

6. **`saveSelection` must use offset-based references, not live DOM nodes.** After `fullReconcileToDOM` replaces DOM nodes, saved `startContainer`/`endContainer` references become stale. **Implementation:** `saveSelection(element)` must walk the DOM to compute `(blockId, characterOffset)` pairs for anchor and focus. `restoreSelection(element, saved)` must walk the reconciled DOM to find the corresponding text nodes and set the browser selection. This ensures selection survives full DOM replacement.

7. **ContentEditable backend Mode 3 must apply marks on insert.** Resolve marks at the insertion position (via `resolveMarksAtPosition`) before inserting text.

8. **Add `handleCut` to clipboard pipeline.** `handleCut = handleCopy + editor.deleteSelection()`.

9. **`NumberedListItemRenderer` counter management.** Pen's flat list model has no `<ol>` wrapper. Implement synthetic counter tracking: maintain a counter map that resets when a non-numbered-list block is encountered, and pass the computed number as a data attribute.

10. **Virtualization must not unmount the active field editor block.** Add the active block (and all blocks in `FieldEditorImpl.activeBlockIds`) to the "always-render" set, regardless of viewport position.

11. **`useEditor` should only destroy self-created editors.** If the consumer passes a pre-existing editor, the hook must not destroy it on unmount.

12. **ContentEditable backend `compositionend` handler must use `requestAnimationFrame`.** The current `handleCompositionEnd` directly calls `reconcileAfterComposition`. On Safari, `compositionend` may fire before the final DOM update. Wrap in `requestAnimationFrame` with a re-entrancy guard (`if (this.isComposing) return` — handles nested composition start).

13. **Remote edits during composition require a deferred delta buffer.** The `handleYTextChange` handler must check `this.isComposing` AND the transaction origin to buffer remote deltas. The current implementation returns early for all Y.Text changes during composition — it must distinguish between local composition DOM changes (ignore) and remote CRDT updates (buffer for post-composition reconciliation).

14. **GBoard rapid composition optimization.** The composition diff path should skip full reconciliation for single-character compositions where the elapsed time between `compositionstart` and `compositionend` is <50ms. Instead, treat as a Mode 1 direct insert. This avoids unnecessary full-diff overhead on Android.

15. **`useVisualViewport` hook.** Not currently in the file structure. Add to `hooks/` as `use-visual-viewport.ts`. Export from the hooks barrel.

16. **Virtualization threshold.** The virtualization `<100 blocks default:off` should be lowered to `<50 blocks` on mobile devices. Detect via `navigator.maxTouchPoints > 0`. Update `Pen.Editor.Content` to accept a `mobileOverscan` option.
