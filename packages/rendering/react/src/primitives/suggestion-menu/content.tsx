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
import { useSuggestionMenuContext } from "./root";

type Side = MenuPlacementSide;
type SuggestionMenuPosition = AnchoredMenuPosition;

export interface SuggestionMenuContentProps extends AsChildProps {
	side?: Side;
	alignOffset?: number;
	sideOffset?: number;
	minHeight?: number;
	viewportPadding?: number;
	ref?: React.Ref<HTMLElement>;
}

export function SuggestionMenuContent(props: SuggestionMenuContentProps) {
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
		status,
		target,
	} = useSuggestionMenuContext();
	const editor = controllerEditor ?? editorContext?.editor;
	const contentRef = useRef<HTMLElement | null>(null);
	const [position, setPosition] = useState<SuggestionMenuPosition | null>(
		null,
	);

	useLayoutEffect(() => {
		if (!open || !editor) {
			setPosition(null);
			return;
		}
		if (typeof window === "undefined") {
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
					target,
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
		status,
		target?.blockId,
		target?.endOffset,
		target?.startOffset,
		viewportPadding,
	]);

	useEffect(() => {
		if (!open) {
			return;
		}

		const handlePointerDown = (event: MouseEvent) => {
			if (contentRef.current?.contains(event.target as Node)) {
				return;
			}
			dismiss();
		};

		document.addEventListener("mousedown", handlePointerDown, true);
		return () => {
			document.removeEventListener("mousedown", handlePointerDown, true);
		};
	}, [dismiss, open]);

	useEffect(() => {
		if (!open) {
			return;
		}

		const selectedItemElement =
			contentRef.current?.querySelector<HTMLElement>(
				"[data-pen-suggestion-menu-item][data-selected]",
			);
		if (typeof selectedItemElement?.scrollIntoView === "function") {
			selectedItemElement.scrollIntoView({ block: "nearest" });
		}
	}, [open, items.length, selectedIndex]);

	if (!editor) {
		if (isDevelopmentEnvironment()) {
			console.error(
				"Pen: <Pen.SuggestionMenu.Content> must be used within <Pen.Editor.Root> or <Pen.SuggestionMenu.Root editor={editor}>.",
			);
		}
		throw new Error("Missing editor for Pen.SuggestionMenu.Content");
	}

	if (!open) {
		return null;
	}

	const primitiveProps: Record<string, unknown> = {
		"data-pen-suggestion-menu-content": "",
		"data-side": position?.side ?? preferredSide,
		"data-state": "open",
		"data-status": status,
		"data-trigger": target?.trigger,
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
