import {
	generateId,
	type Editor,
	type InteractionModel,
	usesInlineTextSelection,
} from "@pen/types";
import type { FieldEditorSession } from "../field-editor/controller";
import {
	handleHistoryShortcut,
	handleSelectAllShortcut,
} from "../field-editor/keyHandling";
import { DATA_ATTRS } from "./dataAttributes";
import { handleEscapeSelectionTransition } from "./escapeSelection";
import { getAdjacentVisibleBlockId } from "./parentIdTree";
import { handleTableCellSelectionKeyDown } from "./tableCellNavigation";

const DATABASE_ROW_SELECTION_SLOT = "database:row-selection";

type DatabaseRowSelectionController = {
	deleteSelectedRows: (blockId: string) => boolean;
};

export function handleEditorDocumentKeyDown(options: {
	event: KeyboardEvent;
	editor: Editor;
	fieldEditor: FieldEditorSession;
	interactionModel?: InteractionModel;
	root: HTMLElement;
}): boolean {
	const { event, editor, fieldEditor, interactionModel, root } = options;

	return (
		handleEscapeSelectionTransition({ event, editor, fieldEditor, root }) ||
		handleDeleteSelectionShortcut(event, editor, fieldEditor, root) ||
		handleTableCellSelectionKeyDown({ event, editor, fieldEditor, root }) ||
		handleSelectAllShortcut(editor, event, fieldEditor, {
			rootElement: root,
		}) ||
		handleBlockSelectionEnter(event, editor, fieldEditor, interactionModel) ||
		handleBlockSelectionArrow(event, editor, fieldEditor) ||
		handleHistoryShortcut(editor, event)
	);
}

function handleBlockSelectionArrow(
	event: KeyboardEvent,
	editor: Editor,
	fieldEditor: FieldEditorSession,
): boolean {
	if (
		event.altKey ||
		event.ctrlKey ||
		event.metaKey ||
		event.shiftKey ||
		event.isComposing
	) {
		return false;
	}

	const isUp = event.key === "ArrowUp" || event.key === "ArrowLeft";
	const isDown = event.key === "ArrowDown" || event.key === "ArrowRight";
	if (!isUp && !isDown) return false;

	const selection = editor.selection;
	if (selection?.type !== "block" || selection.blockIds.length === 0) {
		return false;
	}

	const blockId = isUp
		? selection.blockIds[0]!
		: selection.blockIds[selection.blockIds.length - 1]!;
	const direction = isUp ? "previous" : "next";

	const adjacentId = getAdjacentVisibleBlockId(editor, blockId, direction);
	if (!adjacentId) return false;

	const adjacentBlock = editor.getBlock(adjacentId);
	if (!adjacentBlock) return false;

	const schema = editor.schema.resolve(adjacentBlock.type);
	if (usesInlineTextSelection(schema)) {
		const offset = isUp ? adjacentBlock.length() : 0;
		fieldEditor.activateTextSelection(adjacentId, offset, offset);
		return true;
	}

	editor.selectBlock(adjacentId);
	return true;
}

function handleBlockSelectionEnter(
	event: KeyboardEvent,
	editor: Editor,
	fieldEditor: FieldEditorSession,
	interactionModel: InteractionModel = "content-first",
): boolean {
	if (
		event.key !== "Enter" ||
		event.altKey ||
		event.ctrlKey ||
		event.metaKey ||
		event.shiftKey ||
		event.isComposing
	) {
		return false;
	}

	const selection = editor.selection;
	if (selection?.type !== "block" || selection.blockIds.length === 0) {
		return false;
	}

	const anchorBlockId = selection.blockIds[selection.blockIds.length - 1]!;
	const anchorBlock = editor.getBlock(anchorBlockId);
	if (!anchorBlock) {
		return false;
	}
	const anchorSchema = editor.schema.resolve(anchorBlock.type);

	if (
		interactionModel === "block-first" &&
		selection.blockIds.length === 1 &&
		usesInlineTextSelection(anchorSchema)
	) {
		const offset = anchorBlock.length();
		fieldEditor.activateTextSelection(anchorBlockId, offset, offset);
		return true;
	}

	const newBlockId = generateId();

	editor.apply(
		[
			{
				type: "insert-block",
				blockId: newBlockId,
				blockType: "paragraph",
				props: {},
				position: { after: anchorBlockId },
			},
		],
		{ origin: "user" },
	);

	fieldEditor.activateTextSelection(newBlockId, 0, 0);
	return true;
}

function handleDeleteSelectionShortcut(
	event: KeyboardEvent,
	editor: Editor,
	fieldEditor: FieldEditorSession,
	root: HTMLElement,
): boolean {
	if (
		(event.key !== "Backspace" && event.key !== "Delete") ||
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
	if (tryDeleteSelectedDatabaseRows(root, editor)) {
		fieldEditor.deactivate();
		return true;
	}
	if (!selection) {
		return false;
	}

	if (selection.type === "text" && !selection.isCollapsed) {
		if (
			!selection.isMultiBlock &&
			!shouldUseDocumentTextDeletionFallback(root, fieldEditor)
		) {
			return false;
		}
		if (selection.isMultiBlock) {
			fieldEditor.deactivate();
		}
		editor.deleteSelection({ origin: "user" });
		const nextSelection = editor.selection;
		if (nextSelection?.type === "text") {
			fieldEditor.activateTextSelection(
				nextSelection.focus.blockId,
				nextSelection.focus.offset,
				nextSelection.focus.offset,
			);
		} else {
			fieldEditor.deactivate();
		}
		return true;
	}

	if (selection.type === "block" && selection.blockIds.length > 0) {
		editor.deleteSelection({ origin: "user" });
		fieldEditor.deactivate();
		const firstBlock = editor.firstBlock();
		if (firstBlock) {
			const schema = editor.schema.resolve(firstBlock.type);
			if (usesInlineTextSelection(schema)) {
				fieldEditor.activateTextSelection(firstBlock.id, 0, 0);
			}
		}
		return true;
	}

	if (selection.type === "cell") {
		editor.deleteSelection({ origin: "user" });
		return true;
	}

	return false;
}

function tryDeleteSelectedDatabaseRows(
	root: HTMLElement,
	editor: Editor,
): boolean {
	const controller = editor.internals.getSlot(DATABASE_ROW_SELECTION_SLOT) as
		| DatabaseRowSelectionController
		| undefined;
	if (!controller) {
		return false;
	}

	const activeElement = root.ownerDocument?.activeElement;
	if (
		!(activeElement instanceof HTMLElement) ||
		!root.contains(activeElement)
	) {
		return false;
	}

	const blockElement = activeElement.closest("[data-block-id]");
	const blockId = blockElement?.getAttribute("data-block-id");
	if (!blockId) {
		return false;
	}

	const block = editor.getBlock(blockId);
	if (!block || block.type !== "database") {
		return false;
	}

	return controller.deleteSelectedRows(blockId);
}

function shouldUseDocumentTextDeletionFallback(
	root: HTMLElement,
	fieldEditor: FieldEditorSession,
): boolean {
	if (!fieldEditor.isEditing) {
		return true;
	}

	const activeElement = root.ownerDocument?.activeElement;
	if (
		!(activeElement instanceof HTMLElement) ||
		!root.contains(activeElement)
	) {
		return true;
	}

	if (activeElement === root) {
		return true;
	}

	const activeInlineSurface = activeElement.closest(
		`[${DATA_ATTRS.inlineContent}]`,
	);
	if (activeInlineSurface === null) {
		return true;
	}

	return false;
}
