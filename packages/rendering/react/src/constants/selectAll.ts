import type { DocumentProfile } from "@pen/core";

export type EditorSelectAllBehavior = "document-first" | "block-first";

export const DEFAULT_SELECT_ALL_BEHAVIOR: EditorSelectAllBehavior =
	"document-first";

export function resolveSelectAllBehavior(
	documentProfile: DocumentProfile,
	override?: EditorSelectAllBehavior,
): EditorSelectAllBehavior {
	if (override) {
		return override;
	}
	return documentProfile === "flow" ? "document-first" : "block-first";
}
