import type { ModelMessage, ModelMessagePart } from "@pen/types";

export interface ToolJournalEntry {
	toolCallId: string;
	toolName: string;
	input: unknown;
	output: unknown;
	isError?: boolean;
}

export interface BuildAgentMessagesInput {
	prompt: string;
	workingSet: string | null;
	toolResults: ToolJournalEntry[];
}

const MAX_OBJECT_KEYS = 8;
const MAX_ARRAY_ITEMS = 8;
const MAX_STRING_LENGTH = 1_200;

export function buildAgentMessages(
	input: BuildAgentMessagesInput,
): ModelMessage[] {
	const intro = input.workingSet
		? `${input.workingSet}\n\nUser request:\n${input.prompt}`
		: input.prompt;
	const messages: ModelMessage[] = [{ role: "user", content: intro }];

	for (const toolResult of input.toolResults) {
		messages.push({
			role: "assistant",
			content: [{
				type: "tool-call",
				toolCallId: toolResult.toolCallId,
				toolName: toolResult.toolName,
				input: toolResult.input,
			}],
		});
		messages.push({
			role: "tool",
			content: [{
				type: "tool-result",
				toolCallId: toolResult.toolCallId,
				result: compactToolResult(toolResult.output),
				isError: toolResult.isError,
			}],
		});
	}

	return messages;
}

export function buildAssistantToolCallParts(
	toolCalls: ToolJournalEntry[],
	passTextBuffer: string,
): ModelMessagePart[] {
	const parts: ModelMessagePart[] = [];
	if (passTextBuffer.length > 0) {
		parts.push({ type: "text", text: passTextBuffer });
	}
	return [
		...parts,
		...toolCalls.map<ModelMessagePart>((toolCall) => ({
			type: "tool-call",
			toolCallId: toolCall.toolCallId,
			toolName: toolCall.toolName,
			input: toolCall.input,
		})),
	];
}

export function compactToolResult(value: unknown): unknown {
	if (typeof value === "string") {
		return value.length <= MAX_STRING_LENGTH
			? value
			: `${value.slice(0, MAX_STRING_LENGTH).trimEnd()}…`;
	}
	if (Array.isArray(value)) {
		return value.slice(0, MAX_ARRAY_ITEMS).map((entry) => compactToolResult(entry));
	}
	if (value && typeof value === "object") {
		const entries = Object.entries(value as Record<string, unknown>).slice(
			0,
			MAX_OBJECT_KEYS,
		);
		return Object.fromEntries(
			entries.map(([key, entryValue]) => [key, compactToolResult(entryValue)]),
		);
	}
	return value;
}
