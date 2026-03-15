import type { Editor } from "@pen/types";
import type { AISession } from "@pen/ai";
import { getAIController } from "@pen/ai";
import { useSyncExternalStoreWithSelector } from "../utils/useSyncExternalStoreWithSelector";

export function useActiveAISession(editor: Editor): AISession | null {
	const controller = getAIController(editor);

	return useSyncExternalStoreWithSelector(
		(callback) => {
			if (!controller) {
				return () => {};
			}
			return controller.subscribeSessions(callback);
		},
		() => controller?.getState() ?? null,
		() => null,
		(state) => state?.sessions.find((session) => session.id === state.activeSessionId) ?? null,
	);
}
