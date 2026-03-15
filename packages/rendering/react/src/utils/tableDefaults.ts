import type { TableColumnSchema } from "@pen/types";
import { generateId } from "@pen/types";

const ZERO_WIDTH_SPACE = "\u200B";

export interface TableActivationTarget {
	row: number;
	col: number;
}

export function hasMeaningfulBlockText(
	text: string | null | undefined,
): boolean {
	return !!text && text !== ZERO_WIDTH_SPACE && text !== "/";
}

export function getStarterTableProps(): { hasHeaderRow: true } {
	return { hasHeaderRow: true };
}

export function getTableActivationTarget(
	text: string | null | undefined,
): TableActivationTarget {
	return hasMeaningfulBlockText(text) ? { row: 0, col: 1 } : { row: 0, col: 0 };
}

export function getTableCellPlaceholder(
	hasHeaderRow: boolean,
	row: number,
	col: number,
): string | undefined {
	if (!hasHeaderRow || row !== 0) {
		return undefined;
	}

	return `Column ${col + 1}`;
}

export function createDefaultTableColumns(count: number): TableColumnSchema[] {
	return Array.from({ length: count }, (_, i) => ({
		id: generateId(),
		title: `Column ${i + 1}`,
		type: "text",
	}));
}
