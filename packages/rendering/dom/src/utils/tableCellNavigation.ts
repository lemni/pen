import type { CellSelection, DocumentOp, Editor } from "@pen/types";
import {
	hasIndexedCellSelectionMetadata,
	resolveCellSelectionCoord,
	resolveCellSelectionMatrix,
} from "@pen/core";
import {
	delegatesToGridEditing,
	usesInlineTextSelection,
} from "@pen/types";
import type { FieldEditorTableNavigationController } from "../field-editor/controller";
import { getAdjacentVisibleBlockId } from "./parentIdTree";

export function handleTableCellSelectionKeyDown(options: {
	event: KeyboardEvent;
	editor: Editor;
	fieldEditor: FieldEditorTableNavigationController;
	root: HTMLElement;
}): boolean {
	const { event, editor, fieldEditor, root } = options;
	const selection = editor.selection;

	if (selection?.type !== "cell") return false;
	if (event.defaultPrevented || event.isComposing) return false;
	if (fieldEditor.isEditing) return false;

	const { blockId, anchor, head } = selection;
	const block = editor.getBlock(blockId);
	if (!block) return false;
	if (
		isActiveCellInputHandlingKeys(
			event,
			blockId,
			block,
			selection,
			head.row,
			head.col,
		)
	) {
		return false;
	}

	const cellKeyDownSlot = editor.internals.getSlot("database:cell-keydown") as
		| ((
				event: KeyboardEvent,
				context: { blockId: string; row: number; col: number; root: HTMLElement },
		  ) => boolean)
		| undefined;
	const slotCoord = resolveCellSelectionCoord(block, selection, {
		row: head.row,
		col: head.col,
	});
	if (
		cellKeyDownSlot &&
		slotCoord &&
		cellKeyDownSlot(event, {
			blockId,
			row: slotCoord.row,
			col: slotCoord.col,
			root,
		})
	) {
		return true;
	}

	const rowCount = selection.rowIds?.length ?? block.tableRowCount();
	const colCount = selection.columnIds?.length ?? block.tableColumnCount();

	if (isArrowKey(event.key) && !event.metaKey && !event.ctrlKey && !event.altKey) {
		event.preventDefault();
		const delta = arrowDelta(event.key);
		if (event.shiftKey) {
			const nextHead = clampCoord(
				{ row: head.row + delta.row, col: head.col + delta.col },
				rowCount,
				colCount,
			);
			setCellSelection(editor, selection, anchor, nextHead);
		} else {
			const exitsGrid =
				(event.key === "ArrowUp" && head.row === 0) ||
				(event.key === "ArrowLeft" && head.col === 0) ||
				(event.key === "ArrowDown" && head.row === rowCount - 1) ||
				(event.key === "ArrowRight" && head.col === colCount - 1);
			if (exitsGrid) {
				moveSelectionToAdjacentBlock(editor, fieldEditor, blockId, event.key);
				return true;
			}
			const next = wrapCoord(
				{ row: head.row + delta.row, col: head.col + delta.col },
				rowCount,
				colCount,
			);
			setCellSelection(editor, selection, next);
		}
		return true;
	}

	if (event.key === "Tab" && !event.metaKey && !event.ctrlKey && !event.altKey) {
		event.preventDefault();
		const direction = event.shiftKey ? -1 : 1;
		const linearIdx = head.row * colCount + head.col + direction;
		const totalCells = rowCount * colCount;
		const clamped = Math.max(0, Math.min(totalCells - 1, linearIdx));
		const nextRow = Math.floor(clamped / colCount);
		const nextCol = clamped % colCount;
		setCellSelection(editor, selection, { row: nextRow, col: nextCol });
		return true;
	}

	if ((event.key === "Enter" || event.key === "F2") && !event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey) {
		event.preventDefault();
		activateCellEditing(editor, fieldEditor, blockId, selection, head.row, head.col, root);
		return true;
	}

	if ((event.key === "Backspace" || event.key === "Delete") && !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey) {
		event.preventDefault();
		editor.deleteSelection({ origin: "user" });
		return true;
	}

	if (isSelectAllShortcut(event)) {
		event.preventDefault();
		setCellSelection(
			editor,
			selection,
			{ row: 0, col: 0 },
			{ row: rowCount - 1, col: colCount - 1 },
		);
		return true;
	}

	if (isCopyShortcut(event)) {
		event.preventDefault();
		void copyCellSelection(editor, selection);
		return true;
	}

	if (isCutShortcut(event)) {
		event.preventDefault();
		void cutCellSelection(editor, selection);
		return true;
	}

	if (isPasteShortcut(event)) {
		event.preventDefault();
		pasteCellSelection(editor, selection);
		return true;
	}

	if (isPrintableKey(event)) {
		event.preventDefault();
		const cellCoord = head;
		clearCellContent(editor, selection, blockId, cellCoord.row, cellCoord.col);
		activateCellEditing(editor, fieldEditor, blockId, selection, cellCoord.row, cellCoord.col, root);
		insertCharInActiveCell(editor, selection, blockId, cellCoord.row, cellCoord.col, event.key);
		return true;
	}

	return false;
}

