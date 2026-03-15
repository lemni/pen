import type { CellSelection } from "@pen/types";

export function isCellInSelection(
	selection: CellSelection,
	row: number,
	col: number,
	options?: {
		rowId?: string;
		columnId?: string;
	},
): boolean {
	if (
		selection.rowIds &&
		selection.columnIds &&
		options?.rowId &&
		options?.columnId
	) {
		const rowIndex = selection.rowIds.indexOf(options.rowId);
		const columnIndex = selection.columnIds.indexOf(options.columnId);
		if (rowIndex < 0 || columnIndex < 0) {
			return false;
		}
		row = rowIndex;
		col = columnIndex;
	}
	const minRow = Math.min(selection.anchor.row, selection.head.row);
	const maxRow = Math.max(selection.anchor.row, selection.head.row);
	const minCol = Math.min(selection.anchor.col, selection.head.col);
	const maxCol = Math.max(selection.anchor.col, selection.head.col);
	return row >= minRow && row <= maxRow && col >= minCol && col <= maxCol;
}
