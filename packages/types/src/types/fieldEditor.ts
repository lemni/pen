import type { BlockSchema } from "./schema.js";
import type { Editor } from "./editor.js";
import type { SelectionState } from "./selection.js";
import type { GenerationZone } from "./crdt.js";
import type { Unsubscribe } from "./utility.js";

export type FieldEditorFactory = (ctx: FieldEditorContext) => FieldEditor;

export interface FieldEditorContext {
  blockId: string;
  schema: BlockSchema;
  editor: Editor;
}

export interface FieldEditor {
  readonly activeBlockId: string | null;
  readonly activeBlockIds: readonly string[];
  readonly isEditing: boolean;
  readonly inputMode: "richtext" | "code" | "table" | "none";
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

  onActivate?(callback: (blockIds: string[]) => void): Unsubscribe;
  onDeactivate?(callback: (blockIds: string[]) => void): Unsubscribe;
  onSelectionChange?(callback: (selection: SelectionState) => void): Unsubscribe;
}

export interface InputBackend {
  activate(element: HTMLElement, ytext: unknown): void;
  deactivate(): void;
  updateSelection(relPos: unknown): void;
}

export interface StreamingTarget {
  readonly generationZone: GenerationZone | null;
  beginStreaming(zoneId: string, blockId: string): void;
  appendDelta(delta: string): void;
  endStreaming(status: "complete" | "cancelled" | "error"): void;
}
