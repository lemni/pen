import type { Editor } from "@pen/types";
import { getAttachedFieldEditorStore } from "@pen/react";
import { useSyncExternalStore } from "react";
import { serializeEditorState } from "../utils/editorState";

export function useEditorInspector(editor: Editor) {
	return useSyncExternalStore(
		(callback) => subscribeToEditorInspector(editor, callback),
		() => JSON.stringify(serializeEditorState(editor), null, 2),
		() => JSON.stringify(serializeEditorState(editor), null, 2),
	);
}

function subscribeToEditorInspector(
	editor: Editor,
	callback: () => void,
): () => void {
	let frameId: number | null = null;

	const notify = () => {
		if (frameId != null) {
			return;
		}

		frameId = window.requestAnimationFrame(() => {
			frameId = null;
			callback();
		});
	};

	const unsubscribeEditorEvents = [
		editor.on("change", notify),
		editor.on("documentCommit", notify),
		editor.on("selectionChange", notify),
	];
	const fieldEditor = getAttachedFieldEditorStore(editor);
	const unsubscribeFieldEditor = fieldEditor?.subscribe(notify);

	notify();

	return () => {
		if (frameId != null) {
			window.cancelAnimationFrame(frameId);
		}

		for (const unsubscribe of unsubscribeEditorEvents) {
			unsubscribe();
		}

		unsubscribeFieldEditor?.();
	};
}
