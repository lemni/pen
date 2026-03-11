import React from "react";
import type { Editor } from "@pen/core";
import { EditorRoot, type EditorRootProps } from "./primitives/editor/root";
import { EditorContent, type EditorContentProps } from "./primitives/editor/content";

export interface PenEditorProps
	extends Omit<EditorRootProps, "children">,
	Omit<EditorContentProps, "children"> {
	children?: React.ReactNode;
}

export function PenEditor(props: PenEditorProps) {
	const {
		editor,
		readonly,
		importers,
		assets,
		renderers,
		selectAllBehavior,
		editorViewMode,
		virtualize,
		emptyPlaceholder,
		children,
		...rest
	} = props;

	return (
		<EditorRoot
			editor={editor}
			readonly={readonly}
			importers={importers}
			assets={assets}
			renderers={renderers}
			selectAllBehavior={selectAllBehavior}
			editorViewMode={editorViewMode}
		>
			<EditorContent
				virtualize={virtualize}
				emptyPlaceholder={emptyPlaceholder}
				{...rest}
			>
				{children}
			</EditorContent>
		</EditorRoot>
	);
}
