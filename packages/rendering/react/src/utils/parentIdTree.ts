import type { DocumentOp, Editor } from "@pen/types";

const PARENT_ID_CONTAINER_TYPES = new Set(["toggle", "callout", "blockquote"]);

export function getRootBlockIds(editor: Editor): readonly string[] {
	return editor.documentState.blockOrder.filter(
		(blockId) => editor.documentState.parentOf(blockId) == null,
	);
}

export function getParentIdChildBlockIds(
	editor: Editor,
	parentBlockId: string,
): readonly string[] {
	return editor.documentState.blockOrder.filter(
		(blockId) => editor.documentState.parentOf(blockId) === parentBlockId,
	);
}

export function getVisibleBlockIds(editor: Editor): readonly string[] {
	const visibleBlockIds: string[] = [];

	for (const rootBlockId of getRootBlockIds(editor)) {
		collectVisibleBlockIds(editor, rootBlockId, visibleBlockIds);
	}

	return visibleBlockIds;
}

export function getAdjacentVisibleBlockId(
	editor: Editor,
	blockId: string,
	direction: "previous" | "next",
): string | null {
	const visibleBlockIds = getVisibleBlockIds(editor);
	const blockIndex = visibleBlockIds.indexOf(blockId);
	if (blockIndex < 0) return null;

	const adjacentIndex =
		direction === "previous" ? blockIndex - 1 : blockIndex + 1;
	return visibleBlockIds[adjacentIndex] ?? null;
}

export function isInsideParentIdContainer(
	editor: Editor,
	blockId: string,
): boolean {
	const parentId = editor.documentState.parentOf(blockId);
	if (!parentId) return false;
	const parent = editor.getBlock(parentId);
	return !!parent && PARENT_ID_CONTAINER_TYPES.has(parent.type);
}

export function appendParentIdChildBlock(
	editor: Editor,
	options: {
		parentBlockId: string;
		childBlockId: string;
		blockType: string;
		props?: Record<string, unknown>;
	},
): void {
	const { parentBlockId, childBlockId, blockType, props } = options;
	const insertionAnchorId =
		getLastDescendantBlockId(editor, parentBlockId) ?? parentBlockId;

	editor.apply(
		[
			{
				type: "insert-block",
				blockId: childBlockId,
				blockType,
				props: props ?? {},
				position: { after: insertionAnchorId },
			},
			{
				type: "update-block",
				blockId: childBlockId,
				props: { parentId: parentBlockId },
			},
		],
		{ origin: "user" },
	);
}

export function getInsertSiblingBlockOp(
	editor: Editor,
	options: {
		siblingBlockId: string;
		blockId: string;
		blockType: string;
		props?: Record<string, unknown>;
	},
): DocumentOp {
	const { siblingBlockId, blockId, blockType, props } = options;
	const insertionAnchorId =
		getLastDescendantBlockId(editor, siblingBlockId) ?? siblingBlockId;
	const siblingParentId = editor.documentState.parentOf(siblingBlockId);
	const nextProps = { ...(props ?? {}) };

	if (
		siblingParentId &&
		!Object.prototype.hasOwnProperty.call(nextProps, "parentId")
	) {
		nextProps.parentId = siblingParentId;
	}

	return {
		type: "insert-block",
		blockId,
		blockType,
		props: nextProps,
		position: { after: insertionAnchorId },
	} as DocumentOp;
}

export function getLastDescendantBlockId(
	editor: Editor,
	parentBlockId: string,
): string | null {
	const blockOrder = editor.documentState.blockOrder;
	let lastDescendantBlockId: string | null = null;

	for (const blockId of blockOrder) {
		if (isDescendantOf(editor, blockId, parentBlockId)) {
			lastDescendantBlockId = blockId;
		}
	}

	return lastDescendantBlockId;
}

function collectVisibleBlockIds(
	editor: Editor,
	blockId: string,
	visibleBlockIds: string[],
): void {
	visibleBlockIds.push(blockId);

	if (!shouldShowParentIdChildren(editor, blockId)) {
		return;
	}

	for (const childBlockId of getParentIdChildBlockIds(editor, blockId)) {
		collectVisibleBlockIds(editor, childBlockId, visibleBlockIds);
	}
}

function shouldShowParentIdChildren(editor: Editor, blockId: string): boolean {
	const block = editor.getBlock(blockId);
	if (!block) return false;
	if (!PARENT_ID_CONTAINER_TYPES.has(block.type)) return false;
	if (block.type !== "toggle") return true;
	return Boolean(block.props?.open);
}

function isDescendantOf(
	editor: Editor,
	blockId: string,
	ancestorBlockId: string,
): boolean {
	let currentParentId = editor.documentState.parentOf(blockId);
	while (currentParentId) {
		if (currentParentId === ancestorBlockId) {
			return true;
		}
		currentParentId = editor.documentState.parentOf(currentParentId);
	}
	return false;
}
