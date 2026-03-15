import type { Editor } from "@pen/types";
import { useEffect, useSyncExternalStore } from "react";
import {
	cancelQueuedPlaygroundAISessionSync,
	ensurePlaygroundAISession,
	type PlaygroundAIClientState,
	getPlaygroundAIStateSnapshot,
	queuePlaygroundAISessionSync,
	subscribeToPlaygroundAIState,
} from "../utils/playgroundAISession";

export function usePlaygroundAISession(editor: Editor | null): void {
	useEffect(() => {
		if (!editor) {
			return;
		}
		void ensurePlaygroundAISession()
			.then(() => {
				queuePlaygroundAISessionSync(editor, "initial");
			})
			.catch(() => {
				// Surface session errors through the shared store.
			});

		const scheduleSync = () => {
			queuePlaygroundAISessionSync(editor);
		};

		const unsubscribeEditorEvents = [
			editor.on("change", scheduleSync),
			editor.on("documentCommit", scheduleSync),
			editor.on("selectionChange", scheduleSync),
		];

		return () => {
			cancelQueuedPlaygroundAISessionSync();
			for (const unsubscribe of unsubscribeEditorEvents) {
				unsubscribe();
			}
		};
	}, [editor]);
}

export function usePlaygroundAIState(): PlaygroundAIClientState {
	return useSyncExternalStore(
		subscribeToPlaygroundAIState,
		getPlaygroundAIStateSnapshot,
		getPlaygroundAIStateSnapshot,
	);
}
