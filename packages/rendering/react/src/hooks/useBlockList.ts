import type { Editor } from "@pen/types";
import { getRootBlockIds } from "../utils/parentIdTree";
import { useSyncExternalStoreWithSelector } from "../utils/useSyncExternalStoreWithSelector";

const SSR_BLOCK_ORDER: readonly string[] = [];

export function useBlockList(editor: Editor): readonly string[] {
  return useSyncExternalStoreWithSelector(
    (callback) => editor.onDocumentCommit(callback),
    () => editor.documentState.blockOrder,
    () => SSR_BLOCK_ORDER,
    () => getRootBlockIds(editor),
    areBlockListsEqual,
  );
}

function areBlockListsEqual(
  previous: readonly string[],
  next: readonly string[],
): boolean {
  if (previous.length !== next.length) return false;
  for (let index = 0; index < previous.length; index += 1) {
    if (previous[index] !== next[index]) return false;
  }
  return true;
}
