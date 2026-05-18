import type { ModelMessage } from "@pen/types";
import type { AutocompleteRequestContext } from "./providers/types";
import { AutocompleteProviderRegistry } from "./providers/registry";
import type {
	AutocompleteContextProvider,
	AutocompleteProviderSection,
	AutocompleteProviderTiming,
} from "./providers/types";

export const AUTOCOMPLETE_SYSTEM_PROMPT = [
	"You are generating inline editor autocomplete.",
	"Return only the text that should be inserted at the cursor.",
	"Do not repeat the existing prefix unless it must be changed.",
	"The first character of your answer must be the next character after the cursor, not the start of the already-typed prefix.",
	"If the user already typed `hey`, do not answer `hey` or `hey `.",
	"For example: prefix=`hey ` and suffix=`` should answer something like `there`, not `hey `.",
	"For example: prefix=`const url = ` and suffix=`` should answer the continuation after the cursor only.",
	"Preserve any leading space or punctuation needed so the inserted text joins naturally with the prefix.",
	"When you can confidently continue the current word, phrase, or sentence, continue past a single obvious next character.",
	"Avoid replying with only one character when you can confidently provide a longer useful continuation.",
	"For prose, prefer a short phrase or clause over a single word when you can continue confidently.",
	"When the best continuation naturally starts a structured block after a newline, markdown block syntax is allowed.",
	"Use markdown for lists, headings, blockquotes, checklists, or other structured blocks only when that is the literal continuation after the cursor.",
	"If your best continuation is only a weak or generic one-word guess, return an empty string instead.",
	"If you do not have a useful continuation, return an empty string.",
	"Do not wrap the whole answer in quotes, commentary, or extra enclosing markdown fences.",
	"Prefer a short, high-confidence continuation.",
].join(" ");

export const AUTOCOMPLETE_CONTINUATION_SYSTEM_PROMPT = [
	"You are generating the next inline continuation after a visible autocomplete suggestion has already been accepted.",
	"Return only the text that should be inserted at the cursor.",
	"Do not repeat the already accepted text unless it truly must be changed.",
	"Continue with the next natural thought after the cursor, not a restatement of what was just completed.",
	"For prose, each accepted continuation should usually expand scope rather than stay equally short.",
	"If the previous accept likely completed a sentence, prefer finishing the paragraph next.",
	"If the previous accept likely completed a paragraph, prefer continuing across paragraph boundaries next.",
	"Do not stop after a single short sentence when a longer high-confidence continuation is still available.",
	"When continuing across paragraphs, prefer emitting explicit blank lines between paragraphs instead of collapsing everything into one block.",
	"When target_scope=continue-across-paragraphs or prefer_block_breaks=true, strongly prefer ending the current paragraph and then starting a new paragraph in the same completion.",
	"If you can continue across paragraphs with high confidence, do not return a single unbroken paragraph.",
	"When target scope asks for paragraph or multi-paragraph continuation, aim to noticeably expand the visible suggestion length before stopping.",
	"When the continuation naturally becomes structured content, you may emit markdown block syntax for lists, headings, blockquotes, checklists, or other supported block shapes.",
	"For prose, prefer finishing the current sentence, then the current paragraph, and if confidence remains high you may continue into additional paragraphs.",
	"Preserve any leading space, newline, or punctuation needed so the inserted text joins naturally with the prefix.",
	"If you do not have a useful higher-confidence continuation, return an empty string.",
	"Do not wrap the whole answer in quotes, commentary, or extra enclosing markdown fences.",
].join(" ");

export type AutocompletePromptMode = "inline" | "continuation";

export async function buildAutocompleteMessages(options: {
	context: AutocompleteRequestContext;
	registry: AutocompleteProviderRegistry;
	maxProviderChars: number;
	maxProviderTimeMs: number;
	mode?: AutocompletePromptMode;
	continuationDepth?: number;
}): Promise<{
	messages: ModelMessage[];
	providerTimings: readonly AutocompleteProviderTiming[];
}> {
	const { providerSections, providerTimings } = await collectProviderSections(options);
	const systemPrompt =
		options.mode === "continuation"
			? AUTOCOMPLETE_CONTINUATION_SYSTEM_PROMPT
			: AUTOCOMPLETE_SYSTEM_PROMPT;
	return {
		messages: [
			{ role: "system", content: systemPrompt },
			{
				role: "user",
				content: buildPrompt(
					options.context,
					providerSections,
					options.mode,
					options.continuationDepth,
				),
			},
		],
		providerTimings,
	};
}

