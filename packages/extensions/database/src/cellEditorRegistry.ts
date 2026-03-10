import type React from "react";
import type { ColumnType } from "./types";
import type { DatabaseCellContentProps } from "./cellEditors";

export type CellEditorComponent = React.ComponentType<DatabaseCellContentProps>;

export interface CellEditorRegistry {
	get(columnType: ColumnType | string): CellEditorComponent | undefined;
	register(columnType: ColumnType | string, editor: CellEditorComponent): void;
	unregister(columnType: ColumnType | string): void;
	has(columnType: ColumnType | string): boolean;
	entries(): Iterable<[string, CellEditorComponent]>;
}

export function createCellEditorRegistry(): CellEditorRegistry {
	const editors = new Map<string, CellEditorComponent>();

	return {
		get(columnType) {
			return editors.get(columnType);
		},
		register(columnType, editor) {
			editors.set(columnType, editor);
		},
		unregister(columnType) {
			editors.delete(columnType);
		},
		has(columnType) {
			return editors.has(columnType);
		},
		entries() {
			return editors.entries();
		},
	};
}

export const defaultCellEditorRegistry: CellEditorRegistry = createCellEditorRegistry();
