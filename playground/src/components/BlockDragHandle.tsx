import { useBlockDragHandle, type BlockControlsProps } from "@pen/react";
import { IconDragHandle } from "./icons";
import "./BlockDragHandle.css";

export function PlaygroundBlockDragHandle(props: BlockControlsProps) {
	const { blockId } = props;
	const blockDragHandle = useBlockDragHandle(blockId);

	return (
		<div className="playground-block-drag-gutter">
			<button
				type="button"
				className="playground-block-drag-handle"
				title="Drag block"
				disabled={blockDragHandle.disabled}
				{...blockDragHandle.props}
			>
				<IconDragHandle className="playground-block-drag-handle-icon" />
			</button>
		</div>
	);
}
