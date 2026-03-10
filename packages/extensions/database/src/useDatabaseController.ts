import type { BlockHandle, CellSelection } from "@pen/core";
import {
	DATA_ATTRS,
	useEditorContext,
	useFieldEditorContext,
	useFieldEditorState,
	useSelection,
} from "@pen/react";
import { generateId } from "@pen/types";
import { useEffect, useMemo, useState } from "react";
import { DatabaseEngine } from "./engine";
import type {
	ColumnType,
	DatabaseColumnDef,
	DatabaseDataProvider,
	DatabasePage,
	DatabaseViewModel,
	DatabaseViewModelColumn,
	DatabaseViewModelRow,
	DatabaseViewState,
	FacetBucket,
	FilterGroup,
} from "./types";
import { isCellInSelection } from "./utils";
import {
	createDatabaseViewDefinition,
	getCalendarDateColumn,
	getColumnStickyStyle,
	getDefaultViewTitle,
	getFixedEdgeStyle,
	getNextRowPinningState,
	getNextSortState,
	getPinnedOffsets,
	inferCalendarMonth,
	resolveDefaultColumnWidth,
	shiftMonth,
	toEditableFilterGroup,
} from "./utils/databaseRenderer";

const DATABASE_DATA_PROVIDER_SLOT = "database:data-provider";
const DATABASE_ROW_SELECTION_SLOT = "database:row-selection";

export const ROW_SELECT_COLUMN_WIDTH = 44;

export type CellPointerHandler = (
	event: React.MouseEvent<HTMLElement>,
	row: DatabaseViewModelRow,
	column: DatabaseViewModelColumn,
) => void;

type DatabaseRowSelectionController = {
	registerDeleteHandler: (
		blockId: string,
		handler: () => boolean,
	) => () => void;
	deleteSelectedRows: (blockId: string) => boolean;
};

function getOrCreateDatabaseRowSelectionController(
	editor: ReturnType<typeof useEditorContext>["editor"],
): DatabaseRowSelectionController {
	const existing = editor.internals.getSlot(
		DATABASE_ROW_SELECTION_SLOT,
	) as DatabaseRowSelectionController | undefined;
	if (existing) {
		return existing;
	}

	const handlers = new Map<string, () => boolean>();
	const controller: DatabaseRowSelectionController = {
		registerDeleteHandler(blockId, handler) {
			handlers.set(blockId, handler);
			return () => {
				if (handlers.get(blockId) === handler) {
					handlers.delete(blockId);
				}
			};
		},
		deleteSelectedRows(blockId) {
			return handlers.get(blockId)?.() ?? false;
		},
	};
	editor.internals.setSlot(DATABASE_ROW_SELECTION_SLOT, controller);
	return controller;
}

export interface DatabaseControllerConfig {
	blockId: string;
}

export interface DatabaseController {
	block: BlockHandle;
	engine: DatabaseEngine;
	viewModel: DatabaseViewModel;
	columnSchema: DatabaseColumnDef[];

	viewState: DatabaseViewState;
	updateViewState: (patch: Partial<Omit<DatabaseViewState, "id">>) => void;
	views: readonly DatabaseViewState[];

	title: string;
	isEditingTitle: boolean;
	setIsEditingTitle: (editing: boolean) => void;
	handleTitleClick: () => void;
	handleTitleBlur: (event: React.FocusEvent<HTMLInputElement>) => void;
	handleTitleKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => void;

	addRow: () => void;
	addColumn: () => void;
	deleteColumn: (columnId: string) => void;
	renameColumn: (columnId: string, title: string) => void;
	changeColumnType: (columnId: string, type: ColumnType) => void;
	toggleColumnVisibility: (columnId: string) => void;
	changeColumnPin: (columnId: string, pinned: "left" | "right" | undefined) => void;
	addOption: (columnId: string, value: string, color?: string) => void;
	renameOption: (columnId: string, optionId: string, value: string) => void;
	recolorOption: (columnId: string, optionId: string, color: string) => void;
	removeOption: (columnId: string, optionId: string) => void;
	moveOption: (columnId: string, optionId: string, direction: "up" | "down") => void;

	addView: (type: DatabaseViewState["type"]) => void;
	setActiveView: (viewId: string) => void;
	removeView: (viewId: string) => void;
	showAddViewMenu: boolean;
	setShowAddViewMenu: (show: boolean) => void;

