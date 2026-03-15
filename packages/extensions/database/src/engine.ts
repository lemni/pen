import {
	coerceDatabaseValue,
	formatStoredMultiSelectValue,
	formatStoredSelectValue,
	parseDatabaseMultiSelectValue,
	resolveStoredSelectOption,
} from "@pen/types";
import type { BlockHandle, Editor } from "@pen/types";
import type {
	ColumnType,
	DatabaseColumnDef,
	DatabaseDataProvider,
	DatabasePage,
	DatabaseQuery,
	DatabaseRowGroup,
	DatabaseRowPinning,
	DatabaseRow,
	DatabaseSort,
	FacetBucket,
	DatabaseViewModel,
	DatabaseViewModelColumn,
	DatabaseViewModelRow,
	DatabaseViewState,
	FilterCondition,
	FilterGroup,
	FilterOperator,
	NumberFormat,
	DateFormat,
} from "./types";

const DEFAULT_PAGE_SIZE = 50;
const VALID_COLUMN_TYPES = new Set<ColumnType>([
	"text",
	"number",
	"checkbox",
	"select",
	"multiSelect",
	"date",
	"url",
	"email",
	"relation",
	"formula",
]);

export class DatabaseEngine {
	private readonly _editor: Editor;
	private readonly _blockId: string;
	private _dataProvider: DatabaseDataProvider | null = null;

	constructor(editor: Editor, blockId: string) {
		this._editor = editor;
		this._blockId = blockId;
	}

	get blockId(): string {
		return this._blockId;
	}

	get editor(): Editor {
		return this._editor;
	}

	get dataProvider(): DatabaseDataProvider | null {
		return this._dataProvider;
	}

	setDataProvider(provider: DatabaseDataProvider): void {
		this._dataProvider = provider;
	}

	get isRemote(): boolean {
		const block = this._block;
		return block?.props.dataSource === "remote" || block?.props.dataSource === "hybrid";
	}

	private get _block(): BlockHandle | null {
		return this._editor.getBlock(this._blockId) ?? null;
	}

	deriveColumnSchema(): DatabaseColumnDef[] {
		const block = this._block;
		if (!block) return [];
		return block.tableColumns().map((column, index) => ({
			id: column.id || `col-${index}`,
			title: column.title || "Untitled",
			type: this.normalizeColumnType(column.type),
			width: column.width,
			hidden: column.hidden,
			pinned: column.pinned,
			options: column.options,
			format: column.format,
			readonly: column.readonly,
		}));
	}

	deriveRowData(): DatabaseRow[] {
		const block = this._block;
		if (!block) return [];
		const columns = this.deriveColumnSchema();
		const rowCount = block.tableRowCount();
		const columnCount = Math.max(columns.length, block.tableColumnCount());
		const rows: DatabaseRow[] = [];

		for (let rowIndex = 0; rowIndex < rowCount; rowIndex++) {
			const rowHandle = typeof block.tableRow === "function" ? block.tableRow(rowIndex) : null;
			const cells: Record<string, string> = {};
			for (let columnIndex = 0; columnIndex < columnCount; columnIndex++) {
				const columnId = columns[columnIndex]?.id ?? `col-${columnIndex}`;
				cells[columnId] = block.tableCell(rowIndex, columnIndex)?.textContent() ?? "";
			}
			rows.push({
				id: rowHandle?.id ?? `row-${rowIndex}`,
				crdtRowIndex: rowIndex,
				cells,
			});
		}

		return rows;
	}

	deriveViewState(): DatabaseViewState {
		const block = this._block;
		const columns = this.deriveColumnSchema();
		const fallbackColumnIds = columns.map((column) => column.id);
		const activeView = block?.databaseActiveView();
		if (activeView) {
			return {
				...activeView,
				visibleColumnIds: activeView.visibleColumnIds ?? fallbackColumnIds,
				columnOrder: activeView.columnOrder ?? fallbackColumnIds,
				pageIndex: activeView.pageIndex ?? 0,
				pageSize: activeView.pageSize ?? DEFAULT_PAGE_SIZE,
			};
		}

		return {
			id: "default",
			title: "Table view",
			type: "table",
			visibleColumnIds: fallbackColumnIds,
			columnOrder: fallbackColumnIds,
			sort: [],
			filter: null,
			pageIndex: 0,
			pageSize: DEFAULT_PAGE_SIZE,
		};
	}

