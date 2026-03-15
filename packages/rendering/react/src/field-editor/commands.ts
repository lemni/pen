import {
	INPUT_RULES_ENGINE_SLOT_KEY,
	generateId,
} from "@pen/types";
import type { DocumentOp, Editor } from "@pen/types";
import {
	toggleInlineMark as toggleInlineMarkCommand,
	setInlineMark as setInlineMarkCommand,
} from "@pen/shortcuts";
import { matchListInputRule } from "../utils/listInputRule";
import {
	getAdjacentVisibleBlockId,
	isInsideParentIdContainer,
} from "../utils/parentIdTree";
import { getEditorFlowCapability, isContinuousTextFlowCapability } from "../utils/flowCapabilities";

const ZERO_WIDTH_SPACE = "\u200B";

export interface SelectionRange {
	start: number;
	end: number;
}

export interface SelectionTarget {
	blockId: string;
	anchorOffset: number;
	focusOffset: number;
	selectBlock?: boolean;
}

type InlineTextLike = {
	length: number;
	toString(): string;
};

type BlockInputRuleEngine = {
	tryMatch(
		editor: Editor,
		blockId: string,
		insertedText: string,
		options?: { offset?: number },
	): DocumentOp[] | null;
};

// ── Enter action resolution ──────────────────────────────────

type EnterAction =
	| { action: "split"; newBlockType: string | undefined }
	| { action: "convert"; newType: string }
	| { action: "lift" }
	| { action: "insert-text"; text: string };

type BackspaceAction =
	| { action: "convert"; newType: string }
	| { action: "delete"; targetBlockId: string }
	| { action: "select-block"; targetBlockId: string }
	| { action: "merge"; targetBlockId: string };

type DeleteDirection = "backward" | "forward";

const LIST_BLOCK_TYPES = new Set([
	"bulletListItem",
	"numberedListItem",
	"checkListItem",
]);

const HEADING_TYPES = new Set(["heading"]);

const CONTAINER_EXIT_TYPES = new Set(["blockquote", "callout"]);
const BACKSPACE_EXIT_TYPES = new Set([
	...LIST_BLOCK_TYPES,
	...CONTAINER_EXIT_TYPES,
	...HEADING_TYPES,
]);

function isBlockEmpty(ytext: InlineTextLike): boolean {
	return getLogicalInlineLength(ytext) === 0;
}

