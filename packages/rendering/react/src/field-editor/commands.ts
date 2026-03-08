import type { DocumentOp, Editor } from "@pen/core";
import {
	toggleInlineMark as toggleInlineMarkCommand,
	setInlineMark as setInlineMarkCommand,
} from "@pen/shortcuts";

const ZERO_WIDTH_SPACE = "\u200B";

export interface SelectionRange {
	start: number;
	end: number;
}

export interface SelectionTarget {
	blockId: string;
	anchorOffset: number;
	focusOffset: number;
}

type InlineTextLike = {
	length: number;
	toString(): string;
};

// ── Enter action resolution ──────────────────────────────────

type EnterAction =
	| { action: "split"; newBlockType: string | undefined }
	| { action: "convert"; newType: string }
	| { action: "insert-text"; text: string };

const LIST_BLOCK_TYPES = new Set([
	"bulletListItem",
	"numberedListItem",
	"checkListItem",
]);

const HEADING_TYPES = new Set(["heading"]);

const CONTAINER_EXIT_TYPES = new Set(["blockquote", "callout"]);

function isBlockEmpty(ytext: InlineTextLike): boolean {
	return getLogicalInlineLength(ytext) === 0;
}

function isInlineBlockEditable(editor: Editor, blockId: string): boolean {
	const block = editor.getBlock(blockId);
	if (!block) return false;

	const schema = editor.schema.resolve(block.type);
	return schema?.content === "inline" && schema.fieldEditor !== "none";
}

function getAdjacentEditableBlock(
	editor: Editor,
	blockId: string,
	direction: "previous" | "next",
): ReturnType<Editor["getBlock"]> {
	let block = editor.getBlock(blockId);
	while (block) {
		block = direction === "previous" ? block.prev : block.next;
		if (!block) return null;
		if (isInlineBlockEditable(editor, block.id)) return block;
	}
	return null;
}

export function getLogicalInlineLength(ytext: InlineTextLike): number {
	const text = ytext.toString();
	if (!text || text === ZERO_WIDTH_SPACE) {
		return 0;
	}
	return ytext.length;
}

export function normalizeInlineRange(
	ytext: InlineTextLike,
	range: SelectionRange | null,
): SelectionRange | null {
	if (!range) return null;

	return {
		start: normalizeInlineOffset(ytext, range.start),
		end: normalizeInlineOffset(ytext, range.end),
	};
}

function isCollapsedRange(range: SelectionRange | null): boolean {
	return !range || range.start === range.end;
}

export function moveCaretAcrossBlocks(
	editor: Editor,
	options: {
		blockId: string;
		ytext: InlineTextLike;
		range: SelectionRange | null;
		direction: "previous" | "next";
	},
): SelectionTarget | null {
	const { blockId, ytext, direction } = options;
	const range = normalizeInlineRange(ytext, options.range);
	if (!isCollapsedRange(range)) return null;

	const currentOffset = range?.start ?? 0;
	const logicalLength = getLogicalInlineLength(ytext);
	const isAtBoundary =
		direction === "previous"
			? currentOffset === 0
			: currentOffset === logicalLength;
	if (!isAtBoundary) return null;

	const adjacentBlock = getAdjacentEditableBlock(editor, blockId, direction);
	if (!adjacentBlock) return null;

	const targetOffset = direction === "previous" ? adjacentBlock.length() : 0;
	return {
		blockId: adjacentBlock.id,
		anchorOffset: targetOffset,
		focusOffset: targetOffset,
	};
}

export function mergeBackwardAtBlockStart(
	editor: Editor,
	options: {
		blockId: string;
		ytext: InlineTextLike;
		range: SelectionRange | null;
	},
): SelectionTarget | null {
	const { blockId, ytext } = options;
	const range = normalizeInlineRange(ytext, options.range);
	if (!isCollapsedRange(range)) return null;
	if ((range?.start ?? 0) !== 0) return null;
	if (!isInlineBlockEditable(editor, blockId)) return null;

	const previousBlock = getAdjacentEditableBlock(editor, blockId, "previous");
	if (!previousBlock) return null;

	const targetOffset = previousBlock.length();
	if (getLogicalInlineLength(ytext) === 0) {
		editor.apply([
			{
				type: "delete-block",
				blockId,
			} as DocumentOp,
		]);
	} else {
		editor.apply([
			{
				type: "merge-blocks",
				targetBlockId: previousBlock.id,
				sourceBlockId: blockId,
			} as DocumentOp,
		]);
	}

	return {
		blockId: previousBlock.id,
		anchorOffset: targetOffset,
		focusOffset: targetOffset,
	};
}

