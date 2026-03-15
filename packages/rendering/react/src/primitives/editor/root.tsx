import React, { useRef, useEffect, useState } from "react";
import { FIELD_EDITOR_SLOT_KEY as CORE_FIELD_EDITOR_SLOT_KEY } from "@pen/types";
import {
	generateId,
} from "@pen/types";
import type {
	AssetProvider,
	Editor,
	EditorViewMode,
	InteractionModel,
} from "@pen/types";
import { usesInlineTextSelection } from "@pen/types";
import {
	EditorContext,
	type BlockControlsRenderer,
	type BlockDragAndDropOptions,
	type ResolvedBlockDragAndDropOptions,
	type ResolvedInteractionModel,
	type PasteImporters,
	type RendererOverrides,
	resolveInteractionModel,
} from "../../context/editorContext";
import { FieldEditorContext } from "../../context/fieldEditorContext";
import { FIELD_EDITOR_SLOT_KEY } from "../../constants/fieldEditor";
import type { FieldEditorSession } from "../../field-editor/controller";
import { FieldEditorImpl } from "../../field-editor/fieldEditorImpl";
import { useDocumentEmptyState } from "../../hooks/useDocumentEmptyState";
import { domSelectionToEditor } from "../../field-editor/selectionBridge";
import {
	EditorRegionSelectionContext,
	RegionSelectionStore,
} from "./regionSelectionState";
import { renderAsChild, type AsChildProps } from "../../utils/asChild";
import { composeRefs } from "../../utils/composeRefs";
import { DATA_ATTRS } from "../../utils/dataAttributes";
import { handleEscapeSelectionTransition } from "../../utils/escapeSelection";
import { handleSelectAllShortcut, handleHistoryShortcut } from "../../field-editor/keyHandling";
import { getAdjacentVisibleBlockId } from "../../utils/parentIdTree";
import { handleTableCellSelectionKeyDown } from "../../utils/tableCellNavigation";
import { BlockDragSessionProvider } from "./blockDragSession";

const DATABASE_ROW_SELECTION_SLOT = "database:row-selection";

type DatabaseRowSelectionController = {
	deleteSelectedRows: (blockId: string) => boolean;
};

export interface EditorRootProps extends AsChildProps {
	editor: Editor;
	readonly?: boolean;
	importers?: PasteImporters;
	assets?: AssetProvider;
	renderers?: RendererOverrides;
	blockControls?: BlockControlsRenderer;
	editorViewMode?: EditorViewMode;
	interactionModel?: InteractionModel;
	blockDragAndDrop?: BlockDragAndDropOptions;
	ref?: React.Ref<HTMLElement>;
}

