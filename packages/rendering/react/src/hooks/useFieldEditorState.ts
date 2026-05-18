import { useRef, useSyncExternalStore } from "react";
import type {
	FieldEditorStore,
	FieldEditorStoreSnapshot,
} from "../field-editor/store";

const EMPTY_FIELD_EDITOR_STATE: FieldEditorStoreSnapshot = {
	focusBlockId: null,
	activeBlockIds: [],
	isEditing: false,
	isFocused: false,
	isComposing: false,
	domSyncVersion: 0,
	inputMode: "none",
	mode: "inactive",
	activeCellCoord: null,
};

export function useFieldEditorState(
	fieldEditor: FieldEditorStore | null,
): FieldEditorStoreSnapshot {
	const snapshotRef = useRef<FieldEditorStoreSnapshot>(
		EMPTY_FIELD_EDITOR_STATE,
	);

	return useSyncExternalStore(
		(callback) => {
			if (!fieldEditor) return () => {};
			return fieldEditor.subscribe(callback);
		},
		() => {
			if (!fieldEditor) {
				snapshotRef.current = EMPTY_FIELD_EDITOR_STATE;
				return EMPTY_FIELD_EDITOR_STATE;
			}

			const nextSnapshot = fieldEditor.getSnapshot();

			const prevSnapshot = snapshotRef.current;
			if (
				prevSnapshot.focusBlockId === nextSnapshot.focusBlockId &&
				prevSnapshot.activeBlockIds === nextSnapshot.activeBlockIds &&
				prevSnapshot.isEditing === nextSnapshot.isEditing &&
				prevSnapshot.isFocused === nextSnapshot.isFocused &&
				prevSnapshot.isComposing === nextSnapshot.isComposing &&
				prevSnapshot.domSyncVersion === nextSnapshot.domSyncVersion &&
				prevSnapshot.inputMode === nextSnapshot.inputMode &&
				prevSnapshot.mode === nextSnapshot.mode &&
				prevSnapshot.activeCellCoord === nextSnapshot.activeCellCoord
			) {
				return prevSnapshot;
			}

			snapshotRef.current = nextSnapshot;
			return nextSnapshot;
		},
		() => EMPTY_FIELD_EDITOR_STATE,
	);
}
