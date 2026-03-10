import React from "react";
import { DATA_ATTRS } from "@pen/react";
import type { DatabaseController } from "../useDatabaseController";
import { getDefaultViewTitle } from "../utils/databaseRenderer";

export function DatabaseViewTabs(props: { controller: DatabaseController }) {
	const { controller: db } = props;

	const viewTabItems = db.views.map((view) => {
		const isActive = view.id === (db.block.databasePrimaryViewId() ?? db.viewState.id);
		const removeViewButton = !db.isUiReadonly && db.views.length > 1 ? (
			<button
				type="button"
				data-remove-view-id={view.id}
				className="pen-db-view-tab-remove"
				onClick={(event) => {
					event.stopPropagation();
					db.removeView(view.id);
				}}
			>
				×
			</button>
		) : null;
		return (
			<div key={view.id} className={`pen-db-view-tab ${isActive ? "pen-db-view-tab-active" : ""}`}>
				<button
					type="button"
					data-view-id={view.id}
					className="pen-db-view-tab-button"
					onClick={() => db.setActiveView(view.id)}
				>
					{view.title ?? getDefaultViewTitle(view.type)}
				</button>
				{removeViewButton}
			</div>
		);
	});

	const addViewMenu = db.showAddViewMenu && !db.isUiReadonly ? (
		<div className="pen-db-add-view-menu" {...{ [DATA_ATTRS.ignorePointerGesture]: "" }}>
			<button type="button" onClick={() => db.addView("table")}>New table view</button>
			<button type="button" onClick={() => db.addView("list")}>New list view</button>
			<button type="button" onClick={() => db.addView("board")}>New board view</button>
			<button type="button" onClick={() => db.addView("calendar")}>New calendar view</button>
			<button type="button" onClick={() => db.addView("gallery")}>New gallery view</button>
		</div>
	) : null;

	return (
		<div className="pen-db-view-tabs" {...{ [DATA_ATTRS.ignorePointerGesture]: "" }}>
			{viewTabItems}
			{!db.isUiReadonly ? (
				<button
					type="button"
					className="pen-db-add-view-btn"
					onClick={() => db.setShowAddViewMenu(!db.showAddViewMenu)}
				>
					+ View
				</button>
			) : null}
			{addViewMenu}
		</div>
	);
}
