import React, { useRef, useLayoutEffect, useState } from "react";
import type { Editor } from "@pen/core";
import {
	normalizeStoredMultiSelectValue,
	normalizeStoredSelectValue,
	resolveStoredSelectOption,
} from "@pen/core";
import {
	useEditorContext,
	useFieldEditorContext,
	useFieldEditorState,
	useCellTextSnapshot,
	DATA_ATTRS,
} from "@pen/react";
import { fullReconcileDeltasToDOM } from "@pen/react";
import type { ColumnType, DatabaseColumnDef, SelectOption } from "./types";
import { isContentEditableColumnType } from "./types";
import type { CellEditorRegistry } from "./cellEditorRegistry";

export const DATABASE_CELL_EDITOR_REGISTRY_SLOT = "database:cell-editor-registry";

export interface DatabaseCellContentProps {
	blockId: string;
	row: number;
	col: number;
	column: DatabaseColumnDef;
	placeholder?: string;
	readonly?: boolean;
}

export function DatabaseCellContent(props: DatabaseCellContentProps) {
	const { column } = props;
	const { editor } = useEditorContext();
	const registry = editor.internals.getSlot(DATABASE_CELL_EDITOR_REGISTRY_SLOT) as CellEditorRegistry | undefined;
	const CustomEditor = registry?.get(column.type);
	if (CustomEditor) {
		return <CustomEditor {...props} />;
	}
	return <BuiltInCellContent {...props} />;
}

function BuiltInCellContent(props: DatabaseCellContentProps) {
	const { column } = props;
	switch (column.type) {
		case "checkbox":
			return <CheckboxCell {...props} />;
		case "select":
			return <SelectCell {...props} />;
		case "multiSelect":
			return <MultiSelectCell {...props} />;
		case "relation":
			return <RelationCell {...props} />;
		case "formula":
			return <FormulaCell {...props} />;
		case "date":
			return <DateCell {...props} />;
		case "number":
			return <NumberCell {...props} />;
		case "url":
			return <UrlCell {...props} />;
		case "email":
			return <EmailCell {...props} />;
		default:
			return <TextCell {...props} />;
	}
}

function TextCell(props: DatabaseCellContentProps) {
	const { blockId, row, col, placeholder } = props;
	const { editor } = useEditorContext();
	const fieldEditor = useFieldEditorContext();
	const fieldEditorState = useFieldEditorState(fieldEditor);
	const textSnapshot = useCellTextSnapshot(editor, blockId, row, col);
	const elementRef = useRef<HTMLSpanElement>(null);

	const isActive = isCellActive(fieldEditorState, blockId, row, col);
	const showPlaceholder = !!placeholder && (!textSnapshot.text || textSnapshot.text === "\u200B");

	useLayoutEffect(() => {
		if (isActive && elementRef.current && fieldEditor) {
			fieldEditor.attachElement(elementRef.current);
		}
	}, [isActive, fieldEditor]);

	useLayoutEffect(() => {
		if (isActive) return;
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
	}, [editor, isActive, textSnapshot]);

	return (
		<span
			ref={elementRef}
			{...editableCellAttrs(isActive, row, col, showPlaceholder, placeholder)}
		/>
	);
}

function NumberCell(props: DatabaseCellContentProps) {
	const { blockId, row, col, placeholder } = props;
	const { editor } = useEditorContext();
	const fieldEditor = useFieldEditorContext();
	const fieldEditorState = useFieldEditorState(fieldEditor);
	const textSnapshot = useCellTextSnapshot(editor, blockId, row, col);
	const elementRef = useRef<HTMLSpanElement>(null);

	const isActive = isCellActive(fieldEditorState, blockId, row, col);
	const showPlaceholder = !!placeholder && (!textSnapshot.text || textSnapshot.text === "\u200B");

	useLayoutEffect(() => {
		if (isActive && elementRef.current && fieldEditor) {
			fieldEditor.attachElement(elementRef.current);
		}
	}, [isActive, fieldEditor]);

	useLayoutEffect(() => {
		if (isActive) return;
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
	}, [editor, isActive, textSnapshot]);

	return (
		<span
			ref={elementRef}
			{...editableCellAttrs(isActive, row, col, showPlaceholder, placeholder)}
			style={{ textAlign: "right", display: "block", width: "100%", minWidth: "4rem", minHeight: "1.5rem" }}
		/>
	);
}

