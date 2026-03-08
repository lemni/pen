import React, { useRef, useEffect, useState } from "react";
import { FIELD_EDITOR_SLOT_KEY as CORE_FIELD_EDITOR_SLOT_KEY } from "@pen/core";
import type { Editor } from "@pen/core";
import {
	EditorContext,
	type PasteImporters,
} from "../../context/editorContext.js";
import { FieldEditorContext } from "../../context/fieldEditorContext.js";
import { FIELD_EDITOR_SLOT_KEY } from "../../constants/fieldEditor.js";
import { FieldEditorImpl } from "../../field-editor/fieldEditorImpl.js";
import { domSelectionToEditor } from "../../field-editor/selectionBridge.js";
import { renderAsChild, type AsChildProps } from "../../utils/asChild.js";
import { composeRefs } from "../../utils/composeRefs.js";
import { DATA_ATTRS } from "../../utils/dataAttributes.js";
import { handleEscapeSelectionTransition } from "../../utils/escapeSelection.js";
import { handleSelectAllShortcut } from "../../field-editor/keyHandling.js";

export interface EditorRootProps extends AsChildProps {
	editor: Editor;
	readonly?: boolean;
	importers?: PasteImporters;
	ref?: React.Ref<HTMLElement>;
}

export function EditorRoot(props: EditorRootProps) {
	const { editor, readonly = false, importers, ref, ...rest } = props;
	const [focused, setFocused] = useState(false);
	const [isEmpty, setIsEmpty] = useState(editor.documentState.isEmpty);
	const fieldEditorRef = useRef<FieldEditorImpl | null>(null);
	const rootRef = useRef<HTMLElement | null>(null);

	if (!fieldEditorRef.current) {
		fieldEditorRef.current = new FieldEditorImpl(editor);
	}

	useEffect(() => {
		const unsubDoc = editor.onDocumentCommit(() => {
			setIsEmpty(editor.documentState.isEmpty);
		});
		const root = rootRef.current;
		const fieldEditor = fieldEditorRef.current;
		if (!root || !fieldEditor) {
			return () => {
				unsubDoc();
			};
		}

		const handleFocusIn = () => {
			setFocused(true);
			fieldEditor.setFocused(true);
		};

		const handleFocusOut = () => {
			const ownerDocument = root.ownerDocument;
			const activeElement = ownerDocument?.activeElement;
			const nextFocused =
				activeElement instanceof Node && root.contains(activeElement);
			setFocused(nextFocused);
			fieldEditor.setFocused(nextFocused);
		};

		root.addEventListener("focusin", handleFocusIn);
		root.addEventListener("focusout", handleFocusOut);

		return () => {
			root.removeEventListener("focusin", handleFocusIn);
			root.removeEventListener("focusout", handleFocusOut);
			unsubDoc();
		};
	}, [editor]);

	useEffect(() => {
		editor.internals.setSlot("paste:importers", importers);
		editor.internals.setSlot("paste:assetProvider", importers?.assets);

		return () => {
			editor.internals.setSlot("paste:importers", undefined);
			editor.internals.setSlot("paste:assetProvider", undefined);
		};
	}, [editor, importers]);

	useEffect(() => {
		editor.internals.setSlot(FIELD_EDITOR_SLOT_KEY, fieldEditorRef.current);
		editor.internals.setSlot(
			CORE_FIELD_EDITOR_SLOT_KEY,
			fieldEditorRef.current,
		);
		return () => {
			editor.internals.setSlot(FIELD_EDITOR_SLOT_KEY, undefined);
			editor.internals.setSlot(CORE_FIELD_EDITOR_SLOT_KEY, undefined);
			fieldEditorRef.current?.destroy();
		};
	}, [editor]);

	useEffect(() => {
		fieldEditorRef.current?.setRootElement(rootRef.current);
		return () => {
			fieldEditorRef.current?.setRootElement(null);
		};
	}, []);

	useEffect(() => {
		const root = rootRef.current;
		const fieldEditor = fieldEditorRef.current;
		if (!root || !fieldEditor) {
			return;
		}

		const handleDocumentKeyDown = (event: KeyboardEvent) => {
			const shouldHandle = shouldHandleEditorKeyboardEvent(
				root,
				editor,
				event,
			);

			if (!shouldHandle) {
				return;
			}

			if (
				handleEscapeSelectionTransition({
					event,
					editor,
					fieldEditor,
					root,
				})
			) {
				event.preventDefault();
				event.stopImmediatePropagation();
				return;
			}

			if (
				handleSelectAllShortcut(editor, event, fieldEditor, {
					rootElement: root,
				})
			) {
				event.preventDefault();
				event.stopImmediatePropagation();
				return;
			}

			if (handleDeleteSelectionShortcut(event, editor, fieldEditor)) {
				event.preventDefault();
			}
		};

		root.ownerDocument?.addEventListener(
			"keydown",
			handleDocumentKeyDown,
			true,
		);
		return () => {
			root.ownerDocument?.removeEventListener(
				"keydown",
				handleDocumentKeyDown,
				true,
			);
		};
	}, [editor]);

	const primitiveProps: Record<string, unknown> = {
		[DATA_ATTRS.editorRoot]: "",
		[DATA_ATTRS.focused]: focused || undefined,
		[DATA_ATTRS.readonly]: readonly || undefined,
		[DATA_ATTRS.empty]: isEmpty || undefined,
		role: "textbox",
		tabIndex: -1,
		"aria-multiline": "true",
		"aria-readonly": readonly,
	};

	return (
		<EditorContext.Provider value={{ editor, readonly, importers }}>
			<FieldEditorContext.Provider value={fieldEditorRef.current}>
				{renderAsChild(
					{
						...rest,
						ref: composeRefs(ref, rootRef),
					},
					"div",
					primitiveProps,
				)}
			</FieldEditorContext.Provider>
		</EditorContext.Provider>
	);
}

