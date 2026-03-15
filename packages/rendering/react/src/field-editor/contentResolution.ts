import type { Editor } from "@pen/types";
import type { ActiveCellCoord } from "./controller";
import type { FieldEditorTextLike } from "./crdt";

export function getBlockYText(
	editor: Editor,
	blockId: string,
): FieldEditorTextLike | null {
	return (editor.internals.getBlockText(blockId) as FieldEditorTextLike | null) ?? null;
}

export function getCellYText(
	editor: Editor,
	blockId: string,
	row: number,
	col: number,
): FieldEditorTextLike | null {
	return (
		editor.internals.getCellText(blockId, row, col) as FieldEditorTextLike | null
	) ?? null;
}

export function getResolvedYText(
	editor: Editor,
	blockId: string,
	activeCellCoord: ActiveCellCoord | null,
): FieldEditorTextLike | null {
	if (activeCellCoord?.blockId === blockId) {
		return getCellYText(
			editor,
			activeCellCoord.blockId,
			activeCellCoord.row,
			activeCellCoord.col,
		);
	}
	return getBlockYText(editor, blockId);
}

export function resolveCellInlineElement(
	blockId: string,
	row: number,
	col: number,
	root: HTMLElement | null | undefined,
): HTMLElement | null {
	if (!root) return null;
	return root.querySelector(
		`[data-block-id="${blockId}"] [data-cell-row="${row}"][data-cell-col="${col}"] [data-pen-inline-content]`,
	) as HTMLElement | null;
}
