import { createContext, useContext, type ReactNode } from "react";
import type {
	AssetProvider,
	BlockRenderer,
	Editor,
	EditorViewMode,
	Importer,
	InteractionModel,
} from "@pen/types";
import type { PendingBlock } from "@pen/core";
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

export interface InlineAtomRenderProps {
	type: string;
	props: Record<string, unknown>;
	text: string;
	selected: boolean;
}

export type InlineAtomRenderer = (props: InlineAtomRenderProps) => ReactNode;

export type InlineAtomRenderers = Partial<Record<string, InlineAtomRenderer>>;

export interface BlockDragAndDropOptions {
	enabled?: boolean;
}

export interface ResolvedBlockDragAndDropOptions {
	enabled: boolean;
}

export type BlockSelectionOptions =
	| boolean
	| {
			enabled?: boolean;
	  };

export interface ResolvedBlockSelectionOptions {
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

export function resolveBlockSelection(
	blockSelection?: BlockSelectionOptions,
): ResolvedBlockSelectionOptions {
	if (typeof blockSelection === "boolean") {
		return { enabled: blockSelection };
	}

	return {
		enabled: blockSelection?.enabled ?? true,
	};
}

export interface BlockControlsProps {
	blockId: string;
	blockType: string;
	selected: boolean;
}

export type BlockControlsRenderer = (props: BlockControlsProps) => ReactNode;

export interface EditorContextValue {
	editor: Editor;
	readonly: boolean;
	documentProfile: Editor["documentProfile"];
	editorViewMode: EditorViewMode;
	interactionModel: ResolvedInteractionModel;
	blockDragAndDrop: ResolvedBlockDragAndDropOptions;
	blockSelection: ResolvedBlockSelectionOptions;
	blockControls?: BlockControlsRenderer;
	importers?: PasteImporters;
	assets?: AssetProvider;
	renderers?: RendererOverrides;
	inlineAtomRenderers?: InlineAtomRenderers;
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
