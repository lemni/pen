import { useRef, useEffect } from "react";
import { createEditor } from "@pen/core";
import type { CreateEditorOptions, Editor } from "@pen/types";

export function useEditor(optionsOrEditor?: CreateEditorOptions | Editor): Editor {
  const editorRef = useRef<Editor | null>(null);
  const isOwnedRef = useRef(false);

  if (!editorRef.current) {
    if (optionsOrEditor && "apply" in optionsOrEditor) {
      editorRef.current = optionsOrEditor as Editor;
      isOwnedRef.current = false;
    } else {
      editorRef.current = createEditor(optionsOrEditor);
      isOwnedRef.current = true;
    }
  }

  useEffect(() => {
    return () => {
      if (isOwnedRef.current) {
        editorRef.current?.destroy();
      }
    };
  }, []);

  return editorRef.current;
}
