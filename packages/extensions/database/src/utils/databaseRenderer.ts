import { DEFAULT_DATABASE_COLUMN_WIDTH } from "../types";
import type {
	ColumnType,
	DatabaseColumnDef,
	DatabaseRow,
	DatabaseRowPinning,
	DatabaseViewState,
	FilterCondition,
	FilterGroup,
	FilterOperator,
} from "../types";

const PINNED_CELL_Z_INDEX = 2;
const PINNED_HEADER_Z_INDEX = 3;
const DATE_RELATIVE_FILTER_OPTIONS = [
	{ value: "today", label: "Today" },
	{ value: "yesterday", label: "Yesterday" },
	{ value: "tomorrow", label: "Tomorrow" },
	{ value: "this_week", label: "This week" },
	{ value: "last_7_days", label: "Last 7 days" },
	{ value: "next_7_days", label: "Next 7 days" },
	{ value: "this_month", label: "This month" },
] as const;

type FilterNode = FilterCondition | FilterGroup;
type FilterPath = number[];

export const CALENDAR_WEEKDAY_LABELS = [
	"Sun",
	"Mon",
	"Tue",
	"Wed",
	"Thu",
	"Fri",
	"Sat",
] as const;

export function createDatabaseViewDefinition(options: {
	id: string;
	type: DatabaseViewState["type"];
	columns: DatabaseColumnDef[];
	existingViews: readonly DatabaseViewState[];
}): DatabaseViewState {
	const columnIds = options.columns.map((column) => column.id);
	const defaultBoardGroupBy =
		options.type === "board" ? getDefaultBoardGroupBy(options.columns) : null;
	return {
		id: options.id,
		title: getNextViewTitle(options.type, options.existingViews),
		type: options.type,
		visibleColumnIds: columnIds,
		columnOrder: columnIds,
		sort: [],
		filter: null,
		groupBy: defaultBoardGroupBy,
		pageIndex: 0,
		pageSize: 50,
	};
}

export function getCalendarDateColumn(
	columns: DatabaseColumnDef[],
): DatabaseColumnDef | undefined {
	return columns.find((column) => column.type === "date");
}

export function inferCalendarMonth(
	rows: DatabaseRow[],
	dateColumnId: string | null,
): Date {
	if (!dateColumnId) {
		return startOfMonth(new Date());
	}
	for (const row of rows) {
		const parsedDate = parseCalendarDate(row.cells[dateColumnId] ?? "");
		if (parsedDate) {
			return startOfMonth(parsedDate);
		}
	}
	return startOfMonth(new Date());
}

export function shiftMonth(value: Date, amount: number): Date {
	return new Date(value.getFullYear(), value.getMonth() + amount, 1);
}

export function buildCalendarMonthData(options: {
	month: Date;
	rows: DatabaseRow[];
	dateColumnId: string | null;
}): {
	days: Array<{
		key: string;
		isoDate: string;
		dayNumber: number;
		inCurrentMonth: boolean;
		rows: DatabaseRow[];
	}>;
	unscheduledRows: DatabaseRow[];
} {
	if (!options.dateColumnId) {
		return {
			days: [],
			unscheduledRows: options.rows,
		};
	}
	const monthStart = startOfMonth(options.month);
	const gridStart = startOfWeek(monthStart);
	const scheduledRowsByDay = new Map<string, DatabaseRow[]>();
	const unscheduledRows: DatabaseRow[] = [];

	for (const row of options.rows) {
		const parsedDate = parseCalendarDate(row.cells[options.dateColumnId] ?? "");
		if (!parsedDate) {
			unscheduledRows.push(row);
			continue;
		}
		const key = formatCalendarIsoDate(parsedDate);
		const existingRows = scheduledRowsByDay.get(key);
		if (existingRows) {
			existingRows.push(row);
			continue;
		}
		scheduledRowsByDay.set(key, [row]);
	}

	const days = Array.from({ length: 42 }, (_, index) => {
		const currentDate = new Date(
			gridStart.getFullYear(),
			gridStart.getMonth(),
			gridStart.getDate() + index,
		);
		const key = formatCalendarIsoDate(currentDate);
		return {
			key,
			isoDate: key,
			dayNumber: currentDate.getDate(),
			inCurrentMonth:
				currentDate.getMonth() === monthStart.getMonth() &&
				currentDate.getFullYear() === monthStart.getFullYear(),
			rows: scheduledRowsByDay.get(key) ?? [],
		};
	});

	return {
		days,
		unscheduledRows,
	};
}