function moveSelectionToAdjacentBlock(
	editor: Editor,
	fieldEditor: FieldEditorTableNavigationController,
	blockId: string,
	key: string,
): void {
	const direction =
		key === "ArrowUp" || key === "ArrowLeft" ? "previous" : "next";
	const adjacentId = getAdjacentVisibleBlockId(editor, blockId, direction);
	if (!adjacentId) {
		editor.selectBlock(blockId);
		fieldEditor.deactivate();
		return;
	}

	const adjacentBlock = editor.getBlock(adjacentId);
	if (!adjacentBlock) {
		editor.selectBlock(blockId);
		fieldEditor.deactivate();
		return;
	}

	const schema = editor.schema.resolve(adjacentBlock.type);
	if (delegatesToGridEditing(schema)) {
		const targetRow =
			direction === "previous" ? Math.max(adjacentBlock.tableRowCount() - 1, 0) : 0;
		const targetCol =
			direction === "previous"
				? Math.max(adjacentBlock.tableColumnCount() - 1, 0)
				: 0;
		editor.selectCell(adjacentId, targetRow, targetCol);
		fieldEditor.deactivate();
		return;
	}

	if (usesInlineTextSelection(schema)) {
		const offset = direction === "previous" ? adjacentBlock.length() : 0;
		fieldEditor.activateTextSelection(adjacentId, offset, offset);
		return;
	}

	editor.selectBlock(adjacentId);
	fieldEditor.deactivate();
}

function isActiveCellInputHandlingKeys(
	event: KeyboardEvent,
	blockId: string,
	block: NonNullable<ReturnType<Editor["getBlock"]>>,
	selection: CellSelection,
	row: number,
	col: number,
): boolean {
	const rawTarget = event.target;
	const target =
		rawTarget instanceof HTMLElement
			? rawTarget
			: rawTarget instanceof Node
				? rawTarget.parentElement
				: null;
	if (!(target instanceof HTMLElement)) {
		return false;
	}

	const resolvedCoord = resolveCellSelectionCoord(block, selection, { row, col });
	if (!resolvedCoord) {
		return false;
	}

	const activeCell = target.closest(
		`[data-block-id="${blockId}"] [data-cell-row="${resolvedCoord.row}"][data-cell-col="${resolvedCoord.col}"]`,
	);
	if (!(activeCell instanceof HTMLElement)) {
		return false;
	}

	if (target.closest("[data-pen-field-editor-surface]")) {
		return true;
	}

	return !!target.closest(
		"[data-pen-db-widget-trigger], input, button, select, textarea",
	);
}

function setCellSelection(
	editor: Editor,
	selection: CellSelection,
	anchor: { row: number; col: number },
	head: { row: number; col: number } = anchor,
): void {
	if (hasIndexedCellSelectionMetadata(selection)) {
		editor.setSelection({
			...selection,
			anchor,
			head,
		});
		return;
	}
	if (anchor.row === head.row && anchor.col === head.col) {
		editor.selectCell(selection.blockId, anchor.row, anchor.col);
		return;
	}
	editor.selectCellRange(selection.blockId, anchor, head);
}

function activateCellEditing(
	editor: Editor,
	fieldEditor: FieldEditorTableNavigationController,
	blockId: string,
	selection: CellSelection,
	row: number,
	col: number,
	root: HTMLElement,
): void {
	const block = editor.getBlock(blockId);
	if (!block) {
		return;
	}
	const resolvedCoord = resolveCellSelectionCoord(block, selection, {
		row,
		col,
	});
	if (!resolvedCoord) {
		return;
	}
	const cellSurface = root.querySelector(
		`[data-block-id="${blockId}"] [data-cell-row="${resolvedCoord.row}"][data-cell-col="${resolvedCoord.col}"] [data-pen-field-editor-surface]`,
	) as HTMLElement | null;

	if (cellSurface) {
		fieldEditor.activateCellFromElement?.(
			blockId,
			resolvedCoord.row,
			resolvedCoord.col,
			cellSurface,
		) ?? fieldEditor.activateCell?.(blockId, resolvedCoord.row, resolvedCoord.col);
	} else {
		fieldEditor.activateCell?.(blockId, resolvedCoord.row, resolvedCoord.col);
	}
}

