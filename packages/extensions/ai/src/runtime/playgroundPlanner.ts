import type { Editor, SelectionState } from "@pen/types";
import { parseStructuredIntentRequestPrompt } from "./structuredIntent";

export interface PlaygroundPromptContextEnvelope {
	json: string;
	jsonBytes: number;
	estimatedJsonTokens: number;
}

export type PlaygroundRequestMode =
	| "document-agent"
	| "structured-planner"
	| "selection-fast"
	| "inline-autocomplete";
export type PlaygroundResolvedContextFormat = "json" | "none";

export interface PlaygroundRequestPlan {
	mode: PlaygroundRequestMode;
	modelId: string;
	contextFormat: PlaygroundResolvedContextFormat;
	systemPrompt: string;
	prompt: string;
	maxOutputTokens?: number;
	temperature?: number;
	stopSequences?: string[];
	useTools: boolean;
	promptContext: PlaygroundPromptContextEnvelope | null;
	selectedTextLength: number | null;
}

export interface PlaygroundPlannerConfig {
	documentModel: string;
	selectionModel: string;
	documentSystemPrompt: string;
	structuredPlannerSystemPrompt: string;
	selectionFastPathSystemPrompt: string;
	autocompleteSystemPrompt: string;
	selectionSourceCharLimit: number;
	selectionStopSentinel: string;
	selectionOutputTokenCap: number;
	autocompleteOutputTokenCap: number;
	selectionDefaultOutputTokens: number;
	selectionExpandOutputTokens: number;
	selectionSummarizeOutputTokens: number;
	selectionTranslateOutputTokens: number;
}

const NEARBY_BLOCK_RADIUS = 2;
const STRUCTURED_PLANNER_PROMPT_PREFIX =
	"Produce a structured Pen document mutation plan.";

export function buildPlaygroundRequestPlan(
	editor: Editor,
	prompt: string,
	config: PlaygroundPlannerConfig,
): PlaygroundRequestPlan {
	if (parseStructuredIntentRequestPrompt(prompt)) {
		return {
			mode: "structured-planner",
			modelId: config.documentModel,
			contextFormat: "none",
			systemPrompt: config.structuredPlannerSystemPrompt,
			prompt,
			useTools: false,
			temperature: undefined,
			stopSequences: undefined,
			promptContext: null,
			selectedTextLength: null,
		};
	}

	const inlineAutocompletePlan = buildInlineAutocompletePlan(prompt, config);
	if (inlineAutocompletePlan) {
		return inlineAutocompletePlan;
	}

	const selectionPlan = buildSelectionFastPathPlan(editor, prompt, config);
	if (selectionPlan) {
		return selectionPlan;
	}

	if (isStructuredPlannerPrompt(prompt)) {
		return {
			mode: "structured-planner",
			modelId: config.documentModel,
			contextFormat: "none",
			systemPrompt: config.structuredPlannerSystemPrompt,
			prompt,
			useTools: false,
			temperature: undefined,
			stopSequences: undefined,
			promptContext: null,
			selectedTextLength: null,
		};
	}

	const promptContext = buildPromptContext(editor);
	return {
		mode: "document-agent",
		modelId: config.documentModel,
		contextFormat: "json",
		systemPrompt: config.documentSystemPrompt,
		prompt: buildPromptEnvelope(prompt, promptContext.json),
		useTools: true,
		temperature: undefined,
		stopSequences: undefined,
		promptContext,
		selectedTextLength: null,
	};
}