export function toEditableFilterGroup(
	filter: FilterGroup | null | undefined,
): FilterGroup {
	if (filter) {
		return filter;
	}
	return { operator: "and", conditions: [] };
}

export function getNextRowPinningState(
	current: DatabaseRowPinning | undefined,
	rowIds: string[],
	target: "top" | "bottom" | "none",
): DatabaseRowPinning | undefined {
	const rowIdSet = new Set(rowIds);
	const currentTop: string[] = [...(current?.top ?? [])];
	const currentBottom: string[] = [...(current?.bottom ?? [])];
	const top = currentTop.filter((rowId) => !rowIdSet.has(rowId));
	const bottom = currentBottom.filter((rowId) => !rowIdSet.has(rowId));
	if (target === "top") {
		top.push(...rowIds);
	}
	if (target === "bottom") {
		bottom.push(...rowIds);
	}
	if (top.length === 0 && bottom.length === 0) {
		return undefined;
	}
	return {
		top: top.length > 0 ? top : undefined,
		bottom: bottom.length > 0 ? bottom : undefined,
	};
}

export function getNextSortState(
	currentSort: DatabaseViewState["sort"] extends infer T ? NonNullable<T> : never,
	columnId: string,
	append: boolean,
) {
	const nextSort = [...currentSort];
	const existingIndex = nextSort.findIndex((entry) => entry.columnId === columnId);
	const existing = existingIndex >= 0 ? nextSort[existingIndex] : null;
	if (!append) {
		if (!existing) {
			return [{ columnId, direction: "asc" as const }];
		}
		if (existing.direction === "asc") {
			return [{ columnId, direction: "desc" as const }];
		}
		return [];
	}
	if (!existing) {
		return [...nextSort, { columnId, direction: "asc" as const }];
	}
	if (existing.direction === "asc") {
		nextSort[existingIndex] = { columnId, direction: "desc" };
		return nextSort;
	}
	return nextSort.filter((entry) => entry.columnId !== columnId);
}

export function getPinnedOffsets(
	columns: DatabaseColumnDef[],
	options: { defaultColumnWidth: number; leftBase: number; rightBase: number },
): Record<string, { left?: number; right?: number }> {
	const offsets: Record<string, { left?: number; right?: number }> = {};
	let leftOffset = options.leftBase;
	for (const column of columns) {
		if (column.pinned !== "left") {
			continue;
		}
		offsets[column.id] = { ...(offsets[column.id] ?? {}), left: leftOffset };
		leftOffset += column.width ?? options.defaultColumnWidth;
	}
	let rightOffset = options.rightBase;
	const reversedColumns = [...columns].reverse();
	for (const column of reversedColumns) {
		if (column.pinned !== "right") {
			continue;
		}
		offsets[column.id] = { ...(offsets[column.id] ?? {}), right: rightOffset };
		rightOffset += column.width ?? options.defaultColumnWidth;
	}
	return offsets;
}

export type ColumnStickyStyle = {
	width: number;
	minWidth: number;
	maxWidth: number;
	cursor?: string;
	position: "relative" | "sticky";
	left?: number;
	right?: number;
	zIndex?: number;
	background?: string;
};

export function getColumnStickyStyle(
	column: DatabaseColumnDef,
	pinnedOffsets: Record<string, { left?: number; right?: number }>,
	defaultColumnWidth: number,
	section: "header" | "body",
): ColumnStickyStyle {
	const width = column.width ?? defaultColumnWidth;
	const style: ColumnStickyStyle = {
		width,
		minWidth: width,
		maxWidth: width,
		cursor: section === "header" ? "pointer" : undefined,
		position: "relative",
	};
	const offset = pinnedOffsets[column.id];
	if (offset?.left == null && offset?.right == null) {
		return style;
	}
	return {
		...style,
		position: "sticky",
		left: offset?.left,
		right: offset?.right,
		zIndex: section === "header" ? PINNED_HEADER_Z_INDEX : PINNED_CELL_Z_INDEX,
		background: "var(--surface)",
	};
}

export function resolveDefaultColumnWidth(value: unknown): number {
	return typeof value === "number" && Number.isFinite(value) && value > 0
		? value
		: DEFAULT_DATABASE_COLUMN_WIDTH;
}

export type FixedEdgeStyle = {
	position: "sticky";
	left?: number;
	right?: number;
	width: number;
	minWidth: number;
	maxWidth: number;
	zIndex: number;
	background: string;
};