	createQuery(options?: {
		view?: DatabaseViewState | null;
		override?: Partial<DatabaseQuery>;
	}): DatabaseQuery {
		const view = options?.view ?? this.deriveViewState();
		return {
			sort: options?.override?.sort ?? view.sort,
			filter: options?.override?.filter ?? view.filter ?? undefined,
			groupBy: options?.override?.groupBy ?? view.groupBy ?? null,
			pageIndex: options?.override?.pageIndex ?? view.pageIndex ?? 0,
			pageSize: options?.override?.pageSize ?? view.pageSize ?? DEFAULT_PAGE_SIZE,
		};
	}

	buildViewModel(options?: {
		view?: DatabaseViewState | null;
		rows?: DatabaseRow[];
		globalSearch?: string;
		totalRows?: number;
		remotePage?: boolean;
	}): DatabaseViewModel {
		const view = options?.view ?? this.deriveViewState();
		const columns = this.deriveViewColumns(view);
		const pageIndex = view.pageIndex ?? 0;
		const pageSize = view.pageSize ?? DEFAULT_PAGE_SIZE;
		const sourceRows = options?.rows ?? this.deriveRowData();

		if (options?.remotePage) {
			const totalRows = options?.totalRows ?? sourceRows.length;
			const pageCount = Math.max(1, Math.ceil(totalRows / pageSize));
			return {
				view,
				columns,
				allRows: sourceRows,
				pinnedTopRows: [],
				rows: sourceRows,
				pinnedBottomRows: [],
				rowGroups: this.groupRows(sourceRows, view.groupBy ?? null, columns),
				totalRows,
				pageIndex,
				pageSize,
				pageCount,
			};
		}

		const searchedRows = this.searchRows(sourceRows, options?.globalSearch ?? "", columns);
		const filteredRows = this.filterRows(searchedRows, view.filter ?? null, columns);
		const sortedRows = this.sortRows(filteredRows, view.sort ?? [], columns);
		const pinnedRows = this.splitPinnedRows(sortedRows, view.rowPinning);
		const rows = this.paginateRows(pinnedRows.rows, pageIndex, pageSize);
		const totalRows = pinnedRows.rows.length;
		const pageCount = Math.max(1, Math.ceil(totalRows / pageSize));

		return {
			view,
			columns,
			allRows: sortedRows,
			pinnedTopRows: pinnedRows.top,
			rows,
			pinnedBottomRows: pinnedRows.bottom,
			rowGroups: this.groupRows(rows, view.groupBy ?? null, columns),
			totalRows,
			pageIndex,
			pageSize,
			pageCount,
		};
	}

	buildRemoteViewModel(page: DatabasePage, view?: DatabaseViewState | null): DatabaseViewModel {
		return this.buildViewModel({
			view,
			rows: page.rows,
			totalRows: page.totalRows,
			remotePage: true,
		});
	}

	searchRows(
		rows: DatabaseRow[],
		globalSearch: string,
		columns?: DatabaseViewModelColumn[],
	): DatabaseRow[] {
		const query = globalSearch.trim().toLowerCase();
		if (!query) return rows;
		const searchColumns = columns?.length ? columns : null;
		return rows.filter((row) =>
			(searchColumns ?? Object.keys(row.cells).map((columnId) => ({
				id: columnId,
				type: "text" as ColumnType,
				columnIndex: 0,
				title: columnId,
				format: undefined,
				options: undefined,
			}))).some((column) =>
				this.formatCellDisplay(
					row.cells[column.id] ?? "",
					column.type,
					column.format,
					column.options,
				)
					.toLowerCase()
					.includes(query),
			),
		);
	}

	filterRows(rows: DatabaseRow[], filter: FilterGroup | null, columns: DatabaseViewModelColumn[]): DatabaseRow[] {
		if (!filter || filter.conditions.length === 0) return rows;
		return rows.filter((row) => this.matchesFilterGroup(row, filter, columns));
	}

