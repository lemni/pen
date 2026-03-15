import type { Editor } from "@pen/types";
import { getAIController } from "@pen/ai";
import { useAI } from "./useAI";

export function useSuggestMode(editor: Editor): {
	suggestMode: boolean;
	setSuggestMode: (enabled: boolean) => void;
} {
	const state = useAI(editor);
	return {
		suggestMode: state.suggestMode,
		setSuggestMode(enabled: boolean) {
			getAIController(editor)?.setSuggestMode(enabled);
		},
	};
}