export function getFixedEdgeStyle(
	side: "left" | "right",
	offset: number,
	width: number,
	section: "header" | "body",
): FixedEdgeStyle {
	return {
		position: "sticky",
		[side]: offset,
		width,
		minWidth: width,
		maxWidth: width,
		zIndex: section === "header" ? PINNED_HEADER_Z_INDEX : PINNED_CELL_Z_INDEX,
		background: "var(--surface)",
	} as FixedEdgeStyle;
}

export function createDefaultFilterCondition(
	columnSchema: DatabaseColumnDef[],
): FilterCondition {
	const firstColumn = columnSchema[0];
	if (!firstColumn) {
		return {
			columnId: "",
			operator: "contains",
			value: "",
		};
	}
	return {
		columnId: firstColumn.id,
		operator: defaultOperatorFor(firstColumn.type),
		value: getDefaultFilterValue(firstColumn.type),
	};
}

export function getDefaultFilterValue(
	columnType: ColumnType,
): FilterCondition["value"] {
	return getDefaultFilterValueForOperator(
		columnType,
		defaultOperatorFor(columnType),
	);
}

export function getDefaultFilterValueForOperator(
	columnType: ColumnType,
	operator: FilterOperator,
): FilterCondition["value"] {
	if (!operatorNeedsValue(operator)) {
		return null;
	}
	if (columnType === "date") {
		if (operator === "is_between") {
			return ["", ""];
		}
		if (operator === "is_relative") {
			return DATE_RELATIVE_FILTER_OPTIONS[0]?.value ?? "today";
		}
	}
	return "";
}

export function operatorNeedsValue(operator: FilterOperator): boolean {
	return ![
		"is_empty",
		"is_not_empty",
		"is_checked",
		"is_unchecked",
	].includes(operator);
}

export function dateFilterNeedsValue(operator: FilterOperator): boolean {
	return operatorNeedsValue(operator);
}

export function getDateFilterSingleValue(
	value: FilterCondition["value"],
): string {
	return typeof value === "string" ? value : "";
}

export function getDateFilterRangeValue(
	value: FilterCondition["value"],
	index: 0 | 1,
): string {
	if (!Array.isArray(value)) {
		return "";
	}
	return value[index] ?? "";
}

export function defaultOperatorFor(columnType: ColumnType): FilterOperator {
	if (columnType === "checkbox") {
		return "is_checked";
	}
	if (columnType === "number") {
		return "=";
	}
	if (columnType === "date") {
		return "is";
	}
	if (columnType === "select") {
		return "is";
	}
	if (columnType === "multiSelect") {
		return "is_any_of";
	}
	return "contains";
}

export function operatorOptionsFor(
	columnType: ColumnType,
): Array<{ value: FilterOperator; label: string }> {
	if (columnType === "checkbox") {
		return [
			{ value: "is_checked", label: "is checked" },
			{ value: "is_unchecked", label: "is unchecked" },
		];
	}
	if (columnType === "number") {
		return [
			{ value: "=", label: "=" },
			{ value: "!=", label: "!=" },
			{ value: ">", label: ">" },
			{ value: "<", label: "<" },
			{ value: ">=", label: ">=" },
			{ value: "<=", label: "<=" },
			{ value: "is_empty", label: "is empty" },
			{ value: "is_not_empty", label: "is not empty" },
		];
	}
	if (columnType === "date") {
		return [
			{ value: "is", label: "is" },
			{ value: "is_before", label: "is before" },
			{ value: "is_after", label: "is after" },
			{ value: "is_between", label: "is between" },
			{ value: "is_relative", label: "is relative to today" },
			{ value: "is_empty", label: "is empty" },
			{ value: "is_not_empty", label: "is not empty" },
		];
	}
	if (columnType === "select") {
		return [
			{ value: "is", label: "is" },
			{ value: "is_not", label: "is not" },
			{ value: "is_any_of", label: "is any of" },
			{ value: "is_none_of", label: "is none of" },
			{ value: "is_empty", label: "is empty" },
			{ value: "is_not_empty", label: "is not empty" },
		];
	}
	if (columnType === "multiSelect") {
		return [
			{ value: "contains", label: "contains" },
			{ value: "not_contains", label: "does not contain" },
			{ value: "is_any_of", label: "is any of" },
			{ value: "is_none_of", label: "is none of" },
			{ value: "is_empty", label: "is empty" },
			{ value: "is_not_empty", label: "is not empty" },
		];
	}
	return [
		{ value: "contains", label: "contains" },
		{ value: "not_contains", label: "does not contain" },
		{ value: "is", label: "is" },
		{ value: "is_not", label: "is not" },
		{ value: "starts_with", label: "starts with" },
		{ value: "ends_with", label: "ends with" },
		{ value: "is_empty", label: "is empty" },
		{ value: "is_not_empty", label: "is not empty" },
	];
}

