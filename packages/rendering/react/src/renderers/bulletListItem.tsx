import React from "react";
import type { BlockHandle, BlockRenderContext } from "@pen/types";
import { ListItemLayout } from "../utils/listItemLayout";

export function BulletListItemRenderer(
	block: BlockHandle,
	ctx: BlockRenderContext,
): React.ReactElement {
	const indent = (block.props?.indent as number) ?? 0;

	return (
		<ListItemLayout
			ref={ctx.ref as React.Ref<HTMLDivElement>}
			blockId={block.id}
			blockType="bulletListItem"
			indent={indent}
			selected={ctx.selected}
			marker={
				<span data-pen-list-marker="" aria-hidden="true">
					•
				</span>
			}
		/>
	);
}
