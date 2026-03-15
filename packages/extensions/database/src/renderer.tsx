import type { BlockHandle, BlockRenderContext } from "@pen/types";
import {
	DATA_ATTRS,
	useEditorContext,
	useAIStructuredTargetPreview,
	type AIStructuredTargetPreviewSelection,
} from "@pen/react";
import React from "react";
import {
	DatabasePagination,
	DatabaseStatusIndicators,
	DatabaseTableView,
	DatabaseTitle,
	DatabaseToolbar,
	DatabaseViewTabs,
} from "./primitives";
import { useDatabaseController } from "./useDatabaseController";

function DatabaseRendererInner(props: { block: BlockHandle; ctx: BlockRenderContext }) {
	const { block, ctx } = props;
	const { editor } = useEditorContext();
	const structuredTargetPreview = useAIStructuredTargetPreview(editor, block.id);
	const databaseTargetPreview =
		structuredTargetPreview.target?.targetKind === "database"
			? structuredTargetPreview.target
			: null;
	const db = useDatabaseController({ blockId: block.id });

	if (databaseTargetPreview) {
		return renderStructuredDatabasePreview(
			databaseTargetPreview,
			structuredTargetPreview.preview?.planState ?? "drafted",
			ctx,
		);
	}

	return (
		<div ref={ctx.ref as React.Ref<HTMLDivElement>} data-block-type="database" data-selected={ctx.selected || undefined} className="pen-database">
			<div className="pen-db-title-bar" {...{ [DATA_ATTRS.ignorePointerGesture]: "" }}>
				<DatabaseTitle controller={db} />
				<DatabaseViewTabs controller={db} />
			</div>
			<DatabaseToolbar controller={db} />
			<DatabaseStatusIndicators controller={db} />
			<DatabaseTableView controller={db} ctxSelected={ctx.selected} />
			<DatabasePagination controller={db} />
		</div>
	);
}

export function DatabaseRenderer(block: BlockHandle, ctx: BlockRenderContext): React.ReactElement {
	return <DatabaseRendererInner block={block} ctx={ctx} />;
}

function renderStructuredDatabasePreview(
	target: Extract<
		NonNullable<AIStructuredTargetPreviewSelection["target"]>,
		{ targetKind: "database" }
	>,
	planState: "drafted" | "validated",
	ctx: BlockRenderContext,
): React.ReactElement {
	const viewTabs: React.ReactElement[] = [];
	for (const view of target.database.views) {
		viewTabs.push(
			<div
				key={view.id}
				className={`pen-db-view-tab${view.id === target.database.primaryViewId ? " pen-db-view-tab-active" : ""}`}
			>
				<span className="pen-db-view-tab-button">
					{view.title}
				</span>
			</div>,
		);
	}

	const headerCells: React.ReactElement[] = [];
	for (const [index, column] of target.database.columns.entries()) {
		headerCells.push(
			<th key={`${target.blockId}-preview-header-${index}`}>
				{column.title || column.id}
			</th>,
		);
	}

	const bodyRows: React.ReactElement[] = [];
	for (const row of target.database.rows) {
		const cells: React.ReactElement[] = [];
		for (const column of target.database.columns) {
			cells.push(
				<td key={`${row.id}-${column.id}`}>
					{row.values[column.id] ?? ""}
				</td>,
			);
		}
		bodyRows.push(
			<tr key={row.id} data-pen-table-row="" data-row-id={row.id}>
				{cells}
			</tr>,
		);
	}

	return (
		<div
			ref={ctx.ref as React.Ref<HTMLDivElement>}
			data-block-type="database"
			data-selected={ctx.selected || undefined}
			data-pen-ai-structured-target-state=""
			data-plan-state={planState}
			className="pen-database"
		>
			<div data-pen-ai-structured-target-label="">
				Streaming database preview
			</div>
			<div className="pen-db-title-bar" {...{ [DATA_ATTRS.ignorePointerGesture]: "" }}>
				<div className="pen-db-title">Database preview</div>
				<div className="pen-db-view-tabs">{viewTabs}</div>
			</div>
			<div className="pen-table-shell">
				<div className="pen-table-main">
					<div {...{ [DATA_ATTRS.tableFrame]: "" }}>
						<table {...{ [DATA_ATTRS.table]: "" }}>
							<thead>
								<tr data-pen-table-row="" data-row="header">
									{headerCells}
								</tr>
							</thead>
							<tbody>{bodyRows}</tbody>
						</table>
					</div>
				</div>
			</div>
		</div>
	);
}