function clearCellContent(
	editor: Editor,
	selection: CellSelection,
	blockId: string,
	row: number,
	col: number,
): void {
	const block = editor.getBlock(blockId);
	if (!block) return;
	const resolvedCoord = resolveCellSelectionCoord(block, selection, { row, col });
	if (!resolvedCoord) return;
	const cell = block.tableCell(resolvedCoord.row, resolvedCoord.col);
	if (!cell) return;
	const length = cell.length();
	if (length > 0) {
		editor.apply([{
			type: "delete-table-cell-text",
			blockId,
			row: resolvedCoord.row,
			col: resolvedCoord.col,
			offset: 0,
			length,
		}], { origin: "user" });
	}
}

function insertCharInActiveCell(
	editor: Editor,
	selection: CellSelection,
	blockId: string,
	row: number,
	col: number,
	char: string,
): void {
	const block = editor.getBlock(blockId);
	if (!block) {
		return;
	}
	const resolvedCoord = resolveCellSelectionCoord(block, selection, { row, col });
	if (!resolvedCoord) {
		return;
	}
	editor.apply([{
		type: "insert-table-cell-text",
		blockId,
		row: resolvedCoord.row,
		col: resolvedCoord.col,
		offset: 0,
		text: char,
	}], { origin: "user" });
}

function isArrowKey(key: string): boolean {
	return key === "ArrowUp" || key === "ArrowDown" || key === "ArrowLeft" || key === "ArrowRight";
}

function arrowDelta(key: string): { row: number; col: number } {
	switch (key) {
		case "ArrowUp": return { row: -1, col: 0 };
		case "ArrowDown": return { row: 1, col: 0 };
		case "ArrowLeft": return { row: 0, col: -1 };
		case "ArrowRight": return { row: 0, col: 1 };
		default: return { row: 0, col: 0 };
	}
}

function clampCoord(
	coord: { row: number; col: number },
	rowCount: number,
	colCount: number,
): { row: number; col: number } {
	return {
		row: Math.max(0, Math.min(rowCount - 1, coord.row)),
		col: Math.max(0, Math.min(colCount - 1, coord.col)),
	};
}

function wrapCoord(
	coord: { row: number; col: number },
	rowCount: number,
	colCount: number,
): { row: number; col: number } {
	let { row, col } = coord;

	if (col < 0) {
		col = colCount - 1;
		row--;
	} else if (col >= colCount) {
		col = 0;
		row++;
	}

	row = Math.max(0, Math.min(rowCount - 1, row));
	col = Math.max(0, Math.min(colCount - 1, col));

	return { row, col };
}

function isPrintableKey(event: KeyboardEvent): boolean {
	if (event.metaKey || event.ctrlKey || event.altKey) return false;
	if (event.key.length !== 1) return false;
	return true;
}

function isSelectAllShortcut(event: KeyboardEvent): boolean {
	return (
		event.key.toLowerCase() === "a" &&
		!event.shiftKey &&
		!event.altKey &&
		(event.metaKey || event.ctrlKey)
	);
}

function isCopyShortcut(event: KeyboardEvent): boolean {
	return (
		event.key.toLowerCase() === "c" &&
		!event.shiftKey &&
		!event.altKey &&
		(event.metaKey || event.ctrlKey)
	);
}

function isCutShortcut(event: KeyboardEvent): boolean {
	return (
		event.key.toLowerCase() === "x" &&
		!event.shiftKey &&
		!event.altKey &&
		(event.metaKey || event.ctrlKey)
	);
}

function isPasteShortcut(event: KeyboardEvent): boolean {
	return (
		event.key.toLowerCase() === "v" &&
		!event.shiftKey &&
		!event.altKey &&
		(event.metaKey || event.ctrlKey)
	);
}

async function cutCellSelection(
	editor: Editor,
	selection: CellSelection,
): Promise<void> {
	const copied = await copyCellSelection(editor, selection);
	if (copied) {
		editor.deleteSelection();
	}
}

