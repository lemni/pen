import type { CellSelection } from "@pen/types";

export function isCellInSelection(
	selection: CellSelection,
	row: number,
	col: number,
): boolean {
	const minRow = Math.min(selection.anchor.row, selection.head.row);
	const maxRow = Math.max(selection.anchor.row, selection.head.row);
	const minCol = Math.min(selection.anchor.col, selection.head.col);
	const maxCol = Math.max(selection.anchor.col, selection.head.col);
	return row >= minRow && row <= maxRow && col >= minCol && col <= maxCol;
}
