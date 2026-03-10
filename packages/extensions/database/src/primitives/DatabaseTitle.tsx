import React from "react";
import { DATA_ATTRS } from "@pen/react";
import type { DatabaseController } from "../useDatabaseController";

export function DatabaseTitle(props: { controller: DatabaseController }) {
	const { controller: db } = props;

	if (db.isEditingTitle) {
		return (
			<input
				className="pen-db-title-input"
				key={db.title}
				defaultValue={db.title}
				onBlur={db.handleTitleBlur}
				onKeyDown={db.handleTitleKeyDown}
				autoFocus
			/>
		);
	}

	return (
		<span className="pen-db-title" onClick={db.handleTitleClick}>
			{db.title}
		</span>
	);
}
