import React, { createContext, useContext, useRef, useState } from "react";
import type { MoveBlockOp } from "@pen/core";
import { clearBlockDragPreviewImage } from "../../utils/blockDragPreview";
import { DATA_ATTRS } from "../../utils/dataAttributes";

export const BLOCK_DRAG_MIME = "application/x-pen-block-drag";
export const LEGACY_BLOCK_ID_DRAG_MIME = "application/x-pen-block-id";

export type BlockDropPosition = "before" | "after";

export interface DraggedBlockSet {
	anchorBlockId: string;
	blockIds: readonly string[];
}

export interface SerializedBlockDragPayload {
	type: "pen-block-drag";
	viewId: string;
	anchorBlockId: string;
	blockIds: string[];
}

export interface BlockDragSessionState {
	active: boolean;
	dragged: DraggedBlockSet | null;
}

export interface BlockDragSessionContextValue {
	viewId: string;
	state: BlockDragSessionState;
	/**
	 * Ref to the blocks host element, shared so that direct DOM attribute
	 * updates for drop-target indication can bypass React's async batching.
	 */
	blocksHostRef: React.RefObject<HTMLElement | null>;
	/** Always-current dragged block ids, readable synchronously in event handlers. */
	draggedRef: React.RefObject<DraggedBlockSet | null>;
	startDrag: (dragged: DraggedBlockSet) => void;
	setDropTarget: (blockId: string, position: BlockDropPosition) => void;
	clearDropTarget: () => void;
	endDrag: () => void;
}

const EMPTY_DRAG_SESSION_STATE: BlockDragSessionState = {
	active: false,
	dragged: null,
};

const BlockDragSessionContext =
	createContext<BlockDragSessionContextValue | null>(null);

function applyDropTargetDOM(
	blocksHost: HTMLElement | null,
	blockId: string,
	position: BlockDropPosition,
) {
	if (!blocksHost) return;
	const el = blocksHost.querySelector(
		`[${DATA_ATTRS.editorBlock}][${DATA_ATTRS.blockId}="${blockId}"]`,
	) as HTMLElement | null;
	if (el) {
		el.setAttribute(DATA_ATTRS.dropTarget, "true");
		el.setAttribute(DATA_ATTRS.dropPosition, position);
	}
}

function clearDropTargetDOM(blocksHost: HTMLElement | null) {
	if (!blocksHost) return;
	const current = blocksHost.querySelector(
		`[${DATA_ATTRS.editorBlock}][${DATA_ATTRS.dropTarget}]`,
	) as HTMLElement | null;
	if (current) {
		current.removeAttribute(DATA_ATTRS.dropTarget);
		current.removeAttribute(DATA_ATTRS.dropPosition);
	}
}

export function BlockDragSessionProvider(props: {
	viewId: string;
	children: React.ReactNode;
}) {
	const [state, setState] = useState<BlockDragSessionState>(
		EMPTY_DRAG_SESSION_STATE,
	);
	const blocksHostRef = useRef<HTMLElement | null>(null);
	const draggedRef = useRef<DraggedBlockSet | null>(null);

	const startDrag = (dragged: DraggedBlockSet) => {
		draggedRef.current = dragged;
		setState({
			active: true,
			dragged,
		});
	};

	const setDropTarget = (blockId: string, position: BlockDropPosition) => {
		clearDropTargetDOM(blocksHostRef.current);
		applyDropTargetDOM(blocksHostRef.current, blockId, position);
	};

	const clearDropTarget = () => {
		clearDropTargetDOM(blocksHostRef.current);
	};

	const endDrag = () => {
		clearBlockDragPreviewImage(blocksHostRef.current?.ownerDocument);
		clearDropTargetDOM(blocksHostRef.current);
		draggedRef.current = null;
		setState(EMPTY_DRAG_SESSION_STATE);
	};

	return (
		<BlockDragSessionContext.Provider
			value={{
				viewId: props.viewId,
				state,
				blocksHostRef,
				draggedRef,
				startDrag,
				setDropTarget,
				clearDropTarget,
				endDrag,
			}}
		>
			{props.children}
		</BlockDragSessionContext.Provider>
	);
}

export function useBlockDragSession(): BlockDragSessionContextValue {
	const context = useContext(BlockDragSessionContext);
	if (!context) {
		throw new Error("Missing block drag session context");
	}
	return context;
}

export function serializeBlockDragPayload(args: {
	viewId: string;
	dragged: DraggedBlockSet;
}): string {
	const payload: SerializedBlockDragPayload = {
		type: "pen-block-drag",
		viewId: args.viewId,
		anchorBlockId: args.dragged.anchorBlockId,
		blockIds: [...args.dragged.blockIds],
	};
	return JSON.stringify(payload);
}

export function parseBlockDragPayload(
	value: string,
): SerializedBlockDragPayload | null {
	if (!value) {
		return null;
	}

	try {
		const parsed = JSON.parse(value) as SerializedBlockDragPayload;
		if (
			parsed?.type !== "pen-block-drag" ||
			typeof parsed.viewId !== "string" ||
			typeof parsed.anchorBlockId !== "string" ||
			!Array.isArray(parsed.blockIds) ||
			parsed.blockIds.some((blockId) => typeof blockId !== "string")
		) {
			return null;
		}
		return parsed;
	} catch {
		return null;
	}
}

export function buildMoveBlockOps(args: {
	blockIds: readonly string[];
	targetBlockId: string;
	dropPosition: BlockDropPosition;
}): MoveBlockOp[] {
	const uniqueBlockIds = [...new Set(args.blockIds)].filter(
		(blockId) => blockId !== args.targetBlockId,
	);
	if (uniqueBlockIds.length === 0) {
		return [];
	}

	const orderedBlockIds =
		args.dropPosition === "before"
			? uniqueBlockIds
			: [...uniqueBlockIds].reverse();

	return orderedBlockIds.map((blockId) => ({
		type: "move-block",
		blockId,
		position:
			args.dropPosition === "before"
				? { before: args.targetBlockId }
				: { after: args.targetBlockId },
	}));
}
