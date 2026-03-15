import { useEditorContext } from "../context/editorContext";
import { useFieldEditorContext } from "../context/fieldEditorContext";
import type { FieldEditor } from "@pen/types";

export function useFieldEditor(): FieldEditor | null {
  useEditorContext();
  return useFieldEditorContext();
}