function UrlCell(props: DatabaseCellContentProps) {
	const { blockId, row, col, placeholder } = props;
	const { editor } = useEditorContext();
	const fieldEditor = useFieldEditorContext();
	const fieldEditorState = useFieldEditorState(fieldEditor);
	const textSnapshot = useCellTextSnapshot(editor, blockId, row, col);
	const elementRef = useRef<HTMLSpanElement>(null);

	const isActive = isCellActive(fieldEditorState, blockId, row, col);
	const rawText = textSnapshot.text ?? "";
	const showPlaceholder = !!placeholder && (!rawText || rawText === "\u200B");

	useLayoutEffect(() => {
		if (isActive && elementRef.current && fieldEditor) {
			fieldEditor.attachElement(elementRef.current);
		}
	}, [isActive, fieldEditor]);

	useLayoutEffect(() => {
		if (isActive) return;
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
	}, [editor, isActive, textSnapshot]);

	return (
		<span
			ref={elementRef}
			{...editableCellAttrs(isActive, row, col, showPlaceholder, placeholder)}
			className="pen-db-url-cell"
		/>
	);
}

function EmailCell(props: DatabaseCellContentProps) {
	const { blockId, row, col, placeholder } = props;
	const { editor } = useEditorContext();
	const fieldEditor = useFieldEditorContext();
	const fieldEditorState = useFieldEditorState(fieldEditor);
	const textSnapshot = useCellTextSnapshot(editor, blockId, row, col);
	const elementRef = useRef<HTMLSpanElement>(null);

	const isActive = isCellActive(fieldEditorState, blockId, row, col);
	const rawText = textSnapshot.text ?? "";
	const showPlaceholder = !!placeholder && (!rawText || rawText === "\u200B");

	useLayoutEffect(() => {
		if (isActive && elementRef.current && fieldEditor) {
			fieldEditor.attachElement(elementRef.current);
		}
	}, [isActive, fieldEditor]);

	useLayoutEffect(() => {
		if (isActive) return;
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
	}, [editor, isActive, textSnapshot]);

	return (
		<span
			ref={elementRef}
			{...editableCellAttrs(isActive, row, col, showPlaceholder, placeholder)}
			className="pen-db-email-cell"
		/>
	);
}

function CheckboxCell(props: DatabaseCellContentProps) {
	const { blockId, row, col } = props;
	const { editor } = useEditorContext();
	const readonly = !!props.readonly;
	const textSnapshot = useCellTextSnapshot(editor, blockId, row, col);
	const isChecked = textSnapshot.text?.toLowerCase() === "true";

	function handleToggle(event: React.MouseEvent) {
		if (readonly) return;
		event.preventDefault();
		event.stopPropagation();
		toggleCheckbox(editor, blockId, row, col, isChecked);
	}

	function handleKeyDown(event: React.KeyboardEvent) {
		if (readonly) return;
		if (event.key === " " || event.key === "Enter") {
			event.preventDefault();
			event.stopPropagation();
			toggleCheckbox(editor, blockId, row, col, isChecked);
		}
	}

	return (
		<span
			{...widgetCellAttrs(row, col)}
			role="checkbox"
			aria-checked={isChecked}
			tabIndex={0}
			onClick={handleToggle}
			onKeyDown={handleKeyDown}
			className="pen-db-checkbox"
		>
			{isChecked ? "☑" : "☐"}
		</span>
	);
}

function SelectCell(props: DatabaseCellContentProps) {
	const { blockId, row, col, column } = props;
	const { editor } = useEditorContext();
	const readonly = !!props.readonly;
	const textSnapshot = useCellTextSnapshot(editor, blockId, row, col);
	const currentValue = textSnapshot.text ?? "";
	const options = column.options ?? [];
	const matchedOption = resolveStoredSelectOption(currentValue, options);
	const normalizedValue = normalizeStoredSelectValue(currentValue, options);
	const [isOpen, setIsOpen] = useState(false);

	function handleSelect(option: SelectOption) {
		setCellText(editor, blockId, row, col, option.id);
		setIsOpen(false);
	}

	function handleClear() {
		setCellText(editor, blockId, row, col, "");
		setIsOpen(false);
	}

	const selectOptionItems = options.map((opt) => (
		<button
			key={opt.id}
			className={`pen-db-select-option ${opt.id === normalizedValue ? "pen-db-select-option-active" : ""}`}
			onClick={() => handleSelect(opt)}
		>
			<span
				className="pen-db-tag"
				style={{ backgroundColor: tagColor(opt.color) }}
			>
				{opt.value}
			</span>
		</button>
	));

	return (
		<span {...widgetCellAttrs(row, col)} className="pen-db-select-cell">
			<span
				className="pen-db-select-trigger"
				data-pen-db-widget-trigger="select"
				role="button"
				tabIndex={readonly ? -1 : 0}
				onClick={(e) => {
					if (readonly) return;
					e.stopPropagation();
					setIsOpen(!isOpen);
				}}
			>
				{matchedOption ? (
					<span
						className="pen-db-tag"
						style={{ backgroundColor: tagColor(matchedOption.color) }}
					>
						{matchedOption.value}
					</span>
				) : (
					<span className="pen-db-select-placeholder">{currentValue ? "(removed)" : "Select…"}</span>
				)}
			</span>
			{isOpen && (
				<div className="pen-db-select-dropdown" onClick={(e) => e.stopPropagation()}>
					{selectOptionItems}
					{currentValue && (
						<button className="pen-db-select-option pen-db-select-clear" onClick={handleClear}>
							Clear
						</button>
					)}
				</div>
			)}
		</span>
	);
}

