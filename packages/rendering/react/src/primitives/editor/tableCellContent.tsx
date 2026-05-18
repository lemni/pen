import React, { useRef, useLayoutEffect } from "react";
import { useEditorContext } from "../../context/editorContext";
import { useFieldEditorContext } from "../../context/fieldEditorContext";
import { useFieldEditorState } from "../../hooks/useFieldEditorState";
import { fullReconcileDeltasToDOM } from "../../field-editor/reconciler";
import { useCellTextSnapshot } from "../../hooks/useCellTextSnapshot";
import { DATA_ATTRS } from "../../utils/dataAttributes";
import { fieldEditorTextEntryAttrs } from "../../utils/fieldEditorTextEntryAttrs";

const TABLE_CELL_MIN_WIDTH = "6rem";

export interface TableCellContentProps {
	tableBlockId: string;
	row: number;
	col: number;
	placeholder?: string;
	columnType?: string;
}

export function TableCellContent(props: TableCellContentProps) {
	return <TextCell {...props} />;
}

function TextCell(props: TableCellContentProps) {
	const { tableBlockId, row, col, placeholder } = props;
	const { editor } = useEditorContext();
	const fieldEditor = useFieldEditorContext();
	const fieldEditorState = useFieldEditorState(fieldEditor);
	const textSnapshot = useCellTextSnapshot(editor, tableBlockId, row, col);
	const elementRef = useRef<HTMLSpanElement>(null);

	const isActiveCell = isCellActive(fieldEditorState, tableBlockId, row, col);
	const showPlaceholder =
		!!placeholder &&
		(!textSnapshot.text || textSnapshot.text === "\u200B");

	useLayoutEffect(() => {
		if (isActiveCell && elementRef.current && fieldEditor) {
			fieldEditor.attachElement(elementRef.current);
		}
	}, [isActiveCell, fieldEditor]);

	useLayoutEffect(() => {
		if (isActiveCell) return;
		if (!elementRef.current) return;
		if (!textSnapshot.exists) {
			elementRef.current.replaceChildren();
			return;
		}
		fullReconcileDeltasToDOM(
			[...textSnapshot.deltas],
			elementRef.current,
			editor.schema,
			{ preserveSelection: false },
		);
	}, [editor, isActiveCell, textSnapshot]);

	return (
		<span
			ref={elementRef}
			{...cellSurfaceAttrs(isActiveCell, row, col, showPlaceholder, placeholder)}
		/>
	);
}

function isCellActive(
	fieldEditorState: { activeCellCoord: { blockId: string; row: number; col: number } | null },
	tableBlockId: string,
	row: number,
	col: number,
): boolean {
	return (
		fieldEditorState.activeCellCoord?.blockId === tableBlockId &&
		fieldEditorState.activeCellCoord.row === row &&
		fieldEditorState.activeCellCoord.col === col
	);
}

function cellSurfaceAttrs(
	isActiveCell: boolean,
	row: number,
	col: number,
	showPlaceholder: boolean,
	placeholder?: string,
): Record<string, unknown> {
	return {
		[DATA_ATTRS.inlineContent]: "",
		[DATA_ATTRS.fieldEditorSurface]: "",
		...fieldEditorTextEntryAttrs(isActiveCell),
		[DATA_ATTRS.ignorePointerGesture]: isActiveCell ? "" : undefined,
		[DATA_ATTRS.placeholderVisible]: showPlaceholder ? "" : undefined,
		[DATA_ATTRS.tableCellRow]: row,
		[DATA_ATTRS.tableCellCol]: col,
		"data-placeholder": showPlaceholder ? placeholder : undefined,
		style: {
			minWidth: TABLE_CELL_MIN_WIDTH,
			minHeight: "1.5rem",
			display: "block",
			width: "100%",
			position: showPlaceholder ? ("relative" as const) : undefined,
		},
	};
}
