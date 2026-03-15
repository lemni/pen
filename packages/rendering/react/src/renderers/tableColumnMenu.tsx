import React, { useState, useRef, useEffect, useLayoutEffect } from "react";
import type { Editor, TableColumnSchema } from "@pen/types";
import { generateId } from "@pen/types";
import { DATA_ATTRS } from "../utils/dataAttributes";

const COLUMN_TYPES: { value: TableColumnSchema["type"]; label: string; icon: string }[] = [
	{ value: "text", label: "Text", icon: "Aa" },
	{ value: "number", label: "Number", icon: "#" },
	{ value: "select", label: "Select", icon: "▾" },
	{ value: "checkbox", label: "Checkbox", icon: "☑" },
	{ value: "date", label: "Date", icon: "📅" },
	{ value: "url", label: "URL", icon: "🔗" },
	{ value: "email", label: "Email", icon: "@" },
];

export interface ColumnHeaderMenuProps {
	editor: Editor;
	blockId: string;
	column: TableColumnSchema;
	columnIndex: number;
	allColumns: readonly TableColumnSchema[];
	colCount: number;
	anchorEl: HTMLElement;
	anchorRect: {
		top: number;
		left: number;
		bottom: number;
		right: number;
		width: number;
		height: number;
	};
	onClose: () => void;
}

export function ColumnHeaderMenu(props: ColumnHeaderMenuProps) {
	const {
		editor,
		blockId,
		column,
		columnIndex,
		allColumns,
		colCount,
		anchorEl,
		anchorRect,
		onClose,
	} = props;
	const menuRef = useRef<HTMLDivElement>(null);
	const [title, setTitle] = useState(column.title);

	useEffect(() => {
		const handler = (e: MouseEvent) => {
			if (menuRef.current && !menuRef.current.contains(e.target as Node) && !anchorEl.contains(e.target as Node)) {
				commitTitle();
				onClose();
			}
		};
		document.addEventListener("mousedown", handler);
		return () => document.removeEventListener("mousedown", handler);
	}, [anchorEl, onClose, title]);

	useLayoutEffect(() => {
		if (!menuRef.current) return;
		menuRef.current.style.top = `${anchorRect.bottom + 4}px`;
		menuRef.current.style.left = `${anchorRect.left}px`;
	}, [anchorRect.bottom, anchorRect.left]);

	function updateColumns(updated: TableColumnSchema[]) {
		editor.apply([{ type: "update-table-columns", blockId, columns: updated }]);
	}

	function commitTitle() {
		const trimmed = title.trim();
		if (!trimmed || trimmed === column.title) return;
		const updated = allColumns.map((c, i) =>
			i === columnIndex ? { ...c, title: trimmed } : c,
		);
		updateColumns([...updated]);
	}

	function handleTypeChange(newType: TableColumnSchema["type"]) {
		const updated = allColumns.map((c, i) =>
			i === columnIndex ? { ...c, type: newType } : c,
		);
		updateColumns([...updated]);
		onClose();
	}

	function handleInsertLeft() {
		const newCol: TableColumnSchema = {
			id: generateId(),
			title: `Column ${colCount + 1}`,
			type: "text",
		};
		const updated = [...allColumns];
		updated.splice(columnIndex, 0, newCol);
		editor.apply([
			{ type: "update-table-columns", blockId, columns: updated },
			{ type: "insert-table-column", blockId, index: columnIndex },
		]);
		onClose();
	}

	function handleInsertRight() {
		const newCol: TableColumnSchema = {
			id: generateId(),
			title: `Column ${colCount + 1}`,
			type: "text",
		};
		const updated = [...allColumns];
		updated.splice(columnIndex + 1, 0, newCol);
		editor.apply([
			{ type: "update-table-columns", blockId, columns: updated },
			{ type: "insert-table-column", blockId, index: columnIndex + 1 },
		]);
		onClose();
	}

	function handleDelete() {
		if (colCount <= 1) return;
		const updated = allColumns.filter((_, i) => i !== columnIndex);
		editor.apply([
			{ type: "update-table-columns", blockId, columns: [...updated] },
			{ type: "delete-table-column", blockId, index: columnIndex },
		]);
		onClose();
	}

	const typeItems = COLUMN_TYPES.map((ct) => (
		<button
			key={ct.value}
			className="pen-col-menu-item"
			data-active={ct.value === column.type ? "" : undefined}
			onClick={() => handleTypeChange(ct.value)}
		>
			<span className="pen-col-menu-icon">{ct.icon}</span>
			{ct.label}
		</button>
	));

	return (
		<div
			ref={menuRef}
			className="pen-col-menu"
			data-pen-column-menu=""
			{...{ [DATA_ATTRS.ignorePointerGesture]: "" }}
		>
			<div className="pen-col-menu-title-row">
				<input
					className="pen-col-menu-title-input"
					type="text"
					value={title}
					onChange={(e) => setTitle(e.target.value)}
					onKeyDown={(e) => {
						if (e.key === "Enter") { commitTitle(); onClose(); }
						if (e.key === "Escape") { setTitle(column.title); onClose(); }
					}}
					onBlur={commitTitle}
					autoFocus
					spellCheck={false}
				/>
			</div>
			<div className="pen-col-menu-divider" />
			<div className="pen-col-menu-section">Type</div>
			{typeItems}
			<div className="pen-col-menu-divider" />
			<button className="pen-col-menu-item" onClick={handleInsertLeft}>
				← Insert left
			</button>
			<button className="pen-col-menu-item" onClick={handleInsertRight}>
				Insert right →
			</button>
			{colCount > 1 && (
				<>
					<div className="pen-col-menu-divider" />
					<button className="pen-col-menu-item pen-col-menu-danger" onClick={handleDelete}>
						Delete column
					</button>
				</>
			)}
		</div>
	);
}
