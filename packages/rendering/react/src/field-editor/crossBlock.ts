import type { Editor, FieldEditor, SelectionState } from "@pen/types";
import { getBlockSelectionRoleFromSchema } from "../utils/blockSelectionSemantics";

/**
 * Cross-block expansion and contraction.
 *
 * Handles expanding the contenteditable scope across multiple blocks
 * and managing shared Y.Text observation.
 */

export interface CrossBlockState {
	isExpanded: boolean;
	blockIds: readonly string[];
	anchorBlockId: string | null;
}

export type FieldEditorSurfaceMode =
	| "inactive"
	| "single"
	| "expanded"
	| "block";

export type ExpandedBlockRole = "editable-inline" | "structural" | "delegated";

export interface FieldEditorSurfaceState {
	mode: FieldEditorSurfaceMode;
	blockIds: string[];
}

/**
 * Expand the field editor range from the current block to the target block.
 * Called on shift-click or drag gestures.
 */
export function expandFieldEditorRange(
	fieldEditor: Pick<FieldEditor, "expandTo">,
	targetBlockId: string,
): void {
	fieldEditor.expandTo(targetBlockId);
}

/**
 * Contract back to a single block (the focused one).
 */
export function contractFieldEditorRange(
	fieldEditor: Pick<FieldEditor, "contractToFocused">,
): void {
	fieldEditor.contractToFocused();
}

/**
 * Determine whether a block selection should use cross-block contenteditable
 * expansion or switch to BlockSelection mode.
 *
 * Per spec: >50 blocks uses BlockSelection instead of contenteditable expansion.
 */
export function shouldUseBlockSelection(
	_editor: Editor,
	blockCount: number,
): boolean {
	return blockCount > 50;
}

export function getExpandedBlockRole(
	editor: Editor,
	blockId: string,
): ExpandedBlockRole | null {
	const block = editor.getBlock(blockId);
	if (!block) return null;

	return getBlockSelectionRoleFromSchema(editor.schema.resolve(block.type));
}

export function classifySelectionSurface(
	editor: Editor,
	selection: SelectionState | null,
	focusBlockId: string | null,
	isEditing: boolean,
): FieldEditorSurfaceState {
	if (!isEditing) {
		return { mode: "inactive", blockIds: [] };
	}

	if (selection?.type === "text") {
		if (selection.isMultiBlock) {
			return {
				mode: shouldUseBlockSelection(
					editor,
					selection.blockRange.length,
				)
					? "block"
					: "expanded",
				blockIds: [...selection.blockRange],
			};
		}

		if (!focusBlockId) {
			return { mode: "inactive", blockIds: [] };
		}

		if (!selection.blockRange.includes(focusBlockId)) {
			return { mode: "single", blockIds: [focusBlockId] };
		}

		return { mode: "single", blockIds: [focusBlockId] };
	}

	if (!focusBlockId) {
		return { mode: "inactive", blockIds: [] };
	}

	if (selection?.type === "block") {
		if (selection.blockIds.includes(focusBlockId)) {
			return { mode: "block", blockIds: [...selection.blockIds] };
		}
	}

	if (selection?.type === "cell" && selection.blockId === focusBlockId) {
		return { mode: "inactive", blockIds: [] };
	}

	return { mode: "single", blockIds: [focusBlockId] };
}
