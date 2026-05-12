import type { Editor } from "@pen/types";
import type { FieldEditorEscapeController } from "../field-editor/controller";

export function handleEscapeSelectionTransition(options: {
	event: KeyboardEvent;
	editor: Editor;
	fieldEditor: FieldEditorEscapeController;
	root: HTMLElement;
}): boolean {
	const { event, editor, fieldEditor, root } = options;

	if (
		event.defaultPrevented ||
		event.key !== "Escape" ||
		event.altKey ||
		event.ctrlKey ||
		event.metaKey ||
		event.shiftKey ||
		event.isComposing ||
		fieldEditor.isComposing
	) {
		return false;
	}

	const selection = editor.selection;

	if (fieldEditor.activeCellCoord && fieldEditor.isEditing) {
		const coord = fieldEditor.activeCellCoord;
		fieldEditor.deactivate();
		editor.selectCell(coord.blockId, coord.row, coord.col);
		focusBlockContainer(root, coord.blockId);
		return true;
	}

	if (selection?.type === "text" && !selection.isCollapsed) {
		fieldEditor.collapseSelectionToFocus();
		return true;
	}

	if (selection?.type === "text") {
		const blockId = selection.focus.blockId;
		fieldEditor.deactivate();
		editor.selectBlock(blockId);
		focusBlockContainer(root, blockId);
		return true;
	}

	if (selection?.type === "cell") {
		const { blockId, anchor, head } = selection;
		const isMultiCell =
			anchor.row !== head.row || anchor.col !== head.col;

		if (isMultiCell) {
			editor.selectCell(blockId, anchor.row, anchor.col);
			return true;
		}

		editor.selectBlock(blockId);
		focusBlockContainer(root, blockId);
		return true;
	}

	if (selection?.type === "block" && selection.blockIds.length > 0) {
		const focusedBlockId =
			selection.blockIds[0] ?? fieldEditor.focusBlockId;
		editor.setSelection(null);
		focusBlockContainer(root, focusedBlockId);
		return true;
	}

	return false;
}

function focusBlockContainer(root: HTMLElement, blockId: string | null): void {
	if (blockId) {
		const blockElement = root.querySelector(`[data-block-id="${blockId}"]`);
		if (blockElement instanceof HTMLElement) {
			blockElement.focus({ preventScroll: true });
			return;
		}
	}

	root.focus({ preventScroll: true });
}
