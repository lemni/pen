import type { Editor } from "@pen/types";

export interface AutocompleteProviderDescriptor {
	id: string;
	description: string;
	kind?: "local" | "consumer";
}

export interface AutocompleteRequestContext {
	editor: Editor;
	blockId: string;
	blockType: string | null;
	offset: number;
	prefixText: string;
	suffixText: string;
	previousBlockText: string;
	nextBlockText: string;
}

export interface AutocompleteContextProvider {
	id: string;
	priority?: number;
	maxChars?: number;
	when?(ctx: AutocompleteRequestContext): boolean;
	provide(
		ctx: AutocompleteRequestContext,
	): string | null | Promise<string | null>;
	describe?(): AutocompleteProviderDescriptor;
}

export interface AutocompleteProviderSection {
	id: string;
	text: string;
}

export interface AutocompleteProviderTiming {
	id: string;
	durationMs: number;
	chars: number;
}

export function createAutocompleteProvider(
	provider: AutocompleteContextProvider,
): AutocompleteContextProvider {
	return provider;
}
