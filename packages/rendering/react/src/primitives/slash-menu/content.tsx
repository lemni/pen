import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { EditorContext } from "../../context/editorContext";
import { renderAsChild, type AsChildProps } from "../../utils/asChild";
import { composeRefs } from "../../utils/composeRefs";
import { isDevelopmentEnvironment } from "../../utils/environment";
import {
	resolveAnchoredMenuPosition,
	type AnchoredMenuPosition,
	type MenuPlacementSide,
} from "../../utils/menuPosition";
import { useSlashMenuContext } from "./root";

type Side = MenuPlacementSide;
type SlashMenuPosition = AnchoredMenuPosition;

export interface SlashMenuContentProps extends AsChildProps {
	/**
	 * Preferred placement side relative to the caret.
	 * @default "bottom"
	 */
	side?: Side;
	/** Horizontal offset in px from the trigger token. @default 0 */
	alignOffset?: number;
	/** Gap in px between the caret and menu. @default 10 */
	sideOffset?: number;
	/** Minimum max-height in px when viewport space is tight. @default 120 */
	minHeight?: number;
	/** Viewport padding in px. @default 16 */
	viewportPadding?: number;
	ref?: React.Ref<HTMLElement>;
}

export function SlashMenuContent(props: SlashMenuContentProps) {
	const {
		alignOffset = 0,
		minHeight = 120,
		ref,
		side: preferredSide = "bottom",
		sideOffset = 10,
		viewportPadding = 16,
		...rest
	} = props;
	const editorContext = React.useContext(EditorContext);
	const {
		dismiss,
		editor: controllerEditor,
		items,
		open,
		query,
		selectedIndex,
		target,
	} = useSlashMenuContext();
	const editor = controllerEditor ?? editorContext?.editor;
	const contentRef = useRef<HTMLElement | null>(null);
	const [position, setPosition] = useState<SlashMenuPosition | null>(null);

	useLayoutEffect(() => {
		if (!open || !editor) {
			setPosition(null);
			return;
		}

		let frame = 0;
		const updatePosition = () => {
			setPosition(
				resolveAnchoredMenuPosition({
					alignOffset,
					editor,
					element: contentRef.current,
					minHeight,
					preferredSide,
					sideOffset,
					target: target ?? null,
					viewportPadding,
				}),
			);
		};
		const schedulePosition = () => {
			window.cancelAnimationFrame(frame);
			frame = window.requestAnimationFrame(updatePosition);
		};

		updatePosition();
		window.addEventListener("resize", schedulePosition);
		window.addEventListener("scroll", schedulePosition, true);
		document.addEventListener("selectionchange", schedulePosition);

		return () => {
			window.cancelAnimationFrame(frame);
			window.removeEventListener("resize", schedulePosition);
			window.removeEventListener("scroll", schedulePosition, true);
			document.removeEventListener("selectionchange", schedulePosition);
		};
	}, [
		alignOffset,
		editor,
		items.length,
		minHeight,
		open,
		preferredSide,
		query,
		sideOffset,
		target?.blockId,
		target?.endOffset,
		target?.startOffset,
		viewportPadding,
	]);

	useEffect(() => {
		if (!open) return;

		const handlePointerDown = (event: MouseEvent) => {
			if (contentRef.current?.contains(event.target as Node)) return;
			dismiss();
		};

		document.addEventListener("mousedown", handlePointerDown, true);
		return () =>
			document.removeEventListener("mousedown", handlePointerDown, true);
	}, [dismiss, open]);

	useEffect(() => {
		if (!open) return;

		const selectedItemElement =
			contentRef.current?.querySelector<HTMLElement>(
				"[data-pen-slash-menu-item][data-selected]",
			);
		if (typeof selectedItemElement?.scrollIntoView === "function") {
			selectedItemElement.scrollIntoView({ block: "nearest" });
		}
	}, [open, items.length, selectedIndex]);

	if (!editor) {
		if (isDevelopmentEnvironment()) {
			console.error(
				"Pen: <Pen.SlashMenu.Content> must be used within <Pen.Editor.Root> or <Pen.SlashMenu.Root editor={editor}>.",
			);
		}
		throw new Error("Missing editor for Pen.SlashMenu.Content");
	}

	if (!open) return null;

	const primitiveProps: Record<string, unknown> = {
		"data-pen-slash-menu-content": "",
		"data-side": position?.side ?? preferredSide,
		"data-state": "open",
		style: {
			position: "fixed" as const,
			top: position ? `${Math.round(position.top)}px` : 0,
			left: position ? `${Math.round(position.left)}px` : 0,
			maxHeight: position
				? `${Math.round(position.maxHeight)}px`
				: undefined,
			zIndex: 60,
			visibility: position ? ("visible" as const) : ("hidden" as const),
		},
	};

	return renderAsChild(
		{ ...rest, ref: composeRefs(ref, contentRef) },
		"div",
		primitiveProps,
	);
}
