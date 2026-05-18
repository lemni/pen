import React, { useContext, useEffect, useRef, useState } from "react";
import type { Editor, TextSelection } from "@pen/types";
import { EditorContext } from "../../context/editorContext";
import { useFieldEditorContext } from "../../context/fieldEditorContext";
import { getSelectionPointRect } from "../../field-editor/selectionBridge";
import { useFieldEditorState } from "../../hooks/useFieldEditorState";
import { useOverlayLayout } from "../../hooks/useOverlayLayout";
import { useSelection } from "../../hooks/useSelection";
import { renderAsChild, type AsChildProps } from "../../utils/asChild";
import { DATA_ATTRS } from "../../utils/dataAttributes";
import { isDevelopmentEnvironment } from "../../utils/environment";

type CaretStyle = React.CSSProperties & Record<string, string | number>;
const CARET_BLINK_RESUME_DELAY_MS = 500;

export const CARET = {
	DEFAULT: "default",
	MACOS: "macos",
} as const;

export type EditorCaretVariant = (typeof CARET)[keyof typeof CARET];

export interface EditorCaretRenderProps {
	selection: TextSelection;
	point: {
		blockId: string;
		offset: number;
	};
	caretStyle: CaretStyle;
	attributes: Record<string, string | undefined>;
}

export interface EditorCaretOverlayProps extends AsChildProps {
	editor?: Editor;
	variant?: EditorCaretVariant;
	renderCaret?: (props: EditorCaretRenderProps) => React.ReactNode;
	ref?: React.Ref<HTMLElement>;
}

export function EditorCaretOverlay(props: EditorCaretOverlayProps) {
	const {
		editor: editorProp,
		variant = CARET.DEFAULT,
		renderCaret,
		...rest
	} = props;
	const editorContext = useContext(EditorContext);
	const editor = editorProp ?? editorContext?.editor;
	const fieldEditor = useFieldEditorContext();

	if (!editor) {
		if (isDevelopmentEnvironment()) {
			console.error(
				"Pen: <Pen.Editor.CaretOverlay> must be used within <Pen.Editor.Root> or receive an editor prop.",
			);
		}
		throw new Error("Missing editor for Pen.Editor.CaretOverlay");
	}

	const selection = useSelection(editor);
	const fieldEditorState = useFieldEditorState(fieldEditor);
	const { elementRef, rootElement, layoutVersion } =
		useOverlayLayout<HTMLElement>([
			selection,
			fieldEditorState.focusBlockId,
			fieldEditorState.isEditing,
			fieldEditorState.isFocused,
			fieldEditorState.isComposing,
			fieldEditorState.mode,
		]);

	const caretSelection = resolveCaretSelection(selection, fieldEditorState);
	const rect =
		rootElement && caretSelection
			? getSelectionPointRect(rootElement, caretSelection.focus)
			: null;
	const isCaretVisible = caretSelection != null && rect != null;
	const blinkPaused = useCaretBlinkPauseState({
		rootElement,
		layoutVersion,
		caretSelection,
		isCaretVisible,
	});

	useEffect(() => {
		if (!rootElement || !isCaretVisible) {
			return;
		}

		const activeSurfaces = Array.from(
			rootElement.querySelectorAll<HTMLElement>(
				`[${DATA_ATTRS.fieldEditorActiveSurface}]`,
			),
		);
		if (activeSurfaces.length === 0) {
			return;
		}

		const previousCaretColors = activeSurfaces.map((surface) => ({
			surface,
			caretColor: surface.style.caretColor,
		}));
		for (const { surface } of previousCaretColors) {
			surface.style.caretColor = "transparent";
		}

		return () => {
			for (const entry of previousCaretColors) {
				entry.surface.style.caretColor = entry.caretColor;
			}
		};
	}, [
		rootElement,
		layoutVersion,
		isCaretVisible,
		caretSelection?.focus.blockId,
		caretSelection?.focus.offset,
	]);

	let caretNode: React.ReactNode = null;
	if (caretSelection && rect) {
		const renderProps = createCaretRenderProps(
			caretSelection,
			rect,
			blinkPaused,
			variant,
		);
		caretNode = renderCaret ? (
			renderCaret(renderProps)
		) : (
			<div {...renderProps.attributes} style={renderProps.caretStyle} />
		);
	}

	return renderAsChild(
		{
			...rest,
			ref: elementRef,
			children: rest.children ?? caretNode,
		},
		"div",
		{
			"data-pen-editor-caret-overlay": "",
			"data-caret-visible": isCaretVisible ? "" : undefined,
			"aria-hidden": "true",
			style: {
				pointerEvents: "none",
			},
		},
	);
}

function resolveCaretSelection(
	selection: ReturnType<typeof useSelection>,
	fieldEditorState: ReturnType<typeof useFieldEditorState>,
): TextSelection | null {
	if (selection?.type !== "text") {
		return null;
	}
	if (!selection.isCollapsed || selection.isMultiBlock) {
		return null;
	}
	if (
		!fieldEditorState.isEditing ||
		!fieldEditorState.isFocused ||
		fieldEditorState.isComposing
	) {
		return null;
	}
	return selection;
}