export async function collectProviderSections(options: {
	context: AutocompleteRequestContext;
	registry: AutocompleteProviderRegistry;
	maxProviderChars: number;
	maxProviderTimeMs: number;
}): Promise<{
	providerSections: readonly AutocompleteProviderSection[];
	providerTimings: readonly AutocompleteProviderTiming[];
}> {
	const { context, maxProviderChars, maxProviderTimeMs, registry } = options;
	const sections: AutocompleteProviderSection[] = [];
	const timings: AutocompleteProviderTiming[] = [];
	let usedChars = 0;

	for (const provider of registry.listProviders()) {
		if (provider.when && !provider.when(context)) {
			continue;
		}

		const sectionText = await readProviderText({
			context,
			maxProviderTimeMs,
			provider,
		});
		if (!sectionText) {
			continue;
		}

		const providerCharLimit = provider.maxChars ?? maxProviderChars;
		const remainingChars = maxProviderChars - usedChars;
		if (remainingChars <= 0) {
			break;
		}

		const boundedText = sectionText.text.slice(
			0,
			Math.min(providerCharLimit, remainingChars),
		);
		if (!boundedText) {
			continue;
		}

		sections.push({
			id: provider.id,
			text: boundedText,
		});
		timings.push({
			id: provider.id,
			durationMs: sectionText.durationMs,
			chars: boundedText.length,
		});
		usedChars += boundedText.length;
	}

	return {
		providerSections: sections,
		providerTimings: timings,
	};
}

function buildPrompt(
	context: AutocompleteRequestContext,
	providerSections: readonly AutocompleteProviderSection[],
	mode: AutocompletePromptMode = "inline",
	continuationDepth = 0,
): string {
	const sections = [
		`prefix=${JSON.stringify(context.prefixText)}`,
		"cursor_here=true",
		`suffix=${JSON.stringify(context.suffixText)}`,
	];
	if (context.previousBlockText.trim().length > 0) {
		sections.push(`previous_block=${JSON.stringify(context.previousBlockText)}`);
	}
	if (context.nextBlockText.trim().length > 0) {
		sections.push(`next_block=${JSON.stringify(context.nextBlockText)}`);
	}

	if (mode === "continuation") {
		sections.push(
			"[continuation]",
			`depth=${continuationDepth}`,
			`target_scope=${resolveContinuationScope(continuationDepth)}`,
			`target_min_chars=${resolveContinuationMinChars(continuationDepth)}`,
			`prefer_block_breaks=${continuationDepth >= 2}`,
		);
	}

	if (providerSections.length > 0) {
		const renderedProviders = providerSections.map(
			(section) => `[provider:${section.id}]\n${section.text}`,
		);
		sections.push(...renderedProviders);
	}

	return sections.join("\n");
}

function resolveContinuationScope(depth: number): string {
	if (depth <= 1) {
		return "finish-paragraph";
	}
	return "continue-across-paragraphs";
}

function resolveContinuationMinChars(depth: number): number {
	if (depth <= 1) {
		return 120;
	}
	return 260;
}

async function readProviderText(options: {
	context: AutocompleteRequestContext;
	maxProviderTimeMs: number;
	provider: AutocompleteContextProvider;
}): Promise<{ text: string; durationMs: number } | null> {
	const { context, maxProviderTimeMs, provider } = options;
	const startedAt = Date.now();
	try {
		const result = await Promise.race([
			Promise.resolve(provider.provide(context)),
			createTimeout(maxProviderTimeMs),
		]);
		if (typeof result !== "string") {
			return null;
		}
		const trimmed = result.trim();
		return trimmed.length > 0
			? { text: trimmed, durationMs: Date.now() - startedAt }
			: null;
	} catch {
		return null;
	}
}

function createTimeout(timeoutMs: number): Promise<null> {
	return new Promise((resolve) => {
		setTimeout(() => resolve(null), timeoutMs);
	});
}
