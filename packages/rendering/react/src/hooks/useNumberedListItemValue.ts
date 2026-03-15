import { useSyncExternalStore } from "react";
import {
  getNumberedListItemValue as getOrderedListValue,
} from "@pen/core";
import type { BlockHandle } from "@pen/types";
import { useEditorContext } from "../context/editorContext";

export function useNumberedListItemValue(block: BlockHandle): number {
  const { editor } = useEditorContext();
  const fallbackValue = getOrderedListValue(block) ?? 1;

  return useSyncExternalStore(
    (callback) => editor.onDocumentCommit(() => callback()),
    () => getOrderedListValue(editor.getBlock(block.id)) ?? fallbackValue,
    () => fallbackValue,
  );
}
