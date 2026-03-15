import type { SelectionState } from "@pen/types";
import type { AISurface } from "../types";
import type {
	AIApplyStrategy,
	AIBlockAdapterId,
	AIBlockClass,
	AIContentFormat,
	AIMutationMode,
	AIPlannerMode,
	AIRouteLane,
	AITargetKind,
	AITransportKind,
} from "./contracts";
import {
	resolveBlockAdapter,
	resolveBlockAdapterContentFormat,
} from "./blockAdapters";
import {
	resolveMutationMode,
	shouldStreamDirectAIOutput,
} from "./mutationPolicy";
import {
	resolveGenerationTargetKind,
	resolvePlannerMode,
} from "./structuredPlanner";

export interface RequestRouterInput {
	prompt: string;
	selection: SelectionState;
	blockType: string | null;
	blockCount: number;
	suggestMode: boolean;
	target: "selection" | "block";
	contentFormat: AIContentFormat;
	surface?: AISurface;
}

export interface RequestRouterDecision {
	target: "selection" | "block";
	lane: AIRouteLane;
	mutationMode: AIMutationMode;
	contentFormat: AIContentFormat;
	plannerMode: AIPlannerMode;
	applyStrategy: AIApplyStrategy;
	targetKind: AITargetKind;
	blockClass: AIBlockClass;
	adapterId: AIBlockAdapterId;
	transportKind: AITransportKind;
	suggestMode: boolean;
	surface?: AISurface;
	allowToolUse: boolean;
	useCursorContext: boolean;
	useDocumentSummary: boolean;
	shouldStreamDirectly: boolean;
	intent: PromptIntent;
	confidence: number;
}

interface NavigatorRefinementInput {
	surroundingBlockCount?: number;
	selectedTextLength?: number;
	activeBlockType?: string | null;
	structuredTargetKind?: AITargetKind | null;
}

export type PromptIntent =
	| "rewrite"
	| "continue"
	| "local-edit"
	| "structural"
	| "search"
	| "review"
	| "unknown";

const REWRITE_PATTERNS = /\b(rewrite|summari[sz]e|translate|simplify|fix|improve|shorten|expand|polish|paraphrase)\b/i;
const CONTINUE_PATTERNS = /\b(continue|finish|complete|keep writing|next paragraph|next section)\b/i;
const SEARCH_PATTERNS = /\b(find|search|where|which|list|scan|inspect|look for)\b/i;
const STRUCTURAL_PATTERNS = /\b(restructure|reorganize|outline|move|delete section|insert section|change blocks|convert block|table|heading hierarchy)\b/i;
const REVIEW_PATTERNS = /\b(review|critique|audit|compare|analyze entire|check whole)\b/i;
const TABLE_TARGET_PATTERNS = /\b(table|grid|rows?|columns?)\b/i;
const DATABASE_TARGET_PATTERNS = /\b(database|view|views|records?)\b/i;

