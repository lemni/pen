import React from "react";
import { DATA_ATTRS } from "@pen/react";
import type { DatabaseController } from "../useDatabaseController";

export function DatabaseStatusIndicators(props: { controller: DatabaseController }) {
	const { controller: db } = props;

	const loadingIndicator = db.remoteLoading ? (
		<div className="pen-db-loading" {...{ [DATA_ATTRS.ignorePointerGesture]: "" }}>Loading…</div>
	) : null;

	const errorIndicator = db.remoteError ? (
		<div className="pen-db-error" {...{ [DATA_ATTRS.ignorePointerGesture]: "" }}>{db.remoteError}</div>
	) : null;

	if (!loadingIndicator && !errorIndicator) return null;

	return (
		<>
			{loadingIndicator}
			{errorIndicator}
		</>
	);
}