export function getFilterPathKey(path: number[]): string {
	return path.length > 0 ? path.join("-") : "root";
}

export function updateFilterGroupOperatorAtPath(
	root: FilterGroup,
	path: number[],
	operator: FilterGroup["operator"],
): FilterGroup {
	return updateFilterGroupAtPath(root, path, (group) => ({
		...group,
		operator,
	}));
}

export function updateFilterConditionAtPath(
	root: FilterGroup,
	path: number[],
	patch: Partial<FilterCondition>,
): FilterGroup {
	if (path.length === 0) {
		return root;
	}
	const [index, ...rest] = path;
	const nextConditions = root.conditions.map((condition, conditionIndex) => {
		if (conditionIndex !== index) {
			return condition;
		}
		if (rest.length > 0 && isFilterGroupNode(condition)) {
			return updateFilterConditionAtPath(condition, rest, patch);
		}
		if (isFilterGroupNode(condition)) {
			return condition;
		}
		return {
			...condition,
			...patch,
		};
	});
	return {
		...root,
		conditions: nextConditions,
	};
}

export function addFilterNodeAtPath(
	root: FilterGroup,
	path: number[],
	node: FilterNode,
): FilterGroup {
	return updateFilterGroupAtPath(root, path, (group) => ({
		...group,
		conditions: [...group.conditions, node],
	}));
}

export function removeFilterNodeAtPath(
	root: FilterGroup,
	path: number[],
): FilterGroup {
	if (path.length === 0) {
		return { ...root, conditions: [] };
	}
	const parentPath = path.slice(0, -1);
	const targetIndex = path[path.length - 1] ?? -1;
	return updateFilterGroupAtPath(root, parentPath, (group) => ({
		...group,
		conditions: group.conditions.filter(
			(_, conditionIndex) => conditionIndex !== targetIndex,
		),
	}));
}

export function getDefaultViewTitle(viewType: DatabaseViewState["type"]): string {
	switch (viewType) {
		case "list":
			return "List view";
		case "board":
			return "Board view";
		case "calendar":
			return "Calendar view";
		case "gallery":
			return "Gallery view";
		default:
			return "Table view";
	}
}

function getDefaultBoardGroupBy(columns: DatabaseColumnDef[]): string | null {
	const preferredBoardColumn = columns.find(
		(column) =>
			column.type === "select" ||
			column.type === "multiSelect" ||
			column.type === "checkbox",
	);
	return preferredBoardColumn?.id ?? columns[0]?.id ?? null;
}

function startOfMonth(value: Date): Date {
	return new Date(value.getFullYear(), value.getMonth(), 1);
}

function startOfWeek(value: Date): Date {
	const result = new Date(value.getFullYear(), value.getMonth(), value.getDate());
	result.setDate(result.getDate() - result.getDay());
	return result;
}

function formatCalendarIsoDate(value: Date): string {
	const year = value.getFullYear();
	const month = `${value.getMonth() + 1}`.padStart(2, "0");
	const day = `${value.getDate()}`.padStart(2, "0");
	return `${year}-${month}-${day}`;
}

function parseCalendarDate(raw: string): Date | null {
	if (!raw) {
		return null;
	}
	const parsed = new Date(raw);
	return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function getNextViewTitle(
	viewType: DatabaseViewState["type"],
	existingViews: readonly DatabaseViewState[],
): string {
	const baseTitle = getDefaultViewTitle(viewType);
	const matchingViews = existingViews.filter(
		(view) => (view.title ?? getDefaultViewTitle(view.type)) === baseTitle,
	);
	return matchingViews.length === 0
		? baseTitle
		: `${baseTitle} ${matchingViews.length + 1}`;
}

function isFilterGroupNode(value: FilterNode): value is FilterGroup {
	return "conditions" in value;
}

function updateFilterGroupAtPath(
	root: FilterGroup,
	path: FilterPath,
	updater: (group: FilterGroup) => FilterGroup,
): FilterGroup {
	if (path.length === 0) {
		return updater(root);
	}
	const [index, ...rest] = path;
	const nextConditions = root.conditions.map((condition, conditionIndex) => {
		if (conditionIndex !== index || !isFilterGroupNode(condition)) {
			return condition;
		}
		return updateFilterGroupAtPath(condition, rest, updater);
	});
	return {
		...root,
		conditions: nextConditions,
	};
}

export { DATE_RELATIVE_FILTER_OPTIONS };
