import type { Editor } from "@pen/core";

export type LinkMark = {
	href: string;
	title?: string;
};

export function getActiveLinkMark(editor: Editor): LinkMark | null {
	const selection = editor.selection;
	if (!selection || selection.type !== "text") return null;

	const block = editor.getBlock(selection.anchor.blockId);
	if (!block) return null;

	const deltas = block.textDeltas();
	const offset = Math.min(selection.anchor.offset, selection.focus.offset);

	let currentOffset = 0;
	for (const delta of deltas) {
		const len = delta.insert.length;
		if (currentOffset + len > offset) {
			const link = delta.attributes?.link;
			if (link && typeof link === "object") {
				return link as LinkMark;
			}
			return null;
		}
		currentOffset += len;
	}

	return null;
}

export function canOpenLinkEditor(editor: Editor): boolean {
	const selection = editor.selection;
	if (!selection || selection.type !== "text") return false;

	return !selection.isCollapsed || getActiveLinkMark(editor) !== null;
}
