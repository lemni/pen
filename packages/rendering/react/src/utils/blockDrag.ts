import type React from "react";
import type { SelectionState } from "@pen/core";
import {
	BLOCK_DRAG_MIME,
	LEGACY_BLOCK_ID_DRAG_MIME,
	serializeBlockDragPayload,
	type BlockDragSessionContextValue,
	type DraggedBlockSet,
} from "../primitives/editor/blockDragSession";
import {
	clearBlockDragPreviewImage,
	setBlockDragPreviewImage,
} from "./blockDragPreview";

export function resolveDragBlockIds(args: {
	blockId: string;
	selection: SelectionState;
	documentBlockCount: number;
	focusBlockId: string | null;
}): readonly string[] {
	const { blockId, selection, documentBlockCount, focusBlockId } = args;
	const isDocumentBlockSelection =
		selection?.type === "block" &&
		selection.blockIds.length === documentBlockCount;
	const shouldDragSelectedBlockSet =
		selection?.type === "block" &&
		selection.blockIds.includes(blockId) &&
		(!isDocumentBlockSelection || focusBlockId === blockId);

	return shouldDragSelectedBlockSet ? selection.blockIds : [blockId];
}

export function startNativeBlockDrag(args: {
	event: React.DragEvent<HTMLElement>;
	session: BlockDragSessionContextValue;
	dragged: DraggedBlockSet;
}) {
	const { event, session, dragged } = args;
	if (!event.dataTransfer) {
		return;
	}

	event.dataTransfer.setData(
		BLOCK_DRAG_MIME,
		serializeBlockDragPayload({
			viewId: session.viewId,
			dragged,
		}),
	);
	event.dataTransfer.setData(LEGACY_BLOCK_ID_DRAG_MIME, dragged.anchorBlockId);
	event.dataTransfer.effectAllowed = "move";
	setBlockDragPreviewImage({
		event,
		sourceElement: event.currentTarget,
		blockCount: dragged.blockIds.length,
	});
	session.startDrag(dragged);
}

export function endNativeBlockDrag(args: {
	session: BlockDragSessionContextValue;
	ownerDocument?: Document | null;
}) {
	if (args.ownerDocument) {
		clearBlockDragPreviewImage(args.ownerDocument);
	}
	args.session.endDrag();
}
