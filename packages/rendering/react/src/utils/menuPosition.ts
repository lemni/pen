import type { Editor } from "@pen/types";
import { getSelectionPointRect } from "../field-editor/selectionBridge";
import { DATA_ATTRS } from "./dataAttributes";

export type MenuPlacementSide = "top" | "bottom";

export interface MenuAnchorTarget {
	blockId: string;
	startOffset: number;
	endOffset: number;
}

export interface AnchoredMenuPosition {
	top: number;
	left: number;
	maxHeight: number;
	side: MenuPlacementSide;
}

export function resolveAnchoredMenuPosition(options: {
	alignOffset: number;
	editor: Editor;
	element: HTMLElement | null;
	fallbackWidth?: number;
	minHeight: number;
	preferredSide: MenuPlacementSide;
	sideOffset: number;
	target: MenuAnchorTarget | null;
	viewportPadding: number;
}): AnchoredMenuPosition | null {
	const {
		alignOffset,
		editor,
		element,
		fallbackWidth = 320,
		minHeight,
		preferredSide,
		sideOffset,
		target,
		viewportPadding,
	} = options;

	if (typeof window === "undefined") {
		return null;
	}

	const anchorRect = getAnchorRect(editor, element, target);
	if (!anchorRect) {
		return null;
	}

	const elementRect = element?.getBoundingClientRect();
	const menuWidth = elementRect?.width || fallbackWidth;
	const menuHeight = elementRect?.height || minHeight;
	const viewportWidth = window.innerWidth;
	const viewportHeight = window.innerHeight;

	let side = preferredSide;
	let top =
		side === "top"
			? anchorRect.top - sideOffset - menuHeight
			: anchorRect.bottom + sideOffset;

	if (
		side === "bottom" &&
		top + menuHeight > viewportHeight - viewportPadding
	) {
		side = "top";
		top = anchorRect.top - sideOffset - menuHeight;
	}

	if (side === "top" && top < viewportPadding) {
		side = "bottom";
		top = anchorRect.bottom + sideOffset;
	}

	const left = clamp(
		anchorRect.left - alignOffset,
		viewportPadding,
		viewportWidth - menuWidth - viewportPadding,
	);
	const availableHeight =
		side === "bottom"
			? viewportHeight - top - viewportPadding
			: anchorRect.top - sideOffset - viewportPadding;

	return {
		top: Math.max(viewportPadding, top),
		left,
		maxHeight: Math.max(minHeight, availableHeight),
		side,
	};
}

function getAnchorRect(
	editor: Editor,
	element: HTMLElement | null,
	target: MenuAnchorTarget | null,
): DOMRect | null {
	if (typeof window === "undefined") {
		return null;
	}

	const rootElement = element?.closest(
		`[${DATA_ATTRS.editorRoot}]`,
	) as HTMLElement | null;
	if (rootElement && target) {
		const startRect = getSelectionPointRect(rootElement, {
			blockId: target.blockId,
			offset: target.startOffset,
		});
		const endRect = getSelectionPointRect(rootElement, {
			blockId: target.blockId,
			offset: target.endOffset,
		});
		if (startRect && endRect) {
			return mergeTriggerHorizontalWithCaretLine(startRect, endRect);
		}
		if (startRect) {
			return startRect;
		}
	}

	const domSelection = window.getSelection();
	if (domSelection?.rangeCount) {
		const range = domSelection.getRangeAt(0).cloneRange();
		range.collapse(false);
		const rect =
			Array.from(range.getClientRects()).at(-1) ??
			range.getBoundingClientRect();
		if (rect.width > 0 || rect.height > 0) {
			return rect;
		}
	}

	const editorSelection = editor.selection;
	if (editorSelection?.type !== "text") {
		return null;
	}

	const blockElement = document.querySelector<HTMLElement>(
		`[data-block-id="${escapeCssAttributeValue(editorSelection.anchor.blockId)}"]`,
	);
	return blockElement?.getBoundingClientRect() ?? null;
}

function mergeTriggerHorizontalWithCaretLine(
	startRect: DOMRect,
	endRect: DOMRect,
): DOMRect {
	const verticalRect = isSameVisualLine(startRect, endRect)
		? startRect
		: endRect;
	return {
		x: startRect.left,
		y: verticalRect.top,
		left: startRect.left,
		right: startRect.left,
		top: verticalRect.top,
		bottom: verticalRect.bottom,
		width: 0,
		height: verticalRect.height,
		toJSON() {
			return {};
		},
	} as DOMRect;
}

function isSameVisualLine(left: DOMRect, right: DOMRect): boolean {
	const threshold = Math.max(4, Math.min(left.height, right.height) / 2);
	return Math.abs(left.top - right.top) <= threshold;
}

function escapeCssAttributeValue(value: string): string {
	return value.replace(/["\\]/g, "\\$&");
}

function clamp(value: number, min: number, max: number): number {
	if (max < min) {
		return min;
	}
	return Math.min(Math.max(value, min), max);
}