	sortRows(rows: DatabaseRow[], sorts: DatabaseSort[], columns: DatabaseViewModelColumn[]): DatabaseRow[] {
		if (sorts.length === 0) return rows;
		const columnMap = new Map(columns.map((column) => [column.id, column]));
		return [...rows].sort((left, right) => {
			for (const sort of sorts) {
				const column = columnMap.get(sort.columnId);
				if (!column) continue;
				const compare = this.compareCellValues(
					left.cells[sort.columnId] ?? "",
					right.cells[sort.columnId] ?? "",
					column.type,
					column.options,
				);
				if (compare !== 0) {
					return sort.direction === "desc" ? -compare : compare;
				}
			}
			return left.crdtRowIndex - right.crdtRowIndex;
		});
	}

	paginateRows(rows: DatabaseRow[], pageIndex: number, pageSize: number): DatabaseViewModelRow[] {
		const normalizedPageSize = Math.max(1, pageSize);
		const normalizedPageIndex = Math.max(0, pageIndex);
		const start = normalizedPageIndex * normalizedPageSize;
		return rows.slice(start, start + normalizedPageSize);
	}

	splitPinnedRows(
		rows: DatabaseRow[],
		rowPinning?: DatabaseRowPinning,
	): {
		top: DatabaseViewModelRow[];
		rows: DatabaseViewModelRow[];
		bottom: DatabaseViewModelRow[];
	} {
		const rowMap = new Map(rows.map((row) => [row.id, row]));
		const topRowIds: string[] = [...(rowPinning?.top ?? [])];
		const bottomRowIds: string[] = [...(rowPinning?.bottom ?? [])];
		const top = topRowIds
			.map((rowId: string) => rowMap.get(rowId))
			.filter((row: DatabaseRow | undefined): row is DatabaseViewModelRow => row != null);
		const bottom = bottomRowIds
			.map((rowId: string) => rowMap.get(rowId))
			.filter((row: DatabaseRow | undefined): row is DatabaseViewModelRow => row != null);
		const pinnedIds = new Set([...top, ...bottom].map((row) => row.id));
		return {
			top,
			rows: rows.filter((row) => !pinnedIds.has(row.id)),
			bottom,
		};
	}

	groupRows(
		rows: DatabaseViewModelRow[],
		groupBy: string | null,
		columns: DatabaseViewModelColumn[],
	): DatabaseRowGroup[] {
		if (!groupBy) {
			return [];
		}
		const column = this.resolveGroupingColumn(groupBy, columns);
		if (!column) {
			return [];
		}
		const groups: DatabaseRowGroup[] = [];
		const groupByKey = new Map<string, DatabaseRowGroup>();
		for (const row of rows) {
			const label = this.formatGroupLabel(row.cells[column.id] ?? "", column);
			const key = `${column.id}:${label}`;
			const existing = groupByKey.get(key);
			if (existing) {
				existing.rows.push(row);
				continue;
			}
			const nextGroup: DatabaseRowGroup = {
				key,
				label,
				rows: [row],
			};
			groupByKey.set(key, nextGroup);
			groups.push(nextGroup);
		}
		return groups;
	}

	facetColumnValues(
		rows: DatabaseRow[],
		columnId: string,
		columns: DatabaseViewModelColumn[],
	): FacetBucket[] {
		const column = columns.find((entry) => entry.id === columnId);
		if (!column) return [];
		const buckets = new Map<string, FacetBucket>();
		for (const row of rows) {
			const raw = row.cells[columnId] ?? "";
			if (!raw) continue;
			if (column.type === "multiSelect") {
				const values = parseDatabaseMultiSelectValue(raw);
				for (const value of values) {
					const option = resolveStoredSelectOption(value, column.options);
					const bucketValue = option?.id ?? value;
					const bucketLabel = option?.value ?? value;
					this.incrementFacetBucket(buckets, bucketValue, bucketLabel);
				}
				continue;
			}
			if (column.type === "select") {
				const option = resolveStoredSelectOption(raw, column.options);
				const bucketValue = option?.id ?? raw;
				const bucketLabel = option?.value ?? raw;
				this.incrementFacetBucket(buckets, bucketValue, bucketLabel);
				continue;
			}
			if (column.type === "checkbox") {
				const bucketValue = raw.toLowerCase() === "true" ? "true" : "false";
				const bucketLabel = bucketValue === "true" ? "Checked" : "Unchecked";
				this.incrementFacetBucket(buckets, bucketValue, bucketLabel);
				continue;
			}
			this.incrementFacetBucket(buckets, raw, raw);
		}
		return [...buckets.values()].sort((left, right) =>
			left.label.toLowerCase().localeCompare(right.label.toLowerCase()),
		);
	}

