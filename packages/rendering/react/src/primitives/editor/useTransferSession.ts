import { useEffect, useRef, useState, type RefObject } from "react";
import type { Editor } from "@pen/types";
import { getSelectionPointRect } from "../../field-editor/selectionBridge";
import {
	getDropPreview,
	resolveDropTarget,
	type DropPreview,
	type ResolvedDropTarget,
} from "../../field-editor/dropResolver";
import {
	executeTransfer,
} from "../../field-editor/transfer";
import { canAcceptImageTransfer } from "../../field-editor/transferImages";
import { DATA_ATTRS } from "../../utils/dataAttributes";

interface InlineDropCaretStyle {
	left: number;
	top: number;
	height: number;
}

interface UseTransferSessionOptions {
	editor: Editor;
	readonly: boolean;
	contentRef: RefObject<HTMLElement | null>;
}

interface TransferSessionState {
	isDropActive: boolean;
	dropPreview: DropPreview;
	inlineDropCaretStyle: InlineDropCaretStyle | null;
}

export function useTransferSession(
	options: UseTransferSessionOptions,
): TransferSessionState {
	const { editor, readonly, contentRef } = options;
	const imageFileDragDepthRef = useRef(0);
	const imageFileDropTargetRef = useRef<ResolvedDropTarget | null>(null);
	const [isDropActive, setIsDropActive] = useState(false);
	const [dropPreview, setDropPreview] = useState<DropPreview>(null);
	const [inlineDropCaretStyle, setInlineDropCaretStyle] =
		useState<InlineDropCaretStyle | null>(null);

	useEffect(() => {
		const contentElement = contentRef.current;
		if (!contentElement || readonly) return;
		const rootElement = contentElement.closest(
			`[${DATA_ATTRS.editorRoot}]`,
		) as HTMLElement | null;
		if (!rootElement) return;

		const clearImageFileDropState = () => {
			imageFileDragDepthRef.current = 0;
			imageFileDropTargetRef.current = null;
			setIsDropActive(false);
			setDropPreview(null);
			setInlineDropCaretStyle(null);
		};

		const isNodeWithinRoot = (target: EventTarget | null): boolean =>
			target instanceof Node && rootElement.contains(target);

		const isNodeWithinContent = (target: EventTarget | null): boolean =>
			target instanceof Node && contentElement.contains(target);

		const isIgnoredTransferTarget = (target: EventTarget | null): boolean =>
			target instanceof Element &&
			target.closest(`[${DATA_ATTRS.ignoreTransfer}]`) !== null;

		const isPointWithinElement = (
			element: HTMLElement,
			clientX: number,
			clientY: number,
		): boolean => {
			const rect = element.getBoundingClientRect();
			return (
				clientX >= rect.left &&
				clientX <= rect.right &&
				clientY >= rect.top &&
				clientY <= rect.bottom
			);
		};

		const isRelevantImageFileDragEvent = (event: DragEvent): boolean =>
			!isIgnoredTransferTarget(event.target) &&
			canAcceptImageTransfer(editor, event.dataTransfer) &&
			(isNodeWithinRoot(event.target) ||
				isPointWithinElement(rootElement, event.clientX, event.clientY));

		const isRelevantContentDragEvent = (event: DragEvent): boolean =>
			!isIgnoredTransferTarget(event.target) &&
			(isNodeWithinContent(event.target) ||
				isPointWithinElement(contentElement, event.clientX, event.clientY));

		const updateDropPreviewFromEvent = (event: DragEvent) => {
			if (!isRelevantContentDragEvent(event)) {
				imageFileDropTargetRef.current = null;
				setDropPreview(null);
				setInlineDropCaretStyle(null);
				return;
			}

			const dropTarget = resolveDropTarget(
				editor,
				rootElement,
				event.clientX,
				event.clientY,
				{ previousTarget: imageFileDropTargetRef.current },
			);
			imageFileDropTargetRef.current = dropTarget;

			const preview = getDropPreview(dropTarget);
			setDropPreview(preview);
			if (preview?.kind === "inline-caret") {
				const caretRect = getSelectionPointRect(rootElement, preview.point);
				const contentRect = contentElement.getBoundingClientRect();
				if (caretRect) {
					setInlineDropCaretStyle({
						left: caretRect.left - contentRect.left,
						top: caretRect.top - contentRect.top,
						height: Math.max(caretRect.height, 18),
					});
				} else {
					setInlineDropCaretStyle(null);
				}
			} else {
				setInlineDropCaretStyle(null);
			}
		};

		const handleDragEnter = (event: DragEvent) => {
			if (!isRelevantImageFileDragEvent(event)) {
				return;
			}

			imageFileDragDepthRef.current += 1;
			setIsDropActive(true);
		};

		const handleDragLeave = (event: DragEvent) => {
			if (!canAcceptImageTransfer(editor, event.dataTransfer)) {
				return;
			}

			imageFileDragDepthRef.current = Math.max(
				0,
				imageFileDragDepthRef.current - 1,
			);
			if (imageFileDragDepthRef.current === 0) {
				clearImageFileDropState();
			}
		};

		const handleDragOver = (event: DragEvent) => {
			if (!isRelevantImageFileDragEvent(event)) {
				return;
			}

			event.preventDefault();
			setIsDropActive(true);
			updateDropPreviewFromEvent(event);
			if (event.dataTransfer) {
				event.dataTransfer.dropEffect = "copy";
			}
		};

		const handleDrop = (event: DragEvent) => {
			if (!isRelevantImageFileDragEvent(event)) {
				return;
			}

			event.preventDefault();
			if (isRelevantContentDragEvent(event)) {
				const dataTransfer = event.dataTransfer;
				if (dataTransfer) {
					void executeTransfer({
						source: "drop",
						editor,
						dataTransfer,
						dropTarget: imageFileDropTargetRef.current,
					});
				}
			}
			clearImageFileDropState();
		};

		const handleDocumentDragEnd = () => {
			clearImageFileDropState();
		};

		rootElement.addEventListener("dragenter", handleDragEnter, true);
		rootElement.addEventListener("dragleave", handleDragLeave, true);
		rootElement.addEventListener("dragover", handleDragOver, true);
		rootElement.addEventListener("drop", handleDrop, true);
		rootElement.ownerDocument?.addEventListener("dragend", handleDocumentDragEnd);
		return () => {
			clearImageFileDropState();
			rootElement.removeEventListener("dragenter", handleDragEnter, true);
			rootElement.removeEventListener("dragleave", handleDragLeave, true);
			rootElement.removeEventListener("dragover", handleDragOver, true);
			rootElement.removeEventListener("drop", handleDrop, true);
			rootElement.ownerDocument?.removeEventListener(
				"dragend",
				handleDocumentDragEnd,
			);
		};
	}, [contentRef, editor, readonly]);

	return {
		isDropActive,
		dropPreview,
		inlineDropCaretStyle,
	};
}
