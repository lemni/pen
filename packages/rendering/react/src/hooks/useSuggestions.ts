import { useSyncExternalStore } from "react";
import type { Editor } from "@pen/types";
import { getAIController, type PersistentSuggestion } from "@pen/ai";

const EMPTY_SUGGESTIONS: readonly PersistentSuggestion[] = [];

export function useSuggestions(editor: Editor): readonly PersistentSuggestion[] {
	const controller = getAIController(editor);

	return useSyncExternalStore(
		(callback) => {
			if (!controller) {
				return () => {};
			}
			return controller.subscribe(callback);
		},
		() => controller?.getSuggestions() ?? EMPTY_SUGGESTIONS,
		() => EMPTY_SUGGESTIONS,
	);
}
