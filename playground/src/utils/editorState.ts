import type { BlockHandle, Editor } from "@pen/types";
import { getAttachedFieldEditorStore } from "@pen/react";

interface SerializedTableCell {
	id: string;
	row: number;
	col: number;
	text: string;
}

interface SerializedTableRow {
	id: string;
	index: number;
	cells: SerializedTableCell[];
}

interface SerializedTableContent {
	columnCount: number;
	rowCount: number;
	columns: ReturnType<BlockHandle["tableColumns"]>;
	rows: SerializedTableRow[];
}

interface SerializedBlock {
	id: string;
	type: string;
	props: BlockHandle["props"];
	text: string;
	children?: SerializedBlock[];
	table?: SerializedTableContent;
}

interface SerializedFieldEditorState {
	focusBlockId: string | null;
	activeBlockIds: readonly string[];
	isEditing: boolean;
	isFocused: boolean;
	inputMode: string;
}

export interface SerializedEditorState {
	blockCount: number;
	selection: ReturnType<typeof serializeSelection>;
	fieldEditor: SerializedFieldEditorState | null;
	blocks: SerializedBlock[];
}

export function serializeEditorState(editor: Editor): SerializedEditorState {
	const blockIds = editor.documentState.blockOrder;
	const selection = editor.selection;
	const fieldEditor = getAttachedFieldEditorStore(editor);
	const fieldEditorState = fieldEditor?.getSnapshot() ?? null;
	const blocks = blockIds
		.map((id) => editor.getBlock(id))
		.filter((block): block is BlockHandle => block !== null && block.parent === null)
		.map((block) => serializeBlock(block));

	return {
		blockCount: blockIds.length,
		selection: selection ? serializeSelection(selection) : null,
		fieldEditor: fieldEditorState
			? {
				focusBlockId: fieldEditorState.focusBlockId,
				activeBlockIds: fieldEditorState.activeBlockIds,
				isEditing: fieldEditorState.isEditing,
				isFocused: fieldEditorState.isFocused,
				inputMode: fieldEditorState.inputMode,
			}
			: null,
		blocks,
	};
}

function serializeBlock(block: BlockHandle): SerializedBlock {
	const children = block.children.map((child) => serializeBlock(child));
	const table = serializeTableContent(block);

	return {
		id: block.id,
		type: block.type,
		props: block.props,
		text: block.textContent(),
		...(children.length > 0 ? { children } : {}),
		...(table ? { table } : {}),
	};
}

function serializeTableContent(block: BlockHandle): SerializedTableContent | null {
	const columns = block.tableColumns();
	const rowCount = block.tableRowCount();

	if (columns.length === 0 && rowCount === 0) {
		return null;
	}

	const rows = Array.from({ length: rowCount }, (_, rowIndex) => {
		const row = block.tableRow(rowIndex);
		const cells = Array.from({ length: Math.max(columns.length, block.tableColumnCount()) }, (_, colIndex) => {
			const cell = block.tableCell(rowIndex, colIndex);

			return {
				id: cell?.id ?? `${block.id}:${rowIndex}:${colIndex}`,
				row: rowIndex,
				col: colIndex,
				text: cell?.textContent() ?? "",
			};
		});

		return {
			id: row?.id ?? `${block.id}:row:${rowIndex}`,
			index: rowIndex,
			cells,
		};
	});

	return {
		columnCount: Math.max(columns.length, block.tableColumnCount()),
		rowCount,
		columns,
		rows,
	};
}
function serializeSelection(selection: Editor["selection"]) {
	if (!selection) {
		return null;
	}

	if (selection.type === "text") {
		return {
			type: selection.type,
			blockId: selection.anchor.blockId,
			anchor: selection.anchor.offset,
			focus: selection.focus.offset,
			collapsed: selection.isCollapsed,
			isMultiBlock: selection.isMultiBlock,
		};
	}

	if (selection.type === "block") {
		return {
			type: selection.type,
			blockIds: selection.blockIds,
		};
	}

	if (selection.type === "cell") {
		return {
			type: selection.type,
			blockId: selection.blockId,
			anchor: selection.anchor,
			head: selection.head,
		};
	}

	return {
		type: selection.type,
		appId: selection.appId,
	};
}