export function EditorRoot(props: EditorRootProps) {
	const {
		editor,
		readonly = false,
		importers,
		assets,
		renderers,
		blockControls,
		editorViewMode = editor.editorViewMode,
		interactionModel,
		blockDragAndDrop,
		ref,
		...rest
	} = props;
	const resolvedBlockDragAndDrop = resolveBlockDragAndDrop(
		editorViewMode,
		blockDragAndDrop,
	);
	const resolvedInteractionModel = resolveInteractionModel(
		editorViewMode,
		interactionModel,
	);
	const [focused, setFocused] = useState(false);
	const [rootElement, setRootElement] = useState<HTMLElement | null>(null);
	const isEmpty = useDocumentEmptyState(editor);
	const fieldEditorRef = useRef<FieldEditorSession | null>(null);
	const regionSelectionStoreRef = useRef<RegionSelectionStore | null>(null);
	const rootRef = useRef<HTMLElement | null>(null);
	const interactionModelRef = useRef(resolvedInteractionModel);
	interactionModelRef.current = resolvedInteractionModel;
	const resolvedAssets = assets ?? importers?.assets;

	if (!fieldEditorRef.current) {
		fieldEditorRef.current = new FieldEditorImpl(editor, {
			selectAllBehavior: resolvedInteractionModel.selectAllBehavior,
		});
	}
	if (!regionSelectionStoreRef.current) {
		regionSelectionStoreRef.current = new RegionSelectionStore();
	}

	useEffect(() => {
		fieldEditorRef.current?.setSelectAllBehavior(
			resolvedInteractionModel.selectAllBehavior,
		);
	}, [resolvedInteractionModel.selectAllBehavior]);

	useEffect(() => {
		const root = rootRef.current;
		const fieldEditor = fieldEditorRef.current;
		if (!root || !fieldEditor) {
			return;
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
		};
	}, [editor]);

	useEffect(() => {
		editor.internals.setSlot("paste:importers", importers);
		editor.internals.setSlot("paste:assetProvider", resolvedAssets);

		return () => {
			editor.internals.setSlot("paste:importers", undefined);
			editor.internals.setSlot("paste:assetProvider", undefined);
		};
	}, [editor, importers, resolvedAssets]);

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
		setRootElement(rootRef.current);
		return () => {
			fieldEditorRef.current?.setRootElement(null);
			setRootElement(null);
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

			if (handleDeleteSelectionShortcut(event, editor, fieldEditor, root)) {
				event.preventDefault();
				event.stopImmediatePropagation();
				return;
			}

			if (
				handleTableCellSelectionKeyDown({ event, editor, fieldEditor, root })
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

			if (handleBlockSelectionEnter(event, editor, fieldEditor, interactionModelRef.current)) {
				event.preventDefault();
				event.stopImmediatePropagation();
				return;
			}

			if (handleBlockSelectionArrow(event, editor, fieldEditor)) {
				event.preventDefault();
				event.stopImmediatePropagation();
				return;
			}

			if (handleHistoryShortcut(editor, event)) {
				event.preventDefault();
				event.stopImmediatePropagation();
				return;
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
		[DATA_ATTRS.viewId]: editor.internals.viewId,
		[DATA_ATTRS.focused]: focused || undefined,
		[DATA_ATTRS.readonly]: readonly || undefined,
		[DATA_ATTRS.empty]: isEmpty || undefined,
		role: "textbox",
		tabIndex: -1,
		"aria-multiline": "true",
		"aria-readonly": readonly,
	};

	return (
		<EditorContext.Provider
			value={{
				editor,
				readonly,
				documentProfile: editor.documentProfile,
				editorViewMode,
				interactionModel: resolvedInteractionModel,
				blockDragAndDrop: resolvedBlockDragAndDrop,
				blockControls,
				importers,
				assets: resolvedAssets,
				renderers,
			}}
		>
			<BlockDragSessionProvider viewId={editor.internals.viewId}>
				<EditorRegionSelectionContext.Provider
					value={{
						rootElement,
						setRootElement,
						store: regionSelectionStoreRef.current,
					}}
				>
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
				</EditorRegionSelectionContext.Provider>
			</BlockDragSessionProvider>
		</EditorContext.Provider>
	);
}

function resolveBlockDragAndDrop(
	editorViewMode: EditorViewMode,
	blockDragAndDrop?: BlockDragAndDropOptions,
): ResolvedBlockDragAndDropOptions {
	if (blockDragAndDrop?.enabled != null) {
		return { enabled: blockDragAndDrop.enabled };
	}

	return {
		enabled: editorViewMode !== "flow",
	};
}

function shouldHandleEditorKeyboardEvent(
	root: HTMLElement,
	editor: Editor,
	event: KeyboardEvent,
): boolean {
	const targetRoot = getClosestEditorRoot(event.target);
	if (targetRoot && targetRoot !== root) {
		return false;
	}

	if (isTextEntryTarget(event.target)) {
		const target = event.target;
		if (!(target instanceof Node) || !root.contains(target)) {
			return false;
		}
	}

	const ownerDocument = root.ownerDocument;
	const activeElement = ownerDocument?.activeElement;
	const activeRoot = getClosestEditorRoot(activeElement);
	if (activeRoot && activeRoot !== root) {
		return false;
	}

	if (activeElement instanceof Node && root.contains(activeElement)) {
		if (isTextEntryTarget(activeElement)) {
			if (!isFieldEditorTextEntryTarget(activeElement)) {
				return false;
			}
			const selection = editor.selection;
			if (
				selection?.type === "block" ||
				selection?.type === "cell" ||
				(selection?.type === "text" && !selection.isCollapsed)
			) {
				return true;
			}
			return shouldHandleCollapsedFieldEditorSelectAll(event, activeElement);
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

	if (selection?.type === "cell") {
		return true;
	}

	return false;
}

function getClosestEditorRoot(target: EventTarget | null): HTMLElement | null {
	if (!(target instanceof Node)) {
		return null;
	}
	const element =
		target instanceof HTMLElement ? target : target.parentElement;
	return element?.closest("[data-pen-editor-root]") as HTMLElement | null;
}

function isTextEntryTarget(target: EventTarget | null): boolean {
	if (!(target instanceof HTMLElement)) {
		return false;
	}

	if (target instanceof HTMLInputElement) {
		return isTextEntryInput(target);
	}

	return (
		target.isContentEditable ||
		target instanceof HTMLTextAreaElement ||
		target instanceof HTMLSelectElement
	);
}

function isTextEntryInput(input: HTMLInputElement): boolean {
	return !(
		input.type === "checkbox" ||
		input.type === "radio" ||
		input.type === "button" ||
		input.type === "submit" ||
		input.type === "reset" ||
		input.type === "range" ||
		input.type === "color" ||
		input.type === "file"
	);
}

function shouldHandleCollapsedFieldEditorSelectAll(
	event: KeyboardEvent,
	target: EventTarget | null,
): boolean {
	if (!(target instanceof HTMLElement)) {
		return false;
	}

	return (
		isSelectAllShortcut(event) &&
		target.closest(`[${DATA_ATTRS.fieldEditorSurface}]`) !== null
	);
}

function isFieldEditorTextEntryTarget(target: EventTarget | null): boolean {
	if (!(target instanceof HTMLElement)) {
		return false;
	}

	return target.closest(`[${DATA_ATTRS.fieldEditorSurface}]`) !== null;
}

function isSelectAllShortcut(event: KeyboardEvent): boolean {
	return (
		event.key.toLowerCase() === "a" &&
		!event.shiftKey &&
		!event.altKey &&
		(event.metaKey || event.ctrlKey)
	);
}

function handleBlockSelectionArrow(
	event: KeyboardEvent,
	editor: Editor,
	fieldEditor: FieldEditorSession,
): boolean {
	if (
		event.altKey ||
		event.ctrlKey ||
		event.metaKey ||
		event.shiftKey ||
		event.isComposing
	) {
		return false;
	}

	const isUp = event.key === "ArrowUp" || event.key === "ArrowLeft";
	const isDown = event.key === "ArrowDown" || event.key === "ArrowRight";
	if (!isUp && !isDown) return false;

	const selection = editor.selection;
	if (selection?.type !== "block" || selection.blockIds.length === 0) {
		return false;
	}

	const blockId = isUp
		? selection.blockIds[0]!
		: selection.blockIds[selection.blockIds.length - 1]!;
	const direction = isUp ? "previous" : "next";

	const adjacentId = getAdjacentVisibleBlockId(editor, blockId, direction);
	if (!adjacentId) return false;

	const adjacentBlock = editor.getBlock(adjacentId);
	if (!adjacentBlock) return false;

	const schema = editor.schema.resolve(adjacentBlock.type);
	if (usesInlineTextSelection(schema)) {
		const offset = isUp ? adjacentBlock.length() : 0;
		fieldEditor.activateTextSelection(adjacentId, offset, offset);
		return true;
	}

	editor.selectBlock(adjacentId);
	return true;
}

function handleBlockSelectionEnter(
	event: KeyboardEvent,
	editor: Editor,
	fieldEditor: FieldEditorSession,
	interactionModelResolved: ResolvedInteractionModel,
): boolean {
	if (
		event.key !== "Enter" ||
		event.altKey ||
		event.ctrlKey ||
		event.metaKey ||
		event.shiftKey ||
		event.isComposing
	) {
		return false;
	}

	const selection = editor.selection;
	if (selection?.type !== "block" || selection.blockIds.length === 0) {
		return false;
	}

	const anchorBlockId = selection.blockIds[selection.blockIds.length - 1]!;
	const anchorBlock = editor.getBlock(anchorBlockId);
	if (!anchorBlock) {
		return false;
	}

	if (interactionModelResolved.model === "block-first" && selection.blockIds.length === 1) {
		const schema = editor.schema.resolve(anchorBlock.type);
		if (usesInlineTextSelection(schema)) {
			const offset = anchorBlock.length();
			fieldEditor.activateTextSelection(anchorBlockId, offset, offset);
			return true;
		}
	}

	const anchorSchema = editor.schema.resolve(anchorBlock.type);
	const newBlockId = generateId();

	editor.apply([
		{
			type: "insert-block",
			blockId: newBlockId,
			blockType: "paragraph",
			props: {},
			position: { after: anchorBlockId },
		},
	]);

	fieldEditor.activateTextSelection(newBlockId, 0, 0);
	return true;
}

function handleDeleteSelectionShortcut(
	event: KeyboardEvent,
	editor: Editor,
	fieldEditor: FieldEditorSession,
	root: HTMLElement,
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
	if (tryDeleteSelectedDatabaseRows(root, editor)) {
		fieldEditor.deactivate();
		return true;
	}
	if (!selection) {
		return false;
	}

	if (selection.type === "text" && !selection.isCollapsed) {
		if (
			!selection.isMultiBlock &&
			!shouldUseDocumentTextDeletionFallback(root, fieldEditor)
		) {
			return false;
		}
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
		const firstBlock = editor.firstBlock();
		if (firstBlock) {
			const schema = editor.schema.resolve(firstBlock.type);
			if (usesInlineTextSelection(schema)) {
				fieldEditor.activateTextSelection(firstBlock.id, 0, 0);
			}
		}
		return true;
	}

	if (selection.type === "cell") {
		editor.deleteSelection();
		return true;
	}

	return false;
}

function tryDeleteSelectedDatabaseRows(
	root: HTMLElement,
	editor: Editor,
): boolean {
	const controller = editor.internals.getSlot(
		DATABASE_ROW_SELECTION_SLOT,
	) as DatabaseRowSelectionController | undefined;
	if (!controller) {
		return false;
	}

	const activeElement = root.ownerDocument?.activeElement;
	if (!(activeElement instanceof HTMLElement) || !root.contains(activeElement)) {
		return false;
	}

	const blockElement = activeElement.closest("[data-block-id]");
	const blockId = blockElement?.getAttribute("data-block-id");
	if (!blockId) {
		return false;
	}

	const block = editor.getBlock(blockId);
	if (!block || block.type !== "database") {
		return false;
	}

	return controller.deleteSelectedRows(blockId);
}

function shouldUseDocumentTextDeletionFallback(
	root: HTMLElement,
	fieldEditor: FieldEditorSession,
): boolean {
	if (!fieldEditor.isEditing) {
		return true;
	}

	const activeElement = root.ownerDocument?.activeElement;
	if (!(activeElement instanceof HTMLElement) || !root.contains(activeElement)) {
		return true;
	}

	if (activeElement === root) {
		return true;
	}

	const activeInlineSurface = activeElement.closest(
		`[${DATA_ATTRS.inlineContent}]`,
	);
	if (activeInlineSurface === null) {
		return true;
	}

	return false;
}

