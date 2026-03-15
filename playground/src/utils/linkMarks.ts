import type { Editor } from "@pen/types";
import { setInlineMark } from "@pen/shortcuts";

export type LinkMark = {
	href: string;
	title?: string;
};

type LinkRange = {
	blockId: string;
	start: number;
	end: number;
	link: LinkMark;
};

export function getActiveLinkMark(editor: Editor): LinkMark | null {
	return getActiveLinkRange(editor)?.link ?? null;
}

export function getActiveLinkRange(editor: Editor): LinkRange | null {
	const selection = editor.selection;
	if (!selection || selection.type !== "text") return null;

	const block = editor.getBlock(selection.anchor.blockId);
	if (!block) return null;

	const deltas = block.textDeltas();
	const offset = Math.min(selection.anchor.offset, selection.focus.offset);
	const activeBlockId = selection.anchor.blockId;

	let currentOffset = 0;
	for (let index = 0; index < deltas.length; index++) {
		const delta = deltas[index]!;
		const len = delta.insert.length;
		if (currentOffset + len > offset) {
			const link = delta.attributes?.link;
			if (link && typeof link === "object") {
				const activeLink = link as LinkMark;
				let start = currentOffset;
				let end = currentOffset + len;

				for (let backIndex = index - 1; backIndex >= 0; backIndex--) {
					const previousDelta = deltas[backIndex]!;
					const previousLink = previousDelta.attributes?.link;
					if (!sameLinkMark(previousLink, activeLink)) {
						break;
					}
					start -= previousDelta.insert.length;
				}

				for (
					let nextIndex = index + 1;
					nextIndex < deltas.length;
					nextIndex++
				) {
					const nextDelta = deltas[nextIndex]!;
					const nextLink = nextDelta.attributes?.link;
					if (!sameLinkMark(nextLink, activeLink)) {
						break;
					}
					end += nextDelta.insert.length;
				}

				return {
					blockId: activeBlockId,
					start,
					end,
					link: activeLink,
				};
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

export function removeLinkMark(editor: Editor): boolean {
	const selection = editor.selection;
	if (!selection || selection.type !== "text") return false;

	if (!selection.isCollapsed) {
		return setInlineMark(editor, "link", null);
	}

	const activeLinkRange = getActiveLinkRange(editor);
	if (!activeLinkRange) return false;

	editor.apply(
		[
			{
				type: "format-text",
				blockId: activeLinkRange.blockId,
				offset: activeLinkRange.start,
				length: activeLinkRange.end - activeLinkRange.start,
				marks: { link: null },
			},
		],
		{ origin: "user" },
	);
	return true;
}

function sameLinkMark(value: unknown, link: LinkMark): boolean {
	if (!value || typeof value !== "object") {
		return false;
	}

	const candidate = value as Partial<LinkMark>;
	return candidate.href === link.href && candidate.title === link.title;
}
