import type { Editor, Extension } from "@pen/types";
import { defineExtension } from "@pen/types";
import type { DatabaseDataProvider } from "./types";
import type { CellEditorRegistry } from "./cellEditorRegistry";
import { DATABASE_CELL_EDITOR_REGISTRY_SLOT } from "./cellEditors";

const DATABASE_WIDGET_TRIGGER_ATTR = "data-pen-db-widget-trigger";
const BLOCK_ID_ATTR = "data-block-id";
const TABLE_CELL_ROW_ATTR = "data-cell-row";
const TABLE_CELL_COL_ATTR = "data-cell-col";

export const DATABASE_EXTENSION_NAME = "database";
export const DATABASE_DATA_PROVIDER_SLOT = "database:data-provider";
export const DATABASE_CELL_KEYDOWN_SLOT = "database:cell-keydown";

export interface DatabaseExtensionOptions {
	dataProvider?: DatabaseDataProvider;
	cellKeyDownHandler?: (
		event: KeyboardEvent,
		context: { blockId: string; row: number; col: number; root?: HTMLElement },
	) => boolean;
	cellEditorRegistry?: CellEditorRegistry;
}

export function databaseExtension(options?: DatabaseExtensionOptions): Extension {
	return defineExtension({
		name: DATABASE_EXTENSION_NAME,

		activateClient: async (ctx) => {
			const { editor } = ctx;

			if (options?.dataProvider) {
				editor.internals.setSlot(DATABASE_DATA_PROVIDER_SLOT, options.dataProvider);
			}

			if (options?.cellEditorRegistry) {
				editor.internals.setSlot(DATABASE_CELL_EDITOR_REGISTRY_SLOT, options.cellEditorRegistry);
			}

			editor.internals.setSlot(
				DATABASE_CELL_KEYDOWN_SLOT,
				(event: KeyboardEvent, context: { blockId: string; row: number; col: number; root?: HTMLElement }) => {
					if (options?.cellKeyDownHandler?.(event, context)) {
						return true;
					}
					return handleBuiltInCellKeyDown(editor, event, context);
				},
			);
		},

		deactivateClient: async () => {
			// Slots are cleared when the editor is destroyed
		},
	});
}

function handleBuiltInCellKeyDown(
	editor: Editor,
	event: KeyboardEvent,
	context: { blockId: string; row: number; col: number; root?: HTMLElement },
): boolean {
	if (event.metaKey || event.ctrlKey || event.altKey) {
		return false;
	}

	const block = editor.getBlock(context.blockId);
	const column = block?.tableColumns()[context.col];
	const rowHandle = block?.tableRow(context.row);
	if (!block || !column || !rowHandle) {
		return false;
	}

	if (column.type === "checkbox" && (event.key === " " || event.key === "Enter")) {
		event.preventDefault();
		const isChecked = block.tableCell(context.row, context.col)?.textContent().toLowerCase() === "true";
		editor.apply([
			{
				type: "database-update-cell",
				blockId: context.blockId,
				rowId: rowHandle.id,
				columnId: column.id,
				value: isChecked ? "false" : "true",
			},
		], { origin: "user" });
		return true;
	}

	if (
		(column.type === "select" ||
			column.type === "multiSelect" ||
			column.type === "relation" ||
			column.type === "date") &&
		(event.key === " " || event.key === "Enter" || event.key === "F2")
	) {
		const widgetTrigger = findWidgetTrigger(context.root, context, column.type);
		if (!widgetTrigger) {
			return false;
		}

		event.preventDefault();
		event.stopPropagation();
		if (
			typeof HTMLInputElement !== "undefined" &&
			widgetTrigger instanceof HTMLInputElement
		) {
			widgetTrigger.focus();
			widgetTrigger.showPicker?.();
		} else {
			widgetTrigger.click();
			widgetTrigger.focus?.();
		}
		return true;
	}

	return false;
}

function findWidgetTrigger(
	root: HTMLElement | undefined,
	context: { blockId: string; row: number; col: number },
	type: string | undefined,
): HTMLElement | null {
	if (!root || !type) {
		return null;
	}

	const cellSelector = `[${BLOCK_ID_ATTR}="${context.blockId}"] [${TABLE_CELL_ROW_ATTR}="${context.row}"][${TABLE_CELL_COL_ATTR}="${context.col}"]`;
	const triggerSelector = `${cellSelector} [${DATABASE_WIDGET_TRIGGER_ATTR}="${type}"]`;
	return root.querySelector(triggerSelector) as HTMLElement | null;
}
