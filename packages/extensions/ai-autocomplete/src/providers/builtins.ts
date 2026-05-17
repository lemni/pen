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
];