	parseCellValue(raw: string, columnType: ColumnType): unknown {
		switch (columnType) {
			case "number": {
				if (raw === "") return null;
				const value = Number(raw);
				return Number.isNaN(value) ? null : value;
			}
			case "checkbox":
				return raw.toLowerCase() === "true";
			case "date": {
				if (raw === "") return null;
				const value = new Date(raw);
				return Number.isNaN(value.getTime()) ? null : value;
			}
			case "select":
				return raw === "" ? null : raw;
			case "multiSelect":
				return parseDatabaseMultiSelectValue(raw);
			default:
				return raw;
		}
	}

	serializeCellValue(value: unknown, columnType: ColumnType): string {
		if (value == null) return "";
		switch (columnType) {
			case "checkbox":
				return value ? "true" : "false";
			case "date":
				return value instanceof Date ? value.toISOString() : String(value);
			case "select":
				return String(value);
			case "multiSelect":
				return Array.isArray(value) ? JSON.stringify(value) : "";
			default:
				return String(value);
		}
	}

	validateCellValue(raw: string, columnType: ColumnType): string | null {
		switch (columnType) {
			case "number":
				return raw !== "" && Number.isNaN(Number(raw)) ? "Invalid number" : null;
			case "date":
				return raw !== "" && Number.isNaN(new Date(raw).getTime()) ? "Invalid date" : null;
			case "email":
				return raw !== "" && !raw.includes("@") ? "Invalid email" : null;
			case "url":
				if (raw === "") return null;
				try {
					new URL(raw);
					return null;
				} catch {
					return "Invalid URL";
				}
			default:
				return null;
		}
	}

	formatCellDisplay(
		raw: string,
		columnType: ColumnType,
		format?: NumberFormat | DateFormat,
		options?: DatabaseColumnDef["options"],
	): string {
		if (raw === "") return "";
		switch (columnType) {
			case "number": {
				const value = Number(raw);
				if (Number.isNaN(value)) return raw;
				const numberFormat = format as NumberFormat | undefined;
				if (numberFormat?.style === "currency" && numberFormat.currency) {
					return new Intl.NumberFormat(undefined, {
						style: "currency",
						currency: numberFormat.currency,
						minimumFractionDigits: numberFormat.decimals,
						maximumFractionDigits: numberFormat.decimals,
					}).format(value);
				}
				if (numberFormat?.style === "percent") {
					return new Intl.NumberFormat(undefined, {
						style: "percent",
						minimumFractionDigits: numberFormat.decimals,
						maximumFractionDigits: numberFormat.decimals,
					}).format(value);
				}
				if (numberFormat?.decimals != null) {
					return value.toFixed(numberFormat.decimals);
				}
				return String(value);
			}
			case "date": {
				const value = new Date(raw);
				if (Number.isNaN(value.getTime())) return raw;
				const dateFormat = format as DateFormat | undefined;
				const options: Intl.DateTimeFormatOptions = {
					dateStyle: dateFormat?.dateStyle ?? "medium",
				};
				if (dateFormat?.includeTime) {
					options.timeStyle = "short";
				}
				return new Intl.DateTimeFormat(undefined, options).format(value);
			}
			case "checkbox":
				return raw.toLowerCase() === "true" ? "✓" : "";
			case "select":
				return formatStoredSelectValue(raw, options);
			case "multiSelect":
				return formatStoredMultiSelectValue(raw, options);
			default:
				return raw;
		}
	}

	coerceValue(
		raw: string,
		fromType: ColumnType,
		toType: ColumnType,
		options?: DatabaseColumnDef["options"],
	): string {
		return coerceDatabaseValue(raw, fromType, toType, options);
	}

	getRowId(row: DatabaseRow): string {
		return row.id;
	}

