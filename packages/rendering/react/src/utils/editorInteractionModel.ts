import {
	delegatesToGridEditing,
	usesInlineTextSelection,
	type BlockSchema,
	type SelectionState,
} from "@pen/types";
import type { ResolvedInteractionModel } from "../context/editorContext";

export type PointerCellCoord = {
	row: number;
	col: number;
};

export type BlockPointerIntent =
	| "select-block"
	| "enter-edit"
	| "select-block-text"
	| "place-caret";

export function isRepeatedCellSelection(args: {
	startSelection: SelectionState;
	selection: SelectionState;
	blockId: string;
	cellCoord: PointerCellCoord;
}): boolean {
	const { startSelection, selection, blockId, cellCoord } = args;

	const startedOnSameSingleCell =
		startSelection?.type === "cell" &&
		startSelection.blockId === blockId &&
		startSelection.anchor.row === cellCoord.row &&
		startSelection.anchor.col === cellCoord.col &&
		startSelection.head.row === cellCoord.row &&
		startSelection.head.col === cellCoord.col;
	const isSameSingleCell =
		selection?.type === "cell" &&
		selection.blockId === blockId &&
		selection.anchor.row === cellCoord.row &&
		selection.anchor.col === cellCoord.col &&
		selection.head.row === cellCoord.row &&
		selection.head.col === cellCoord.col;

	return startedOnSameSingleCell && isSameSingleCell;
}

export function resolveBlockPointerIntent(args: {
	blockId: string;
	clickCount: number;
	moved: boolean;
	schema: BlockSchema | null;
	startSelection: SelectionState;
	selection: SelectionState;
	interactionModel: ResolvedInteractionModel;
}): BlockPointerIntent {
	const {
		blockId,
		clickCount,
		moved,
		schema,
		startSelection,
		selection,
		interactionModel,
	} = args;

	if (delegatesToGridEditing(schema) || schema?.fieldEditor === "none") {
		return "select-block";
	}

	if (clickCount >= 3) {
		return "select-block-text";
	}

	if (!interactionModel.clickToSelect || moved) {
		return "place-caret";
	}

	const startedOnSameSingleBlock =
		startSelection?.type === "block" &&
		startSelection.blockIds.length === 1 &&
		startSelection.blockIds[0] === blockId;
	const isSameSingleBlockSelected =
		selection?.type === "block" &&
		selection.blockIds.length === 1 &&
		selection.blockIds[0] === blockId;

	if (startedOnSameSingleBlock && isSameSingleBlockSelected) {
		return usesInlineTextSelection(schema) ? "enter-edit" : "select-block";
	}

	return "select-block";
}
