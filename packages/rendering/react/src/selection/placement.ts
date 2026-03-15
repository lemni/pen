import type { SelectionState } from "@pen/types";
import { getSelectionPointRect } from "../field-editor/selectionBridge";

export function resolveSelectionRect(
	root: HTMLElement,
	selection: SelectionState | null,
): DOMRect | null {
	if (!selection || selection.type !== "text" || selection.isCollapsed) {
		return null;
	}

	const domRect = resolveNativeSelectionRect(root);
	if (domRect) {
		return domRect;
	}

	const anchorRect = getSelectionPointRect(root, selection.anchor);
	const focusRect = getSelectionPointRect(root, selection.focus);
	if (!anchorRect || !focusRect) {
		return null;
	}

	return mergeDomRects(anchorRect, focusRect);
}

function resolveNativeSelectionRect(root: HTMLElement): DOMRect | null {
	const selection = root.ownerDocument.defaultView?.getSelection();
	if (!selection || selection.rangeCount === 0) {
		return null;
	}

	const anchorNode = selection.anchorNode;
	const focusNode = selection.focusNode;
	if (!anchorNode || !focusNode) {
		return null;
	}

	if (!root.contains(anchorNode) || !root.contains(focusNode)) {
		return null;
	}

	const range = selection.getRangeAt(0);
	const rect = range.getBoundingClientRect();
	if (rect.width === 0 && rect.height === 0) {
		return null;
	}
	return rect;
}

function mergeDomRects(a: DOMRect, b: DOMRect): DOMRect {
	const left = Math.min(a.left, b.left);
	const top = Math.min(a.top, b.top);
	const right = Math.max(a.right, b.right);
	const bottom = Math.max(a.bottom, b.bottom);
	return new DOMRect(left, top, right - left, bottom - top);
}
