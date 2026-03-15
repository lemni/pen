import { useRef, useSyncExternalStore } from "react";
import type { Editor } from "@pen/types";
import {
	computeDocumentEmpty,
	computeDocumentPlaceholderVisible,
} from "../utils/editorEmptyState";

export function useDocumentEmptyState(editor: Editor): boolean {
	const snapshotRef = useRef(computeDocumentEmpty(editor));

	return useSyncExternalStore(
		(callback) => editor.onDocumentCommit(() => callback()),
		() => {
			const nextSnapshot = computeDocumentEmpty(editor);
			if (snapshotRef.current === nextSnapshot) {
				return snapshotRef.current;
			}
			snapshotRef.current = nextSnapshot;
			return nextSnapshot;
		},
		() => false,
	);
}

export function useDocumentPlaceholderState(editor: Editor): boolean {
	const snapshotRef = useRef(computeDocumentPlaceholderVisible(editor));

	return useSyncExternalStore(
		(callback) => editor.onDocumentCommit(() => callback()),
		() => {
			const nextSnapshot = computeDocumentPlaceholderVisible(editor);
			if (snapshotRef.current === nextSnapshot) {
				return snapshotRef.current;
			}
			snapshotRef.current = nextSnapshot;
			return nextSnapshot;
		},
		() => false,
	);
}