export function buildPromptContext(
	editor: Editor,
): PlaygroundPromptContextEnvelope {
	const blocks = Array.from(editor.blocks()).map((block) => ({
		id: block.id,
		type: block.type,
		text: truncateText(block.textContent({ resolved: true }), 240),
		childCount: block.children.length,
	}));
	const selection = editor.selection;
	const selectedText = truncateText(editor.getSelectedText(), 600);
	const activeBlockId = resolveSelectionBlockId(selection);
	const activeBlockIndex = activeBlockId
		? blocks.findIndex((block) => block.id === activeBlockId)
		: -1;
	const nearbyBlocks = resolveNearbyBlocks(blocks, activeBlockIndex);
	const activeBlock =
		activeBlockIndex >= 0 ? blocks[activeBlockIndex] ?? null : blocks[0] ?? null;
	const payload = {
		blockCount: editor.blockCount(),
		selectionType: selection?.type ?? null,
		activeBlockId,
		selectedText,
		activeBlock,
		nearbyBlocks,
		blockTypes: [...new Set(blocks.map((block) => block.type))],
	};
	const json = JSON.stringify(payload);

	return {
		json,
		jsonBytes: Buffer.byteLength(json, "utf8"),
		estimatedJsonTokens: estimateTokens(json),
	};
}

export function createPlaygroundRequestMetricsSeed(
	requestPlan: PlaygroundRequestPlan,
): {
	requestMode: PlaygroundRequestMode;
	requestModel: string;
	contextFormat: PlaygroundResolvedContextFormat;
	firstToolStartMs: number | null;
	firstToolResultMs: number | null;
	firstTextDeltaServerMs: number | null;
	totalServerMs: number | null;
	toolCallCount: number;
	toolExecutionMs: number;
	contextBytesJson: number | null;
	contextEstimatedTokensJson: number | null;
} {
	return {
		requestMode: requestPlan.mode,
		requestModel: requestPlan.modelId,
		contextFormat: requestPlan.contextFormat,
		firstToolStartMs: null,
		firstToolResultMs: null,
		firstTextDeltaServerMs: null,
		totalServerMs: null,
		toolCallCount: 0,
		toolExecutionMs: 0,
		contextBytesJson: requestPlan.promptContext?.jsonBytes ?? null,
		contextEstimatedTokensJson:
			requestPlan.promptContext?.estimatedJsonTokens ?? null,
	};
}

export function estimateTokens(value: string): number {
	return Math.max(1, Math.ceil(value.length / 4));
}

function isStructuredPlannerPrompt(prompt: string): boolean {
	const normalizedPrompt = prompt.trimStart();
	return (
		normalizedPrompt.startsWith(STRUCTURED_PLANNER_PROMPT_PREFIX) ||
		normalizedPrompt.includes(`User request:\n${STRUCTURED_PLANNER_PROMPT_PREFIX}`)
	);
}

function buildPromptEnvelope(
	prompt: string,
	context: string,
): string {
	return [
		"Direct document context (JSON, compact summary):",
		context,
		"",
		"Use this summary first. Call tools only when you need more precise or broader context.",
		"When you answer with document content, return only the content to insert or apply.",
		'Do not add conversational lead-ins like "Here is", "Here\'s", or "I wrote".',
		"",
		"User request:",
		prompt,
	].join("\n");
}

function buildInlineAutocompletePlan(
	prompt: string,
	config: PlaygroundPlannerConfig,
): PlaygroundRequestPlan | null {
	if (!isInlineAutocompletePrompt(prompt)) {
		return null;
	}

	return {
		mode: "inline-autocomplete",
		modelId: config.selectionModel,
		contextFormat: "none",
		systemPrompt: config.autocompleteSystemPrompt,
		prompt,
		maxOutputTokens: resolveAutocompleteOutputTokenCap(prompt, config),
		temperature: 0,
		stopSequences: undefined,
		useTools: false,
		promptContext: null,
		selectedTextLength: null,
	};
}

function resolveAutocompleteOutputTokenCap(
	prompt: string,
	config: PlaygroundPlannerConfig,
): number {
	const targetScope = extractAutocompleteContinuationTargetScope(prompt);
	if (targetScope === "continue-across-paragraphs") {
		return Math.max(config.autocompleteOutputTokenCap * 8, 640);
	}
	if (targetScope === "finish-paragraph") {
		return Math.max(config.autocompleteOutputTokenCap * 4, 256);
	}
	return config.autocompleteOutputTokenCap;
}

