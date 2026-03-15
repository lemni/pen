import type { Editor } from "@pen/types";

export interface DocumentInsertionAnchor {
	blockId: string;
	strategy: "replace-empty-block" | "append-after-block";
}

export function resolveDocumentInsertionAnchor(
	editor: Editor,
	options?: {
		preferredBlockId?: string | null;
	},
): DocumentInsertionAnchor | null {
	const blockOrder = editor.documentState.blockOrder;
	if (blockOrder.length === 0) {
		return null;
	}
	const selectionBlockId = resolveSelectionBlockId(editor);
	const preferredExistingBlockId =
		resolveExistingBlockId(editor, options?.preferredBlockId) ??
		resolveExistingBlockId(editor, selectionBlockId);

	const reclaimableBlockIds = blockOrder.filter((blockId) =>
		isReclaimableEmptyBlock(editor, blockId),
	);
	if (preferredExistingBlockId) {
		return {
			blockId: preferredExistingBlockId,
			strategy: reclaimableBlockIds.includes(preferredExistingBlockId)
				? "replace-empty-block"
				: "append-after-block",
		};
	}
	if (reclaimableBlockIds.length > 0) {
		const preferredReclaimableBlockId = resolvePreferredReclaimableBlockId(
			reclaimableBlockIds,
			options?.preferredBlockId,
			selectionBlockId,
			blockOrder,
		);
		if (preferredReclaimableBlockId) {
			return {
				blockId: preferredReclaimableBlockId,
				strategy: "replace-empty-block",
			};
		}
	}

	const fallbackBlockId =
		resolveExistingBlockId(editor, options?.preferredBlockId) ??
		blockOrder[blockOrder.length - 1] ??
		null;
	if (!fallbackBlockId) {
		return null;
	}

	return {
		blockId: fallbackBlockId,
		strategy: "append-after-block",
	};
}

function resolvePreferredReclaimableBlockId(
	reclaimableBlockIds: readonly string[],
	preferredBlockId: string | null | undefined,
	selectionBlockId: string | null,
	blockOrder: readonly string[],
): string | null {
	if (preferredBlockId && reclaimableBlockIds.includes(preferredBlockId)) {
		return preferredBlockId;
	}
	if (selectionBlockId && reclaimableBlockIds.includes(selectionBlockId)) {
		return selectionBlockId;
	}

	const firstBlockId = blockOrder[0] ?? null;
	if (firstBlockId && reclaimableBlockIds.includes(firstBlockId)) {
		return firstBlockId;
	}

	const lastBlockId = blockOrder[blockOrder.length - 1] ?? null;
	if (lastBlockId && reclaimableBlockIds.includes(lastBlockId)) {
		return lastBlockId;
	}

	return reclaimableBlockIds[0] ?? null;
}

function isReclaimableEmptyBlock(editor: Editor, blockId: string): boolean {
	const block = editor.getBlock(blockId);
	if (!block) {
		return false;
	}

	const schema = editor.schema.resolve(block.type);
	if (schema?.content !== "inline") {
		return false;
	}

	return (
		block.children.length === 0 &&
		isVisuallyEmptyInlineText(block.textContent({ resolved: true }))
	);
}

function resolveExistingBlockId(
	editor: Editor,
	blockId: string | null | undefined,
): string | null {
	if (!blockId) {
		return null;
	}
	return editor.getBlock(blockId) ? blockId : null;
}

function resolveSelectionBlockId(editor: Editor): string | null {
	const selection = editor.selection;
	if (!selection) {
		return null;
	}
	if (selection.type === "text") {
		return selection.focus.blockId;
	}
	if (selection.type === "block") {
		return selection.blockIds[0] ?? null;
	}
	if (selection.type === "cell") {
		return selection.blockId;
	}
	return null;
}

function isVisuallyEmptyInlineText(text: string): boolean {
	return text.replace(/\u200B/g, "").trim().length === 0;
}
