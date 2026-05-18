import { describe, expect, it } from "vitest";
import { buildAutocompleteMessages } from "./promptBuilder";
import { builtinAutocompleteProviders } from "./providers/builtins";
import { AutocompleteProviderRegistry } from "./providers/registry";

describe("buildAutocompleteMessages", () => {
	it("includes neighboring block text for local draft context", async () => {
		const { messages } = await buildAutocompleteMessages({
			context: {
				editor: {} as never,
				blockId: "block-1",
				blockType: "paragraph",
				offset: 9,
				prefixText: "Hey Jason",
				suffixText: "",
				previousBlockText: "Earlier accepted reply text.",
				nextBlockText: "Original quoted message text.",
			},
			registry: new AutocompleteProviderRegistry(builtinAutocompleteProviders),
			maxProviderChars: 500,
			maxProviderTimeMs: 10,
		});

		const userMessage = String(messages[1]?.content ?? "");

		expect(userMessage).toContain(
			'previous_block="Earlier accepted reply text."',
		);
		expect(userMessage).toContain(
			'next_block="Original quoted message text."',
		);
		expect(userMessage.match(/previous_block=/g)).toHaveLength(1);
		expect(userMessage.match(/next_block=/g)).toHaveLength(1);
	});
});