	private deriveViewColumns(view: DatabaseViewState): DatabaseViewModelColumn[] {
		const schema = this.deriveColumnSchema();
		const schemaById = new Map(schema.map((column, columnIndex) => [column.id, { column, columnIndex }]));
		const columnOrder = view.columnOrder ?? schema.map((column) => column.id);
		const visibleColumnIds = new Set(
			view.visibleColumnIds ?? schema.filter((column) => !column.hidden).map((column) => column.id),
		);
		const orderedIds = [
			...columnOrder,
			...schema.map((column) => column.id).filter((columnId) => !columnOrder.includes(columnId)),
		];

		const orderedColumns = orderedIds
			.map((columnId) => schemaById.get(columnId))
			.filter((entry): entry is { column: DatabaseColumnDef; columnIndex: number } => entry != null)
			.filter(({ column }) => !column.hidden && visibleColumnIds.has(column.id))
			.map(({ column, columnIndex }) => ({
				id: column.id,
				title: column.title,
				type: this.normalizeColumnType(column.type),
				columnIndex,
				width: column.width,
				hidden: column.hidden,
				pinned: column.pinned,
				options: column.options,
				format: column.format,
				readonly: column.readonly,
			}));

		const leftColumns = orderedColumns.filter((column) => column.pinned === "left");
		const centerColumns = orderedColumns.filter((column) => column.pinned == null);
		const rightColumns = orderedColumns.filter((column) => column.pinned === "right");
		return [...leftColumns, ...centerColumns, ...rightColumns];
	}

	private matchesFilterGroup(row: DatabaseRow, filterGroup: FilterGroup, columns: DatabaseViewModelColumn[]): boolean {
		const results = filterGroup.conditions.map((condition) =>
			this.isFilterGroup(condition)
				? this.matchesFilterGroup(row, condition, columns)
				: this.matchesFilterCondition(row, condition, columns),
		);
		return filterGroup.operator === "or" ? results.some(Boolean) : results.every(Boolean);
	}

	private matchesFilterCondition(row: DatabaseRow, condition: FilterCondition, columns: DatabaseViewModelColumn[]): boolean {
		const column = columns.find((entry) => entry.id === condition.columnId);
		if (!column) return true;
		return this.matchesOperator(
			row.cells[condition.columnId] ?? "",
			condition.operator,
			condition.value,
			column.type,
			column.options,
		);
	}

	private matchesOperator(
		rawValue: string,
		operator: FilterOperator,
		filterValue: string | string[] | null,
		columnType: ColumnType,
		options?: DatabaseColumnDef["options"],
	): boolean {
		const normalizedRawValue =
			columnType === "select"
				? resolveStoredSelectOption(rawValue, options)?.id ?? rawValue
				: rawValue;
		if (columnType === "date") {
			return this.matchesDateOperator(normalizedRawValue, operator, filterValue);
		}
		const lowerValue = normalizedRawValue.toLowerCase();
		switch (operator) {
			case "is":
				return lowerValue === String(filterValue ?? "").toLowerCase();
			case "is_not":
				return lowerValue !== String(filterValue ?? "").toLowerCase();
			case "contains":
				if (columnType === "multiSelect") {
					return parseDatabaseMultiSelectValue(rawValue).includes(
						String(filterValue ?? ""),
					);
				}
				return lowerValue.includes(String(filterValue ?? "").toLowerCase());
			case "not_contains":
				if (columnType === "multiSelect") {
					return !parseDatabaseMultiSelectValue(rawValue).includes(
						String(filterValue ?? ""),
					);
				}
				return !lowerValue.includes(String(filterValue ?? "").toLowerCase());
			case "starts_with":
				return lowerValue.startsWith(String(filterValue ?? "").toLowerCase());
			case "ends_with":
				return lowerValue.endsWith(String(filterValue ?? "").toLowerCase());
			case "is_empty":
				return rawValue === "";
			case "is_not_empty":
				return rawValue !== "";
			case "is_checked":
				return rawValue.toLowerCase() === "true";
			case "is_unchecked":
				return rawValue.toLowerCase() !== "true";
			case "is_any_of": {
				const values = Array.isArray(filterValue) ? filterValue : [String(filterValue ?? "")];
				if (columnType === "multiSelect") {
					const selectedValues = parseDatabaseMultiSelectValue(rawValue);
					return values.some((value) => selectedValues.includes(value));
				}
				return values.includes(normalizedRawValue);
			}
			case "is_none_of": {
				const values = Array.isArray(filterValue) ? filterValue : [String(filterValue ?? "")];
				if (columnType === "multiSelect") {
					const selectedValues = parseDatabaseMultiSelectValue(rawValue);
					return values.every((value) => !selectedValues.includes(value));
				}
				return !values.includes(normalizedRawValue);
			}
			case "=":
				return this.comparePrimitive(normalizedRawValue, String(filterValue ?? ""), columnType) === 0;
			case "!=":
				return this.comparePrimitive(normalizedRawValue, String(filterValue ?? ""), columnType) !== 0;
			case ">":
				return this.comparePrimitive(normalizedRawValue, String(filterValue ?? ""), columnType) > 0;
			case "<":
				return this.comparePrimitive(normalizedRawValue, String(filterValue ?? ""), columnType) < 0;
			case ">=":
				return this.comparePrimitive(normalizedRawValue, String(filterValue ?? ""), columnType) >= 0;
			case "<=":
				return this.comparePrimitive(normalizedRawValue, String(filterValue ?? ""), columnType) <= 0;
			default:
				return true;
		}
	}

