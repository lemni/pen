import React from "react";
import { DATA_ATTRS } from "@pen/react";
import type { DatabaseController } from "../useDatabaseController";

export function DatabasePagination(props: { controller: DatabaseController }) {
	const { controller: db } = props;

	if (!db.showPagination) return null;

	return (
		<div className="pen-db-pagination" {...{ [DATA_ATTRS.ignorePointerGesture]: "" }}>
			<button onClick={db.handlePreviousPage} disabled={(db.viewState.pageIndex ?? 0) <= 0}>◀</button>
			<span>Page {(db.viewState.pageIndex ?? 0) + 1} of {db.pageCount}</span>
			<button onClick={db.handleNextPage} disabled={(db.viewState.pageIndex ?? 0) >= db.pageCount - 1}>▶</button>
		</div>
	);
}