export function routeAIRequest(
	input: RequestRouterInput,
): RequestRouterDecision {
	const selectionExpanded =
		input.selection?.type === "text" && !input.selection.isCollapsed;
	const intent = classifyPromptIntent(input.prompt);

	let lane: AIRouteLane;
	if (selectionExpanded && input.target === "selection" && intent === "rewrite") {
		lane = "selection-rewrite";
	} else if (
		input.target === "block" &&
		(intent === "continue" ||
			(input.surface === "inline-edit" && intent === "local-edit")) &&
		(!selectionExpanded || input.surface === "inline-edit") &&
		!isStructuralBlockType(input.blockType)
	) {
		lane = "cursor-context";
	} else if (intent === "review" || intent === "structural") {
		lane = input.suggestMode ? "review" : "tool-loop";
	} else if (intent === "search") {
		lane = "tool-loop";
	} else if (!selectionExpanded && input.blockCount <= 200) {
		lane = "context-first";
	} else if (selectionExpanded && input.target === "selection") {
		lane = "selection-rewrite";
	} else {
		lane = "tool-loop";
	}

	let mutationMode = resolveMutationMode({
		lane,
		suggestMode: input.suggestMode,
		selection: input.selection,
		surface: input.surface,
	});
	let targetKind = resolveGenerationTargetKind({
		target: input.target,
		blockType: input.blockType,
		workingSet: null,
	});
	const promptTargetKind = inferPromptTargetKind(input.prompt);
	if (
		input.target === "block" &&
		targetKind === "block" &&
		(promptTargetKind === "table" || promptTargetKind === "database")
	) {
		targetKind = promptTargetKind;
	}
	let plannerMode = resolvePlannerMode({
		target: input.target,
		targetKind,
		intent,
	});
	mutationMode = resolveStructuredMutationMode({
		mutationMode,
		target: input.target,
		targetKind,
		surface: input.surface,
		activeBlockType: input.blockType,
	});
	const adapter = resolveBlockAdapter({
		targetKind,
		plannerMode,
		target: input.target,
		activeBlockType: input.blockType,
		surface: input.surface,
		mutationMode,
	});
	const resolvedContentFormat = resolveBlockAdapterContentFormat({
		adapter,
		target: input.target,
		targetKind,
		surface: input.surface,
		mutationMode,
		fallback: input.contentFormat,
	});

	return {
		target: input.target,
		lane,
		mutationMode,
		contentFormat: resolvedContentFormat,
		plannerMode,
		applyStrategy: resolveApplyStrategy({
			target: input.target,
			targetKind,
			contentFormat: resolvedContentFormat,
			plannerMode,
			mutationMode,
			intent,
			surface: input.surface,
		}),
		targetKind,
		blockClass: adapter.blockClass,
		adapterId: adapter.id,
		transportKind: adapter.transportKind,
		suggestMode: input.suggestMode,
		surface: input.surface,
		allowToolUse: lane === "tool-loop" || lane === "review",
		useCursorContext: lane === "cursor-context" || lane === "context-first",
		useDocumentSummary: lane === "context-first" || lane === "tool-loop" || lane === "review",
		shouldStreamDirectly: shouldStreamDirectAIOutput({
			mutationMode,
			contentFormat: resolvedContentFormat,
			target: input.target,
		}),
		intent,
		confidence: estimateBaseConfidence(lane, intent),
	};
}

export function refineRouteWithNavigator(
	decision: RequestRouterDecision,
	input: NavigatorRefinementInput,
): RequestRouterDecision {
	let lane = decision.lane;
	let confidence = decision.confidence;
	let targetKind = decision.targetKind;

	if (input.activeBlockType && isStructuralBlockType(input.activeBlockType)) {
		if (input.activeBlockType === "table" || input.activeBlockType === "database") {
			targetKind = input.activeBlockType;
		}
		confidence = Math.min(confidence, 0.45);
		if (lane === "cursor-context" || lane === "context-first") {
			lane = "tool-loop";
		}
	}

	if ((input.surroundingBlockCount ?? 0) <= 1 && lane === "cursor-context") {
		confidence = Math.min(confidence, 0.4);
		lane = "context-first";
	}

	if ((input.selectedTextLength ?? 0) > 1200 && lane === "selection-rewrite") {
		confidence = Math.min(confidence, 0.55);
	}

	if (
		input.structuredTargetKind === "table" ||
		input.structuredTargetKind === "database"
	) {
		targetKind = input.structuredTargetKind;
		confidence = Math.min(confidence, 0.5);
		if (lane === "cursor-context" || lane === "context-first") {
			lane = "tool-loop";
		}
	}

	const plannerMode = resolvePlannerMode({
		target: decision.target,
		targetKind,
		intent: decision.intent,
	});
	const resolvedPlannerMode = plannerMode;
	const mutationMode = resolveStructuredMutationMode({
		mutationMode:
			lane === decision.lane
				? decision.mutationMode
				: resolveMutationMode({
					lane,
					suggestMode: decision.suggestMode,
					selection: null,
					surface: decision.surface,
				}),
		target: "block",
		targetKind,
		surface: decision.surface,
		activeBlockType: input.activeBlockType ?? null,
	});
	const adapter = resolveBlockAdapter({
		targetKind,
		plannerMode,
		target: decision.target,
		activeBlockType: input.activeBlockType ?? null,
		surface: decision.surface,
		mutationMode,
	});
	const contentFormat = resolveBlockAdapterContentFormat({
		adapter,
		target: decision.target,
		targetKind,
		surface: decision.surface,
		mutationMode,
		fallback: decision.contentFormat,
	});

	if (lane === decision.lane) {
		return {
			...decision,
			confidence,
			targetKind,
			blockClass: adapter.blockClass,
			adapterId: adapter.id,
			transportKind: adapter.transportKind,
			contentFormat,
			mutationMode,
			plannerMode,
			applyStrategy: resolveApplyStrategy({
				target: decision.target,
				targetKind,
				contentFormat,
				plannerMode,
				mutationMode,
				intent: decision.intent,
				surface: decision.surface,
			}),
			shouldStreamDirectly: shouldStreamDirectAIOutput({
				mutationMode,
				contentFormat,
				target: decision.target,
			}),
		};
	}

	return {
		...decision,
		lane,
		mutationMode,
		contentFormat,
		plannerMode,
		applyStrategy: resolveApplyStrategy({
			target: decision.target,
			targetKind,
			contentFormat,
			plannerMode,
			mutationMode,
			intent: decision.intent,
			surface: decision.surface,
		}),
		targetKind,
		blockClass: adapter.blockClass,
		adapterId: adapter.id,
		transportKind: adapter.transportKind,
		allowToolUse: lane === "tool-loop" || lane === "review",
		useCursorContext: lane === "cursor-context" || lane === "context-first",
		useDocumentSummary: lane === "context-first" || lane === "tool-loop" || lane === "review",
		shouldStreamDirectly: shouldStreamDirectAIOutput({
			mutationMode,
			contentFormat,
			target: decision.target,
		}),
		confidence,
	};
}

