import { createContext, useContext } from "react";
import type {
	Editor,
	EditorViewMode,
	AssetProvider,
	BlockRenderer,
	Importer,
	PendingBlock,
} from "@pen/core";
import { isDevelopmentEnvironment } from "../utils/environment";

export interface PasteImporters {
	html?: Importer<string, PendingBlock[]>;
	markdown?: Importer<string, PendingBlock[]>;
	assets?: AssetProvider;
}

export type RendererOverrides = Partial<Record<string, BlockRenderer>>;

export interface EditorContextValue {
	editor: Editor;
	readonly: boolean;
	documentProfile: Editor["documentProfile"];
	editorViewMode: EditorViewMode;
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
