import type { FieldEditor, Unsubscribe } from "@pen/types";

export interface FieldEditorStoreSnapshot {
	focusBlockId: string | null;
	activeBlockIds: readonly string[];
	isEditing: boolean;
	isFocused: boolean;
	isComposing: boolean;
	inputMode: "richtext" | "code" | "table" | "none";
	mode: "inactive" | "single" | "expanded" | "block";
	activeCellCoord: { blockId: string; row: number; col: number } | null;
}

export interface FieldEditorStore extends FieldEditor {
	getSnapshot(): FieldEditorStoreSnapshot;
	subscribe(callback: () => void): Unsubscribe;
	applyDocumentTextSelection(
		anchor: { blockId: string; offset: number },
		focus: { blockId: string; offset: number },
	): void;
	applyDomTextSelection(
		anchor: { blockId: string; offset: number },
		focus: { blockId: string; offset: number },
		options?: {
			focusBlockId?: string;
		},
	): void;
	collapseSelectionToPoint(point: { blockId: string; offset: number }): void;
}