function shouldHandleEditorKeyboardEvent(
	root: HTMLElement,
	editor: Editor,
	event: KeyboardEvent,
): boolean {
	if (isTextEntryTarget(event.target)) {
		return false;
	}

	const ownerDocument = root.ownerDocument;
	const activeElement = ownerDocument?.activeElement;
	if (activeElement instanceof Node && root.contains(activeElement)) {
		if (isTextEntryTarget(activeElement)) {
			return false;
		}
		return true;
	}

	if (domSelectionToEditor(root) !== null) {
		return true;
	}

	const selection = editor.selection;
	if (selection?.type === "text" && !selection.isCollapsed) {
		return true;
	}

	if (selection?.type === "block" && selection.blockIds.length > 0) {
		return true;
	}

	return false;
}

function isTextEntryTarget(target: EventTarget | null): boolean {
	if (!(target instanceof HTMLElement)) {
		return false;
	}

	return (
		target instanceof HTMLInputElement ||
		target instanceof HTMLTextAreaElement ||
		target instanceof HTMLSelectElement
	);
}

function handleDeleteSelectionShortcut(
	event: KeyboardEvent,
	editor: Editor,
	fieldEditor: FieldEditorImpl,
): boolean {
	if (
		(event.key !== "Backspace" && event.key !== "Delete") ||
		event.altKey ||
		event.ctrlKey ||
		event.metaKey ||
		event.shiftKey ||
		event.isComposing ||
		fieldEditor.isComposing
	) {
		return false;
	}

	const selection = editor.selection;
	if (!selection) {
		return false;
	}

	if (selection.type === "text" && !selection.isCollapsed) {
		if (selection.isMultiBlock) {
			fieldEditor.deactivate();
		}
		editor.deleteSelection();
		const nextSelection = editor.selection;
		if (nextSelection?.type === "text") {
			fieldEditor.activateTextSelection(
				nextSelection.focus.blockId,
				nextSelection.focus.offset,
				nextSelection.focus.offset,
			);
		} else {
			fieldEditor.deactivate();
		}
		return true;
	}

	if (selection.type === "block" && selection.blockIds.length > 0) {
		editor.deleteSelection();
		fieldEditor.deactivate();
		return true;
	}

	return false;
}
