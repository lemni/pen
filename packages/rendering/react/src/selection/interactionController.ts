import type { Editor, SelectionState } from "@pen/types";
import { pointToEditorSelectionPoint } from "../field-editor/selectionBridge";
import { getEditorBlockSelectionRole } from "../utils/blockSelectionSemantics";
import {
	getEditorFlowCapability,
	shouldFallbackMixedSelectionToBlock,
} from "../utils/flowCapabilities";

export interface PointerSelectionGesture {
	blockId: string;
	clientX: number;
	clientY: number;
	anchorPoint: { blockId: string; offset: number } | null;
	startSelection: SelectionState | null;
	promotedDuringDrag: boolean;
}

export type ResolvedPointerDragSelection =
	| {
		mode: "mapped-text" | "canonical";
		anchorPoint: { blockId: string; offset: number };
		focusPoint: { blockId: string; offset: number };
	}
	| {
		mode: "block";
		blockIds: string[];
	};

export function createPointerSelectionGesture(
	editor: Editor,
	input: {
		blockId: string;
		clientX: number;
		clientY: number;
	},
): PointerSelectionGesture {
	return {
		...input,
		anchorPoint: null,
		startSelection: editor.getSelection(),
		promotedDuringDrag: false,
	};
}

export function resolvePointerGestureAnchorPoint(
	gesture: PointerSelectionGesture,
	root: HTMLElement,
): { blockId: string; offset: number } | null {
	if (gesture.anchorPoint) {
		return gesture.anchorPoint;
	}

	if (gesture.startSelection?.type === "text") {
		return gesture.startSelection.anchor;
	}

	return pointToEditorSelectionPoint(root, gesture.clientX, gesture.clientY);
}

export function resolvePointerDragSelection(
	editor: Editor,
	root: HTMLElement,
	gesture: PointerSelectionGesture,
	input: {
		clientX: number;
		clientY: number;
		getBoundaryPoint: (
			blockId: string,
			side: "start" | "end",
		) => { blockId: string; offset: number };
	},
): ResolvedPointerDragSelection | null {
	const focusPoint = pointToEditorSelectionPoint(root, input.clientX, input.clientY);
	if (!focusPoint) {
		return null;
	}

	const gestureBlockRole = getEditorBlockSelectionRole(editor, gesture.blockId);
	if (
		gestureBlockRole !== "editable-inline" &&
		shouldFallbackMixedSelectionToBlock(
			editor.documentProfile,
			getEditorFlowCapability(editor, gesture.blockId),
		) &&
		focusPoint.blockId !== gesture.blockId
	) {
		const blockIds = resolveBlockIdRange(
			editor.documentState.blockOrder,
			gesture.blockId,
			focusPoint.blockId,
		);
		return blockIds ? { mode: "block", blockIds } : null;
	}

	if (
		gesture.startSelection?.type === "block" &&
		gesture.startSelection.blockIds.includes(gesture.blockId) &&
		focusPoint.blockId !== gesture.blockId
	) {
		const blockIds = resolveBlockIdRange(
			editor.documentState.blockOrder,
			gesture.blockId,
			focusPoint.blockId,
		);
		return blockIds ? { mode: "block", blockIds } : null;
	}

	const anchorPoint = resolvePointerGestureAnchorPoint(gesture, root);
	if (!anchorPoint || focusPoint.blockId === anchorPoint.blockId) {
		return null;
	}

	const anchorRole = getEditorBlockSelectionRole(editor, anchorPoint.blockId);
	const focusRole = getEditorBlockSelectionRole(editor, focusPoint.blockId);
	if (anchorRole === "editable-inline" && focusRole === "editable-inline") {
		return {
			mode: "mapped-text",
			anchorPoint,
			focusPoint,
		};
	}

	const blockOrder = editor.documentState.blockOrder;
	const anchorIdx = blockOrder.indexOf(anchorPoint.blockId);
	const focusIdx = blockOrder.indexOf(focusPoint.blockId);
	if (anchorIdx < 0 || focusIdx < 0) {
		return null;
	}

	const selectingForward = anchorIdx <= focusIdx;
	const normalizedAnchorPoint =
		anchorRole === "editable-inline"
			? input.getBoundaryPoint(
				anchorPoint.blockId,
				selectingForward ? "end" : "start",
			)
			: input.getBoundaryPoint(
				anchorPoint.blockId,
				selectingForward ? "start" : "end",
			);
	const normalizedFocusPoint =
		focusRole === "editable-inline"
			? focusPoint
			: input.getBoundaryPoint(
				focusPoint.blockId,
				selectingForward ? "end" : "start",
			);

	return {
		mode: "canonical",
		anchorPoint: normalizedAnchorPoint,
		focusPoint: normalizedFocusPoint,
	};
}

function resolveBlockIdRange(
	blockOrder: readonly string[],
	anchorBlockId: string,
	focusBlockId: string,
): string[] | null {
	const anchorIdx = blockOrder.indexOf(anchorBlockId);
	const focusIdx = blockOrder.indexOf(focusBlockId);
	if (anchorIdx < 0 || focusIdx < 0) {
		return null;
	}

	const from = Math.min(anchorIdx, focusIdx);
	const to = Math.max(anchorIdx, focusIdx);
	return blockOrder.slice(from, to + 1);
}
