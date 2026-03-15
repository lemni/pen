import { useSyncExternalStore } from "react";
import type { Editor } from "@pen/types";
import { getAIController, type AIControllerState } from "@pen/ai";

const EMPTY_AI_STATE: AIControllerState = {
	status: "idle",
	activeGeneration: null,
	sessions: [],
	activeSessionId: null,
	suggestMode: false,
	ephemeralSuggestion: null,
	commandMenuOpen: false,
};

export function useAI(editor: Editor): AIControllerState {
	const controller = getAIController(editor);

	return useSyncExternalStore(
		(callback) => {
			if (!controller) {
				return () => {};
			}
			return controller.subscribe(callback);
		},
		() => controller?.getState() ?? EMPTY_AI_STATE,
		() => EMPTY_AI_STATE,
	);
}
