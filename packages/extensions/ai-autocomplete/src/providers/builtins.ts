import {
	createAutocompleteProvider,
	type AutocompleteContextProvider,
} from "./types";

export const builtinAutocompleteProviders: readonly AutocompleteContextProvider[] = [
	createAutocompleteProvider({
		id: "block-shape",
		priority: 100,
		describe: () => ({
			id: "block-shape",
			description: "Adds the current block type to autocomplete context",
			kind: "local",
		}),
		provide: (ctx) => `block_type=${ctx.blockType ?? "unknown"}`,
	}),
	createAutocompleteProvider({
		id: "neighbor-blocks",
		priority: 50,
		describe: () => ({
			id: "neighbor-blocks",
			description: "Adds nearby block text around the cursor block",
			kind: "local",
		}),
		provide: (ctx) => {
			const sections: string[] = [];
			if (ctx.previousBlockText) {
				sections.push(`previous_block=${JSON.stringify(ctx.previousBlockText)}`);
			}
			if (ctx.nextBlockText) {
				sections.push(`next_block=${JSON.stringify(ctx.nextBlockText)}`);
			}
			return sections.length > 0 ? sections.join("\n") : null;
		},
	}),
];
