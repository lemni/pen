import type { DocumentOp, Editor, OpOrigin } from "@pen/types";
import { getOpOriginType } from "@pen/types";
import { createSuggestionMark } from "./persistent";
import type { BlockSuggestionMeta } from "../types";

export const SUGGESTION_RESOLUTION_ORIGIN = "suggestion-resolution";
export const AI_SESSION_SUGGESTION_ORIGIN = "ai-session";

const BYPASS_ORIGINS = new Set([
	AI_SESSION_SUGGESTION_ORIGIN,
	"collaborator",
	"history",
	"import",
	"system",
	"extension",
	SUGGESTION_RESOLUTION_ORIGIN,
]);

export function shouldBypassSuggestMode(origin?: OpOrigin): boolean {
	return origin != null && BYPASS_ORIGINS.has(getOpOriginType(origin));
}

export function interceptApplyForSuggestMode(
	ops: DocumentOp[],
	editor: Editor,
	author: string,
	authorType: "user" | "ai",
	model?: string,
	sessionId?: string,
): DocumentOp[] {
	const intercepted: DocumentOp[] = [];

	for (const op of ops) {
		switch (op.type) {
			case "insert-text": {
				intercepted.push({
					...op,
					marks: {
						...(op.marks ?? {}),
						...createSuggestionMark(
							"insert",
							author,
							authorType,
							model,
							sessionId,
						),
					},
				});
				break;
			}

			case "replace-text": {
				if (op.length > 0) {
					intercepted.push({
						type: "format-text",
						blockId: op.blockId,
						offset: op.offset,
						length: op.length,
						marks: createSuggestionMark(
							"delete",
							author,
							authorType,
							model,
							sessionId,
						),
					});
				}
				if (op.text.length > 0) {
					intercepted.push({
						type: "insert-text",
						blockId: op.blockId,
						offset: op.offset + op.length,
						text: op.text,
						marks: {
							...(op.marks ?? {}),
							...createSuggestionMark(
								"insert",
								author,
								authorType,
								model,
								sessionId,
							),
						},
					});
				}
				break;
			}

			case "delete-text": {
				intercepted.push({
					type: "format-text",
					blockId: op.blockId,
					offset: op.offset,
					length: op.length,
					marks: createSuggestionMark(
						"delete",
						author,
						authorType,
						model,
						sessionId,
					),
				});
				break;
			}

			case "insert-block": {
				intercepted.push(op);
				intercepted.push({
					type: "set-meta",
					blockId: op.blockId,
					namespace: "suggestion",
					data: createBlockSuggestionMeta(
						"insert-block",
						author,
						authorType,
						model,
						undefined,
						sessionId,
					),
				});
				break;
			}

			case "delete-block": {
				intercepted.push({
					type: "set-meta",
					blockId: op.blockId,
					namespace: "suggestion",
					data: createBlockSuggestionMeta(
						"delete-block",
						author,
						authorType,
						model,
						undefined,
						sessionId,
					),
				});
				break;
			}

			case "move-block": {
				const block = editor.getBlock(op.blockId);
				const layoutParent = block?.layoutParent();
				intercepted.push(op);
				intercepted.push({
					type: "set-meta",
					blockId: op.blockId,
					namespace: "suggestion",
					data: createBlockSuggestionMeta(
						"move-block",
						author,
						authorType,
						model,
						{
							position: layoutParent
								? {
										parent: layoutParent.id,
										index: block?.index ?? 0,
									}
								: block?.prev
									? { after: block.prev.id }
									: "first",
						},
						sessionId,
					),
				});
				break;
			}

			case "convert-block": {
				const block = editor.getBlock(op.blockId);
				intercepted.push(op);
				intercepted.push({
					type: "set-meta",
					blockId: op.blockId,
					namespace: "suggestion",
					data: createBlockSuggestionMeta(
						"convert-block",
						author,
						authorType,
						model,
						{
							type: block?.type,
							props: block ? { ...block.props } : undefined,
						},
						sessionId,
					),
				});
				break;
			}

			default:
				intercepted.push(op);
		}
	}

	return intercepted;
}

function createBlockSuggestionMeta(
	action: BlockSuggestionMeta["action"],
	author: string,
	authorType: "user" | "ai",
	model?: string,
	previousState?: BlockSuggestionMeta["previousState"],
	sessionId?: string,
): Record<string, unknown> {
	return {
		id: crypto.randomUUID(),
		action,
		author,
		authorType,
		createdAt: Date.now(),
		model,
		previousState,
		sessionId,
	};
}
