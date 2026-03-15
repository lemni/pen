import { createContext, useContext } from "react";
import type { Editor } from "@pen/types";
import { isDevelopmentEnvironment } from "../utils/environment";

export interface ToolbarState {
	activeMarks: Record<string, unknown>;
	blockType: string | null;
	blockTypeOptions: Array<{ value: string; label: string }>;
	canBold: boolean;
	canItalic: boolean;
	canUnderline: boolean;
	canStrikethrough: boolean;
	canCode: boolean;
	canLink: boolean;
}

export const EMPTY_TOOLBAR_STATE: ToolbarState = {
	activeMarks: {},
	blockType: null,
	blockTypeOptions: [],
	canBold: false,
	canItalic: false,
	canUnderline: false,
	canStrikethrough: false,
	canCode: false,
	canLink: false,
};

export interface ToolbarContextValue {
	editor: Editor;
	state: ToolbarState;
}

export const ToolbarContext = createContext<ToolbarContextValue | null>(null);

export function useToolbarContext(): ToolbarContextValue {
	const ctx = useContext(ToolbarContext);
	if (!ctx) {
		if (isDevelopmentEnvironment()) {
			console.error(
				"Pen: useToolbarContext must be used within <Pen.Toolbar.Root>.",
			);
		}
		throw new Error("Missing Pen.Toolbar.Root context");
	}
	return ctx;
}
