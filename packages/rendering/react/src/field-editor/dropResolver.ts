import type { Editor, Position } from "@pen/types";
import { DATA_ATTRS } from "../utils/dataAttributes";
import {
	getClosestBlockElementFromPoint,
	getSelectionPointForBlockAtPointer,
	pointToEditorSelectionPoint,
	queryBlockElement,
	type SelectionPoint,
} from "./selectionBridge";

export type ResolvedDropTarget =
	| {
			kind: "inline";
			point: SelectionPoint;
	  }
	| {
			kind: "block-edge";
			blockId: string;
			side: "before" | "after";
			position: Position;
	  }
	| {
			kind: "document-end";
			position: Position;
	  };

export type DropPreview =
	| {
			kind: "inline-caret";
			point: SelectionPoint;
	  }
	| {
			kind: "block-edge";
			blockId: string;
			side: "before" | "after";
	  }
	| null;

export interface ResolveDropTargetOptions {
	previousTarget?: ResolvedDropTarget | null;
}

export function resolveDropTarget(
	editor: Editor,
	root: HTMLElement,
	clientX: number,
	clientY: number,
	options: ResolveDropTargetOptions = {},
): ResolvedDropTarget | null {
	const hoveredBlockEl = getClosestBlockElementFromPoint(
		root,
		clientX,
		clientY,
	);
	const hoveredBlockId = hoveredBlockEl?.getAttribute("data-block-id") ?? null;
	if (hoveredBlockEl) {
		const blockRect = hoveredBlockEl.getBoundingClientRect();
		const inlineRectCandidate = hoveredBlockEl.querySelector(
			`[${DATA_ATTRS.inlineContent}]`,
		) as HTMLElement | null;
		const inlineRect = inlineRectCandidate?.getBoundingClientRect() ?? null;
		const hoveredRect =
			blockRect.width > 0 || blockRect.height > 0
				? blockRect
				: (inlineRect ?? blockRect);
		const isPointerWithinHoveredBlock =
			clientX >= hoveredRect.left &&
			clientX <= hoveredRect.right &&
			clientY >= hoveredRect.top &&
			clientY <= hoveredRect.bottom;
		if (hoveredBlockId && !isPointerWithinHoveredBlock) {
			const side =
				clientY <= hoveredRect.top + hoveredRect.height / 2
					? "before"
					: "after";
			return {
				kind: "block-edge",
				blockId: hoveredBlockId,
				side,
				position:
					side === "before"
						? { before: hoveredBlockId }
						: { after: hoveredBlockId },
			};
		}
	}

	const previousPoint =
		options.previousTarget?.kind === "inline"
			? options.previousTarget.point
			: null;
	let point = pointToEditorSelectionPoint(root, clientX, clientY, {
		previousPoint,
	});
	if (hoveredBlockEl) {
		if (hoveredBlockId && (!point || point.blockId !== hoveredBlockId)) {
			point = getSelectionPointForBlockAtPointer(
				hoveredBlockEl,
				clientX,
				clientY,
				{ previousPoint },
			);
		}
	}

	if (point) {
		const block = editor.getBlock(point.blockId);
		const schema = block ? editor.schema.resolve(block.type) : null;
		if (schema?.content === "inline") {
			return {
				kind: "inline",
				point,
			};
		}

		const blockElement = queryBlockElement(root, point.blockId);
		if (blockElement) {
			const rect = blockElement.getBoundingClientRect();
			const side = clientY <= rect.top + rect.height / 2 ? "before" : "after";
			return {
				kind: "block-edge",
				blockId: point.blockId,
				side,
				position: side === "before" ? { before: point.blockId } : { after: point.blockId },
			};
		}

		return {
			kind: "inline",
			point,
		};
	}

	const lastBlock = editor.lastBlock();
	if (!lastBlock) {
		return {
			kind: "document-end",
			position: "last",
		};
	}

	return {
		kind: "block-edge",
		blockId: lastBlock.id,
		side: "after",
		position: { after: lastBlock.id },
	};
}

export function getDropPreview(
	target: ResolvedDropTarget | null,
): DropPreview {
	if (!target) return null;

	if (target.kind === "inline") {
		return {
			kind: "inline-caret",
			point: target.point,
		};
	}

	if (target.kind === "document-end") return null;

	return {
		kind: "block-edge",
		blockId: target.blockId,
		side: target.side,
	};
}
