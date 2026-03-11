import React, { useContext } from "react";
import type { Editor } from "@pen/core";
import { EditorContext } from "../../context/editorContext";
import {
	ToolbarContext,
	type ToolbarContextValue,
} from "../../context/toolbarContext";
import { useToolbar } from "../../hooks/useToolbar";
import { renderAsChild, type AsChildProps } from "../../utils/asChild";
import { isDevelopmentEnvironment } from "../../utils/environment";

export interface ToolbarRootProps extends AsChildProps {
	editor?: Editor;
	ref?: React.Ref<HTMLElement>;
}

export function ToolbarRoot(props: ToolbarRootProps) {
	const { editor: editorProp, ...rest } = props;
	const editorContext = useContext(EditorContext);
	const editor = editorProp ?? editorContext?.editor;
	if (!editor) {
		if (isDevelopmentEnvironment()) {
			console.error(
				"Pen: <Pen.Toolbar.Root> must be used within <Pen.Editor.Root> or receive an editor prop.",
			);
		}
		throw new Error("Missing editor for Pen.Toolbar.Root");
	}

	const state = useToolbar(editor);
	const editorContextValue = {
		editor,
		readonly: editorContext?.readonly ?? false,
		documentProfile: editor.documentProfile,
		editorViewMode: editorContext?.editorViewMode ?? editor.editorViewMode,
		importers: editorContext?.importers,
		assets: editorContext?.assets,
		renderers: editorContext?.renderers,
	};

	const ctx: ToolbarContextValue = { editor, state };

	const primitiveProps: Record<string, unknown> = {
		role: "toolbar",
		"aria-label": "Formatting",
		"data-pen-toolbar": "",
	};

	return (
		<EditorContext.Provider value={editorContextValue}>
			<ToolbarContext.Provider value={ctx}>
				{renderAsChild(rest, "div", primitiveProps)}
			</ToolbarContext.Provider>
		</EditorContext.Provider>
	);
}
