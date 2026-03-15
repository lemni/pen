import type { BlockDecoration } from "@pen/types";
import type { GenerationState } from "../types";

export function buildGenerationZoneDecorations(
	generation: GenerationState | null,
): BlockDecoration[] {
	if (!generation) return [];
	return [{
		type: "block",
		blockId: generation.blockId,
		attributes: {
			"ai-generating": generation.status === "streaming",
			"data-generationZone-id": generation.zoneId,
			"data-generation-status": generation.status,
		},
	}];
}
