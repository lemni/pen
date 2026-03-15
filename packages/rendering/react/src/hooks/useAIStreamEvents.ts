import { useSyncExternalStore } from "react";
import type { Editor } from "@pen/types";
import { getAIController, type AIStreamEvent } from "@pen/ai";

const EMPTY_STREAM_EVENTS: readonly AIStreamEvent[] = Object.freeze([]);

export function useAIStreamEvents(editor: Editor): readonly AIStreamEvent[] {
	const controller = getAIController(editor);

	return useSyncExternalStore(
		(callback) => {
			if (!controller) {
				return () => {};
			}
			return controller.subscribeStreamEvents(callback);
		},
		() => controller?.getStreamEvents() ?? EMPTY_STREAM_EVENTS,
		() => EMPTY_STREAM_EVENTS,
	);
}
