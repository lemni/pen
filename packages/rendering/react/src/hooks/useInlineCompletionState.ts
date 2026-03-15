import type { Editor, InlineCompletionSuggestion } from "@pen/types";
import { getInlineCompletionController } from "@pen/core";
import { useSyncExternalStoreWithSelector } from "../utils/useSyncExternalStoreWithSelector";

export function useInlineCompletionState(
	editor: Editor,
): InlineCompletionSuggestion | null {
	return useSyncExternalStoreWithSelector(
		(callback) => {
			const controller = getInlineCompletionController(editor);
			if (!controller) {
				return () => { };
			}
			return controller.subscribe(callback);
		},
		() => getInlineCompletionState(editor),
		() => null,
		(state) => state?.visibleSuggestion ?? null,
		Object.is,
	);
}

function getInlineCompletionState(editor: Editor) {
	return getInlineCompletionController(editor)?.getState() ?? null;
}
