import type { Decoration } from "@pen/types";
import { EphemeralSuggestionManager } from "../suggestions/ephemeral";

export function buildEphemeralDecorations(
	manager: EphemeralSuggestionManager,
): Decoration[] {
	return manager.toDecorations();
}