function MultiSelectCell(props: DatabaseCellContentProps) {
	const { blockId, row, col, column } = props;
	const { editor } = useEditorContext();
	const readonly = !!props.readonly;
	const textSnapshot = useCellTextSnapshot(editor, blockId, row, col);
	const raw = textSnapshot.text ?? "";
	const options = column.options ?? [];
	const [isOpen, setIsOpen] = useState(false);

	const selectedValues = normalizeStoredMultiSelectValue(raw, options);

	function handleToggleOption(optionId: string) {
		const next = selectedValues.includes(optionId)
			? selectedValues.filter((value) => value !== optionId)
			: [...selectedValues, optionId];
		setCellText(editor, blockId, row, col, JSON.stringify(next));
	}

	const tags = selectedValues.map((val) => {
		const opt = resolveStoredSelectOption(val, options);
		return (
			<span
				key={val}
				className="pen-db-tag"
				style={{ backgroundColor: opt ? tagColor(opt.color) : undefined }}
			>
				{opt?.value ?? "(removed)"}
			</span>
		);
	});

	const multiSelectOptionItems = options.map((opt) => (
		<label key={opt.id} className="pen-db-multiselect-option">
			<input
				type="checkbox"
				checked={selectedValues.includes(opt.id)}
				onChange={() => handleToggleOption(opt.id)}
			/>
			<span
				className="pen-db-tag"
				style={{ backgroundColor: tagColor(opt.color) }}
			>
				{opt.value}
			</span>
		</label>
	));

	return (
		<span {...widgetCellAttrs(row, col)} className="pen-db-multiselect-cell">
			<span
				className="pen-db-select-trigger"
				data-pen-db-widget-trigger="multiSelect"
				role="button"
				tabIndex={readonly ? -1 : 0}
				onClick={(e) => {
					if (readonly) return;
					e.stopPropagation();
					setIsOpen(!isOpen);
				}}
			>
				{tags.length > 0 ? tags : <span className="pen-db-select-placeholder">Select…</span>}
			</span>
			{isOpen && (
				<div className="pen-db-select-dropdown" onClick={(e) => e.stopPropagation()}>
					{multiSelectOptionItems}
				</div>
			)}
		</span>
	);
}

function RelationCell(props: DatabaseCellContentProps) {
	const { blockId, row, col } = props;
	const { editor } = useEditorContext();
	const readonly = !!props.readonly;
	const textSnapshot = useCellTextSnapshot(editor, blockId, row, col);
	const currentValue = textSnapshot.text ?? "";
	const [isEditing, setIsEditing] = useState(false);
	const [draftValue, setDraftValue] = useState(currentValue);

	function handleSave() {
		setCellText(editor, blockId, row, col, draftValue.trim());
		setIsEditing(false);
	}

	if (!isEditing) {
		return (
			<span
				{...widgetCellAttrs(row, col)}
				className="pen-db-relation-cell"
				data-pen-db-widget-trigger="relation"
				role="button"
				tabIndex={readonly ? -1 : 0}
				onClick={(event) => {
					if (readonly) return;
					event.stopPropagation();
					setDraftValue(currentValue);
					setIsEditing(true);
				}}
			>
				{currentValue ? (
					<span className="pen-db-tag pen-db-tag-plain">{currentValue}</span>
				) : (
					<span className="pen-db-select-placeholder">Link record…</span>
				)}
			</span>
		);
	}

	return (
		<span {...widgetCellAttrs(row, col)} className="pen-db-relation-editor">
			<input
				type="text"
				value={draftValue}
				placeholder="Record id…"
				onChange={(event) => setDraftValue(event.target.value)}
				onClick={(event) => event.stopPropagation()}
				onKeyDown={(event) => {
					if (event.key === "Enter") {
						event.preventDefault();
						handleSave();
					}
					if (event.key === "Escape") {
						event.preventDefault();
						setIsEditing(false);
					}
				}}
				autoFocus
			/>
			<button onClick={handleSave}>Save</button>
			<button
				onClick={(event) => {
					event.stopPropagation();
					setCellText(editor, blockId, row, col, "");
					setIsEditing(false);
				}}
			>
				Clear
			</button>
		</span>
	);
}

