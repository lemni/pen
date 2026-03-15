import type { Editor } from "@pen/types";
import type {
	AIStreamEvent,
	GenerationState,
	GenerationStructuredPreviewState,
} from "@pen/ai";
import { getAIController } from "@pen/ai";
import {
	areAIStructuredPreviewSelectionsEqual,
	buildAIStructuredPreviewContentItems,
	buildAIStructuredPreviewSelection,
	type AIStructuredPreviewContentItem,
	type AIStructuredPreviewSelection,
} from "../utils/structuredPreview";
import { useSyncExternalStoreWithSelector } from "../utils/useSyncExternalStoreWithSelector";
import { useAI } from "./useAI";

export type { AIStructuredPreviewSelection } from "../utils/structuredPreview";

const EMPTY_STREAM_EVENTS: readonly AIStreamEvent[] = Object.freeze([]);
const EMPTY_STRUCTURED_PREVIEW_SELECTION: AIStructuredPreviewSelection = {
	preview: null,
	patchCount: 0,
};

export function useAIStructuredPreview(
	editor: Editor,
	generation: GenerationState | null,
): AIStructuredPreviewSelection {
	const controller = getAIController(editor);
	const generationId = generation?.id ?? null;
	const fallbackPreview = generation?.structuredPreview ?? null;

	return useSyncExternalStoreWithSelector(
		(callback) => {
			if (!controller) {
				return () => { };
			}
			return controller.subscribeStreamEvents(callback);
		},
		() => controller?.getStreamEvents() ?? EMPTY_STREAM_EVENTS,
		() => EMPTY_STREAM_EVENTS,
		(streamEvents) =>
			buildAIStructuredPreviewSelection(
				streamEvents,
				generationId,
				fallbackPreview,
			),
		areAIStructuredPreviewSelectionsEqual,
	);
}

export function getStructuredPreviewSelection(
	preview: GenerationStructuredPreviewState | null,
): AIStructuredPreviewSelection {
	if (!preview) {
		return EMPTY_STRUCTURED_PREVIEW_SELECTION;
	}
	return {
		preview,
		patchCount: 0,
	};
}

export function useActiveAIStructuredPreview(
	editor: Editor,
): AIStructuredPreviewSelection {
	const aiState = useAI(editor);
	const activeGenerationSelection = useAIStructuredPreview(editor, aiState.activeGeneration);
	if (activeGenerationSelection.preview) {
		return activeGenerationSelection;
	}

	return getStructuredPreviewSelection(
		resolveSessionStructuredPreview(aiState),
	);
}

export interface AIStructuredTargetPreviewSelection {
	target: GenerationStructuredPreviewState["targets"][number] | null;
	preview: GenerationStructuredPreviewState | null;
	patchCount: number;
}

export function useAIStructuredTargetPreview(
	editor: Editor,
	blockId: string,
): AIStructuredTargetPreviewSelection {
	const structuredPreview = useActiveAIStructuredPreview(editor);
	const target =
		structuredPreview.preview?.targets.find((item) => item.blockId === blockId) ?? null;

	return {
		target,
		preview: structuredPreview.preview,
		patchCount: structuredPreview.patchCount,
	};
}

export function useAIStructuredPreviewContent(
	editor: Editor,
	blockIds: readonly string[],
): AIStructuredPreviewContentItem[] {
	const structuredPreview = useActiveAIStructuredPreview(editor);

	return buildAIStructuredPreviewContentItems(blockIds, structuredPreview.preview);
}

function resolveSessionStructuredPreview(
	aiState: ReturnType<typeof useAI>,
): GenerationStructuredPreviewState | null {
	const activeSession =
		aiState.sessions.find((session) => session.id === aiState.activeSessionId) ??
		findVisibleStructuredPreviewSession(aiState);
	if (!activeSession) {
		return null;
	}

	if (activeSession.activeTurnId) {
		const activeTurn =
			activeSession.turns.find((turn) => turn.id === activeSession.activeTurnId) ?? null;
		if (activeTurn && shouldUseSessionStructuredPreview(activeTurn)) {
			return activeTurn.structuredPreview ?? null;
		}
	}

	for (let index = activeSession.turns.length - 1; index >= 0; index -= 1) {
		const turn = activeSession.turns[index]!;
		if (shouldUseSessionStructuredPreview(turn)) {
			return turn.structuredPreview ?? null;
		}
	}

	return null;
}

function findVisibleStructuredPreviewSession(
	aiState: ReturnType<typeof useAI>,
): ReturnType<typeof useAI>["sessions"][number] | null {
	for (let index = aiState.sessions.length - 1; index >= 0; index -= 1) {
		const session = aiState.sessions[index]!;
		if (session.pendingReviewItemIds.length > 0) {
			return session;
		}
		for (let turnIndex = session.turns.length - 1; turnIndex >= 0; turnIndex -= 1) {
			if (shouldUseSessionStructuredPreview(session.turns[turnIndex] ?? null)) {
				return session;
			}
		}
	}

	return null;
}

function shouldUseSessionStructuredPreview(
	turn:
		| ReturnType<typeof useAI>["sessions"][number]["turns"][number]
		| null,
): boolean {
	if (!turn?.structuredPreview) {
		return false;
	}
	return (
		turn.status === "streaming" ||
		turn.status === "review" ||
		turn.status === "complete"
	);
}