function createCaretRenderProps(
	selection: TextSelection,
	rect: DOMRect,
	blinkPaused: boolean,
	variant: EditorCaretVariant,
): EditorCaretRenderProps {
	const height = Math.max(rect.height, 16);
	const point = selection.focus;
	const isMacOS = variant === CARET.MACOS;
	const defaultCaretColor = isMacOS
		? "var(--palette-blue, #0a84ff)"
		: "var(--palette-b100, currentColor)";
	const defaultCaretWidth = isMacOS ? "2px" : "1px";
	const defaultCaretRadius = isMacOS ? "999px" : "0px";
	const caretStyle: CaretStyle = {
		position: "fixed",
		left: `${rect.left}px`,
		top: `${rect.top}px`,
		height: `${height}px`,
		width: `var(--pen-editor-caret-width, var(--pen-caret-width, ${defaultCaretWidth}))`,
		borderRadius: `var(--pen-editor-caret-radius, var(--pen-caret-radius, ${defaultCaretRadius}))`,
		background: `var(--pen-editor-caret-color, var(--pen-caret-color, ${defaultCaretColor}))`,
		boxShadow: "var(--pen-editor-caret-shadow, none)",
		animation: blinkPaused
			? "none"
			: "var(--pen-editor-caret-animation, none)",
		opacity: "var(--pen-editor-caret-opacity, 1)",
		pointerEvents: "none",
		zIndex: 20,
		"--pen-editor-caret-height": `${height}px`,
	};
	const attributes = {
		"data-pen-editor-caret": "",
		"data-block-id": point.blockId,
		"data-offset": String(point.offset),
	};

	return {
		selection,
		point,
		caretStyle,
		attributes,
	};
}

function useCaretBlinkPauseState(options: {
	rootElement: HTMLElement | null;
	layoutVersion: number;
	caretSelection: TextSelection | null;
	isCaretVisible: boolean;
}): boolean {
	const { rootElement, layoutVersion, caretSelection, isCaretVisible } =
		options;
	const [blinkPaused, setBlinkPaused] = useState(false);
	const resumeTimeoutRef = useRef<number | null>(null);

	useEffect(() => {
		return () => {
			if (resumeTimeoutRef.current == null) {
				return;
			}
			window.clearTimeout(resumeTimeoutRef.current);
		};
	}, []);

	useEffect(() => {
		if (!isCaretVisible) {
			if (resumeTimeoutRef.current != null) {
				window.clearTimeout(resumeTimeoutRef.current);
				resumeTimeoutRef.current = null;
			}
			setBlinkPaused(false);
			return;
		}

		setBlinkPaused(true);
		if (resumeTimeoutRef.current != null) {
			window.clearTimeout(resumeTimeoutRef.current);
		}
		resumeTimeoutRef.current = window.setTimeout(() => {
			resumeTimeoutRef.current = null;
			setBlinkPaused(false);
		}, CARET_BLINK_RESUME_DELAY_MS);
	}, [
		isCaretVisible,
		caretSelection?.focus.blockId,
		caretSelection?.focus.offset,
	]);

	useEffect(() => {
		if (!rootElement || !isCaretVisible) {
			return;
		}

		const activeSurface = rootElement.querySelector<HTMLElement>(
			`[${DATA_ATTRS.fieldEditorActiveSurface}]`,
		);
		if (!activeSurface) {
			return;
		}

		const pauseBlink = () => {
			setBlinkPaused(true);
			if (resumeTimeoutRef.current != null) {
				window.clearTimeout(resumeTimeoutRef.current);
			}
			resumeTimeoutRef.current = window.setTimeout(() => {
				resumeTimeoutRef.current = null;
				setBlinkPaused(false);
			}, CARET_BLINK_RESUME_DELAY_MS);
		};
		const handleKeyDown = (event: KeyboardEvent) => {
			if (isModifierOnlyKey(event)) {
				return;
			}
			pauseBlink();
		};

		activeSurface.addEventListener("beforeinput", pauseBlink);
		activeSurface.addEventListener("compositionend", pauseBlink);
		activeSurface.addEventListener("pointerdown", pauseBlink);
		activeSurface.addEventListener("focus", pauseBlink);
		activeSurface.addEventListener("keydown", handleKeyDown);

		return () => {
			activeSurface.removeEventListener("beforeinput", pauseBlink);
			activeSurface.removeEventListener("compositionend", pauseBlink);
			activeSurface.removeEventListener("pointerdown", pauseBlink);
			activeSurface.removeEventListener("focus", pauseBlink);
			activeSurface.removeEventListener("keydown", handleKeyDown);
		};
	}, [rootElement, layoutVersion, isCaretVisible]);

	return blinkPaused;
}

function isModifierOnlyKey(event: KeyboardEvent): boolean {
	return (
		event.key === "Shift" ||
		event.key === "Control" ||
		event.key === "Alt" ||
		event.key === "Meta" ||
		event.key === "CapsLock"
	);
}
