import { DocumentRangeImpl } from "@pen/core";
import type { Editor } from "@pen/types";
import type { SelectionPoint } from "../field-editor/selectionBridge";
import {
	getEditorFlowCapability,
	shouldFallbackMixedSelectionToBlock,
} from "./flowCapabilities";

type DomSelectionPoints = {
	anchor: SelectionPoint;
	focus: SelectionPoint;
};

type NormalizedSelectionIntent =
	| {
			type: "text";
			anchor: SelectionPoint;
			focus: SelectionPoint;
	  }
	| {
			type: "block";
			blockIds: string[];
	  };

export function normalizeSelectionFormation(
	editor: Editor,
	selection: DomSelectionPoints,
): NormalizedSelectionIntent {
	if (selection.anchor.blockId === selection.focus.blockId) {
		return {
			type: "text",
			anchor: selection.anchor,
			focus: selection.focus,
		};
	}

	const blockIds = new DocumentRangeImpl(
		selection.anchor,
		selection.focus,
		editor.internals.doc,
	).blockRange;
	const shouldFallbackToBlockSelection = blockIds.some((blockId) => {
		return shouldFallbackMixedSelectionToBlock(
			editor.documentProfile,
			getEditorFlowCapability(editor, blockId),
		);
	});

	if (shouldFallbackToBlockSelection) {
		return {
			type: "block",
			blockIds,
		};
	}

	return {
		type: "text",
		anchor: selection.anchor,
		focus: selection.focus,
	};
}
