import React from "react";
import type { BlockHandle, BlockRenderContext } from "@pen/types";
import { useNumberedListItemValue } from "../hooks/useNumberedListItemValue";
import { ListItemLayout } from "../utils/listItemLayout";

export function NumberedListItemRenderer(
	block: BlockHandle,
	ctx: BlockRenderContext,
): React.ReactElement {
	return <NumberedListItemView block={block} ctx={ctx} />;
}

function NumberedListItemView({
	block,
	ctx,
}: {
	block: BlockHandle;
	ctx: BlockRenderContext;
}): React.ReactElement {
	const indent = (block.props?.indent as number) ?? 0;
	const counterValue = useNumberedListItemValue(block);

	return (
		<ListItemLayout
			ref={ctx.ref as React.Ref<HTMLDivElement>}
			blockId={block.id}
			blockType="numberedListItem"
			indent={indent}
			selected={ctx.selected}
			extraAttributes={{ "data-counter": counterValue }}
			marker={
				<span data-pen-list-marker="" aria-hidden="true">
					{counterValue}.
				</span>
			}
		/>
	);
}