	private matchesDateOperator(
		rawValue: string,
		operator: FilterOperator,
		filterValue: string | string[] | null,
	): boolean {
		if (operator === "is_empty") {
			return rawValue === "";
		}
		if (operator === "is_not_empty") {
			return rawValue !== "";
		}
		const rawDate = this.parseFilterDate(rawValue);
		if (!rawDate) {
			return false;
		}
		switch (operator) {
			case "is": {
				const targetDate = this.parseFilterDate(String(filterValue ?? ""));
				return targetDate ? this.isSameCalendarDay(rawDate, targetDate) : false;
			}
			case "is_before": {
				const targetDate = this.parseFilterDate(String(filterValue ?? ""));
				return targetDate ? this.startOfCalendarDay(rawDate) < this.startOfCalendarDay(targetDate) : false;
			}
			case "is_after": {
				const targetDate = this.parseFilterDate(String(filterValue ?? ""));
				return targetDate ? this.startOfCalendarDay(rawDate) > this.startOfCalendarDay(targetDate) : false;
			}
			case "is_between": {
				if (!Array.isArray(filterValue) || filterValue.length < 2) {
					return false;
				}
				const startDate = this.parseFilterDate(filterValue[0] ?? "");
				const endDate = this.parseFilterDate(filterValue[1] ?? "");
				if (!startDate || !endDate) {
					return false;
				}
				const rawTime = this.startOfCalendarDay(rawDate);
				return rawTime >= this.startOfCalendarDay(startDate) && rawTime <= this.startOfCalendarDay(endDate);
			}
			case "is_relative":
				return this.matchesRelativeDate(rawDate, String(filterValue ?? ""));
			default:
				return true;
		}
	}

	private compareCellValues(
		left: string,
		right: string,
		columnType: ColumnType,
		options?: DatabaseColumnDef["options"],
	): number {
		if (columnType === "select") {
			return this.comparePrimitive(
				formatStoredSelectValue(left, options),
				formatStoredSelectValue(right, options),
				"text",
			);
		}
		if (columnType === "multiSelect") {
			return this.comparePrimitive(
				formatStoredMultiSelectValue(left, options),
				formatStoredMultiSelectValue(right, options),
				"text",
			);
		}
		return this.comparePrimitive(left, right, columnType);
	}

	private comparePrimitive(left: string, right: string, columnType: ColumnType): number {
		switch (columnType) {
			case "number":
				return (Number(left) || 0) - (Number(right) || 0);
			case "date":
				return (new Date(left).getTime() || 0) - (new Date(right).getTime() || 0);
			case "checkbox":
				return (left.toLowerCase() === "true" ? 1 : 0) - (right.toLowerCase() === "true" ? 1 : 0);
			default:
				return left.toLowerCase().localeCompare(right.toLowerCase());
		}
	}

	private parseFilterDate(raw: string): Date | null {
		if (!raw) {
			return null;
		}
		const value = new Date(raw);
		return Number.isNaN(value.getTime()) ? null : value;
	}

	private startOfCalendarDay(value: Date): number {
		return new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
	}

