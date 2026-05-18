import React, { createContext, useContext } from "react";
import type { Editor } from "@pen/types";
import { useEditorContext } from "../../context/editorContext";
import {
	ToolbarContext,
	type ToolbarContextValue,
} from "../../context/toolbarContext";
import { useToolbar } from "../../hooks/useToolbar";
import {
	useSelectionToolbar,
	type SelectionToolbarState,
} from "../../hooks/useSelectionToolbar";
import { renderAsChild, type AsChildProps } from "../../utils/asChild";
import { isDevelopmentEnvironment } from "../../utils/environment";

export interface SelectionToolbarContextValue {
	editor: Editor;
	toolbar: ToolbarContextValue;
	selectionToolbar: SelectionToolbarState;
}

export const SelectionToolbarContext =
	createContext<SelectionToolbarContextValue | null>(null);

export function useSelectionToolbarContext(): SelectionToolbarContextValue {
	const ctx = useContext(SelectionToolbarContext);
	if (!ctx) {
		if (isDevelopmentEnvironment()) {
			console.error(
				"Pen: useSelectionToolbarContext must be used within <Pen.SelectionToolbar.Root>.",
			);
		}
		throw new Error("Missing Pen.SelectionToolbar.Root context");
	}
	return ctx;
}

export interface SelectionToolbarRootProps extends AsChildProps {
	ref?: React.Ref<HTMLElement>;
}

export function SelectionToolbarRoot(props: SelectionToolbarRootProps) {
	const { ...rest } = props;
	const { editor } = useEditorContext();

	const toolbarState = useToolbar(editor);
	const selectionToolbar = useSelectionToolbar(editor);

	const toolbarCtx: ToolbarContextValue = { editor, state: toolbarState };
	const ctx: SelectionToolbarContextValue = {
		editor,
		toolbar: toolbarCtx,
		selectionToolbar,
	};

	const primitiveProps: Record<string, unknown> = {
		"data-pen-selection-toolbar": "",
		"data-open": selectionToolbar.isOpen || undefined,
	};

	return (
		<ToolbarContext.Provider value={toolbarCtx}>
			<SelectionToolbarContext.Provider value={ctx}>
				{renderAsChild(rest, "div", primitiveProps)}
			</SelectionToolbarContext.Provider>
		</ToolbarContext.Provider>
	);
}