function getAdjacentEditableBlock(
	editor: Editor,
	blockId: string,
	direction: "previous" | "next",
): ReturnType<Editor["getBlock"]> {
	let adjacentBlockId = getAdjacentVisibleBlockId(editor, blockId, direction);
	while (adjacentBlockId) {
		const adjacentBlock = editor.getBlock(adjacentBlockId);
		if (
			adjacentBlock &&
			isContinuousTextFlowCapability(
				getEditorFlowCapability(editor, adjacentBlock.id),
			)
		) {
			return adjacentBlock;
		}
		adjacentBlockId = getAdjacentVisibleBlockId(
			editor,
			adjacentBlockId,
			direction,
		);
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

function getSelectionTarget(
	blockId: string,
	ytext: InlineTextLike,
	range: SelectionRange | null,
): SelectionTarget {
	const normalizedRange = normalizeInlineRange(ytext, range);

	return {
		blockId,
		anchorOffset: normalizedRange?.start ?? 0,
		focusOffset: normalizedRange?.end ?? 0,
	};
}

function isCollapsedRange(range: SelectionRange | null): boolean {
	return !range || range.start === range.end;
}

function getListIndent(
	block: NonNullable<ReturnType<Editor["getBlock"]>>,
): number {
	const rawIndent = block.props?.indent;
	return typeof rawIndent === "number" && rawIndent >= 0 ? rawIndent : 0;
}

function isListBlock(
	block: ReturnType<Editor["getBlock"]>,
): block is NonNullable<ReturnType<Editor["getBlock"]>> {
	return !!block && LIST_BLOCK_TYPES.has(block.type);
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

	const immediateId = getAdjacentVisibleBlockId(editor, blockId, direction);
	if (!immediateId) return null;

	if (
		!isContinuousTextFlowCapability(
			getEditorFlowCapability(editor, immediateId),
		)
	) {
		return {
			blockId: immediateId,
			anchorOffset: 0,
			focusOffset: 0,
			selectBlock: true,
		};
	}

	const adjacentBlock = editor.getBlock(immediateId);
	if (!adjacentBlock) return null;

	const targetOffset = direction === "previous" ? adjacentBlock.length() : 0;
	return {
		blockId: adjacentBlock.id,
		anchorOffset: targetOffset,
		focusOffset: targetOffset,
	};
}

export function applyListTabBehavior(
	editor: Editor,
	options: {
		blockId: string;
		ytext: InlineTextLike;
		range: SelectionRange | null;
		shiftKey: boolean;
	},
): SelectionTarget | null {
	const { blockId, ytext, range, shiftKey } = options;
	const block = editor.getBlock(blockId);
	if (!isListBlock(block)) {
		return null;
	}

	const currentIndent = getListIndent(block);
	let nextIndent = currentIndent;

	if (shiftKey) {
		nextIndent = Math.max(0, currentIndent - 1);
	} else {
		const previousBlockId = getAdjacentVisibleBlockId(editor, blockId, "previous");
		const previousBlock = previousBlockId
			? editor.getBlock(previousBlockId)
			: null;
		const sharesParent =
			previousBlockId !== null &&
			editor.documentState.parentOf(previousBlockId) ===
			editor.documentState.parentOf(blockId);

		if (
			isListBlock(previousBlock) &&
			sharesParent &&
			getListIndent(previousBlock) >= currentIndent
		) {
			nextIndent = currentIndent + 1;
		}
	}

	if (nextIndent === currentIndent) {
		return null;
	}

	editor.apply(
		[
			{
				type: "update-block",
				blockId,
				props: { indent: nextIndent },
			} as DocumentOp,
		],
		{ origin: "user" },
	);

	return getSelectionTarget(blockId, ytext, range);
}

export function resolveBackspaceAction(
	editor: Editor,
	options: {
		blockId: string;
		ytext: InlineTextLike;
		range: SelectionRange | null;
	},
): BackspaceAction | null {
	const { blockId, ytext } = options;
	const range = normalizeInlineRange(ytext, options.range);
	if (!isCollapsedRange(range)) return null;
	if ((range?.start ?? 0) !== 0) return null;
	if (
		!isContinuousTextFlowCapability(getEditorFlowCapability(editor, blockId))
	) {
		return null;
	}

	const block = editor.getBlock(blockId);
	if (!block) return null;

	if (isBlockEmpty(ytext) && block.type === "toggle" && block.children.length === 0) {
		const previousBlock = getAdjacentEditableBlock(editor, blockId, "previous");
		if (previousBlock) {
			return {
				action: "delete",
				targetBlockId: previousBlock.id,
			};
		}
		return { action: "convert", newType: "paragraph" };
	}

	if (isBlockEmpty(ytext) && BACKSPACE_EXIT_TYPES.has(block.type)) {
		return { action: "convert", newType: "paragraph" };
	}

	const immediateBlockId = getAdjacentVisibleBlockId(editor, blockId, "previous");
	if (
		immediateBlockId &&
		!isContinuousTextFlowCapability(
			getEditorFlowCapability(editor, immediateBlockId),
		)
	) {
		return {
			action: "select-block",
			targetBlockId: immediateBlockId,
		};
	}

	const previousBlock = getAdjacentEditableBlock(editor, blockId, "previous");
	if (!previousBlock) return null;

	return {
		action: "merge",
		targetBlockId: previousBlock.id,
	};
}

export function applyBackspaceBehavior(
	editor: Editor,
	options: {
		blockId: string;
		ytext: InlineTextLike;
		range: SelectionRange | null;
	},
): SelectionTarget | null {
	const { blockId, ytext } = options;
	const action = resolveBackspaceAction(editor, options);
	if (!action) return null;

	if (action.action === "convert") {
		return convertBlock(editor, {
			blockId,
			newType: action.newType,
		});
	}

	if (action.action === "select-block") {
		return {
			blockId: action.targetBlockId,
			anchorOffset: 0,
			focusOffset: 0,
			selectBlock: true,
		};
	}

	const previousBlock = editor.getBlock(action.targetBlockId);
	if (!previousBlock) return null;

	const targetOffset = previousBlock.length();
	if (action.action === "delete" || getLogicalInlineLength(ytext) === 0) {
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

function getCollapsedTextSelectionTarget(editor: Editor): SelectionTarget | null {
	const selection = editor.selection;
	if (!selection || selection.type !== "text") {
		return null;
	}

	return {
		blockId: selection.focus.blockId,
		anchorOffset: selection.focus.offset,
		focusOffset: selection.focus.offset,
	};
}

export function applyDeleteBehavior(
	editor: Editor,
	options: {
		blockId: string;
		ytext: InlineTextLike;
		range: SelectionRange | null;
		direction: DeleteDirection;
	},
): SelectionTarget | null {
	const { blockId, ytext, direction } = options;
	const range = normalizeInlineRange(ytext, options.range);
	if (!range) return null;

	if (!isCollapsedRange(range)) {
		editor.selectText(blockId, range.start, range.end);
		editor.deleteSelection({ origin: "user" });
		return (
			getCollapsedTextSelectionTarget(editor) ?? {
				blockId,
				anchorOffset: range.start,
				focusOffset: range.start,
			}
		);
	}

	if (direction === "backward") {
		return applyBackspaceBehavior(editor, {
			blockId,
			ytext,
			range,
		});
	}

	return null;
}

export function mergeBackwardAtBlockStart(
	editor: Editor,
	options: {
		blockId: string;
		ytext: InlineTextLike;
		range: SelectionRange | null;
	},
): SelectionTarget | null {
	return applyBackspaceBehavior(editor, options);
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

	if (empty && isInsideParentIdContainer(editor, blockId)) {
		return { action: "lift" };
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
	const newBlockId = generateId();

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
		newProps?: Record<string, unknown>;
	},
): SelectionTarget {
	editor.apply(getConvertBlockOps(editor, options), { origin: "user" });

	return {
		blockId: options.blockId,
		anchorOffset: 0,
		focusOffset: 0,
	};
}

export function getConvertBlockOps(
	editor: Editor,
	options: {
		blockId: string;
		newType: string;
		newProps?: Record<string, unknown>;
	},
): DocumentOp[] {
	const existingParentId = editor.documentState.parentOf(options.blockId);
	const ops: DocumentOp[] = [
		{
			type: "convert-block",
			blockId: options.blockId,
			newType: options.newType,
			newProps: options.newProps,
		} as DocumentOp,
	];

	if (existingParentId) {
		ops.push({
			type: "update-block",
			blockId: options.blockId,
			props: { parentId: existingParentId },
		} as DocumentOp);
	}

	return ops;
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

export function applyListInputRule(
	editor: Editor,
	options: {
		blockId: string;
		range: SelectionRange | null;
		text: string;
	},
): SelectionTarget | null {
	const { blockId, range, text } = options;
	if (!range || range.start !== range.end) {
		return null;
	}

	const block = editor.getBlock(blockId);
	if (!block) {
		return null;
	}

	const inputRuleEngine =
		editor.internals.getSlot<BlockInputRuleEngine>(INPUT_RULES_ENGINE_SLOT_KEY) ??
		null;
	if (inputRuleEngine) {
		const ops = inputRuleEngine.tryMatch(editor, blockId, text, {
			offset: range.start,
		});
		if (ops) {
			editor.apply(ops, { origin: "input-rule" });
			return {
				blockId,
				anchorOffset: 0,
				focusOffset: 0,
			};
		}
	}

	if (block.type !== "paragraph") {
		return null;
	}

	const match = matchListInputRule(block.textContent(), range, text);
	if (!match) {
		return null;
	}

	editor.apply(
		[
			{
				type: "delete-text",
				blockId,
				offset: match.deleteRange.start,
				length: match.deleteRange.end - match.deleteRange.start,
			} as DocumentOp,
			{
				type: "convert-block",
				blockId,
				newType: match.blockType,
				newProps: match.newProps,
			} as DocumentOp,
		],
		{ origin: "input-rule" },
	);

	return {
		blockId,
		anchorOffset: 0,
		focusOffset: 0,
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

		case "lift":
			return liftBlockOutOfParent(editor, { blockId });

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

function liftBlockOutOfParent(
	editor: Editor,
	options: { blockId: string },
): SelectionTarget {
	editor.apply(
		[
			{
				type: "update-block",
				blockId: options.blockId,
				props: { parentId: null },
			} as DocumentOp,
		],
		{ origin: "user" },
	);

	return {
		blockId: options.blockId,
		anchorOffset: 0,
		focusOffset: 0,
	};
}