	rowSelection: Record<string, boolean>;
	toggleRow: (rowId: string) => void;
	toggleAllRows: () => void;
	deleteSelectedRows: () => void;
	pinSelectedRows: (target: "top" | "bottom" | "none") => void;
	handleRowSelectionKeyDown: (event: React.KeyboardEvent<HTMLInputElement>, rowId: string) => void;
	hasSelectedRows: boolean;
	selectedRowCount: number;
	allVisibleSelected: boolean;

	cellSelection: CellSelection | null;
	createCellSelection: (anchor: { row: number; col: number }, head?: { row: number; col: number }) => CellSelection;
	handleCellMouseDown: CellPointerHandler;
	handleCellDoubleClick: CellPointerHandler;

	globalSearch: string;
	setGlobalSearch: (value: string) => void;

	filterGroup: FilterGroup;
	handleFilterGroupChange: (filter: FilterGroup | null) => void;
	facetBucketsByColumnId: Record<string, FacetBucket[]>;
	showFilterPanel: boolean;
	setShowFilterPanel: (show: boolean) => void;

	handleSortChange: (sort: NonNullable<DatabaseViewState["sort"]>) => void;
	handleHeaderClick: (event: React.MouseEvent<HTMLTableCellElement>, columnId: string) => void;
	showSortPanel: boolean;
	setShowSortPanel: (show: boolean) => void;

	handleChangeGroupBy: (groupBy: string | null) => void;
	showGroupPanel: boolean;
	setShowGroupPanel: (show: boolean) => void;

	showColumnVisibilityMenu: boolean;
	setShowColumnVisibilityMenu: (show: boolean) => void;

	activeColumnMenu: string | null;
	setActiveColumnMenu: (columnId: string | null) => void;

	handlePreviousPage: () => void;
	handleNextPage: () => void;
	pageCount: number;
	showPagination: boolean;

	remoteLoading: boolean;
	remoteError: string | null;

	isUiReadonly: boolean;
	isDataReadonly: boolean;
	showRowSelectionControls: boolean;

	columns: DatabaseViewModelColumn[];
	allRows: DatabaseViewModelRow[];
	rows: DatabaseViewModelRow[];
	pinnedTopRows: DatabaseViewModelRow[];
	pinnedBottomRows: DatabaseViewModelRow[];
	rowGroups: DatabaseViewModel["rowGroups"];
	visibleRows: DatabaseViewModelRow[];
	visibleColumnIds: string[];
	visibleColumnIdSet: ReadonlySet<string>;

	defaultColumnWidth: number;
	pinnedOffsets: Record<string, { left?: number; right?: number }>;
	getColumnStickyStyle: typeof getColumnStickyStyle;
	getFixedEdgeStyle: typeof getFixedEdgeStyle;
	isCellSelected: (row: number, column: number) => boolean;
	formatRemoteCell: (row: DatabaseViewModelRow, column: DatabaseViewModelColumn) => string;

	calendarMonth: Date;
	shiftCalendarMonth: (amount: number) => void;
	calendarDateColumn: DatabaseColumnDef | undefined;
}

