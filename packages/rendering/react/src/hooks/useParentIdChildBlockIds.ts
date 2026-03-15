import type { Editor } from "@pen/types";
import { useSyncExternalStoreWithSelector } from "../utils/useSyncExternalStoreWithSelector";
import { getParentIdChildBlockIds } from "../utils/parentIdTree";

const SSR_BLOCK_ORDER: readonly string[] = [];

export function useParentIdChildBlockIds(
	editor: Editor,
	parentBlockId: string,
): readonly string[] {
	return useSyncExternalStoreWithSelector(
		(callback) => editor.onDocumentCommit(callback),
		() => editor.documentState.blockOrder,
		() => SSR_BLOCK_ORDER,
		() => getParentIdChildBlockIds(editor, parentBlockId),
		areBlockListsEqual,
	);
}

function areBlockListsEqual(
	previous: readonly string[],
	next: readonly string[],
): boolean {
	if (previous.length !== next.length) return false;
	for (let index = 0; index < previous.length; index += 1) {
		if (previous[index] !== next[index]) return false;
	}
	return true;
}
