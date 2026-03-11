import type { InteractionModel } from "@pen/core";

export type EditorSelectAllBehavior = "document-first" | "block-first";

export const DEFAULT_SELECT_ALL_BEHAVIOR: EditorSelectAllBehavior =
	"document-first";

export function resolveSelectAllBehavior(
	interactionModel: InteractionModel,
): EditorSelectAllBehavior {
	return interactionModel === "block-first"
		? "block-first"
		: DEFAULT_SELECT_ALL_BEHAVIOR;
}