export function useDatabaseController(config: DatabaseControllerConfig): DatabaseController {
	const { blockId } = config;
	const { editor, readonly } = useEditorContext();
	const fieldEditor = useFieldEditorContext();
	const fieldEditorState = useFieldEditorState(fieldEditor);
	const editorSelection = useSelection(editor);

	const block = editor.getBlock(blockId)!;
	const provider = editor.internals.getSlot(DATABASE_DATA_PROVIDER_SLOT) as DatabaseDataProvider | undefined;
	const engine = useMemo(() => {
		const nextEngine = new DatabaseEngine(editor, blockId);
		if (provider) {
			nextEngine.setDataProvider(provider);
		}
		return nextEngine;
	}, [editor, blockId, provider]);

	const activeView = block.databaseActiveView();
	const serializedActiveView = JSON.stringify(activeView ?? null);
	const initialView = engine.deriveViewState();
	const [viewState, setViewState] = useState<DatabaseViewState>(initialView);
	const [globalSearch, setGlobalSearchRaw] = useState("");
	const [rowSelection, setRowSelection] = useState<Record<string, boolean>>({});
	const [isEditingTitle, setIsEditingTitle] = useState(false);
	const [activeColumnMenu, setActiveColumnMenu] = useState<string | null>(null);
	const [showSortPanel, setShowSortPanel] = useState(false);
	const [showFilterPanel, setShowFilterPanel] = useState(false);
	const [showColumnVisibilityMenu, setShowColumnVisibilityMenu] = useState(false);
	const [showGroupPanel, setShowGroupPanel] = useState(false);
	const [showAddViewMenu, setShowAddViewMenu] = useState(false);
	const [calendarMonth, setCalendarMonth] = useState<Date | null>(null);
	const [remotePage, setRemotePage] = useState<DatabasePage | null>(null);
	const [remoteLoading, setRemoteLoading] = useState(false);
	const [remoteError, setRemoteError] = useState<string | null>(null);
	const [columnSchemaRefreshToken, setColumnSchemaRefreshToken] = useState(0);

	const fieldEditorActiveCell = fieldEditorState.activeCellCoord;
	const cellSelection =
		editorSelection?.type === "cell" && editorSelection.blockId === blockId
			? editorSelection
			: null;
	const isUiReadonly = readonly;
	const isDataReadonly = readonly || engine.isRemote;
	const showRowSelectionControls = !isUiReadonly;
	const title = (block.props.title as string) || "Untitled";
	const databaseViews = block.databaseViews();
	const defaultColumnWidth = resolveDefaultColumnWidth(block.props.defaultColumnWidth);
	const columnSchema = engine.deriveColumnSchema();
	const localViewModel = engine.buildViewModel({ view: viewState, globalSearch });
	const remoteViewModel = remotePage ? engine.buildRemoteViewModel(remotePage, viewState) : null;
	const viewModel = engine.isRemote && remoteViewModel ? remoteViewModel : localViewModel;
	const columns = viewModel.columns;
	const pinnedTopRows = viewModel.pinnedTopRows;
	const rows = viewModel.rows;
	const pinnedBottomRows = viewModel.pinnedBottomRows;
	const rowGroups = viewModel.rowGroups;
	const allRows = viewModel.allRows;
	const visibleRows = useMemo(
		() =>
			rowGroups.length > 0
				? [
					...pinnedTopRows,
					...rowGroups.flatMap((group) => group.rows),
					...pinnedBottomRows,
				]
				: [...pinnedTopRows, ...rows, ...pinnedBottomRows],
		[pinnedBottomRows, pinnedTopRows, rowGroups, rows],
	);
	const pageCount = viewModel.pageCount;
	const showPagination = pageCount > 1;
	const visibleColumnIds = viewState.visibleColumnIds ?? columnSchema.filter((column) => !column.hidden).map((column) => column.id);
	const visibleColumnIdSet = new Set(visibleColumnIds);
	const calendarDateColumn = getCalendarDateColumn(columnSchema);
	const pinnedOffsets = getPinnedOffsets(columns, {
		defaultColumnWidth,
		leftBase: showRowSelectionControls ? ROW_SELECT_COLUMN_WIDTH : 0,
		rightBase: 0,
	});
	const hasSelectedRows = Object.keys(rowSelection).some((id) => rowSelection[id]);
	const selectedRowCount = Object.values(rowSelection).filter(Boolean).length;
	const visibleRowIds = visibleRows.map((row) => row.id);
	const visibleSelectionColumnIds = columns.map((column) => column.id);
	const allVisibleSelected = visibleRowIds.length > 0 && visibleRowIds.every((rowId) => rowSelection[rowId]);
	const filterGroup = toEditableFilterGroup(viewState.filter);
	const facetSourceRows = engine.searchRows(engine.deriveRowData(), globalSearch, columns);
	const facetBucketsByColumnId = Object.fromEntries(
		columnSchema.map((column) => [
			column.id,
			engine.facetColumnValues(facetSourceRows, column.id, columns),
		]),
	) as Record<string, FacetBucket[]>;

	// --- Cell selection helpers ---

	function createDatabaseCellSelection(
		anchor: { row: number; col: number },
		head: { row: number; col: number } = anchor,
	): CellSelection {
		return {
			type: "cell",
			blockId,
			anchor,
			head,
			rowIds: visibleRowIds,
			columnIds: visibleSelectionColumnIds,
		};
	}

	function findVisibleCellCoordByIds(
		rowId: string | null,
		columnId: string | null,
	): { row: number; col: number } | null {
		if (!rowId || !columnId) {
			return null;
		}
		const row = visibleRows.findIndex((entry) => entry.id === rowId);
		const col = columns.findIndex((entry) => entry.id === columnId);
		if (row < 0 || col < 0) {
			return null;
		}
		return { row, col };
	}

	function findVisibleCellCoordByStorage(
		row: number,
		col: number,
	): { row: number; col: number } | null {
		const rowIndex = visibleRows.findIndex(
			(entry) => entry.crdtRowIndex === row,
		);
		const colIndex = columns.findIndex(
			(entry) => entry.columnIndex === col,
		);
		if (rowIndex < 0 || colIndex < 0) {
			return null;
		}
		return { row: rowIndex, col: colIndex };
	}

	function normalizeDatabaseCellSelection(
		selection: CellSelection,
	): CellSelection | null {
		if (columns.length === 0) {
			return null;
		}
		if (visibleRows.length === 0) {
			return {
				type: "cell",
				blockId,
				anchor: selection.anchor,
				head: selection.head,
			};
		}

		const firstVisibleCell = { row: 0, col: 0 };
		const anchorCoord =
			findVisibleCellCoordByIds(
				selection.rowIds?.[selection.anchor.row] ?? null,
				selection.columnIds?.[selection.anchor.col] ?? null,
			) ??
			findVisibleCellCoordByStorage(
				selection.anchor.row,
				selection.anchor.col,
			) ??
			firstVisibleCell;
		const headCoord =
			findVisibleCellCoordByIds(
				selection.rowIds?.[selection.head.row] ?? null,
				selection.columnIds?.[selection.head.col] ?? null,
			) ??
			findVisibleCellCoordByStorage(
				selection.head.row,
				selection.head.col,
			) ??
			anchorCoord;

		return createDatabaseCellSelection(anchorCoord, headCoord);
	}

	function areSelectionAxesEqual(
		left: string[] | undefined,
		right: string[],
	): boolean {
		if (!left || left.length !== right.length) {
			return false;
		}
		return left.every((value, index) => value === right[index]);
	}

	function isDatabaseSelectionCurrent(selection: CellSelection): boolean {
		if (visibleRows.length === 0) {
			return !selection.rowIds && !selection.columnIds;
		}

		return (
			areSelectionAxesEqual(selection.rowIds, visibleRowIds) &&
			areSelectionAxesEqual(selection.columnIds, visibleSelectionColumnIds)
		);
	}

	// --- Mutation handlers ---

	function updateViewState(patch: Partial<Omit<DatabaseViewState, "id">>) {
		const nextView = {
			...viewState,
			...patch,
		};
		setViewState(nextView);
		editor.apply([
			{
				type: "database-update-view",
				blockId,
				viewId: block.databasePrimaryViewId() ?? undefined,
				patch,
			},
		], { origin: "user" });
	}

	function handleTitleClick() {
		if (isUiReadonly) return;
		setIsEditingTitle(true);
	}

	function handleTitleBlur(event: React.FocusEvent<HTMLInputElement>) {
		setIsEditingTitle(false);
		const nextTitle = event.currentTarget.value.trim() || "Untitled";
		if (nextTitle === title) return;
		editor.apply([
			{
				type: "update-block",
				blockId,
				props: { title: nextTitle },
			},
		]);
	}

	function handleTitleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
		if (event.key === "Enter" || event.key === "Escape") {
			event.currentTarget.blur();
		}
	}

	function handleCellMouseDown(
		event: React.MouseEvent<HTMLElement>,
		row: DatabaseViewModelRow,
		column: DatabaseViewModelColumn,
	) {
		if (!fieldEditor) return;
		const isEditing =
			fieldEditorActiveCell?.blockId === blockId
			&& fieldEditorActiveCell.row === row.crdtRowIndex
			&& fieldEditorActiveCell.col === column.columnIndex;
		if (isEditing) return;
		const nextCoord = findVisibleCellCoordByIds(row.id, column.id);
		if (!nextCoord) return;
		event.preventDefault();
		event.stopPropagation();
		event.nativeEvent.stopImmediatePropagation?.();
		const isSameSingleCellSelection =
			cellSelection &&
			cellSelection.anchor.row === nextCoord.row &&
			cellSelection.anchor.col === nextCoord.col &&
			cellSelection.head.row === nextCoord.row &&
			cellSelection.head.col === nextCoord.col;
		if (!event.shiftKey && isSameSingleCellSelection) {
			editor.selectBlock(blockId);
			return;
		}
		if (event.shiftKey && cellSelection) {
			editor.setSelection(
				createDatabaseCellSelection(cellSelection.anchor, nextCoord),
			);
			return;
		}
		editor.setSelection(createDatabaseCellSelection(nextCoord));
	}

	function handleCellDoubleClick(
		event: React.MouseEvent<HTMLElement>,
		row: DatabaseViewModelRow,
		column: DatabaseViewModelColumn,
	) {
		if (isDataReadonly || !fieldEditor) return;
		event.preventDefault();
		event.stopPropagation();
		event.nativeEvent.stopImmediatePropagation?.();
		const cellSurface = event.currentTarget.querySelector(`[${DATA_ATTRS.fieldEditorSurface}]`) as HTMLElement | null;
		if (cellSurface) {
			fieldEditor.activateCellFromElement?.(blockId, row.crdtRowIndex, column.columnIndex, cellSurface)
				?? fieldEditor.activateCell?.(blockId, row.crdtRowIndex, column.columnIndex);
			return;
		}
		fieldEditor.activateCell?.(blockId, row.crdtRowIndex, column.columnIndex);
	}

	function handleHeaderClick(event: React.MouseEvent<HTMLTableCellElement>, columnId: string) {
		const nextSort = getNextSortState(viewState.sort ?? [], columnId, event.shiftKey);
		updateViewState({ sort: nextSort, pageIndex: 0 });
	}

	function handleAddRow() {
		if (isDataReadonly) return;
		editor.apply([
			{
				type: "database-insert-row",
				blockId,
				index: block.tableRowCount(),
			},
		], { origin: "user" });
	}

	function handleAddColumn() {
		if (isUiReadonly) return;
		const columnId = generateId();
		const nextColumn: DatabaseColumnDef = {
			id: columnId,
			title: "New column",
			type: "text",
		};
		editor.apply([
			{
				type: "database-add-column",
				blockId,
				column: nextColumn,
				index: block.tableColumnCount(),
				viewId: block.databasePrimaryViewId() ?? undefined,
			},
		], { origin: "user" });
	}

	function handleAddView(nextType: DatabaseViewState["type"]) {
		if (isUiReadonly) return;
		const nextViewId = generateId();
		const nextView = createDatabaseViewDefinition({
			id: nextViewId,
			type: nextType,
			columns: columnSchema,
			existingViews: databaseViews,
		});
		setViewState(nextView);
		editor.apply([
			{
				type: "database-add-view",
				blockId,
				view: nextView,
			},
			{
				type: "database-set-active-view",
				blockId,
				viewId: nextViewId,
			},
		], { origin: "user" });
		setShowAddViewMenu(false);
	}

	function handleSetActiveView(viewId: string) {
		const nextView = databaseViews.find((view) => view.id === viewId);
		if (nextView) {
			setViewState(nextView);
		}
		editor.apply([
			{
				type: "database-set-active-view",
				blockId,
				viewId,
			},
		], { origin: "user" });
	}

	function handleRemoveView(viewId: string) {
		if (isUiReadonly || databaseViews.length <= 1) return;
		const currentActiveViewId = block.databasePrimaryViewId() ?? viewState.id;
		if (currentActiveViewId === viewId) {
			const fallbackView = databaseViews.find((view) => view.id !== viewId);
			if (fallbackView) {
				setViewState(fallbackView);
			}
		}
		editor.apply([
			{
				type: "database-remove-view",
				blockId,
				viewId,
			},
		], { origin: "user" });
	}

	function handleToggleAllRows() {
		if (allVisibleSelected) {
			const nextSelection = { ...rowSelection };
			for (const rowId of visibleRowIds) {
				delete nextSelection[rowId];
			}
			setRowSelection(nextSelection);
			return;
		}
		const nextSelection = { ...rowSelection };
		for (const rowId of visibleRowIds) {
			nextSelection[rowId] = true;
		}
		setRowSelection(nextSelection);
	}

	function handleToggleRow(rowId: string) {
		setRowSelection((previous) => ({
			...previous,
			[rowId]: !previous[rowId],
		}));
	}

	function getSelectedRowIds(
		fallback?: { rowId: string; checked: boolean },
	): string[] {
		const selectedRowIds = allRows
			.filter((row) => rowSelection[row.id])
			.map((row) => row.id);
		if (
			fallback?.checked &&
			!selectedRowIds.includes(fallback.rowId)
		) {
			selectedRowIds.push(fallback.rowId);
		}
		return selectedRowIds;
	}

	function handleRowSelectionKeyDown(
		event: React.KeyboardEvent<HTMLInputElement>,
		rowId: string,
	) {
		if (event.key !== "Backspace" && event.key !== "Delete") {
			return;
		}
		event.preventDefault();
		event.stopPropagation();
		handleDeleteSelectedRows({
			rowId,
			checked: event.currentTarget.checked,
		});
	}

	function handleDeleteSelectedRows(
		fallback?: { rowId: string; checked: boolean },
	) {
		const selectedRowIds = getSelectedRowIds(fallback);
		if (selectedRowIds.length === 0 || isDataReadonly) return;
		editor.apply([
			{
				type: "database-delete-rows",
				blockId,
				rowIds: selectedRowIds,
			},
		], { origin: "user" });
		setRowSelection({});
	}

	function handlePinSelectedRows(target: "top" | "bottom" | "none") {
		const selectedRowIds = getSelectedRowIds();
		if (selectedRowIds.length === 0) {
			return;
		}
		const currentRowPinning = viewState.rowPinning;
		const nextRowPinning = getNextRowPinningState(
			currentRowPinning,
			selectedRowIds,
			target,
		);
		updateViewState({ rowPinning: nextRowPinning, pageIndex: 0 });
	}

	function handleDeleteColumn(columnId: string) {
		if (isUiReadonly) return;
		editor.apply([
			{ type: "database-remove-column", blockId, columnId },
		], { origin: "user" });
		setActiveColumnMenu(null);
	}

	function handleRenameColumn(columnId: string, nextTitle: string) {
		editor.apply([{
			type: "database-update-column",
			blockId,
			columnId,
			patch: { title: nextTitle || "Untitled" },
		}], { origin: "user" });
		setActiveColumnMenu(null);
	}

	function handleChangeColumnType(columnId: string, nextType: ColumnType) {
		const targetColumn = columnSchema.find((column) => column.id === columnId);
		if (!targetColumn || targetColumn.type === nextType) return;
		editor.apply([{
			type: "database-convert-column",
			blockId,
			columnId,
			toType: nextType,
		}], { origin: "user" });
		setActiveColumnMenu(null);
	}

	function handleToggleColumnVisibility(columnId: string) {
		const nextVisibleColumnIds = visibleColumnIdSet.has(columnId)
			? visibleColumnIds.filter((id) => id !== columnId)
			: [...visibleColumnIds, columnId];
		updateViewState({ visibleColumnIds: nextVisibleColumnIds });
	}

	function handleChangeColumnPin(
		columnId: string,
		nextPinned: "left" | "right" | undefined,
	) {
		editor.apply([{
			type: "database-update-column",
			blockId,
			columnId,
			patch: { pinned: nextPinned },
		}], { origin: "user" });
		setActiveColumnMenu(null);
	}

	function refreshColumnSchemaSoon() {
		requestAnimationFrame(() => {
			setColumnSchemaRefreshToken((value) => value + 1);
		});
	}

	function handleAddOption(columnId: string, value: string, color?: string) {
		const trimmedValue = value.trim();
		if (!trimmedValue) return;
		editor.apply([{
			type: "database-update-select-options",
			blockId,
			columnId,
			action: "add",
			option: {
				id: generateId(),
				value: trimmedValue,
				color,
			},
		}], { origin: "user" });
		refreshColumnSchemaSoon();
	}

	function handleRenameOption(columnId: string, optionId: string, value: string) {
		const trimmedValue = value.trim();
		if (!trimmedValue) return;
		editor.apply([{
			type: "database-update-select-options",
			blockId,
			columnId,
			action: "rename",
			optionId,
			value: trimmedValue,
		}], { origin: "user" });
		refreshColumnSchemaSoon();
	}

	function handleRecolorOption(columnId: string, optionId: string, color: string) {
		editor.apply([{
			type: "database-update-select-options",
			blockId,
			columnId,
			action: "recolor",
			optionId,
			color,
		}], { origin: "user" });
		refreshColumnSchemaSoon();
	}

	function handleRemoveOption(columnId: string, optionId: string) {
		editor.apply([{
			type: "database-update-select-options",
			blockId,
			columnId,
			action: "remove",
			optionId,
		}], { origin: "user" });
		refreshColumnSchemaSoon();
	}

	function handleMoveOption(columnId: string, optionId: string, direction: "up" | "down") {
		const column = columnSchema.find((entry) => entry.id === columnId);
		const currentOptions = column?.options ?? [];
		const currentIndex = currentOptions.findIndex((option) => option.id === optionId);
		if (currentIndex < 0) return;
		const targetIndex = direction === "up" ? currentIndex - 1 : currentIndex + 1;
		if (targetIndex < 0 || targetIndex >= currentOptions.length) return;
		const nextOrder = [...currentOptions.map((option) => option.id)];
		const [movedOptionId] = nextOrder.splice(currentIndex, 1);
		nextOrder.splice(targetIndex, 0, movedOptionId);
		editor.apply([{
			type: "database-update-select-options",
			blockId,
			columnId,
			action: "reorder",
			order: nextOrder,
		}], { origin: "user" });
		refreshColumnSchemaSoon();
	}

	function handleFilterGroupChange(nextFilter: FilterGroup | null) {
		updateViewState({ filter: nextFilter, pageIndex: 0 });
	}

	function handleSortChange(nextSort: NonNullable<DatabaseViewState["sort"]>) {
		updateViewState({ sort: nextSort, pageIndex: 0 });
	}

	function handleChangeGroupBy(nextGroupBy: string | null) {
		updateViewState({ groupBy: nextGroupBy, pageIndex: 0 });
	}

	function handlePreviousPage() {
		updateViewState({ pageIndex: Math.max(0, (viewState.pageIndex ?? 0) - 1) });
	}

	function handleNextPage() {
		updateViewState({ pageIndex: Math.min(pageCount - 1, (viewState.pageIndex ?? 0) + 1) });
	}

	function setGlobalSearch(value: string) {
		setGlobalSearchRaw(value);
		updateViewState({ pageIndex: 0 });
	}

	function isCellSelectedFn(row: number, column: number): boolean {
		return !!(
			cellSelection &&
			isCellInSelection(cellSelection, row, column, {
				rowId: visibleRows.find((entry) => entry.crdtRowIndex === row)?.id,
				columnId: columns.find((entry) => entry.columnIndex === column)?.id,
			})
		);
	}

	function formatRemoteCell(row: DatabaseViewModelRow, column: DatabaseViewModelColumn): string {
		return engine.formatCellDisplay(
			row.cells[column.id] ?? "",
			column.type,
			column.format,
			column.options,
		);
	}

	const activeCalendarMonth =
		calendarMonth ?? inferCalendarMonth(allRows, calendarDateColumn?.id ?? null);

	function shiftCalendarMonthFn(amount: number) {
		setCalendarMonth(shiftMonth(activeCalendarMonth, amount));
	}

	// --- Effects ---

	useEffect(() => {
		setViewState(engine.deriveViewState());
	}, [engine, blockId, block.tableColumns().length, columnSchemaRefreshToken, serializedActiveView]);

	useEffect(() => {
		if (!cellSelection) {
			return;
		}
		const normalizedSelection = normalizeDatabaseCellSelection(cellSelection);
		if (!normalizedSelection) {
			editor.selectBlock(blockId);
			return;
		}
		if (
			cellSelection.anchor.row !== normalizedSelection.anchor.row ||
			cellSelection.anchor.col !== normalizedSelection.anchor.col ||
			cellSelection.head.row !== normalizedSelection.head.row ||
			cellSelection.head.col !== normalizedSelection.head.col ||
			!isDatabaseSelectionCurrent(cellSelection)
		) {
			editor.setSelection(normalizedSelection);
		}
	}, [blockId, cellSelection, columns, editor, visibleRowIds, visibleRows, visibleSelectionColumnIds]);

	useEffect(() => {
		const controller = getOrCreateDatabaseRowSelectionController(editor);
		return controller.registerDeleteHandler(blockId, () => {
			const selectedRowIds = getSelectedRowIds();
			if (selectedRowIds.length === 0 || isDataReadonly) {
				return false;
			}
			editor.apply([
				{
					type: "database-delete-rows",
					blockId,
					rowIds: selectedRowIds,
				},
			], { origin: "user" });
			setRowSelection({});
			return true;
		});
	}, [allRows, blockId, editor, isDataReadonly, rowSelection]);

	useEffect(() => {
		const rowIdSet = new Set(allRows.map((row) => row.id));
		setRowSelection((previous) => {
			const nextSelection = Object.fromEntries(
				Object.entries(previous).filter(([rowId, selected]) => selected && rowIdSet.has(rowId)),
			);
			const previousKeys = Object.keys(previous);
			const nextKeys = Object.keys(nextSelection);
			return previousKeys.length === nextKeys.length &&
				previousKeys.every((rowId) => nextSelection[rowId] === previous[rowId])
				? previous
				: nextSelection;
		});
	}, [allRows]);

	useEffect(() => {
		if (viewState.type !== "calendar") {
			return;
		}
		setCalendarMonth(inferCalendarMonth(allRows, calendarDateColumn?.id ?? null));
	}, [calendarDateColumn?.id, viewState.id, viewState.type]);

	useEffect(() => {
		if (!provider || !engine.isRemote) {
			setRemotePage(null);
			setRemoteLoading(false);
			setRemoteError(null);
			return;
		}
		const query = engine.createQuery({ view: viewState });
		let unsub: (() => void) | undefined;
		let cancelled = false;
		setRemoteLoading(true);
		setRemoteError(null);
		provider.fetch(query)
			.then((page) => {
				if (cancelled) return;
				setRemotePage(page);
				setRemoteLoading(false);
			})
			.catch((error: unknown) => {
				if (cancelled) return;
				setRemoteError(error instanceof Error ? error.message : "Failed to load database rows.");
				setRemoteLoading(false);
			});
		if (provider.subscribe) {
			unsub = provider.subscribe(query, (page) => {
				if (!cancelled) {
					setRemotePage(page);
					setRemoteLoading(false);
				}
			});
		}
		return () => {
			cancelled = true;
			unsub?.();
		};
	}, [provider, blockId, engine.isRemote, viewState]);

	return {
		block,
		engine,
		viewModel,
		columnSchema,

		viewState,
		updateViewState,
		views: databaseViews,

		title,
		isEditingTitle,
		setIsEditingTitle,
		handleTitleClick,
		handleTitleBlur,
		handleTitleKeyDown,

		addRow: handleAddRow,
		addColumn: handleAddColumn,
		deleteColumn: handleDeleteColumn,
		renameColumn: handleRenameColumn,
		changeColumnType: handleChangeColumnType,
		toggleColumnVisibility: handleToggleColumnVisibility,
		changeColumnPin: handleChangeColumnPin,
		addOption: handleAddOption,
		renameOption: handleRenameOption,
		recolorOption: handleRecolorOption,
		removeOption: handleRemoveOption,
		moveOption: handleMoveOption,

		addView: handleAddView,
		setActiveView: handleSetActiveView,
		removeView: handleRemoveView,
		showAddViewMenu,
		setShowAddViewMenu,

		rowSelection,
		toggleRow: handleToggleRow,
		toggleAllRows: handleToggleAllRows,
		deleteSelectedRows: () => handleDeleteSelectedRows(),
		pinSelectedRows: handlePinSelectedRows,
		handleRowSelectionKeyDown,
		hasSelectedRows,
		selectedRowCount,
		allVisibleSelected,

		cellSelection,
		createCellSelection: createDatabaseCellSelection,
		handleCellMouseDown,
		handleCellDoubleClick,

		globalSearch,
		setGlobalSearch,

		filterGroup,
		handleFilterGroupChange,
		facetBucketsByColumnId,
		showFilterPanel,
		setShowFilterPanel,

		handleSortChange,
		handleHeaderClick,
		showSortPanel,
		setShowSortPanel,

		handleChangeGroupBy,
		showGroupPanel,
		setShowGroupPanel,

		showColumnVisibilityMenu,
		setShowColumnVisibilityMenu,

		activeColumnMenu,
		setActiveColumnMenu,

		handlePreviousPage,
		handleNextPage,
		pageCount,
		showPagination,

		remoteLoading,
		remoteError,

		isUiReadonly,
		isDataReadonly,
		showRowSelectionControls,

		columns,
		allRows,
		rows,
		pinnedTopRows,
		pinnedBottomRows,
		rowGroups,
		visibleRows,
		visibleColumnIds,
		visibleColumnIdSet,

		defaultColumnWidth,
		pinnedOffsets,
		getColumnStickyStyle,
		getFixedEdgeStyle,
		isCellSelected: isCellSelectedFn,
		formatRemoteCell,

		calendarMonth: activeCalendarMonth,
		shiftCalendarMonth: shiftCalendarMonthFn,
		calendarDateColumn,
	};
}
