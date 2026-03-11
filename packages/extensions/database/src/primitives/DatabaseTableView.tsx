import React from "react";
import { DATA_ATTRS } from "@pen/react";
import type { DatabaseController } from "../useDatabaseController";
import { ROW_SELECT_COLUMN_WIDTH } from "../useDatabaseController";
import {
	ColumnMenu,
	ColumnVisibilityPanel,
	FilterPanel,
	GroupPanel,
	SortPanel,
} from "../rendererPanels";
import { DatabaseViewBody } from "../rendererViews";

export function DatabaseTableView(props: {
	controller: DatabaseController;
	ctxSelected: boolean | undefined;
}) {
	const { controller: db, ctxSelected } = props;

	const headerCells = db.columns.map((column) => {
		const sort = db.viewState.sort?.find((entry) => entry.columnId === column.id);
		const sortIndex = sort ? (db.viewState.sort?.findIndex((entry) => entry.columnId === column.id) ?? 0) + 1 : null;
		const sortIcon = sort ? (sort.direction === "desc" ? " ↓" : " ↑") : null;
		const sortMarker = sortIndex && (db.viewState.sort?.length ?? 0) > 1 ? ` ${sortIndex}` : "";
		const headerCellStyle = db.getColumnStickyStyle(column, db.pinnedOffsets, db.defaultColumnWidth, "header");
		const columnMenu = db.activeColumnMenu === column.id ? (
			<ColumnMenu
				column={db.columnSchema.find((entry) => entry.id === column.id)}
				onClose={() => db.setActiveColumnMenu(null)}
				onRename={(nextTitle) => db.renameColumn(column.id, nextTitle)}
				onChangeType={(nextType) => db.changeColumnType(column.id, nextType)}
				onDelete={() => db.deleteColumn(column.id)}
				onToggleVisibility={() => db.toggleColumnVisibility(column.id)}
				onChangePin={(nextPinned) => db.changeColumnPin(column.id, nextPinned)}
				onAddOption={(value, color) => db.addOption(column.id, value, color)}
				onRenameOption={(optionId, value) => db.renameOption(column.id, optionId, value)}
				onRecolorOption={(optionId, color) => db.recolorOption(column.id, optionId, color)}
				onRemoveOption={(optionId) => db.removeOption(column.id, optionId)}
				onMoveOption={(optionId, direction) => db.moveOption(column.id, optionId, direction)}
			/>
		) : null;
		const menuButton = !db.isUiReadonly ? (
			<button
				className="pen-db-col-menu-btn"
				{...{ [DATA_ATTRS.ignorePointerGesture]: "" }}
				onMouseDown={handleControlMouseDown}
				onClick={(event) => {
					event.stopPropagation();
					db.setActiveColumnMenu(db.activeColumnMenu === column.id ? null : column.id);
				}}
			>
				⋮
			</button>
		) : null;
		return (
			<th
				key={column.id}
				{...{
					[DATA_ATTRS.ignorePointerGesture]: "",
					[DATA_ATTRS.tableCell]: "",
					[DATA_ATTRS.tableCellRow]: 0,
					[DATA_ATTRS.tableCellCol]: column.columnIndex,
				}}
				style={headerCellStyle}
				onClick={(event) => db.handleHeaderClick(event, column.id)}
			>
				<span className="pen-db-header-label">{column.title}{sortIcon}{sortMarker}</span>
				{menuButton}
				{columnMenu}
			</th>
		);
	});

	const headerRow = (
		<tr data-pen-table-row="" data-row="header">
			{db.showRowSelectionControls ? (
				<th
					className="pen-db-row-select-header"
					{...{ [DATA_ATTRS.ignorePointerGesture]: "" }}
					style={db.getFixedEdgeStyle("left", 0, ROW_SELECT_COLUMN_WIDTH, "header")}
				>
					<input type="checkbox" checked={db.allVisibleSelected} onChange={db.toggleAllRows} />
				</th>
			) : null}
			{headerCells}
		</tr>
	);

	const tableColumnSpan = db.columns.length + (db.showRowSelectionControls ? 1 : 0);

	function handleControlMouseDown(event: React.MouseEvent<HTMLButtonElement>) {
		event.preventDefault();
		event.stopPropagation();
	}

	const addListRow = !db.isDataReadonly ? (
		<div
			className="pen-db-list-add-row"
			{...{ [DATA_ATTRS.ignorePointerGesture]: "" }}
			onClick={db.addRow}
		>
			<span>+ New row</span>
		</div>
	) : null;

	const addColumnControl = db.isUiReadonly ? null : (
		<button
			type="button"
			className="pen-table-add-column-control"
			aria-label="Add column"
			{...{ [DATA_ATTRS.ignorePointerGesture]: "" }}
			onMouseDown={handleControlMouseDown}
			onClick={db.addColumn}
		>
			<span>+</span>
		</button>
	);

	const addRowControl = db.isDataReadonly ? null : (
		<button
			type="button"
			className="pen-table-add-row-control"
			aria-label="Add row"
			{...{ [DATA_ATTRS.ignorePointerGesture]: "" }}
			onMouseDown={handleControlMouseDown}
			onClick={db.addRow}
		>
			<span>+</span>
		</button>
	);

	const filterPanel = db.showFilterPanel && !db.isUiReadonly ? (
		<FilterPanel
			columnSchema={db.columnSchema}
			filterGroup={db.filterGroup}
			facetBucketsByColumnId={db.facetBucketsByColumnId}
			onChange={db.handleFilterGroupChange}
			onClose={() => db.setShowFilterPanel(false)}
		/>
	) : null;
	const sortPanel = db.showSortPanel && !db.isUiReadonly ? (
		<SortPanel
			columnSchema={db.columnSchema}
			sorts={db.viewState.sort ?? []}
			onChange={db.handleSortChange}
			onClose={() => db.setShowSortPanel(false)}
		/>
	) : null;
	const columnVisibilityPanel = db.showColumnVisibilityMenu && !db.isUiReadonly ? (
		<ColumnVisibilityPanel
			columnSchema={db.columnSchema}
			visibleColumnIds={db.visibleColumnIdSet}
			onToggle={db.toggleColumnVisibility}
			onClose={() => db.setShowColumnVisibilityMenu(false)}
		/>
	) : null;
	const groupPanel = db.showGroupPanel && !db.isUiReadonly ? (
		<GroupPanel
			columnSchema={db.columnSchema}
			groupBy={db.viewState.groupBy ?? null}
			onChange={db.handleChangeGroupBy}
			onClose={() => db.setShowGroupPanel(false)}
		/>
	) : null;

	return (
		<>
			{sortPanel}
			{filterPanel}
			{groupPanel}
			{columnVisibilityPanel}
			<DatabaseViewBody
				blockId={db.block.id}
				viewType={db.viewState.type}
				ctxSelected={ctxSelected}
				headerRow={headerRow}
				tableColumnSpan={tableColumnSpan}
				columns={db.columns}
				allRows={db.allRows}
				rows={db.rows}
				pinnedTopRows={db.pinnedTopRows}
				pinnedBottomRows={db.pinnedBottomRows}
				rowGroups={db.rowGroups}
				rowSelection={db.rowSelection}
				showRowSelectionControls={db.showRowSelectionControls}
				isDataReadonly={db.isDataReadonly}
				isRemote={db.engine.isRemote}
				defaultColumnWidth={db.defaultColumnWidth}
				pinnedOffsets={db.pinnedOffsets}
				getColumnStickyStyle={db.getColumnStickyStyle}
				isCellSelected={db.isCellSelected}
				formatRemoteCell={db.formatRemoteCell}
				onToggleRow={db.toggleRow}
				onRowSelectionKeyDown={db.handleRowSelectionKeyDown}
				onCellMouseDown={db.handleCellMouseDown}
				onCellDoubleClick={db.handleCellDoubleClick}
				addListRow={addListRow}
				addRowControl={addRowControl}
				addColumnControl={addColumnControl}
				calendarMonth={db.calendarMonth}
				onShiftCalendarMonth={db.shiftCalendarMonth}
				calendarDateColumn={db.calendarDateColumn}
			/>
		</>
	);
}