function extractAutocompleteContinuationTargetScope(
	prompt: string,
): "finish-paragraph" | "continue-across-paragraphs" | null {
	const match = prompt.match(/^target_scope=(.+)$/m);
	if (!match) {
		return null;
	}
	if (match[1] === "finish-paragraph") {
		return "finish-paragraph";
	}
	if (match[1] === "continue-across-paragraphs") {
		return "continue-across-paragraphs";
	}
	return null;
}

function buildSelectionFastPathPlan(
	editor: Editor,
	prompt: string,
	config: PlaygroundPlannerConfig,
): PlaygroundRequestPlan | null {
	const parsedPromptSelection = parsePinnedSelectionPrompt(prompt);
	const selectedText = (
		parsedPromptSelection?.selectedText ?? resolveLiveSelectedText(editor)
	).trim();
	if (!selectedText || selectedText.length > config.selectionSourceCharLimit) {
		return null;
	}

	const instruction =
		parsedPromptSelection?.instruction ??
		extractSelectionInstruction(prompt, selectedText);
	const promptKind = classifySelectionPrompt(instruction);

	return {
		mode: "selection-fast",
		modelId: config.selectionModel,
		contextFormat: "none",
		systemPrompt: config.selectionFastPathSystemPrompt,
		prompt: buildSelectionPromptEnvelope(
			instruction,
			selectedText,
			config.selectionStopSentinel,
		),
		maxOutputTokens: resolveSelectionOutputTokenBudget(
			promptKind,
			selectedText,
			config,
		),
		temperature: resolveSelectionTemperature(promptKind),
		stopSequences: [config.selectionStopSentinel],
		useTools: false,
		promptContext: null,
		selectedTextLength: selectedText.length,
	};
}

function resolveLiveSelectedText(editor: Editor): string {
	const selection = editor.selection;
	if (!selection || selection.type !== "text" || selection.isCollapsed) {
		return "";
	}
	return editor.getSelectedText();
}

function isInlineAutocompletePrompt(prompt: string): boolean {
	const normalizedPrompt = prompt.trim();
	const promptLines = normalizedPrompt.split("\n");
	return (
		promptLines[0]?.startsWith("prefix=") === true &&
		promptLines[1] === "cursor_here=true" &&
		promptLines[2]?.startsWith("suffix=") === true
	);
}

function buildSelectionPromptEnvelope(
	instruction: string,
	selectedText: string,
	stopSentinel: string,
): string {
	return [
		"Instruction:",
		instruction,
		"",
		"Selected text:",
		selectedText,
		"",
		`Return only the final replacement text. When finished, output ${stopSentinel}.`,
	].join("\n");
}

function parsePinnedSelectionPrompt(
	prompt: string,
): { instruction: string; selectedText: string } | null {
	const normalizedPrompt = prompt.replace(/\r\n?/g, "\n");
	const selectionMarker =
		"Context summary:\nSource: selection\nSelected text:\n";
	const requestMarker = "\n\nUser request:\n";
	const selectionStart = normalizedPrompt.indexOf(selectionMarker);
	if (selectionStart < 0) {
		return null;
	}
	const requestStart = normalizedPrompt.lastIndexOf(requestMarker);
	if (requestStart <= selectionStart + selectionMarker.length) {
		return null;
	}
	const selectedText = normalizedPrompt
		.slice(selectionStart + selectionMarker.length, requestStart)
		.trim();
	const instruction = normalizedPrompt
		.slice(requestStart + requestMarker.length)
		.trim();
	if (!selectedText || !instruction) {
		return null;
	}
	return {
		instruction,
		selectedText,
	};
}

