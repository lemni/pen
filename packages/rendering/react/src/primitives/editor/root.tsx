import React, { useRef, useEffect, useState } from "react";
import { FIELD_EDITOR_SLOT_KEY as CORE_FIELD_EDITOR_SLOT_KEY } from "@pen/types";
import type {
	AssetProvider,
	Editor,
	EditorViewMode,
	InteractionModel,
} from "@pen/types";
import {
	EditorContext,
	type BlockControlsRenderer,
	type BlockDragAndDropOptions,
	type BlockSelectionOptions,
	type InlineAtomRenderers,
	type ResolvedBlockDragAndDropOptions,
	type PasteImporters,
	type RendererOverrides,
	resolveBlockSelection,
	resolveInteractionModel,
} from "../../context/editorContext";
import { FieldEditorContext } from "../../context/fieldEditorContext";
import { FIELD_EDITOR_SLOT_KEY } from "../../constants/fieldEditor";
import {
	FieldEditorImpl,
	handleEditorDocumentKeyDown,
	shouldHandleEditorKeyboardEvent as shouldHandlePenEditorKeyboardEvent,
	type FieldEditorSession,
} from "@pen/dom";
import { useDocumentEmptyState } from "../../hooks/useDocumentEmptyState";
import { domSelectionToEditor } from "../../field-editor/selectionBridge";
import {
	EditorRegionSelectionContext,
	RegionSelectionStore,
} from "./regionSelectionState";
import { renderAsChild, type AsChildProps } from "../../utils/asChild";
import { composeRefs } from "../../utils/composeRefs";
import { DATA_ATTRS } from "../../utils/dataAttributes";
import { BlockDragSessionProvider } from "./blockDragSession";

export interface EditorRootProps extends AsChildProps {
	editor: Editor;
	readonly?: boolean;
	importers?: PasteImporters;
	assets?: AssetProvider;
	renderers?: RendererOverrides;
	inlineAtomRenderers?: InlineAtomRenderers;
	blockControls?: BlockControlsRenderer;
	editorViewMode?: EditorViewMode;
	interactionModel?: InteractionModel;
	blockDragAndDrop?: BlockDragAndDropOptions;
	blockSelection?: BlockSelectionOptions;
	ref?: React.Ref<HTMLElement>;
}

export function EditorRoot(props: EditorRootProps) {
	const {
		editor,
		readonly = false,
		importers,
		assets,
		renderers,
		inlineAtomRenderers,
		blockControls,
		editorViewMode = editor.editorViewMode,
		interactionModel,
		blockDragAndDrop,
		blockSelection,
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
	const resolvedBlockSelection = resolveBlockSelection(blockSelection);
	const [focused, setFocused] = useState(false);
	const [rootElement, setRootElement] = useState<HTMLElement | null>(null);
	const isEmpty = useDocumentEmptyState(editor);
	const fieldEditorRef = useRef<FieldEditorSession | null>(null);
	const regionSelectionStoreRef = useRef<RegionSelectionStore | null>(null);
	const rootRef = useRef<HTMLElement | null>(null);
	const resolvedAssets = assets ?? importers?.assets;

	if (!fieldEditorRef.current) {
		const fieldEditorOptions = {
			selectAllBehavior: resolvedInteractionModel.selectAllBehavior,
		};
		fieldEditorRef.current = new FieldEditorImpl(
			editor,
			fieldEditorOptions,
		);
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
			const shouldHandle = shouldHandlePenEditorKeyboardEvent({
				root,
				event,
				selection: editor.selection,
				hasMappedDomSelection: () =>
					domSelectionToEditor(root) !== null,
			});

			if (!shouldHandle) {
				return;
			}

			if (
				handleEditorDocumentKeyDown({
					event,
					editor,
					fieldEditor,
					interactionModel: resolvedInteractionModel.model,
					root,
				})
			) {
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
	}, [editor, resolvedInteractionModel.model]);

	const primitiveProps: Record<string, unknown> = {
		[DATA_ATTRS.editorRoot]: "",
		[DATA_ATTRS.viewId]: editor.internals.viewId,
		[DATA_ATTRS.focused]: focused || undefined,
		[DATA_ATTRS.readonly]: readonly || undefined,
		[DATA_ATTRS.empty]: isEmpty || undefined,
		tabIndex: -1,
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
				blockSelection: resolvedBlockSelection,
				blockControls,
				importers,
				assets: resolvedAssets,
				renderers,
				inlineAtomRenderers,
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
