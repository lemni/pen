import { DATA_ATTRS } from "@pen/react";
import React from "react";
import { DatabaseCellContent } from "./cellEditors";
import type {
	DatabaseColumnDef,
	DatabaseRow,
	DatabaseRowGroup,
	DatabaseViewModelColumn,
	DatabaseViewModelRow,
	DatabaseViewState,
} from "./types";
import type { ColumnStickyStyle } from "./utils/databaseRenderer";
import {
	buildCalendarMonthData,
	CALENDAR_WEEKDAY_LABELS,
	shiftMonth,
} from "./utils/databaseRenderer";

type RowSectionOptions = {
	sectionLabel?: string;
};

type CellPointerHandler = (
	event: React.MouseEvent<HTMLElement>,
	row: DatabaseViewModelRow,
	column: DatabaseViewModelColumn,
) => void;

export function DatabaseViewBody(props: {
	blockId: string;
	viewType: DatabaseViewState["type"];
	ctxSelected: boolean | undefined;
	headerRow: React.ReactElement;
	tableColumnSpan: number;
	columns: DatabaseViewModelColumn[];
	allRows: DatabaseRow[];
	rows: DatabaseViewModelRow[];
	pinnedTopRows: DatabaseViewModelRow[];
	pinnedBottomRows: DatabaseViewModelRow[];
	rowGroups: DatabaseRowGroup[];
	rowSelection: Record<string, boolean>;
	showRowSelectionControls: boolean;
	isDataReadonly: boolean;
	isRemote: boolean;
	defaultColumnWidth: number;
	pinnedOffsets: Record<string, { left?: number; right?: number }>;
	getColumnStickyStyle: (
		column: DatabaseViewModelColumn,
		pinnedOffsets: Record<string, { left?: number; right?: number }>,
		defaultColumnWidth: number,
		section: "header" | "body",
	) => ColumnStickyStyle;
	isCellSelected: (row: number, column: number) => boolean;
	formatRemoteCell: (
		row: DatabaseViewModelRow,
		column: DatabaseViewModelColumn,
	) => string;
	onToggleRow: (rowId: string) => void;
	onRowSelectionKeyDown: (
		event: React.KeyboardEvent<HTMLInputElement>,
		rowId: string,
	) => void;
	onCellMouseDown: CellPointerHandler;
	onCellDoubleClick: CellPointerHandler;
	addListRow: React.ReactNode;
	addRowControl: React.ReactNode;
	addColumnControl: React.ReactNode;
	calendarMonth: Date;
	onShiftCalendarMonth: (amount: number) => void;
	calendarDateColumn: DatabaseColumnDef | undefined;
}) {
	const {
		blockId,
		viewType,
		ctxSelected,
		headerRow,
		tableColumnSpan,
		columns,
		allRows,
		rows,
		pinnedTopRows,
		pinnedBottomRows,
		rowGroups,
		rowSelection,
		showRowSelectionControls,
		isDataReadonly,
		isRemote,
		defaultColumnWidth,
		pinnedOffsets,
		getColumnStickyStyle,
		isCellSelected,
		formatRemoteCell,
		onToggleRow,
		onRowSelectionKeyDown,
		onCellMouseDown,
		onCellDoubleClick,
		addListRow,
		addRowControl,
		addColumnControl,
		calendarMonth,
		onShiftCalendarMonth,
		calendarDateColumn,
	} = props;

	function renderLocalCell(
		row: DatabaseViewModelRow,
		column: DatabaseViewModelColumn,
	) {
		return (
			<DatabaseCellContent
				blockId={blockId}
				row={row.crdtRowIndex}
				col={column.columnIndex}
				column={column}
				readonly={isDataReadonly}
			/>
		);
	}

	function renderTableRow(
		row: DatabaseViewModelRow,
		options?: RowSectionOptions,
	) {
		const bodyCells = columns.map((column) => {
			const bodyCellStyle = getColumnStickyStyle(
				column,
				pinnedOffsets,
				defaultColumnWidth,
				"body",
			);
			const remoteDisplay = formatRemoteCell(row, column);
			const remoteCellContent = (
				<span className="pen-db-remote-cell">{remoteDisplay}</span>
			);
			const localCellContent = renderLocalCell(row, column);
			return (
				<td
					key={`${row.id}:${column.id}`}
					{...{
						[DATA_ATTRS.tableCell]: "",
						[DATA_ATTRS.tableCellRow]: row.crdtRowIndex,
						[DATA_ATTRS.tableCellCol]: column.columnIndex,
						[DATA_ATTRS.ignorePointerGesture]: "",
						"data-pen-cell-selected": isCellSelected(
							row.crdtRowIndex,
							column.columnIndex,
						)
							? ""
							: undefined,
					}}
					style={bodyCellStyle}
					onMouseDown={(event) =>
						onCellMouseDown(event, row, column)
					}
					onDoubleClick={(event) =>
						onCellDoubleClick(event, row, column)
					}
				>
					{isRemote ? remoteCellContent : localCellContent}
				</td>
			);
		});
		const rowCheckboxCell = showRowSelectionControls ? (
			<td
				className="pen-db-row-select-cell"
				{...{ [DATA_ATTRS.ignorePointerGesture]: "" }}
				style={{
					position: "sticky",
					left: 0,
					width: 44,
					minWidth: 44,
					maxWidth: 44,
					zIndex: 2,
					background: "var(--surface)",
				}}
			>
				<input
					type="checkbox"
					checked={!!rowSelection[row.id]}
					onChange={() => onToggleRow(row.id)}
					onKeyDownCapture={(event) => onRowSelectionKeyDown(event, row.id)}
					onKeyDown={(event) => onRowSelectionKeyDown(event, row.id)}
				/>
			</td>
		) : null;
		return (
			<tr
				key={row.id}
				data-pen-table-row=""
				data-row={row.crdtRowIndex}
				data-row-section={options?.sectionLabel}
			>
				{rowCheckboxCell}
				{bodyCells}
			</tr>
		);
	}

	function renderFieldItems(
		row: DatabaseViewModelRow,
		variant: "list" | "board" | "gallery" | "calendar",
	) {
		const fieldItems = columns.map((column) => {
			const remoteDisplay = formatRemoteCell(row, column);
			const remoteCellContent = (
				<span className="pen-db-remote-cell">{remoteDisplay}</span>
			);
			const localCellContent = renderLocalCell(row, column);
			return (
				<div key={`${row.id}:${column.id}`} className={`pen-db-${variant}-field`}>
					<div className={`pen-db-${variant}-field-label`}>{column.title}</div>
					<div
						className={`pen-db-${variant}-field-value`}
						{...{
							[DATA_ATTRS.tableCell]: "",
							[DATA_ATTRS.tableCellRow]: row.crdtRowIndex,
							[DATA_ATTRS.tableCellCol]: column.columnIndex,
							[DATA_ATTRS.ignorePointerGesture]: "",
							"data-pen-cell-selected": isCellSelected(
								row.crdtRowIndex,
								column.columnIndex,
							)
								? ""
								: undefined,
						}}
						onMouseDown={(event) =>
							onCellMouseDown(event, row, column)
						}
						onDoubleClick={(event) =>
							onCellDoubleClick(event, row, column)
						}
					>
						{isRemote ? remoteCellContent : localCellContent}
					</div>
				</div>
			);
		});
		return fieldItems;
	}

	function renderListRow(row: DatabaseViewModelRow, options?: RowSectionOptions) {
		const listFieldItems = renderFieldItems(row, "list");
		const rowSelectionControl = showRowSelectionControls ? (
			<label
				className="pen-db-list-row-select"
				{...{ [DATA_ATTRS.ignorePointerGesture]: "" }}
			>
				<input
					type="checkbox"
					checked={!!rowSelection[row.id]}
					onChange={() => onToggleRow(row.id)}
					onKeyDownCapture={(event) => onRowSelectionKeyDown(event, row.id)}
					onKeyDown={(event) => onRowSelectionKeyDown(event, row.id)}
				/>
			</label>
		) : null;
		return (
			<div
				key={row.id}
				className="pen-db-list-row"
				data-row={row.crdtRowIndex}
				data-row-section={options?.sectionLabel}
			>
				{rowSelectionControl}
				<div className="pen-db-list-fields">{listFieldItems}</div>
			</div>
		);
	}

	function renderCard(
		row: DatabaseViewModelRow,
		variant: "board" | "gallery" | "calendar",
	) {
		const fieldItems = renderFieldItems(row, variant);
		const selectionControl = showRowSelectionControls ? (
			<label
				className={`pen-db-${variant === "calendar" ? "calendar-card" : `${variant}-card`}-select`}
				{...{ [DATA_ATTRS.ignorePointerGesture]: "" }}
			>
				<input
					type="checkbox"
					checked={!!rowSelection[row.id]}
					onChange={() => onToggleRow(row.id)}
					onKeyDownCapture={(event) => onRowSelectionKeyDown(event, row.id)}
					onKeyDown={(event) => onRowSelectionKeyDown(event, row.id)}
				/>
			</label>
		) : null;
		const cardClassName =
			variant === "calendar"
				? "pen-db-calendar-card"
				: `pen-db-${variant}-card`;
		const cardFieldsClassName =
			variant === "calendar"
				? "pen-db-calendar-card-fields"
				: `pen-db-${variant}-card-fields`;
		return (
			<div
				key={row.id}
				className={cardClassName}
				data-row={row.crdtRowIndex}
			>
				{selectionControl}
				<div className={cardFieldsClassName}>{fieldItems}</div>
			</div>
		);
	}

	const pinnedTopRowItems = pinnedTopRows.map((row) =>
		renderTableRow(row, { sectionLabel: "top" }),
	);
	const groupedRowItems =
		rowGroups.length > 0
			? rowGroups.flatMap((group) => {
					const groupHeader = (
						<tr key={`group:${group.key}`} className="pen-db-group-row">
							<td
								colSpan={tableColumnSpan}
								className="pen-db-group-cell"
								{...{ [DATA_ATTRS.ignorePointerGesture]: "" }}
							>
								{group.label} ({group.rows.length})
							</td>
						</tr>
					);
					const groupRows = group.rows.map((row) =>
						renderTableRow(row, { sectionLabel: "group" }),
					);
					return [groupHeader, ...groupRows];
				})
			: rows.map((row) => renderTableRow(row));
	const pinnedBottomRowItems = pinnedBottomRows.map((row) =>
		renderTableRow(row, { sectionLabel: "bottom" }),
	);

	const pinnedTopListItems = pinnedTopRows.map((row) =>
		renderListRow(row, { sectionLabel: "top" }),
	);
	const groupedListItems =
		rowGroups.length > 0
			? rowGroups.flatMap((group) => {
					const groupHeader = (
						<div
							key={`group:${group.key}`}
							className="pen-db-group-row pen-db-list-group-row"
						>
							<div className="pen-db-group-cell">
								{group.label} ({group.rows.length})
							</div>
						</div>
					);
					const groupRows = group.rows.map((row) =>
						renderListRow(row, { sectionLabel: "group" }),
					);
					return [groupHeader, ...groupRows];
				})
			: rows.map((row) => renderListRow(row));
	const pinnedBottomListItems = pinnedBottomRows.map((row) =>
		renderListRow(row, { sectionLabel: "bottom" }),
	);

	const boardGroupItems =
		rowGroups.length > 0 ? rowGroups : [{ key: "all-rows", label: "All rows", rows }];
	const boardLaneItems = boardGroupItems.map((group) => {
		const boardCardItems = group.rows.map((row) => renderCard(row, "board"));
		return (
			<div key={group.key} className="pen-db-board-lane" data-board-group={group.key}>
				<div className="pen-db-board-lane-header">
					{group.label} ({group.rows.length})
				</div>
				<div className="pen-db-board-lane-cards">{boardCardItems}</div>
			</div>
		);
	});

	const galleryCardItems = rows.map((row) => renderCard(row, "gallery"));

	const calendarMonthData = buildCalendarMonthData({
		month: calendarMonth,
		rows: allRows,
		dateColumnId: calendarDateColumn?.id ?? null,
	});
	const calendarWeekdayItems = CALENDAR_WEEKDAY_LABELS.map((label) => (
		<div key={label} className="pen-db-calendar-weekday">
			{label}
		</div>
	));
	const calendarDayItems = calendarMonthData.days.map((day) => {
		const dayCardItems = day.rows.map((row) => renderCard(row, "calendar"));
		return (
			<div
				key={day.key}
				className={`pen-db-calendar-cell ${day.inCurrentMonth ? "" : "pen-db-calendar-cell-muted"}`.trim()}
				data-date={day.isoDate}
			>
				<div className="pen-db-calendar-day-label">{day.dayNumber}</div>
				<div className="pen-db-calendar-day-cards">{dayCardItems}</div>
			</div>
		);
	});
	const unscheduledCalendarCardItems = calendarMonthData.unscheduledRows.map((row) =>
		renderCard(row, "calendar"),
	);
	const calendarMonthLabel = new Intl.DateTimeFormat(undefined, {
		month: "long",
		year: "numeric",
	}).format(calendarMonth);
	const calendarEmptyState = !calendarDateColumn ? (
		<div className="pen-db-calendar-empty" {...{ [DATA_ATTRS.ignorePointerGesture]: "" }}>
			Add a date column to use calendar view.
		</div>
	) : null;
	const calendarUnscheduledSection =
		calendarDateColumn && unscheduledCalendarCardItems.length > 0 ? (
			<div className="pen-db-calendar-unscheduled">
				<div className="pen-db-calendar-unscheduled-header">Unscheduled</div>
				<div className="pen-db-calendar-unscheduled-cards">
					{unscheduledCalendarCardItems}
				</div>
			</div>
		) : null;

	const tableViewContent = (
		<div className="pen-table-shell">
			<div className="pen-table-main">
				<div
					{...{ [DATA_ATTRS.tableFrame]: "" }}
					data-selected={ctxSelected || undefined}
					style={{ overflowX: "auto", overflowY: "hidden", maxWidth: "100%" }}
				>
					<table
						{...{ [DATA_ATTRS.table]: "" }}
						style={{
							borderCollapse: "separate",
							borderSpacing: 0,
							tableLayout: "fixed",
							width: "max-content",
							minWidth: "100%",
						}}
					>
						<thead>{headerRow}</thead>
						<tbody>
							{pinnedTopRowItems}
							{groupedRowItems}
							{pinnedBottomRowItems}
						</tbody>
					</table>
				</div>
				{addRowControl}
			</div>
			{addColumnControl}
		</div>
	);
	const listViewContent = (
		<div
			className="pen-db-list-view"
			{...{ [DATA_ATTRS.tableFrame]: "" }}
			data-selected={ctxSelected || undefined}
		>
			{pinnedTopListItems}
			{groupedListItems}
			{pinnedBottomListItems}
			{addListRow}
		</div>
	);
	const boardViewContent = (
		<div
			className="pen-db-board-view"
			{...{ [DATA_ATTRS.tableFrame]: "" }}
			data-selected={ctxSelected || undefined}
		>
			{boardLaneItems}
			{addListRow}
		</div>
	);
	const galleryViewContent = (
		<div
			className="pen-db-gallery-view"
			{...{ [DATA_ATTRS.tableFrame]: "" }}
			data-selected={ctxSelected || undefined}
		>
			{galleryCardItems}
			{addListRow}
		</div>
	);
	const calendarViewContent = (
		<div
			className="pen-db-calendar-view"
			{...{ [DATA_ATTRS.tableFrame]: "" }}
			data-selected={ctxSelected || undefined}
		>
			<div className="pen-db-calendar-header" {...{ [DATA_ATTRS.ignorePointerGesture]: "" }}>
				<button type="button" onClick={() => onShiftCalendarMonth(-1)}>
					◀
				</button>
				<span>{calendarMonthLabel}</span>
				<button type="button" onClick={() => onShiftCalendarMonth(1)}>
					▶
				</button>
			</div>
			{calendarEmptyState}
			{calendarDateColumn ? (
				<>
					<div className="pen-db-calendar-weekdays">{calendarWeekdayItems}</div>
					<div className="pen-db-calendar-grid">{calendarDayItems}</div>
					{calendarUnscheduledSection}
					{addListRow}
				</>
			) : null}
		</div>
	);

	if (viewType === "list") {
		return listViewContent;
	}
	if (viewType === "board") {
		return boardViewContent;
	}
	if (viewType === "calendar") {
		return calendarViewContent;
	}
	if (viewType === "gallery") {
		return galleryViewContent;
	}
	return tableViewContent;
}
