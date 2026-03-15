import type {
	BlockDecoration,
	Decoration,
	Editor,
	InlineDecoration,
} from "@pen/types";
import { readBlockSuggestionMeta } from "../suggestions/persistent";

interface YTextLike {
	toDelta(): Array<{
		insert: string | object;
		attributes?: Record<string, unknown>;
	}>;
}

export function buildTrackChangesDecorations(editor: Editor): Decoration[] {
	const decorations: Decoration[] = [];

	for (const block of editor.documentState.allBlocks()) {
		const blockSuggestion = readBlockSuggestionMeta(block);
		if (blockSuggestion) {
			const blockDecoration: BlockDecoration = {
				type: "block",
				blockId: block.id,
				attributes: {
					class: `pen-block-suggestion pen-block-suggestion-${blockSuggestion.action}`,
					"data-suggestion-id": blockSuggestion.id,
					"data-suggestion-action": blockSuggestion.action,
					"data-suggestion-author-type": blockSuggestion.authorType,
				},
			};
			decorations.push(blockDecoration);
		}

		const ytext = editor.internals.getBlockText(block.id) as YTextLike | null;
		if (!ytext || typeof ytext.toDelta !== "function") {
			continue;
		}

		let offset = 0;
		for (const delta of ytext.toDelta()) {
			const length = typeof delta.insert === "string" ? delta.insert.length : 1;
			const suggestion = delta.attributes?.suggestion as
				| Record<string, unknown>
				| undefined;
			if (suggestion && typeof suggestion.id === "string") {
				const inlineDecoration: InlineDecoration = {
					type: "inline",
					blockId: block.id,
					from: offset,
					to: offset + length,
					attributes: {
						class: `pen-suggestion-${String(suggestion.action ?? "insert")}`,
						"data-suggestion-id": suggestion.id,
						"data-suggestion-action": String(suggestion.action ?? "insert"),
						"data-suggestion-author": String(suggestion.author ?? ""),
						"data-suggestion-author-type": String(
							suggestion.authorType ?? "user",
						),
					},
				};
				decorations.push(inlineDecoration);
			}
			offset += length;
		}
	}

	return decorations;
}
