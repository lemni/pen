import type React from "react";
import { useEditorContext } from "../context/editorContext";
import { useFieldEditorContext } from "../context/fieldEditorContext";
import { useSelection } from "./useSelection";
import {
	endNativeBlockDrag,
	resolveDragBlockIds,
	startNativeBlockDrag,
} from "../utils/blockDrag";
import { DATA_ATTRS } from "../utils/dataAttributes";
import { useBlockDragSession } from "../primitives/editor/blockDragSession";

export interface BlockDragHandleHookResult {
	disabled: boolean;
	isDragging: boolean;
	dragBlockIds: readonly string[];
	props: {
		draggable: boolean;
		role: "button";
		"aria-label": string;
		"data-pen-block-handle": string;
		"data-block-id": string;
		"data-dragging"?: string;
		"data-pen-ignore-pointer-gesture": string;
		onDragStart: (event: React.DragEvent<HTMLElement>) => void;
		onDragEnd: (event: React.DragEvent<HTMLElement>) => void;
	};
}

export function useBlockDragHandle(
	blockId: string,
): BlockDragHandleHookResult {
	const { editor, readonly, blockDragAndDrop } = useEditorContext();
	const fieldEditor = useFieldEditorContext();
	const selection = useSelection(editor);
	const dragSession = useBlockDragSession();
	const disabled = readonly || !blockDragAndDrop.enabled;
	const dragBlockIds = resolveDragBlockIds({
		blockId,
		selection,
		documentBlockCount: editor.documentState.blockOrder.length,
		focusBlockId: fieldEditor?.focusBlockId ?? null,
	});
	const isDragging =
		dragSession.state.active &&
		dragSession.state.dragged?.blockIds.includes(blockId) === true;

	const handleDragStart = (event: React.DragEvent<HTMLElement>) => {
		if (disabled) {
			event.preventDefault();
			return;
		}

		const dragged = {
			anchorBlockId: blockId,
			blockIds: dragBlockIds,
		};
		startNativeBlockDrag({ event, session: dragSession, dragged });
	};

	const handleDragEnd = (event: React.DragEvent<HTMLElement>) => {
		endNativeBlockDrag({
			session: dragSession,
			ownerDocument: event.currentTarget.ownerDocument,
		});
	};

	return {
		disabled,
		isDragging,
		dragBlockIds,
		props: {
			draggable: !disabled,
			role: "button",
			"aria-label": "Drag to reorder block",
			[DATA_ATTRS.blockHandle]: "",
			[DATA_ATTRS.blockId]: blockId,
			[DATA_ATTRS.dragging]: isDragging ? "" : undefined,
			[DATA_ATTRS.ignorePointerGesture]: "",
			onDragStart: handleDragStart,
			onDragEnd: handleDragEnd,
		},
	};
}
