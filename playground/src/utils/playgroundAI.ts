import type {
	Editor,
	ModelAdapter,
	ModelMessage,
	ModelMessagePart,
} from "@pen/types";
import {
	streamPlaygroundAIResponse,
} from "./playgroundAISession";
import { logAutocompleteDebug } from "./autocompleteDebug";

export function createPlaygroundAIModel(
	getEditor: () => Editor | null,
): ModelAdapter {
	return {
		capabilities: {
			structuredIntent: true,
		},
		async *stream(options) {
			try {
				const editor = getEditor();

				if (!editor) {
					logAutocompleteDebug("model stream aborted: editor unavailable");
					yield {
						type: "error",
						error: new Error("The playground editor is not ready yet."),
					} as const;
					return;
				}

				const prompt = getLatestPrompt(options.messages);
				const isolatedSession = isInlineAutocompleteRequest(options.messages);
				logAutocompleteDebug("model stream started", {
					promptPreview: prompt.slice(0, 160),
					promptLength: prompt.length,
					isolatedSession,
				});
				for await (const chunk of streamPlaygroundAIResponse(
					editor,
					prompt,
					options.signal,
					{ isolatedSession },
				)) {
					logAutocompleteDebug("model stream chunk", {
						type: chunk.type ?? "unknown",
						deltaLength:
							typeof chunk.delta === "string" ? chunk.delta.length : null,
						error:
							typeof chunk.error === "string"
								? chunk.error
								: chunk.error instanceof Error
									? chunk.error.message
									: null,
					});

					if (chunk.type === "text-delta" && typeof chunk.delta === "string") {
						yield {
							type: "text-delta",
							delta: chunk.delta,
						} as const;
						continue;
					}

					if (
						(chunk.type === "app-partial" ||
							chunk.type === "app-final") &&
						chunk.data !== undefined
					) {
						yield {
							type: "structured-data",
							contract: "app",
							data: chunk.data,
							final: chunk.type === "app-final",
						} as const;
						continue;
					}

					if (chunk.type === "done") {
						logAutocompleteDebug("model stream done");
						yield { type: "done" as const };
						return;
					}

					if (chunk.type === "error") {
						logAutocompleteDebug("model stream error chunk", {
							error:
								typeof chunk.error === "string"
									? chunk.error
									: chunk.error instanceof Error
										? chunk.error.message
										: chunk.error,
						});
						yield {
							type: "error",
							error:
								typeof chunk.error === "string"
									? new Error(chunk.error)
									: chunk.error,
						} as const;
						return;
					}
				}

				logAutocompleteDebug("model stream ended without terminal chunk");
				yield { type: "done" as const };
			} catch (error) {
				if (options.signal?.aborted) {
					logAutocompleteDebug("model stream aborted by signal");
					return;
				}

				logAutocompleteDebug("model stream threw", {
					error: error instanceof Error ? error.message : String(error),
				});
				yield {
					type: "error",
					error,
				} as const;
			}
		},
	};
}

function getLatestPrompt(messages: ModelMessage[]): string {
	const lastMessage = messages[messages.length - 1];
	if (!lastMessage) {
		return "";
	}
	return flattenMessageContent(lastMessage.content).trim();
}

function isInlineAutocompleteRequest(messages: ModelMessage[]): boolean {
	const systemMessage = messages[0];
	if (!systemMessage || systemMessage.role !== "system") {
		return false;
	}
	const systemContent = flattenMessageContent(systemMessage.content);
	return systemContent.includes("You are generating inline editor autocomplete.");
}

function flattenMessageContent(content: string | ModelMessagePart[]): string {
	if (typeof content === "string") {
		return content;
	}

	const textParts = content.flatMap((part) => {
		if (part.type === "text") {
			return [part.text];
		}
		if (part.type === "tool-result") {
			return [String(part.result ?? "")];
		}
		return [];
	});

	return textParts.join("\n");
}
