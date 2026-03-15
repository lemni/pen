import { useMemo } from "react";
import type { Editor } from "@pen/types";
import type { AIStreamEvent } from "@pen/ai";
import { useAI } from "./useAI";
import { useAISessions } from "./useAISessions";
import { useActiveAISession } from "./useActiveAISession";
import { useAIStreamEvents } from "./useAIStreamEvents";
import { useSuggestions } from "./useSuggestions";

export interface AIDebugLogEntry {
	id: string;
	type: AIStreamEvent["type"];
	generationId: string;
	sessionId: string | null;
	timestamp: number;
	label: string;
	detail: string | null;
}

export interface AIDebugLogState {
	status: string;
	activeGenerationId: string | null;
	activeSessionId: string | null;
	fastApplySessionId: string | null;
	sessionCount: number;
	pendingSuggestionCount: number;
	pendingReviewItemCount: number;
	activeSessionFastApply: AIDebugLogFastApplyMetrics | null;
	aggregateFastApply: AIDebugLogFastApplyMetrics;
	entries: readonly AIDebugLogEntry[];
}

export interface AIDebugLogFastApplyMetrics {
	attemptCount: number;
	nativeFastApplyCount: number;
	scopedReplacementCount: number;
	plainMarkdownCount: number;
	failedCount: number;
}

export interface UseAIDebugLogOptions {
	sessionId?: string;
}

export function useAIDebugLog(
	editor: Editor,
	options: UseAIDebugLogOptions = {},
): AIDebugLogState {
	const aiState = useAI(editor);
	const sessions = useAISessions(editor);
	const activeSession = useActiveAISession(editor);
	const streamEvents = useAIStreamEvents(editor);
	const suggestions = useSuggestions(editor);

	return useMemo(() => {
		const pendingReviewItemCount = aiState.activeGeneration?.reviewItems?.length ?? 0;
		const entries = streamEvents.map((event, index) =>
			buildDebugLogEntry(event, index),
		);
		const fastApplySession =
			sessions.find((session) =>
				options.sessionId ? session.id === options.sessionId : session.id === activeSession?.id,
			) ?? null;
		const aggregateFastApply = sessions.reduce<AIDebugLogFastApplyMetrics>(
			(accumulator, session) => ({
				attemptCount:
					accumulator.attemptCount + session.metrics.fastApply.attemptCount,
				nativeFastApplyCount:
					accumulator.nativeFastApplyCount +
					session.metrics.fastApply.nativeFastApplyCount,
				scopedReplacementCount:
					accumulator.scopedReplacementCount +
					session.metrics.fastApply.scopedReplacementCount,
				plainMarkdownCount:
					accumulator.plainMarkdownCount +
					session.metrics.fastApply.plainMarkdownCount,
				failedCount:
					accumulator.failedCount + session.metrics.fastApply.failedCount,
			}),
			createEmptyFastApplyMetrics(),
		);

		return {
			status: aiState.status,
			activeGenerationId: aiState.activeGeneration?.id ?? null,
			activeSessionId: activeSession?.id ?? null,
			fastApplySessionId: fastApplySession?.id ?? null,
			sessionCount: sessions.length,
			pendingSuggestionCount: suggestions.length,
			pendingReviewItemCount,
			activeSessionFastApply: fastApplySession
				? {
						...fastApplySession.metrics.fastApply,
					}
				: null,
			aggregateFastApply,
			entries,
		} satisfies AIDebugLogState;
	}, [
		options.sessionId,
		activeSession?.id,
		aiState.activeGeneration?.id,
		aiState.activeGeneration?.reviewItems?.length,
		aiState.status,
		sessions,
		streamEvents,
		suggestions.length,
	]);
}

function createEmptyFastApplyMetrics(): AIDebugLogFastApplyMetrics {
	return {
		attemptCount: 0,
		nativeFastApplyCount: 0,
		scopedReplacementCount: 0,
		plainMarkdownCount: 0,
		failedCount: 0,
	};
}

function buildDebugLogEntry(
	event: AIStreamEvent,
	index: number,
): AIDebugLogEntry {
	return {
		id: `${event.generationId}:${event.type}:${index}`,
		type: event.type,
		generationId: event.generationId,
		sessionId: event.sessionId ?? null,
		timestamp: event.timestamp,
		label: describeEvent(event),
		detail: describeEventDetail(event),
	};
}

function describeEvent(event: AIStreamEvent): string {
	switch (event.type) {
		case "generation-start":
			return "Generation started";
		case "generation-finish":
			return "Generation finished";
		case "status":
			return `Status: ${event.status}`;
		case "text-delta":
			return "Text delta";
		case "tool-call":
			return `Tool call: ${event.toolName}`;
		case "tool-output":
			return `Tool output: ${event.toolName}`;
		case "tool-result":
			return `Tool result: ${event.toolName}`;
		case "structured-preview":
			return "Structured preview";
	}

	return "Unknown event";
}

function describeEventDetail(event: AIStreamEvent): string | null {
	switch (event.type) {
		case "generation-start":
			return event.prompt || null;
		case "generation-finish":
			return `${event.status}: ${truncateString(event.text)}`;
		case "status":
			return null;
		case "text-delta":
			return `${event.delta.length} chars`;
		case "tool-call":
			return safeStringify(event.input);
		case "tool-output":
			return truncateString(event.output);
		case "tool-result":
			return `${event.state}: ${truncateString(event.output)}`;
		case "structured-preview":
			return `${event.patches.length} patches`;
	}

	return null;
}

function safeStringify(value: unknown): string | null {
	if (value == null) {
		return null;
	}

	try {
		return truncateString(JSON.stringify(value));
	} catch {
		return truncateString(String(value));
	}
}

function truncateString(value: unknown): string {
	const text = typeof value === "string" ? value : String(value);
	return text.length > 140 ? `${text.slice(0, 137)}...` : text;
}