	private endOfCalendarDay(value: Date): number {
		return new Date(value.getFullYear(), value.getMonth(), value.getDate(), 23, 59, 59, 999).getTime();
	}

	private startOfCalendarWeek(value: Date): number {
		const nextValue = new Date(value.getFullYear(), value.getMonth(), value.getDate());
		nextValue.setDate(nextValue.getDate() - nextValue.getDay());
		return nextValue.getTime();
	}

	private endOfCalendarWeek(value: Date): number {
		const nextValue = new Date(value.getFullYear(), value.getMonth(), value.getDate());
		nextValue.setDate(nextValue.getDate() + (6 - nextValue.getDay()));
		return this.endOfCalendarDay(nextValue);
	}

	private startOfCalendarMonth(value: Date): number {
		return new Date(value.getFullYear(), value.getMonth(), 1).getTime();
	}

	private endOfCalendarMonth(value: Date): number {
		return new Date(value.getFullYear(), value.getMonth() + 1, 0, 23, 59, 59, 999).getTime();
	}

	private isSameCalendarDay(left: Date, right: Date): boolean {
		return left.getFullYear() === right.getFullYear()
			&& left.getMonth() === right.getMonth()
			&& left.getDate() === right.getDate();
	}

	private matchesRelativeDate(rawDate: Date, relativeValue: string): boolean {
		const now = new Date();
		const rawTime = rawDate.getTime();
		const todayStart = this.startOfCalendarDay(now);
		switch (relativeValue) {
			case "today":
				return rawTime >= todayStart && rawTime <= this.endOfCalendarDay(now);
			case "yesterday": {
				const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
				return rawTime >= this.startOfCalendarDay(yesterday) && rawTime <= this.endOfCalendarDay(yesterday);
			}
			case "tomorrow": {
				const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
				return rawTime >= this.startOfCalendarDay(tomorrow) && rawTime <= this.endOfCalendarDay(tomorrow);
			}
			case "this_week":
				return rawTime >= this.startOfCalendarWeek(now) && rawTime <= this.endOfCalendarWeek(now);
			case "last_7_days": {
				const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6);
				return rawTime >= this.startOfCalendarDay(start) && rawTime <= this.endOfCalendarDay(now);
			}
			case "next_7_days": {
				const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 6);
				return rawTime >= todayStart && rawTime <= this.endOfCalendarDay(end);
			}
			case "this_month":
				return rawTime >= this.startOfCalendarMonth(now) && rawTime <= this.endOfCalendarMonth(now);
			default:
				return false;
		}
	}

	private incrementFacetBucket(
		buckets: Map<string, FacetBucket>,
		value: string,
		label: string,
	): void {
		const existing = buckets.get(value);
		if (existing) {
			existing.count += 1;
			return;
		}
		buckets.set(value, { value, label, count: 1 });
	}

	private formatGroupLabel(
		raw: string,
		column: DatabaseViewModelColumn,
	): string {
		const formatted = this.formatCellDisplay(
			raw,
			column.type,
			column.format,
			column.options,
		);
		return formatted || "(empty)";
	}

	private resolveGroupingColumn(
		groupBy: string,
		columns: DatabaseViewModelColumn[],
	): DatabaseViewModelColumn | null {
		const visibleColumn = columns.find((entry) => entry.id === groupBy);
		if (visibleColumn) {
			return visibleColumn;
		}
		const schema = this.deriveColumnSchema();
		const schemaColumn = schema.find((entry) => entry.id === groupBy);
		if (!schemaColumn) {
			return null;
		}
		return {
			id: schemaColumn.id,
			title: schemaColumn.title,
			type: this.normalizeColumnType(schemaColumn.type),
			columnIndex: schema.findIndex((entry) => entry.id === groupBy),
			width: schemaColumn.width,
			hidden: schemaColumn.hidden,
			pinned: schemaColumn.pinned,
			options: schemaColumn.options,
			format: schemaColumn.format,
			readonly: schemaColumn.readonly,
		};
	}

	private normalizeColumnType(type: string | undefined): ColumnType {
		return type && VALID_COLUMN_TYPES.has(type as ColumnType) ? (type as ColumnType) : "text";
	}

	private isFilterGroup(value: FilterCondition | FilterGroup): value is FilterGroup {
		return "conditions" in value;
	}
}
