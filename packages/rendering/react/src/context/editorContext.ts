import { createContext, useContext, type ReactNode } from "react";
import type {
	Editor,
	EditorViewMode,
	AssetProvider,
	BlockRenderer,
	Importer,
	InteractionModel,
	PendingBlock,
} from "@pen/core";
import {
	resolveSelectAllBehavior,
	type EditorSelectAllBehavior,
} from "../constants/selectAll";
import { isDevelopmentEnvironment } from "../utils/environment";

export interface PasteImporters {
	html?: Importer<string, PendingBlock[]>;
	markdown?: Importer<string, PendingBlock[]>;
	assets?: AssetProvider;
}

export type RendererOverrides = Partial<Record<string, BlockRenderer>>;

export interface BlockDragAndDropOptions {
	enabled?: boolean;
}

export interface ResolvedBlockDragAndDropOptions {
	enabled: boolean;
}

export interface ResolvedInteractionModel {
	model: InteractionModel;
	selectAllBehavior: EditorSelectAllBehavior;
	clickToSelect: boolean;
	clickToEdit: boolean;
}

const DEFAULT_INTERACTION_MODEL_BY_VIEW_MODE: Record<
	EditorViewMode,
	InteractionModel
> = {
	structured: "content-first",
	flow: "content-first",
};

export function resolveInteractionModel(
	editorViewMode: EditorViewMode,
	override?: InteractionModel,
): ResolvedInteractionModel {
	const model =
		override ?? DEFAULT_INTERACTION_MODEL_BY_VIEW_MODE[editorViewMode];
	const isBlockFirst = model === "block-first";

	return {
		model,
		selectAllBehavior: resolveSelectAllBehavior(model),
		clickToSelect: isBlockFirst,
		clickToEdit: !isBlockFirst,
	};
}

export interface BlockControlsProps {
	blockId: string;
	blockType: string;
	selected: boolean;
}

export type BlockControlsRenderer = (
	props: BlockControlsProps,
) => ReactNode;

export interface EditorContextValue {
	editor: Editor;
	readonly: boolean;
	documentProfile: Editor["documentProfile"];
	editorViewMode: EditorViewMode;
	interactionModel: ResolvedInteractionModel;
	blockDragAndDrop: ResolvedBlockDragAndDropOptions;
	blockControls?: BlockControlsRenderer;
	importers?: PasteImporters;
	assets?: AssetProvider;
	renderers?: RendererOverrides;
}

export const EditorContext = createContext<EditorContextValue | null>(null);

export function useEditorContext(): EditorContextValue {
	const ctx = useContext(EditorContext);
	if (!ctx) {
		if (isDevelopmentEnvironment()) {
			console.error(
				"Pen: useEditorContext must be used within <Pen.Editor.Root>. " +
				"Wrap your editor components in <Pen.Editor.Root editor={editor}>.",
			);
		}
		throw new Error("Missing Pen.Editor.Root context");
	}
	return ctx;
}