function FormulaCell(props: DatabaseCellContentProps) {
	const { blockId, row, col } = props;
	const { editor } = useEditorContext();
	const textSnapshot = useCellTextSnapshot(editor, blockId, row, col);
	const currentValue = textSnapshot.text ?? "";

	return (
		<span {...widgetCellAttrs(row, col)} className="pen-db-formula-cell" aria-readonly="true">
			{currentValue || <span className="pen-db-select-placeholder">Computed value</span>}
		</span>
	);
}

function DateCell(props: DatabaseCellContentProps) {
	const { blockId, row, col, column } = props;
	const { editor } = useEditorContext();
	const readonly = !!props.readonly;
	const textSnapshot = useCellTextSnapshot(editor, blockId, row, col);
	const raw = textSnapshot.text ?? "";

	let display = "";
	if (raw) {
		const d = new Date(raw);
		if (!Number.isNaN(d.getTime())) {
			const fmt = column.format as { includeTime?: boolean; dateStyle?: "short" | "medium" | "long" } | undefined;
			const opts: Intl.DateTimeFormatOptions = { dateStyle: fmt?.dateStyle ?? "medium" };
			if (fmt?.includeTime) opts.timeStyle = "short";
			display = new Intl.DateTimeFormat(undefined, opts).format(d);
		} else {
			display = raw;
		}
	}

	function handleDateChange(event: React.ChangeEvent<HTMLInputElement>) {
		if (readonly) return;
		setCellText(editor, blockId, row, col, event.target.value ? new Date(event.target.value).toISOString() : "");
	}

	return (
		<span {...widgetCellAttrs(row, col)} className="pen-db-date-cell">
			{display || <span className="pen-db-date-placeholder">Pick date…</span>}
			{!readonly && (
				<input
					type="date"
					className="pen-db-date-input"
					data-pen-db-widget-trigger="date"
					value={raw ? raw.slice(0, 10) : ""}
					onChange={handleDateChange}
				/>
			)}
		</span>
	);
}

function setCellText(editor: Editor, blockId: string, row: number, col: number, text: string): void {
	const block = editor.getBlock(blockId);
	if (!block) return;
	const rowHandle = block.tableRow(row);
	const column = block.tableColumns()[col];
	const cell = block.tableCell(row, col);
	if (!cell || !rowHandle || !column) return;
	editor.apply([{
		type: "database-update-cell",
		blockId,
		rowId: rowHandle.id,
		columnId: column.id,
		value: text,
	}], { origin: "user" });
}

function toggleCheckbox(editor: Editor, blockId: string, row: number, col: number, isChecked: boolean): void {
	setCellText(editor, blockId, row, col, isChecked ? "false" : "true");
}

function isCellActive(
	fieldEditorState: { activeCellCoord: { blockId: string; row: number; col: number } | null },
	blockId: string,
	row: number,
	col: number,
): boolean {
	return (
		fieldEditorState.activeCellCoord?.blockId === blockId &&
		fieldEditorState.activeCellCoord.row === row &&
		fieldEditorState.activeCellCoord.col === col
	);
}

function editableCellAttrs(
	isActive: boolean,
	row: number,
	col: number,
	showPlaceholder: boolean,
	placeholder?: string,
): Record<string, unknown> {
	return {
		[DATA_ATTRS.inlineContent]: "",
		[DATA_ATTRS.fieldEditorSurface]: "",
		[DATA_ATTRS.fieldEditorActiveSurface]: isActive ? "" : undefined,
		[DATA_ATTRS.ignorePointerGesture]: isActive ? "" : undefined,
		[DATA_ATTRS.tableCellRow]: row,
		[DATA_ATTRS.tableCellCol]: col,
		[DATA_ATTRS.placeholderVisible]: showPlaceholder ? "" : undefined,
		"data-placeholder": showPlaceholder ? placeholder : undefined,
		style: { minWidth: "4rem", minHeight: "1.5rem", display: "block", width: "100%" },
	};
}

function widgetCellAttrs(row: number, col: number): Record<string, unknown> {
	return {
		[DATA_ATTRS.ignorePointerGesture]: "",
		[DATA_ATTRS.tableCellRow]: row,
		[DATA_ATTRS.tableCellCol]: col,
		style: { minWidth: "4rem", minHeight: "1.5rem", display: "block", width: "100%", cursor: "default" },
	};
}

const TAG_COLORS: Record<string, string> = {
	red: "rgba(255, 86, 86, 0.2)",
	orange: "rgba(255, 163, 68, 0.2)",
	yellow: "rgba(255, 220, 73, 0.2)",
	green: "rgba(77, 208, 89, 0.2)",
	blue: "rgba(45, 120, 255, 0.2)",
	purple: "rgba(155, 89, 255, 0.2)",
	pink: "rgba(255, 89, 166, 0.2)",
	gray: "rgba(155, 155, 155, 0.2)",
};

function tagColor(color?: string): string | undefined {
	if (!color) {
		return undefined;
	}
	return TAG_COLORS[color] ?? color;
}