function extractSelectionInstruction(prompt: string, selectedText: string): string {
	const trimmedPrompt = prompt.trim();
	const trimmedSelection = selectedText.trim();
	if (!trimmedSelection) {
		return trimmedPrompt;
	}

	const selectionSuffix = `\n\n${trimmedSelection}`;
	if (trimmedPrompt.endsWith(selectionSuffix)) {
		return trimmedPrompt.slice(0, -selectionSuffix.length).trim();
	}

	if (trimmedPrompt.endsWith(trimmedSelection)) {
		return trimmedPrompt.slice(0, -trimmedSelection.length).trim();
	}

	return trimmedPrompt;
}

function classifySelectionPrompt(
	instruction: string,
): "rewrite" | "summarize" | "translate" | "expand" {
	const normalizedInstruction = instruction.trim().toLowerCase();

	if (normalizedInstruction.startsWith("summarize")) {
		return "summarize";
	}

	if (normalizedInstruction.startsWith("translate")) {
		return "translate";
	}

	if (
		normalizedInstruction.startsWith("expand") ||
		normalizedInstruction.includes("more detail")
	) {
		return "expand";
	}

	if (
		normalizedInstruction.startsWith("rewrite") ||
		normalizedInstruction.startsWith("fix grammar") ||
		normalizedInstruction.startsWith("simplify") ||
		normalizedInstruction.startsWith("shorten") ||
		normalizedInstruction.startsWith("make") ||
		normalizedInstruction.startsWith("improve")
	) {
		return "rewrite";
	}

	return "rewrite";
}

function resolveSelectionOutputTokenBudget(
	promptKind: "rewrite" | "summarize" | "translate" | "expand",
	selectedText: string,
	config: PlaygroundPlannerConfig,
): number {
	const selectedTokenEstimate = estimateTokens(selectedText);

	if (promptKind === "summarize") {
		return Math.min(
			config.selectionSummarizeOutputTokens,
			Math.max(80, Math.ceil(selectedTokenEstimate * 0.6)),
		);
	}

	if (promptKind === "translate") {
		return Math.min(
			config.selectionTranslateOutputTokens,
			Math.max(120, Math.ceil(selectedTokenEstimate * 1.35)),
		);
	}

	if (promptKind === "expand") {
		return Math.min(
			config.selectionOutputTokenCap,
			Math.max(
				config.selectionExpandOutputTokens,
				Math.ceil(selectedTokenEstimate * 2),
			),
		);
	}

	if (promptKind === "rewrite") {
		return Math.min(
			220,
			Math.max(72, Math.ceil(selectedTokenEstimate * 1.1)),
		);
	}

	return Math.min(
		config.selectionOutputTokenCap,
		Math.max(
			config.selectionDefaultOutputTokens,
			selectedTokenEstimate,
		),
	);
}

function resolveSelectionTemperature(
	promptKind: "rewrite" | "summarize" | "translate" | "expand",
): number {
	if (promptKind === "expand") {
		return 0.3;
	}

	if (promptKind === "translate") {
		return 0.2;
	}

	return 0;
}

function resolveNearbyBlocks(
	blocks: Array<{ id: string; type: string; text: string; childCount: number }>,
	activeBlockIndex: number,
) {
	if (blocks.length === 0) {
		return [];
	}

	if (activeBlockIndex < 0) {
		return blocks.slice(0, 5);
	}

	const startIndex = Math.max(0, activeBlockIndex - 2);
	const endIndex = Math.min(blocks.length, activeBlockIndex + 3);
	return blocks.slice(startIndex, endIndex);
}

function resolveSelectionBlockId(
	selection: SelectionState,
): string | null {
	if (!selection) {
		return null;
	}

	if (selection.type === "text" && "anchor" in selection) {
		return selection.anchor.blockId;
	}

	if (selection.type === "cell") {
		return selection.blockId;
	}

	if (selection.type === "block") {
		return selection.blockIds[0] ?? null;
	}

	return null;
}

function truncateText(value: string, limit: number): string {
	if (value.length <= limit) {
		return value;
	}

	return `${value.slice(0, limit)}...`;
}
