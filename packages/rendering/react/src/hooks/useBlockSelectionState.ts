import type { Editor, SelectionState } from "@pen/types";
import { useSyncExternalStoreWithSelector } from "../utils/useSyncExternalStoreWithSelector";

export function useBlockSelectionState(
	editor: Editor,
	blockId: string,
): boolean {
	return useSyncExternalStoreWithSelector(
		(callback) => editor.on("selectionChange", callback),
		() => editor.selection,
		() => null,
		(selection) => isBlockSelected(selection, blockId),
	);
}

function isBlockSelected(selection: SelectionState, blockId: string): boolean {
	return (
		(selection?.type === "block" && selection.blockIds.includes(blockId)) ||
		(selection?.type === "text" && selection.blockRange.includes(blockId))
	);
}
