import type { BlockHandle, BlockRenderContext } from "@pen/core";
import { DATA_ATTRS } from "@pen/react";
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
	const db = useDatabaseController({ blockId: block.id });

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
