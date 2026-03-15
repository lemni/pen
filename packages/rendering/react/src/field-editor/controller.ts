import type { BlockSchema } from "@pen/types";
import type { FieldEditorStore } from "./store";
import type { EditorSelectAllBehavior } from "../constants/selectAll";

export type ActiveCellCoord = {
	blockId: string;
	row: number;
	col: number;
};

type FieldEditorSelectionState = Pick<
	FieldEditorStore,
	| "focusBlockId"
	| "selection"
	| "inputMode"
	| "isEditing"
	| "isComposing"
> & {
	readonly activeCellCoord: ActiveCellCoord | null;
};

export interface FieldEditorRootHandle {
	setRootElement(element: HTMLElement | null): void;
	setFocused(focused: boolean): void;
	setSelectAllBehavior(behavior: EditorSelectAllBehavior): void;
	deactivate(): void;
	activateTextSelection(
		blockId: string,
		anchorOffset: number,
		focusOffset: number,
	): void;
}

export interface FieldEditorDomController extends FieldEditorSelectionState {
	setComposing(composing: boolean): void;
	shouldHandleDomSelectionChange(isApplyingSelection: number): boolean;
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
	resolveInsertMarks(
		ytext: { toDelta(): unknown[] },
		offset: number,
	): Record<string, unknown | null> | undefined;
	syncTextSelection(
		blockId: string,
		anchorOffset: number,
		focusOffset: number,
	): void;
	activateTextSelection(
		blockId: string,
		anchorOffset: number,
		focusOffset: number,
	): void;
	deactivate(): void;
}

export interface FieldEditorKeyboardController
	extends Pick<FieldEditorSelectionState, "focusBlockId" | "inputMode"> {
	readonly activeCellCoord: ActiveCellCoord | null;
	activateCell(blockId: string, row: number, col: number): void;
	activateTextSelection(
		blockId: string,
		anchorOffset: number,
		focusOffset: number,
	): void;
	deactivate(): void;
	selectAll(rootElement?: HTMLElement | null): boolean;
}

export interface FieldEditorTableNavigationController {
	readonly isEditing: boolean;
	activateCell?(blockId: string, row: number, col: number): void;
	activateCellFromElement?(
		blockId: string,
		row: number,
		col: number,
		element: HTMLElement,
	): void;
	activateTextSelection(
		blockId: string,
		anchorOffset: number,
		focusOffset: number,
	): void;
	deactivate(): void;
}

export interface FieldEditorEscapeController
	extends Pick<
		FieldEditorSelectionState,
		"focusBlockId" | "isEditing" | "isComposing"
	> {
	readonly activeCellCoord: ActiveCellCoord | null;
	collapseSelectionToFocus(): void;
	deactivate(): void;
}

export interface FieldEditorTransferController {
	activateTextSelection(
		blockId: string,
		anchorOffset: number,
		focusOffset: number,
	): void;
}

export type FieldEditorInputController = FieldEditorDomController &
	FieldEditorKeyboardController;

export type FieldEditorSession = FieldEditorStore &
	FieldEditorRootHandle &
	FieldEditorInputController &
	FieldEditorTableNavigationController &
	FieldEditorEscapeController & {
		beginPointerSelection(): void;
		endPointerSelection(): void;
	selectAll(rootElement?: HTMLElement | null): boolean;
	resetSelectAllCycle(): void;
	suspendForPointerSelection(): void;
	getPendingMarks(): Readonly<Record<string, unknown | null>>;
	togglePendingMark(markType: string): boolean;
	clearPendingMarks(): void;
	collapseSelectionToAnchor(): void;
	collapseSelectionToPoint(point: { blockId: string; offset: number }): void;
	delegate(blockSchema: BlockSchema): boolean;
};
