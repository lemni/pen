import React from "react";
import { DATA_ATTRS } from "@pen/react";
import type { DatabaseController } from "../useDatabaseController";

export function DatabaseToolbar(props: { controller: DatabaseController }) {
	const { controller: db } = props;

	if (db.isUiReadonly) return null;

	return (
		<div className="pen-db-toolbar" {...{ [DATA_ATTRS.ignorePointerGesture]: "" }}>
			<input
				className="pen-db-global-search"
				type="text"
				placeholder="Search…"
				value={db.globalSearch}
				onChange={(event) => db.setGlobalSearch(event.target.value)}
			/>
			<button className="pen-db-toolbar-btn" onClick={() => db.setShowFilterPanel(!db.showFilterPanel)}>
				Filter
			</button>
			<button className="pen-db-toolbar-btn" onClick={() => db.setShowSortPanel(!db.showSortPanel)}>
				Sort
			</button>
			<button className="pen-db-toolbar-btn" onClick={() => db.setShowGroupPanel(!db.showGroupPanel)}>
				{db.viewState.groupBy ? "Grouped" : "Group"}
			</button>
			<button className="pen-db-toolbar-btn" onClick={() => db.setShowColumnVisibilityMenu(!db.showColumnVisibilityMenu)}>
				Columns
			</button>
			{db.hasSelectedRows ? (
				<>
					<button className="pen-db-toolbar-btn" onClick={() => db.pinSelectedRows("top")}>
						Pin top
					</button>
					<button className="pen-db-toolbar-btn" onClick={() => db.pinSelectedRows("bottom")}>
						Pin bottom
					</button>
					<button className="pen-db-toolbar-btn" onClick={() => db.pinSelectedRows("none")}>
						Unpin
					</button>
					{!db.isDataReadonly ? (
						<button className="pen-db-toolbar-btn pen-db-toolbar-btn-danger" onClick={db.deleteSelectedRows}>
							Delete {db.selectedRowCount} rows
						</button>
					) : null}
				</>
			) : null}
		</div>
	);
}
