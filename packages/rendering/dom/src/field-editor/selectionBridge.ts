/**
 * DOM↔CRDT selection mapping utilities.
 * Converts between browser selection ranges and (blockId, offset) pairs.
 */

import { DATA_ATTRS } from "../utils/dataAttributes";
import {
	getBlockSelectionRoleFromType,
	getSelectionLengthForRole,
} from "../utils/blockSelectionSemantics";
import {
	domPointToLogicalOffset,
	findLogicalDOMPoint,
	getLogicalNodeLength,
	getLogicalTextContent,
} from "./inlineAtomDom";

/**
 * Safely query a block element by ID, escaping special characters to prevent
 * selector injection from untrusted CRDT data.
 */
export function queryBlockElement(
	root: HTMLElement,
	blockId: string,
): HTMLElement | null {
	const escaped =
		typeof CSS !== "undefined" && CSS.escape
			? CSS.escape(blockId)
			: blockId.replace(/(["\]\\])/g, "\\$1");
	return root.querySelector(
		`[${DATA_ATTRS.blockId}="${escaped}"]`,
	) as HTMLElement | null;
}

/**
 * Find the inline content element for a given block.
 */
export function queryInlineElement(
	root: HTMLElement,
	blockId: string,
): HTMLElement | null {
	const blockEl = queryBlockElement(root, blockId);
	return blockEl?.querySelector(
		`[${DATA_ATTRS.inlineContent}]`,
	) as HTMLElement | null;
}

export type TextDiffOp =
	| { type: "insert"; offset: number; text: string }
	| { type: "delete"; offset: number; length: number };

/**
 * O(n) scan from both ends to find the changed region.
 * Returns delete + insert ops for the diff.
 */
export function computeTextDiff(
	oldText: string,
	newText: string,
): TextDiffOp[] {
	if (oldText === newText) return [];

	let prefixLen = 0;
	const minLen = Math.min(oldText.length, newText.length);
	while (prefixLen < minLen && oldText[prefixLen] === newText[prefixLen]) {
		prefixLen++;
	}

	let oldSuffix = oldText.length;
	let newSuffix = newText.length;
	while (
		oldSuffix > prefixLen &&
		newSuffix > prefixLen &&
		oldText[oldSuffix - 1] === newText[newSuffix - 1]
	) {
		oldSuffix--;
		newSuffix--;
	}

	const ops: TextDiffOp[] = [];

	const deleteLen = oldSuffix - prefixLen;
	if (deleteLen > 0) {
		ops.push({ type: "delete", offset: prefixLen, length: deleteLen });
	}

	const insertText = newText.slice(prefixLen, newSuffix);
	if (insertText.length > 0) {
		ops.push({ type: "insert", offset: prefixLen, text: insertText });
	}

	return ops;
}

export function extractTextFromDOM(element: HTMLElement): string {
	return getLogicalTextContent(element);
}

export interface SelectionPoint {
	blockId: string;
	offset: number;
}

export type SelectionBoundary = "start" | "end";

export interface DirectionalSelectionOffsets {
	anchor: number;
	focus: number;
	start: number;
	end: number;
}

function isNodeWithinOrEqual(container: HTMLElement, node: Node): boolean {
	return node === container || container.contains(node);
}

interface CaretPositionLike {
	offsetNode: Node;
	offset: number;
}

interface ResolveSelectionPointOptions {
	preferredBoundary?: SelectionBoundary;
	previousPoint?: SelectionPoint | null;
}

const WRAPPED_LINE_HYSTERESIS_PX = 6;
const WRAPPED_LINE_HORIZONTAL_SLACK_PX = 12;
const WRAPPED_LINE_DELTA_PX = 1;

function fallbackCharacterOffset(
	container: HTMLElement,
	targetNode: Node,
	targetOffset: number,
): number {
	return domPointToLogicalOffset(container, targetNode, targetOffset);
}

/**
 * Compute the character offset of a DOM point within an inline content container.
 * Uses DOM Range first so browser-native endpoints on mark wrapper elements map
 * to the same logical offsets as equivalent text-node endpoints.
 */
export function domPointToOffset(
	container: HTMLElement,
	targetNode: Node,
	targetOffset: number,
): number {
	if (targetNode !== container && !container.contains(targetNode)) {
		return fallbackCharacterOffset(container, targetNode, targetOffset);
	}

	return domPointToLogicalOffset(container, targetNode, targetOffset);
}

/**
 * Find the ancestor block element for a given DOM node.
 */
function findBlockElement(node: Node, root: HTMLElement): HTMLElement | null {
	let current: Node | null = node;
	while (current && current !== root) {
		if (
			current instanceof HTMLElement &&
			current.hasAttribute(DATA_ATTRS.editorBlock)
		) {
			return current;
		}
		current = current.parentNode;
	}
	return null;
}

/**
 * Find the inline content element inside a block.
 */
function findInlineContentElement(blockEl: HTMLElement): HTMLElement | null {
	return blockEl.querySelector(`[${DATA_ATTRS.inlineContent}]`);
}

function getDistanceToRect(
	rect: DOMRect,
	clientX: number,
	clientY: number,
): { dx: number; dy: number } {
	return {
		dx:
			clientX < rect.left
				? rect.left - clientX
				: clientX > rect.right
					? clientX - rect.right
					: 0,
		dy:
			clientY < rect.top
				? rect.top - clientY
				: clientY > rect.bottom
					? clientY - rect.bottom
					: 0,
	};
}

function getCharacterRectAtOffset(
	container: HTMLElement,
	charOffset: number,
): DOMRect | null {
	const domPoint = findLogicalDOMPoint(container, charOffset);
	const range = document.createRange();
	try {
		range.setStart(domPoint.node, domPoint.offset);
		range.setEnd(domPoint.node, domPoint.offset);
	} catch {
		return null;
	}
	const rangeRectGetter = (
		range as Range & { getBoundingClientRect?: () => DOMRect }
	).getBoundingClientRect;
	if (typeof rangeRectGetter === "function") {
		const rect = rangeRectGetter.call(range);
		if (rect.width > 0 || rect.height > 0) {
			return rect;
		}
	}

	return null;
}

function getInlineCaretRectFromOffset(
	inlineEl: HTMLElement,
	offset: number,
): DOMRect {
	const textLength = getLogicalNodeLength(inlineEl);
	const inlineRect = inlineEl.getBoundingClientRect();
	if (textLength <= 0) {
		return {
			x: inlineRect.left,
			y: inlineRect.top,
			left: inlineRect.left,
			top: inlineRect.top,
			right: inlineRect.left,
			bottom: inlineRect.bottom,
			width: 0,
			height: inlineRect.height,
			toJSON() {
				return {};
			},
		} as DOMRect;
	}

	if (offset <= 0) {
		const firstRect = getCharacterRectAtOffset(inlineEl, 0);
		const left = firstRect?.left ?? inlineRect.left;
		const top = firstRect?.top ?? inlineRect.top;
		const height = firstRect?.height ?? inlineRect.height;
		return {
			x: left,
			y: top,
			left,
			top,
			right: left,
			bottom: top + height,
			width: 0,
			height,
			toJSON() {
				return {};
			},
		} as DOMRect;
	}

	if (offset >= textLength) {
		const lastRect = getCharacterRectAtOffset(inlineEl, textLength - 1);
		const left = lastRect?.right ?? inlineRect.right;
		const top = lastRect?.top ?? inlineRect.top;
		const height = lastRect?.height ?? inlineRect.height;
		return {
			x: left,
			y: top,
			left,
			top,
			right: left,
			bottom: top + height,
			width: 0,
			height,
			toJSON() {
				return {};
			},
		} as DOMRect;
	}

	const previousRect = getCharacterRectAtOffset(inlineEl, offset - 1);
	const nextRect = getCharacterRectAtOffset(inlineEl, offset);
	const useNextRect =
		previousRect && nextRect && nextRect.top > previousRect.top + 1;
	const sourceRect = useNextRect
		? nextRect
		: (previousRect ?? nextRect ?? inlineRect);
	const left = useNextRect
		? (nextRect?.left ?? inlineRect.left)
		: (previousRect?.right ?? nextRect?.left ?? inlineRect.left);

	return {
		x: left,
		y: sourceRect.top,
		left,
		top: sourceRect.top,
		right: left,
		bottom: sourceRect.top + sourceRect.height,
		width: 0,
		height: sourceRect.height,
		toJSON() {
			return {};
		},
	} as DOMRect;
}

function getCaretDistanceMetrics(
	rect: DOMRect,
	clientX: number,
	clientY: number,
): {
	dx: number;
	dy: number;
} {
	return {
		dx: Math.abs(clientX - rect.left),
		dy:
			clientY < rect.top
				? rect.top - clientY
				: clientY > rect.bottom
					? clientY - rect.bottom
					: 0,
	};
}

function stabilizeWrappedLineOffset(
	inlineEl: HTMLElement,
	candidateOffset: number,
	clientX: number,
	clientY: number,
	previousOffset: number | null | undefined,
): number {
	if (previousOffset == null || previousOffset === candidateOffset) {
		return candidateOffset;
	}

	const previousRect = getInlineCaretRectFromOffset(inlineEl, previousOffset);
	const candidateRect = getInlineCaretRectFromOffset(
		inlineEl,
		candidateOffset,
	);
	if (
		Math.abs(previousRect.top - candidateRect.top) <= WRAPPED_LINE_DELTA_PX
	) {
		return candidateOffset;
	}

	const previousMetrics = getCaretDistanceMetrics(
		previousRect,
		clientX,
		clientY,
	);
	const candidateMetrics = getCaretDistanceMetrics(
		candidateRect,
		clientX,
		clientY,
	);
	const isNearWrappedBoundary =
		previousMetrics.dy <= WRAPPED_LINE_HYSTERESIS_PX &&
		candidateMetrics.dy <= WRAPPED_LINE_HYSTERESIS_PX;
	if (!isNearWrappedBoundary) {
		return candidateOffset;
	}

	const shouldPreservePreviousLine =
		previousMetrics.dx <=
			candidateMetrics.dx + WRAPPED_LINE_HORIZONTAL_SLACK_PX &&
		previousMetrics.dy <= candidateMetrics.dy + WRAPPED_LINE_DELTA_PX;
	return shouldPreservePreviousLine ? previousOffset : candidateOffset;
}

function approximateInlineOffsetFromPoint(
	inlineEl: HTMLElement,
	clientX: number,
	clientY: number,
	previousOffset?: number | null,
): number {
	const textLength = getLogicalNodeLength(inlineEl);
	if (textLength <= 0) return 0;

	let bestOffset = 0;
	let bestScore = Number.POSITIVE_INFINITY;

	for (let offset = 0; offset <= textLength; offset++) {
		const rect = getInlineCaretRectFromOffset(inlineEl, offset);
		const { dx, dy } = getCaretDistanceMetrics(rect, clientX, clientY);
		const score = dy * 1000 + dx;
		if (score < bestScore) {
			bestScore = score;
			bestOffset = offset;
		}
	}

	return stabilizeWrappedLineOffset(
		inlineEl,
		bestOffset,
		clientX,
		clientY,
		previousOffset,
	);
}

function getBlockSurfaceRole(
	blockEl: HTMLElement,
): "editable-inline" | "structural" | "delegated" {
	const role = blockEl.getAttribute(DATA_ATTRS.surfaceRole);
	if (role === "structural" || role === "delegated") {
		return role;
	}

	return getBlockSelectionRoleFromType(
		blockEl.getAttribute(DATA_ATTRS.blockType),
	);
}

function getBlockTextLength(blockEl: HTMLElement): number {
	const inlineEl = findInlineContentElement(blockEl);
	if (inlineEl) {
		return getLogicalNodeLength(inlineEl);
	}
	return blockEl.textContent?.length ?? 0;
}

function getBlockSelectionLength(blockEl: HTMLElement): number {
	return getSelectionLengthForRole(
		getBlockSurfaceRole(blockEl),
		getBlockTextLength(blockEl),
	);
}

function getBoundaryOffset(
	blockEl: HTMLElement,
	side: SelectionBoundary,
): number {
	return side === "start" ? 0 : getBlockSelectionLength(blockEl);
}

function resolveBoundarySideFromOffset(
	currentOffset: number,
	maxOffset: number,
): SelectionBoundary {
	if (currentOffset <= 0) return "start";
	if (currentOffset >= maxOffset) return "end";
	return currentOffset <= maxOffset / 2 ? "start" : "end";
}

function resolveBoundarySideFromPointer(
	blockEl: HTMLElement,
	clientX: number,
	clientY: number,
): SelectionBoundary {
	const rect = blockEl.getBoundingClientRect();
	const verticalDelta = clientY - (rect.top + rect.height / 2);
	if (Math.abs(verticalDelta) > 4) {
		return verticalDelta < 0 ? "start" : "end";
	}
	return clientX <= rect.left + rect.width / 2 ? "start" : "end";
}

function getBoundaryPointForBlockElement(
	blockEl: HTMLElement,
	side: SelectionBoundary,
): SelectionPoint | null {
	const blockId = blockEl.getAttribute("data-block-id");
	if (!blockId) return null;
	return {
		blockId,
		offset: getBoundaryOffset(blockEl, side),
	};
}

export function getClosestBlockElementFromPoint(
	root: HTMLElement,
	clientX: number,
	clientY: number,
): HTMLElement | null {
	const doc = root.ownerDocument;
	const hitElement =
		typeof doc.elementFromPoint === "function"
			? doc.elementFromPoint(clientX, clientY)
			: null;
	const hitBlockEl = hitElement?.closest(
		`[${DATA_ATTRS.editorBlock}]`,
	) as HTMLElement | null;
	if (hitBlockEl && root.contains(hitBlockEl)) {
		return hitBlockEl;
	}

	const blockElements = root.querySelectorAll(`[${DATA_ATTRS.editorBlock}]`);
	let closestBlockEl: HTMLElement | null = null;
	let bestScore = Number.POSITIVE_INFINITY;

	for (const blockElement of blockElements) {
		if (!(blockElement instanceof HTMLElement)) continue;
		const rect = blockElement.getBoundingClientRect();
		const { dx, dy } = getDistanceToRect(rect, clientX, clientY);
		const score = dy * 1000 + dx;
		if (score < bestScore) {
			bestScore = score;
			closestBlockEl = blockElement;
		}
	}

	return closestBlockEl;
}

export function getBlockBoundaryPoint(
	root: HTMLElement,
	blockId: string,
	side: SelectionBoundary,
): SelectionPoint | null {
	const blockEl = queryBlockElement(root, blockId);
	if (!blockEl) return null;
	return getBoundaryPointForBlockElement(blockEl, side);
}

export function getSelectionPointForBlockAtPointer(
	blockEl: HTMLElement,
	clientX: number,
	clientY: number,
	options: ResolveSelectionPointOptions = {},
): SelectionPoint | null {
	const blockId = blockEl.getAttribute("data-block-id");
	if (!blockId) return null;

	const surfaceRole = getBlockSurfaceRole(blockEl);
	if (surfaceRole !== "editable-inline") {
		return getBoundaryPointForBlockElement(
			blockEl,
			options.preferredBoundary ??
				resolveBoundarySideFromPointer(blockEl, clientX, clientY),
		);
	}

	const inlineEl = findInlineContentElement(blockEl);
	if (!inlineEl) {
		return { blockId, offset: 0 };
	}

	return {
		blockId,
		offset: approximateInlineOffsetFromPoint(
			inlineEl,
			clientX,
			clientY,
			options.previousPoint?.blockId === blockId
				? options.previousPoint.offset
				: null,
		),
	};
}

/**
 * Resolve a DOM selection point (node + offset within that node) into
 * a (blockId, characterOffset) pair relative to the editor root.
 */
function resolveSelectionPoint(
	root: HTMLElement,
	node: Node,
	offset: number,
	options: ResolveSelectionPointOptions = {},
): SelectionPoint | null {
	const blockEl = findBlockElement(node, root);
	if (!blockEl) return null;
	const blockId = blockEl.getAttribute("data-block-id");
	if (!blockId) return null;

	const surfaceRole = getBlockSurfaceRole(blockEl);
	if (surfaceRole !== "editable-inline") {
		const inlineEl = findInlineContentElement(blockEl);
		const snappedSide =
			options.preferredBoundary ??
			(inlineEl && inlineEl.contains(node)
				? resolveBoundarySideFromOffset(
						domPointToOffset(inlineEl, node, offset),
						getBlockSelectionLength(blockEl),
					)
				: "start");
		return getBoundaryPointForBlockElement(blockEl, snappedSide);
	}

	const inlineEl = findInlineContentElement(blockEl);
	if (!inlineEl) return { blockId, offset: 0 };

	if (!inlineEl.contains(node)) return { blockId, offset: 0 };

	const charOffset = domPointToOffset(inlineEl, node, offset);
	return { blockId, offset: charOffset };
}

export function pointToEditorSelectionPoint(
	root: HTMLElement,
	clientX: number,
	clientY: number,
	options: ResolveSelectionPointOptions = {},
): SelectionPoint | null {
	const doc = root.ownerDocument;
	if (!doc) return null;
	const caretFromPoint = doc as Document & {
		caretPositionFromPoint?: (
			x: number,
			y: number,
		) => CaretPositionLike | null;
		caretRangeFromPoint?: (x: number, y: number) => Range | null;
	};

	const position = caretFromPoint.caretPositionFromPoint?.(clientX, clientY);
	if (position) {
		const resolved = resolveSelectionPoint(
			root,
			position.offsetNode,
			position.offset,
			options,
		);
		if (resolved) return resolved;
	}

	const range = caretFromPoint.caretRangeFromPoint?.(clientX, clientY);
	if (range) {
		const resolved = resolveSelectionPoint(
			root,
			range.startContainer,
			range.startOffset,
			options,
		);
		if (resolved) return resolved;
	}

	const hoveredBlockEl = getClosestBlockElementFromPoint(
		root,
		clientX,
		clientY,
	);
	if (!hoveredBlockEl) return null;
	return getSelectionPointForBlockAtPointer(
		hoveredBlockEl,
		clientX,
		clientY,
		options,
	);
}

/**
 * Convert DOM selection range to editor (blockId, offset) pairs.
 */
export function domSelectionToEditor(
	root: HTMLElement,
): { anchor: SelectionPoint; focus: SelectionPoint } | null {
	const sel = window.getSelection();
	if (!sel || sel.rangeCount === 0) return null;

	const anchorNode = sel.anchorNode;
	const focusNode = sel.focusNode;
	if (!anchorNode || !focusNode) return null;
	if (!root.contains(anchorNode) || !root.contains(focusNode)) return null;

	const anchor = resolveSelectionPoint(root, anchorNode, sel.anchorOffset);
	const focus = resolveSelectionPoint(root, focusNode, sel.focusOffset);
	if (!anchor || !focus) return null;

	return { anchor, focus };
}

/**
 * Set DOM selection from editor (blockId, offset) pairs.
 */
export function editorSelectionToDOM(
	root: HTMLElement,
	anchor: SelectionPoint,
	focus: SelectionPoint,
): void {
	const anchorResult = findDOMPoint(root, anchor.blockId, anchor.offset);
	const focusResult = findDOMPoint(root, focus.blockId, focus.offset);
	if (!anchorResult || !focusResult) return;

	const sel = window.getSelection();
	if (!sel) return;

	setDOMSelection(sel, anchorResult, focusResult);
}

export function getSelectionPointRect(
	root: HTMLElement,
	point: SelectionPoint,
): DOMRect | null {
	const domPoint = findDOMPoint(root, point.blockId, point.offset);
	if (!domPoint) return null;

	const blockEl = queryBlockElement(root, point.blockId);
	const inlineEl = blockEl?.querySelector(
		`[${DATA_ATTRS.inlineContent}]`,
	) as HTMLElement | null;
	if (!inlineEl) return null;

	const doc = root.ownerDocument;
	if (!doc) return null;

	const range = doc.createRange();
	range.setStart(domPoint.node, domPoint.offset);
	range.collapse(true);

	const rangeRectGetter = (
		range as Range & { getBoundingClientRect?: () => DOMRect }
	).getBoundingClientRect;
	if (typeof rangeRectGetter === "function") {
		const rect = rangeRectGetter.call(range);
		if (rect.height > 0 || rect.width > 0) {
			return rect;
		}
	}

	return getInlineCaretRectFromOffset(inlineEl, point.offset);
}

export function getTextSelectionClientRects(
	root: HTMLElement,
	selection: {
		anchor: SelectionPoint;
		focus: SelectionPoint;
	},
): DOMRect[] {
	const doc = root.ownerDocument;
	if (!doc) {
		return [];
	}

	const anchorPoint = findDOMPoint(
		root,
		selection.anchor.blockId,
		selection.anchor.offset,
	);
	const focusPoint = findDOMPoint(
		root,
		selection.focus.blockId,
		selection.focus.offset,
	);
	if (!anchorPoint || !focusPoint) {
		return [];
	}

	const range = doc.createRange();
	try {
		range.setStart(anchorPoint.node, anchorPoint.offset);
		range.setEnd(focusPoint.node, focusPoint.offset);
	} catch {
		range.setStart(focusPoint.node, focusPoint.offset);
		range.setEnd(anchorPoint.node, anchorPoint.offset);
	}

	const rangeClientRectGetter = (
		range as Range & { getClientRects?: () => DOMRectList | DOMRect[] }
	).getClientRects;
	const clientRects =
		typeof rangeClientRectGetter === "function"
			? Array.from(rangeClientRectGetter.call(range))
			: [];
	if (clientRects.length > 0) {
		return clientRects.filter((rect) => rect.width > 0 || rect.height > 0);
	}

	const rangeRectGetter = (
		range as Range & { getBoundingClientRect?: () => DOMRect }
	).getBoundingClientRect;
	if (typeof rangeRectGetter !== "function") {
		return [];
	}

	const boundingRect = rangeRectGetter.call(range);
	return boundingRect.width > 0 || boundingRect.height > 0
		? [boundingRect]
		: [];
}

/**
 * Find the DOM text node and offset for a given (blockId, characterOffset).
 */
function findDOMPoint(
	root: HTMLElement,
	blockId: string,
	charOffset: number,
): { node: Node; offset: number } | null {
	const blockEl = queryBlockElement(root, blockId);
	if (!blockEl) return null;

	const inlineEl = blockEl.querySelector(
		`[${DATA_ATTRS.inlineContent}]`,
	) as HTMLElement | null;
	if (!inlineEl) return null;

	return findLogicalDOMPoint(inlineEl, charOffset);
}

/**
 * Get the current selection as character offsets within the active inline content.
 * Used by DIRECT_HANDLERS to know the selection range for editing operations.
 */
export function getDirectionalSelectionOffsets(
	inlineElement: HTMLElement,
): DirectionalSelectionOffsets | null {
	const sel = window.getSelection();
	if (!sel || sel.rangeCount === 0) return null;
	if (!sel.anchorNode || !sel.focusNode) return null;
	if (
		!isNodeWithinOrEqual(inlineElement, sel.anchorNode) ||
		!isNodeWithinOrEqual(inlineElement, sel.focusNode)
	) {
		return null;
	}

	const anchor = domPointToOffset(
		inlineElement,
		sel.anchorNode,
		sel.anchorOffset,
	);
	const focus = domPointToOffset(
		inlineElement,
		sel.focusNode,
		sel.focusOffset,
	);

	return {
		anchor,
		focus,
		start: Math.min(anchor, focus),
		end: Math.max(anchor, focus),
	};
}

export function getSelectionOffsets(
	inlineElement: HTMLElement,
): { start: number; end: number } | null {
	const offsets = getDirectionalSelectionOffsets(inlineElement);
	if (!offsets) return null;

	return { start: offsets.start, end: offsets.end };
}

/**
 * Get the caret offset (collapsed cursor position) within an inline element.
 */
export function getCaretOffset(inlineElement: HTMLElement): number {
	const offsets = getSelectionOffsets(inlineElement);
	return offsets?.start ?? 0;
}

function setDOMSelection(
	selection: Selection,
	anchor: { node: Node; offset: number },
	focus: { node: Node; offset: number },
): void {
	selection.removeAllRanges();

	const setBaseAndExtent = (
		selection as Selection & {
			setBaseAndExtent?: (
				anchorNode: Node,
				anchorOffset: number,
				focusNode: Node,
				focusOffset: number,
			) => void;
		}
	).setBaseAndExtent;
	if (typeof setBaseAndExtent === "function") {
		try {
			setBaseAndExtent.call(
				selection,
				anchor.node,
				anchor.offset,
				focus.node,
				focus.offset,
			);
			return;
		} catch {
			// Fall back to the range-based path in test environments like jsdom.
		}
	}

	const collapseRange = document.createRange();
	collapseRange.setStart(anchor.node, anchor.offset);
	collapseRange.collapse(true);
	selection.addRange(collapseRange);

	if (
		(anchor.node !== focus.node || anchor.offset !== focus.offset) &&
		typeof selection.extend === "function"
	) {
		selection.extend(focus.node, focus.offset);
		return;
	}

	selection.removeAllRanges();
	const orderedRange = document.createRange();
	if (compareDOMPoints(anchor, focus) <= 0) {
		orderedRange.setStart(anchor.node, anchor.offset);
		orderedRange.setEnd(focus.node, focus.offset);
	} else {
		orderedRange.setStart(focus.node, focus.offset);
		orderedRange.setEnd(anchor.node, anchor.offset);
	}
	selection.addRange(orderedRange);
}

function compareDOMPoints(
	left: { node: Node; offset: number },
	right: { node: Node; offset: number },
): number {
	if (left.node === right.node) {
		return left.offset - right.offset;
	}

	const leftRange = document.createRange();
	leftRange.setStart(left.node, left.offset);
	leftRange.collapse(true);

	const rightRange = document.createRange();
	rightRange.setStart(right.node, right.offset);
	rightRange.collapse(true);

	return leftRange.compareBoundaryPoints(Range.START_TO_START, rightRange);
}
