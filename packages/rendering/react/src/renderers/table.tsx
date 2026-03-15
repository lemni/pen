import React from "react";
import type { BlockHandle, BlockRenderContext, CellSelection } from "@pen/types";
import { useEditorContext } from "../context/editorContext";
import { useFieldEditorContext } from "../context/fieldEditorContext";
import { useFieldEditorState } from "../hooks/useFieldEditorState";
import { useSelection } from "../hooks/useSelection";
import { DATA_ATTRS } from "../utils/dataAttributes";
import { isCellInSelection } from "../utils/cellSelection";
import { TableCellContent } from "../primitives/editor/tableCellContent";

const TABLE_ADD_COLUMN_LABEL = "Add column";
const TABLE_ADD_ROW_LABEL = "Add row";

function TableRendererInner(props: {
	block: BlockHandle;
	ctx: BlockRenderContext;
}) {
	const { block, ctx } = props;
	const { editor, readonly } = useEditorContext();
	const fieldEditor = useFieldEditorContext();
	const fieldEditorState = useFieldEditorState(fieldEditor);
	const editorSelection = useSelection(editor);

	const rowCount = block.tableRowCount();
	const colCount = block.tableColumnCount();
	const hasHeaderRow = !!block.props.hasHeaderRow;

	const cellSelection =
		editorSelection?.type === "cell" && editorSelection.blockId === block.id
			? editorSelection
			: null;

	const isEditingThisCell = (row: number, col: number) =>
		fieldEditorState.activeCellCoord?.blockId === block.id &&
		fieldEditorState.activeCellCoord.row === row &&
		fieldEditorState.activeCellCoord.col === col;

	function handleCellMouseDown(
		event: React.MouseEvent<HTMLTableCellElement>,
		row: number,
		col: number,
	) {
		if (readonly || !fieldEditor) return;
		if (isEditingThisCell(row, col)) return;

		event.preventDefault();
		event.stopPropagation();

		if (event.shiftKey && cellSelection) {
			editor.selectCellRange(block.id, cellSelection.anchor, { row, col });
			return;
		}

		editor.selectCell(block.id, row, col);
	}

	function handleCellDoubleClick(
		event: React.MouseEvent<HTMLTableCellElement>,
		row: number,
		col: number,
	) {
		if (readonly || !fieldEditor) return;

		event.preventDefault();
		event.stopPropagation();

		const cellSurface = event.currentTarget.querySelector(
			`[${DATA_ATTRS.fieldEditorSurface}]`,
		) as HTMLElement | null;
		if (cellSurface) {
			fieldEditor.activateCellFromElement?.(block.id, row, col, cellSurface)
				?? fieldEditor.activateCell?.(block.id, row, col);
		} else {
			fieldEditor.activateCell?.(block.id, row, col);
		}
	}

	function handleAddRow() {
		editor.apply([{ type: "insert-table-row", blockId: block.id, index: rowCount }]);
	}

	function handleAddColumn() {
		editor.apply([{ type: "insert-table-column", blockId: block.id, index: colCount }]);
	}

	function handleControlMouseDown(event: React.MouseEvent<HTMLButtonElement>) {
		event.preventDefault();
		event.stopPropagation();
	}

	const cellAttrs = (row: number, col: number) => ({
		[DATA_ATTRS.tableCell]: "",
		[DATA_ATTRS.tableCellRow]: row,
		[DATA_ATTRS.tableCellCol]: col,
		"data-pen-cell-selected": cellSelection && isCellInSelection(cellSelection, row, col) ? "" : undefined,
	});

	const headerCells = hasHeaderRow
		? Array.from({ length: colCount }, (_, colIdx) => (
			<th
				key={`hdr-${colIdx}`}
				{...cellAttrs(0, colIdx)}
				onMouseDown={(e) => handleCellMouseDown(e, 0, colIdx)}
				onDoubleClick={(e) => handleCellDoubleClick(e, 0, colIdx)}
			>
				<TableCellContent
					tableBlockId={block.id}
					row={0}
					col={colIdx}
					placeholder={`Column ${colIdx + 1}`}
				/>
			</th>
		))
		: null;

	const dataStartRow = hasHeaderRow ? 1 : 0;

	const bodyRows: React.ReactElement[] = [];
	for (let rowIdx = dataStartRow; rowIdx < rowCount; rowIdx++) {
		const cells: React.ReactElement[] = [];
		for (let colIdx = 0; colIdx < colCount; colIdx++) {
			cells.push(
				<td
					key={`cell-${rowIdx}-${colIdx}`}
					{...cellAttrs(rowIdx, colIdx)}
					onMouseDown={(e) => handleCellMouseDown(e, rowIdx, colIdx)}
					onDoubleClick={(e) => handleCellDoubleClick(e, rowIdx, colIdx)}
				>
					<TableCellContent
						tableBlockId={block.id}
						row={rowIdx}
						col={colIdx}
					/>
				</td>,
			);
		}
		bodyRows.push(
			<tr key={`row-${rowIdx}`} data-pen-table-row="" data-row={rowIdx}>
				{cells}
			</tr>,
		);
	}

	const addColumnControl = readonly ? null : (
		<button
			type="button"
			className="pen-table-add-column-control"
			aria-label={TABLE_ADD_COLUMN_LABEL}
			{...{ [DATA_ATTRS.ignorePointerGesture]: "" }}
			onMouseDown={handleControlMouseDown}
			onClick={handleAddColumn}
		>
			<span>+</span>
		</button>
	);

	const addRowControl = readonly ? null : (
		<button
			type="button"
			className="pen-table-add-row-control"
			aria-label={TABLE_ADD_ROW_LABEL}
			{...{ [DATA_ATTRS.ignorePointerGesture]: "" }}
			onMouseDown={handleControlMouseDown}
			onClick={handleAddRow}
		>
			<span>+</span>
		</button>
	);

	return (
		<div
			ref={ctx.ref as React.Ref<HTMLDivElement>}
			data-block-type="table"
			data-selected={ctx.selected || undefined}
		>
			<div className="pen-table-shell">
				<div className="pen-table-main">
					<div
						{...{ [DATA_ATTRS.tableFrame]: "" }}
						data-selected={ctx.selected || undefined}
					>
						<table {...{ [DATA_ATTRS.table]: "" }}>
							{hasHeaderRow && headerCells && (
								<thead>
									<tr data-pen-table-row="" data-row="header">
										{headerCells}
									</tr>
								</thead>
							)}
							<tbody>{bodyRows}</tbody>
						</table>
					</div>
					{addRowControl}
				</div>
				{addColumnControl}
			</div>
		</div>
	);
}

export function TableRenderer(
	block: BlockHandle,
	ctx: BlockRenderContext,
): React.ReactElement {
	return <TableRendererInner block={block} ctx={ctx} />;
}