export function classifyPromptIntent(prompt: string): PromptIntent {
	if (REWRITE_PATTERNS.test(prompt)) {
		return "rewrite";
	}
	if (CONTINUE_PATTERNS.test(prompt)) {
		return "continue";
	}
	if (REVIEW_PATTERNS.test(prompt)) {
		return "review";
	}
	if (STRUCTURAL_PATTERNS.test(prompt)) {
		return "structural";
	}
	if (SEARCH_PATTERNS.test(prompt)) {
		return "search";
	}
	if (prompt.trim().length <= 80) {
		return "local-edit";
	}
	return "unknown";
}

function isStructuralBlockType(blockType: string | null): boolean {
	return blockType === "table" || blockType === "database" || blockType === "kanban";
}

function inferPromptTargetKind(prompt: string): AITargetKind | null {
	if (DATABASE_TARGET_PATTERNS.test(prompt)) {
		return "database";
	}
	if (TABLE_TARGET_PATTERNS.test(prompt)) {
		return "table";
	}
	return null;
}

function estimateBaseConfidence(
	lane: AIRouteLane,
	intent: PromptIntent,
): number {
	if (lane === "selection-rewrite" && intent === "rewrite") {
		return 0.95;
	}
	if (lane === "cursor-context" && intent === "continue") {
		return 0.9;
	}
	if (lane === "tool-loop" || lane === "review") {
		return 0.75;
	}
	return 0.8;
}

function resolveStructuredMutationMode(input: {
	mutationMode: AIMutationMode;
	target: "selection" | "block";
	targetKind: AITargetKind;
	surface?: AISurface;
	activeBlockType?: string | null;
}): AIMutationMode {
	if (
		input.surface === "bottom-chat" &&
		input.target === "block" &&
		input.targetKind === "database" &&
		input.activeBlockType !== input.targetKind
	) {
		return "direct-stream";
	}
	if (
		input.surface === "bottom-chat" &&
		input.target === "block" &&
		input.targetKind === "table" &&
		input.activeBlockType !== "table"
	) {
		return "streaming-suggestions";
	}
	return input.mutationMode;
}

function resolveApplyStrategy(input: {
	target: "selection" | "block";
	targetKind: AITargetKind;
	contentFormat: AIContentFormat;
	plannerMode: AIPlannerMode;
	mutationMode: AIMutationMode;
	intent: PromptIntent;
	surface?: AISurface;
}): AIApplyStrategy {
	if (input.plannerMode === "structured" || input.targetKind === "database") {
		return "structured-database";
	}
	if (input.target === "selection" || input.contentFormat === "text") {
		return "text-fast-apply";
	}
	if (
		input.surface === "bottom-chat" &&
		input.mutationMode === "streaming-suggestions"
	) {
		return "markdown-full-replace";
	}
	if (
		input.intent === "rewrite" ||
		input.intent === "continue" ||
		input.intent === "local-edit" ||
		input.targetKind === "table"
	) {
		return "markdown-fast-apply";
	}
	return "markdown-full-replace";
}