export function resolveEnterAction(
	editor: Editor,
	blockId: string,
	inputMode: "richtext" | "code" | "table" | "none",
	ytext: { length: number; toString(): string },
): EnterAction | null {
	if (inputMode === "code") {
		return { action: "insert-text", text: "\n" };
	}

	if (inputMode !== "richtext") {
		return null;
	}

	const block = editor.getBlock(blockId);
	if (!block) return null;

	const blockType = block.type;
	const empty = isBlockEmpty(ytext);

	if (empty && LIST_BLOCK_TYPES.has(blockType)) {
		return { action: "convert", newType: "paragraph" };
	}

	if (empty && CONTAINER_EXIT_TYPES.has(blockType)) {
		return { action: "convert", newType: "paragraph" };
	}

	if (HEADING_TYPES.has(blockType)) {
		return { action: "split", newBlockType: "paragraph" };
	}

	return { action: "split", newBlockType: undefined };
}

// ── Offset normalization ─────────────────────────────────────

export function normalizeInlineOffset(
	ytext: InlineTextLike,
	offset: number,
): number {
	return Math.max(0, Math.min(offset, getLogicalInlineLength(ytext)));
}

export function toggleInlineMark(editor: Editor, markType: string): boolean {
	return toggleInlineMarkCommand(editor, markType);
}

export function setInlineMark(
	editor: Editor,
	markType: string,
	value: Record<string, unknown> | null,
): boolean {
	return setInlineMarkCommand(editor, markType, value);
}

// ── Commands ─────────────────────────────────────────────────

export function splitBlockAtOffset(
	editor: Editor,
	options: {
		blockId: string;
		offset: number;
		newBlockType?: string;
	},
): SelectionTarget {
	const { blockId, offset, newBlockType } = options;
	const newBlockId = crypto.randomUUID();

	editor.apply([
		{
			type: "split-block",
			blockId,
			offset,
			newBlockId,
			newBlockType,
		} as DocumentOp,
	]);

	return {
		blockId: newBlockId,
		anchorOffset: 0,
		focusOffset: 0,
	};
}

export function convertBlock(
	editor: Editor,
	options: {
		blockId: string;
		newType: string;
	},
): SelectionTarget {
	editor.apply([
		{
			type: "convert-block",
			blockId: options.blockId,
			newType: options.newType,
		} as DocumentOp,
	]);

	return {
		blockId: options.blockId,
		anchorOffset: 0,
		focusOffset: 0,
	};
}

export function insertTextAtRange(
	editor: Editor,
	options: {
		blockId: string;
		range: SelectionRange | null;
		text: string;
	},
): SelectionTarget {
	const { blockId, range, text } = options;
	const start = range?.start ?? 0;
	const end = range?.end ?? start;
	const ops: DocumentOp[] = [];

	if (end > start) {
		ops.push({
			type: "delete-text",
			blockId,
			offset: start,
			length: end - start,
		});
	}

	if (text.length > 0) {
		ops.push({
			type: "insert-text",
			blockId,
			offset: start,
			text,
		});
	}

	if (ops.length > 0) {
		editor.apply(ops, { origin: "user" });
	}

	const nextOffset = start + text.length;
	return {
		blockId,
		anchorOffset: nextOffset,
		focusOffset: nextOffset,
	};
}

export function applyEnterBehavior(
	editor: Editor,
	options: {
		blockId: string;
		inputMode: "richtext" | "code" | "table" | "none";
		ytext: {
			length: number;
			toString(): string;
			insert(offset: number, text: string): void;
			delete(offset: number, length: number): void;
		};
		range: SelectionRange | null;
	},
): SelectionTarget | null {
	const { blockId, inputMode, ytext, range } = options;

	const enterAction = resolveEnterAction(editor, blockId, inputMode, ytext);
	if (!enterAction) return null;

	switch (enterAction.action) {
		case "insert-text":
			return insertTextAtRange(editor, {
				blockId,
				range,
				text: enterAction.text,
			});

		case "convert":
			return convertBlock(editor, {
				blockId,
				newType: enterAction.newType,
			});

		case "split":
			return splitBlockAtOffset(editor, {
				blockId,
				offset: normalizeInlineOffset(
					ytext,
					range?.start ?? ytext.length,
				),
				newBlockType: enterAction.newBlockType,
			});
	}
}
