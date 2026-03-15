import type { Editor } from "@pen/types";

export function computeDocumentEmpty(editor: Editor): boolean {
	return editor.documentState.isEmpty;
}

export function computeDocumentPlaceholderVisible(editor: Editor): boolean {
	const { blockOrder } = editor.documentState;
	if (blockOrder.length === 0) return true;
	if (blockOrder.length > 1) return false;
	const block = editor.getBlock(blockOrder[0]);
	if (!block) return true;
	const schema = editor.schema.resolve(block.type);
	if (!schema || schema.content !== "inline" || schema.fieldEditor === "none") {
		return false;
	}
	const text = block.textContent();
	return !text || text === "\u200B";
}
