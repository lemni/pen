import type { Editor } from "@pen/types";
import type { GenerationState } from "@pen/ai";
import { useAI } from "./useAI";

export function useGeneration(editor: Editor): GenerationState | null {
	return useAI(editor).activeGeneration;
}
