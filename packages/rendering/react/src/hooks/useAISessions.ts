import type { Editor } from "@pen/types";
import type { AISession } from "@pen/ai";
import { getAIController } from "@pen/ai";
import { useSyncExternalStoreWithSelector } from "../utils/useSyncExternalStoreWithSelector";

const EMPTY_AI_SESSIONS: readonly AISession[] = [];

export function useAISessions(editor: Editor): readonly AISession[] {
	const controller = getAIController(editor);

	return useSyncExternalStoreWithSelector(
		(callback) => {
			if (!controller) {
				return () => {};
			}
			return controller.subscribeSessions(callback);
		},
		() => controller?.getSessions() ?? EMPTY_AI_SESSIONS,
		() => EMPTY_AI_SESSIONS,
		(sessions) => sessions,
		areSessionsEqual,
	);
}

function areSessionsEqual(
	previous: readonly AISession[],
	next: readonly AISession[],
): boolean {
	if (previous.length !== next.length) {
		return false;
	}
	for (let index = 0; index < previous.length; index += 1) {
		if (previous[index] !== next[index]) {
			return false;
		}
	}
	return true;
}
