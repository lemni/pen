import type React from "react";
import { DATA_ATTRS } from "./dataAttributes";

const DRAG_PREVIEW_ROOT_ATTR = "data-pen-block-drag-preview-root";
const DRAG_PREVIEW_ATTR = "data-pen-block-drag-preview";

function getPreviewRoot(ownerDocument: Document): HTMLElement {
	let root = ownerDocument.querySelector(
		`[${DRAG_PREVIEW_ROOT_ATTR}]`,
	) as HTMLElement | null;
	if (root) {
		return root;
	}

	root = ownerDocument.createElement("div");
	root.setAttribute(DRAG_PREVIEW_ROOT_ATTR, "");
	root.style.position = "fixed";
	root.style.top = "0";
	root.style.left = "0";
	root.style.width = "0";
	root.style.height = "0";
	root.style.pointerEvents = "none";
	root.style.zIndex = "2147483647";
	ownerDocument.body.append(root);
	return root;
}

function removeDragHandles(clone: HTMLElement) {
	const handleElements = clone.querySelectorAll(`[${DATA_ATTRS.blockHandle}]`);
	for (const handle of handleElements) {
		const parent = handle.parentElement;
		handle.remove();
		if (
			parent &&
			parent.childElementCount === 0 &&
			(parent.textContent?.trim().length ?? 0) === 0
		) {
			parent.remove();
		}
	}
}

function removeDuplicateIds(clone: HTMLElement) {
	if (clone.id) {
		clone.removeAttribute("id");
	}
	const descendantsWithIds = clone.querySelectorAll("[id]");
	for (const element of descendantsWithIds) {
		element.removeAttribute("id");
	}
}

function resetBlockStateAttrs(clone: HTMLElement) {
	const attrsToReset = [
		DATA_ATTRS.selected,
		DATA_ATTRS.dragging,
		DATA_ATTRS.dropTarget,
		DATA_ATTRS.dropPosition,
		DATA_ATTRS.focused,
	];
	for (const attr of attrsToReset) {
		clone.removeAttribute(attr);
		const matchingDescendants = clone.querySelectorAll(`[${attr}]`);
		for (const element of matchingDescendants) {
			element.removeAttribute(attr);
		}
	}
	clone.removeAttribute("draggable");
}

function createCountBadge(ownerDocument: Document, blockCount: number): HTMLElement {
	const badge = ownerDocument.createElement("div");
	badge.textContent = String(blockCount);
	badge.style.position = "absolute";
	badge.style.top = "-8px";
	badge.style.right = "-8px";
	badge.style.minWidth = "24px";
	badge.style.height = "24px";
	badge.style.padding = "0 7px";
	badge.style.borderRadius = "999px";
	badge.style.background = "rgba(17, 24, 39, 0.92)";
	badge.style.color = "white";
	badge.style.display = "inline-flex";
	badge.style.alignItems = "center";
	badge.style.justifyContent = "center";
	badge.style.fontSize = "12px";
	badge.style.fontWeight = "600";
	badge.style.boxShadow = "0 6px 18px rgba(0, 0, 0, 0.28)";
	return badge;
}

export function setBlockDragPreviewImage(args: {
	event: React.DragEvent<HTMLElement>;
	sourceElement: HTMLElement;
	blockCount: number;
}) {
	if (typeof args.event.dataTransfer?.setDragImage !== "function") {
		return;
	}

	const blockElement = args.sourceElement.closest(
		`[${DATA_ATTRS.editorBlock}]`,
	) as HTMLElement | null;
	if (!blockElement) {
		return;
	}

	const ownerDocument = blockElement.ownerDocument;
	const previewRoot = getPreviewRoot(ownerDocument);
	const rect = blockElement.getBoundingClientRect();
	const preview = ownerDocument.createElement("div");
	preview.setAttribute(DRAG_PREVIEW_ATTR, "");
	preview.setAttribute("aria-hidden", "true");
	preview.style.position = "fixed";
	preview.style.top = "0";
	preview.style.left = "0";
	preview.style.pointerEvents = "none";
	preview.style.opacity = "0.01";
	preview.style.width = `${rect.width}px`;
	preview.style.maxWidth = "min(480px, calc(100vw - 48px))";
	preview.style.filter = "drop-shadow(0 16px 40px rgba(0, 0, 0, 0.25))";

	const clone = blockElement.cloneNode(true) as HTMLElement;
	removeDragHandles(clone);
	removeDuplicateIds(clone);
	resetBlockStateAttrs(clone);
	preview.append(clone);

	if (args.blockCount > 1) {
		preview.append(createCountBadge(ownerDocument, args.blockCount));
	}

	previewRoot.replaceChildren(preview);
	args.event.dataTransfer.setDragImage(
		preview,
		Math.max(0, args.event.clientX - rect.left),
		Math.max(0, args.event.clientY - rect.top),
	);
}

export function clearBlockDragPreviewImage(ownerDocument: Document | null | undefined) {
	if (!ownerDocument) {
		return;
	}
	const previewRoot = ownerDocument.querySelector(
		`[${DRAG_PREVIEW_ROOT_ATTR}]`,
	) as HTMLElement | null;
	if (!previewRoot) {
		return;
	}
	previewRoot.replaceChildren();
	previewRoot.remove();
}
