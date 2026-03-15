import React from "react";
import type { BlockHandle, BlockRenderContext } from "@pen/types";
import { isDevelopmentEnvironment } from "../utils/environment";

const shouldShowDevWarnings = isDevelopmentEnvironment();

export function DefaultRenderer(
	block: BlockHandle,
	ctx: BlockRenderContext,
): React.ReactElement {
	if (shouldShowDevWarnings) {
		console.warn(
			`Pen: No renderer registered for block type "${block.type}". ` +
				"Using DefaultRenderer. Register a custom renderer to fix this.",
		);
	}

	return (
		<div
			ref={ctx.ref as React.Ref<HTMLDivElement>}
			data-block-type={block.type}
			data-selected={ctx.selected || undefined}
			data-unknown-block=""
		>
			<span data-pen-unknown-type="">{block.type}</span>
			{shouldShowDevWarnings && (
				<pre data-pen-unknown-props="">
					{JSON.stringify(block.props, null, 2)}
				</pre>
			)}
		</div>
	);
}