async function copyCellSelection(
	editor: Editor,
	selection: CellSelection,
): Promise<boolean> {
	const block = editor.getBlock(selection.blockId);
	if (!block) return false;

	const cellData: string[][] = [];
	for (const rowCells of resolveCellSelectionMatrix(block, selection)) {
		const row: string[] = [];
		for (const cellCoord of rowCells) {
			const cell = block.tableCell(cellCoord.row, cellCoord.col);
			row.push(cell?.textContent() ?? "");
		}
		cellData.push(row);
	}

	const tabSeparated = cellData.map((row) => row.join("\t")).join("\n");
	const penCells = JSON.stringify({
		cells: cellData,
		rows: cellData.length,
		cols: Math.max(...cellData.map((row) => row.length), 0),
	});
	const encodedPenCells = encodeURIComponent(penCells);

	const htmlRows = cellData.map((row) =>
		`<tr>${row.map((c) => `<td>${escapeHtml(c)}</td>`).join("")}</tr>`,
	).join("");
	const html = `<table>${htmlRows}</table>`;
	const clipboard = globalThis.navigator?.clipboard;
	if (!clipboard) {
		return false;
	}

	if (
		typeof ClipboardItem !== "undefined" &&
		typeof clipboard.write === "function"
	) {
		try {
			await clipboard.write([
				new ClipboardItem({
					"text/plain": new Blob([tabSeparated], { type: "text/plain" }),
					"text/html": new Blob(
						[`<meta data-pen-cells="${encodedPenCells}" />${html}`],
						{ type: "text/html" },
					),
				}),
			]);
			return true;
		} catch {
			// Fall through to plain-text clipboard writes below.
		}
	}

	if (typeof clipboard.writeText === "function") {
		try {
			await clipboard.writeText(tabSeparated);
			return true;
		} catch {
			return false;
		}
	}

	return false;
}

function pasteCellSelection(editor: Editor, selection: CellSelection): void {
	navigator.clipboard.read().then((items) => {
		for (const item of items) {
			if (item.types.includes("text/html")) {
				item.getType("text/html").then((blob) => {
					blob.text().then((html) => {
						const penCellsMatch = html.match(/data-pen-cells=(['"])(.*?)\1/);
						if (penCellsMatch) {
							try {
								const parsed = parseEncodedCellPayload(penCellsMatch[2]);
								applyPastedCells(editor, selection, parsed.cells);
								return;
							} catch {
								// Fall through to plain-text clipboard reads below.
							}
						}
						pasteFromPlainText(editor, selection);
					});
				});
				return;
			}
		}
		pasteFromPlainText(editor, selection);
	}).catch(() => {
		pasteFromPlainText(editor, selection);
	});
}

function pasteFromPlainText(editor: Editor, selection: CellSelection): void {
	navigator.clipboard.readText().then((text) => {
		const cells = text.split("\n").map((row) => row.split("\t"));
		applyPastedCells(editor, selection, cells);
	}).catch(() => { });
}

function applyPastedCells(editor: Editor, selection: CellSelection, cellData: string[][]): void {
	const block = editor.getBlock(selection.blockId);
	if (!block) return;

	const rowCount = selection.rowIds?.length ?? block.tableRowCount();
	const colCount = selection.columnIds?.length ?? block.tableColumnCount();
	const startRow = Math.min(selection.anchor.row, selection.head.row);
	const startCol = Math.min(selection.anchor.col, selection.head.col);

	const ops: DocumentOp[] = [];
	for (let r = 0; r < cellData.length; r++) {
		const targetRow = startRow + r;
		if (targetRow >= rowCount) break;
		for (let c = 0; c < cellData[r].length; c++) {
			const targetCol = startCol + c;
			if (targetCol >= colCount) break;
			const resolvedCoord = resolveCellSelectionCoord(block, selection, {
				row: targetRow,
				col: targetCol,
			});
			if (!resolvedCoord) continue;
			const cell = block.tableCell(resolvedCoord.row, resolvedCoord.col);
			if (!cell) continue;
			const existingLen = cell.textContent().length;
			if (existingLen > 0) {
				ops.push({
					type: "delete-table-cell-text",
					blockId: selection.blockId,
					row: resolvedCoord.row,
					col: resolvedCoord.col,
					offset: 0,
					length: existingLen,
				});
			}
			const pasteText = cellData[r][c];
			if (pasteText.length > 0) {
				ops.push({
					type: "insert-table-cell-text",
					blockId: selection.blockId,
					row: resolvedCoord.row,
					col: resolvedCoord.col,
					offset: 0,
					text: pasteText,
				});
			}
		}
	}

	if (ops.length > 0) {
		editor.apply(ops, { origin: "user" });
	}
}

function parseEncodedCellPayload(raw: string): { cells: string[][] } {
	try {
		return JSON.parse(decodeURIComponent(raw)) as { cells: string[][] };
	} catch {
		return JSON.parse(raw) as { cells: string[][] };
	}
}

function escapeHtml(text: string): string {
	return text
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}
