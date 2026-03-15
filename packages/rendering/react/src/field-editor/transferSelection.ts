import type { Editor, Position } from "@pen/types";

export interface TransferCursorContext {
	blockId: string;
	offset: number;
	blockType: string;
	isInline: boolean;
	isEmpty: boolean;
}

export type TransferSelectionSnapshot =
	| {
			type: "text";
			anchor: { blockId: string; offset: number };
			focus: { blockId: string; offset: number };
	  }
	| {
			type: "block";
			blockIds: string[];
	  }
	| {
			type: "app";
			appId: string;
	  }
	| {
			type: "cell";
			blockId: string;
			anchor: { row: number; col: number };
			head: { row: number; col: number };
	  }
	| null;

export function getTransferCursorContext(
	editor: Editor,
): TransferCursorContext | null {
	const selection = editor.selection;
	if (selection?.type !== "text") return null;

	const blockId = selection.anchor.blockId;
	const block = editor.getBlock(blockId);
	if (!block) return null;

	const schema = editor.schema.resolve(block.type);
	const textContent = block.textContent?.() ?? "";
	return {
		blockId,
		offset: selection.anchor.offset,
		blockType: block.type,
		isInline: schema?.content === "inline",
		isEmpty:
			schema?.content === "inline" &&
			textContent.length === 0 &&
			selection.anchor.offset === 0,
	};
}

export function snapshotTransferSelection(
	editor: Editor,
): TransferSelectionSnapshot {
	const selection = editor.selection;
	if (!selection) return null;

	switch (selection.type) {
		case "text":
			return {
				type: "text",
				anchor: { ...selection.anchor },
				focus: { ...selection.focus },
			};
		case "block":
			return {
				type: "block",
				blockIds: [...selection.blockIds],
			};
		case "app":
			return {
				type: "app",
				appId: selection.appId,
			};
		case "cell":
			return {
				type: "cell",
				blockId: selection.blockId,
				anchor: { ...selection.anchor },
				head: { ...selection.head },
			};
		default:
			return null;
	}
}

export function selectionSnapshotMatches(
	editor: Editor,
	snapshot: TransferSelectionSnapshot,
): boolean {
	return JSON.stringify(snapshotTransferSelection(editor)) === JSON.stringify(snapshot);
}

export function deleteSelectionForTransfer(
	editor: Editor,
	cursorBefore: TransferCursorContext | null,
): {
	cursorAfter: TransferCursorContext | null;
	position: Position | undefined;
	emptyBlockToRemove: string | undefined;
} {
	editor.deleteSelection();

	const cursorAfter = getTransferCursorContext(editor) ?? cursorBefore;
	const shouldReplace = cursorAfter?.isEmpty;
	return {
		cursorAfter,
		position: cursorAfter
			? shouldReplace
				? { before: cursorAfter.blockId }
				: { after: cursorAfter.blockId }
			: undefined,
		emptyBlockToRemove: shouldReplace ? cursorAfter.blockId : undefined,
	};
}
