import type { Editor, FieldEditor } from "@pen/types";
import { FIELD_EDITOR_SLOT_KEY } from "@pen/types";
import { FIELD_EDITOR_SLOT_KEY as REACT_FIELD_EDITOR_SLOT_KEY } from "../constants/fieldEditor";
import type { FieldEditorStore } from "../field-editor/store";

export function getAttachedFieldEditor(editor: Editor): FieldEditor | null {
	return editor.internals.getSlot<FieldEditor>(FIELD_EDITOR_SLOT_KEY) ?? null;
}

export function getAttachedFieldEditorStore(
	editor: Editor,
): FieldEditorStore | null {
	return (
		editor.internals.getSlot<FieldEditorStore>(REACT_FIELD_EDITOR_SLOT_KEY) ?? null
	);
}
