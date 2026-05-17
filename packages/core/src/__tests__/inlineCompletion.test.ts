import {
	INLINE_COMPLETION_VISIBLE_BLOCK_ATTRIBUTE,
	type BlockDecoration,
	type InlineDecoration,
} from "@pen/types";
import { describe, expect, it } from "vitest";
import { createEditor, ensureInlineCompletionController } from "../index";

const noDefaultExtensionsPreset = {
	resolve() {
		return { extensions: [] };
	},
};

describe("inline completion decorations", () => {
	it("marks the suggestion block while an inline suggestion is visible", () => {
		const editor = createEditor({ preset: noDefaultExtensionsPreset });
		const blockId = editor.firstBlock()!.id;
		const inlineCompletion = ensureInlineCompletionController(editor);

		try {
			editor.apply([{ type: "insert-text", blockId, offset: 0, text: "Hello" }]);
			inlineCompletion.controller.showSuggestion({
				id: "suggestion-1",
				blockId,
				offset: 5,
				text: " there",
				type: "inline",
			});

			const decorations = inlineCompletion.controller.buildDecorations();
			const blockDecoration = decorations.find(
				(decoration): decoration is BlockDecoration =>
					decoration.type === "block",
			);
			const inlineDecoration = decorations.find(
				(decoration): decoration is InlineDecoration =>
					decoration.type === "inline",
			);

			expect(blockDecoration?.attributes).toMatchObject({
				[INLINE_COMPLETION_VISIBLE_BLOCK_ATTRIBUTE]: true,
			});
			expect(inlineDecoration?.attributes["data-suggestion-id"]).toBe(
				"suggestion-1",
			);
		} finally {
			inlineCompletion.release();
			editor.destroy();
		}
	});

	it("keeps a block marker for block suggestions without inline anchors", () => {
		const editor = createEditor({ preset: noDefaultExtensionsPreset });
		const blockId = editor.firstBlock()!.id;
		const inlineCompletion = ensureInlineCompletionController(editor);

		try {
			inlineCompletion.controller.showSuggestion({
				id: "suggestion-1",
				blockId,
				offset: 0,
				text: "A new paragraph",
				type: "block",
			});

			expect(inlineCompletion.controller.buildDecorations()).toEqual([
				{
					type: "block",
					blockId,
					attributes: {
						[INLINE_COMPLETION_VISIBLE_BLOCK_ATTRIBUTE]: true,
					},
				},
			]);
		} finally {
			inlineCompletion.release();
			editor.destroy();
		}
	});
});
