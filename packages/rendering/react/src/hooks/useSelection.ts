import { useSyncExternalStore } from "react";
import type { Editor, SelectionState } from "@pen/types";

export function useSelection(editor: Editor): SelectionState {
  return useSyncExternalStore(
    (callback) => editor.on("selectionChange", callback),
    () => editor.selection,
    () => null,
  );
}
