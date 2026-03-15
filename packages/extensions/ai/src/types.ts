import type {
	Editor,
	InlineCompletionController as CoreInlineCompletionController,
	InlineCompletionState as CoreInlineCompletionState,
	ModelAdapter,
	ModelMessage,
	SelectionState,
	TextSelection,
	ToolRuntime,
} from "@pen/types";
import type {
	AIApplyStrategy,
	AIMutationMode,
	AIRouteLane,
	AIContentFormat,
	AIBlockAdapterId,
	AIBlockClass,
	AIExecutionMode,
	AIPlannerMode,
	AIQualityMetricId,
	AITargetKind,
	AITransportKind,
	AIWorkingSetViewMode,
} from "./runtime/contracts";
import type { DocumentMutationPlan } from "./runtime/planTypes";
import type { FlowPatchAlignmentMetrics } from "./runtime/planExecutor";
import type {
	StructuralReviewItem,
	StructuredPreviewTargetState,
} from "./runtime/reviewArtifacts";
import type { StructuredIntent } from "./runtime/structuredIntent";

export interface AIExtensionConfig {
	model?: ModelAdapter;
	suggestMode?: boolean;
	commands?: AICommandBinding[];
	maxAgenticSteps?: number;
	author?: string;
	contentFormat?: AIContentFormatOptions;
}

export interface AIContentFormatOptions {
	blockGeneration?: AIContentFormat;
	selectionRewrite?: "text";
}

export type AIStatus =
	| "idle"
	| "reading"
	| "thinking"
	| "writing"
	| "tool-calling";

export type AISurface = "inline-edit" | "bottom-chat";

export type AISessionStatus =
	| "idle"
	| "streaming"
	| "paused"
	| "complete"
	| "cancelled"
	| "error";

export type AISessionTarget =
	| {
		kind: "selection";
		selection: TextSelection;
		blockId: string | null;
	}
	| {
		kind: "block";
		blockId: string;
	}
	| {
		kind: "document";
	};

export interface AISessionPrompt {
	id: string;
	prompt: string;
	createdAt: number;
	generationId?: string;
}

export interface AISessionSelectionSnapshot {
	anchor: { blockId: string; offset: number };
	focus: { blockId: string; offset: number };
	blockRange: string[];
	isMultiBlock: boolean;
}

export interface AIContextualPromptRect {
	top: number;
	left: number;
	width: number;
	height: number;
}

export type AIContextualPromptAnchorKind = "text-range" | "block" | "document";

export type AIContextualPromptAnchorStatus = "valid" | "shifted" | "invalid";

export interface AIContextualPromptAnchor {
	kind: AIContextualPromptAnchorKind;
	selectionSnapshot?: AISessionSelectionSnapshot;
	focusBlockId: string | null;
	status: AIContextualPromptAnchorStatus;
	lastResolvedRect: AIContextualPromptRect | null;
}

export interface AIContextualPromptComposerState {
	draftPrompt: string;
	isOpen: boolean;
	isSubmitting: boolean;
	canSubmitFollowUp: boolean;
}

export interface AIContextualPromptState {
	anchor: AIContextualPromptAnchor;
	composer: AIContextualPromptComposerState;
}

export type AISessionTurnStatus =
	| "streaming"
	| "review"
	| "accepted"
	| "rejected"
	| "complete"
	| "cancelled"
	| "error";

export interface AISessionTurn {
	id: string;
	prompt: string;
	createdAt: number;
	generationId?: string;
	target: Exclude<AIPromptTarget, "auto">;
	status: AISessionTurnStatus;
	suggestionIds: string[];
	reviewItemIds: string[];
	structuredPreview?: GenerationStructuredPreviewState | null;
	anchor?: AISessionAnchor;
	selection?: AISessionSelectionSnapshot;
}

export interface AISessionMetrics {
	firstTokenMs?: number;
	totalMs?: number;
	toolMs?: number;
	streamEventCount: number;
	patchCount: number;
	fastApply: AISessionFastApplyMetrics;
}

export interface AISessionFastApplyMetrics {
	attemptCount: number;
	nativeFastApplyCount: number;
	scopedReplacementCount: number;
	plainMarkdownCount: number;
	failedCount: number;
}

export interface AISessionAnchor {
	blockId?: string;
	from?: number;
	to?: number;
}

export interface AISession {
	id: string;
	surface: AISurface;
	status: AISessionStatus;
	target: AISessionTarget;
	contextualPrompt?: AIContextualPromptState;
	turns: AISessionTurn[];
	activeTurnId?: string;
	promptHistory: AISessionPrompt[];
	generationIds: string[];
	pendingSuggestionIds: string[];
	pendingReviewItemIds: string[];
	createdAt: number;
	updatedAt: number;
	metrics: AISessionMetrics;
	anchor?: AISessionAnchor;
}

export interface AIInlineHistorySnapshot {
	id: string;
	sessionId: string | null;
	sessions: readonly AISession[];
	activeSessionId: string | null;
	documentVersion: number;
	kind: "document-coupled" | "ui-local";
}

export interface AgenticStep {
	index: number;
	type: "text" | "tool-call" | "tool-result";
	toolName?: string;
	toolCallId?: string;
	input?: unknown;
	output?: unknown;
	status: "pending" | "running" | "complete" | "error";
}

export type AIStreamEventType =
	| "generation-start"
	| "status"
	| "text-delta"
	| "app-partial"
	| "tool-call"
	| "tool-output"
	| "tool-result"
	| "structured-preview"
	| "generation-finish";

export interface AIStreamEventBase {
	type: AIStreamEventType;
	generationId: string;
	sessionId?: string;
	zoneId: string;
	blockId: string;
	timestamp: number;
}

export type AIStreamEvent =
	| (AIStreamEventBase & {
		type: "generation-start";
		prompt: string;
		target: GenerationState["target"];
	})
	| (AIStreamEventBase & {
		type: "status";
		status: AIStatus;
	})
	| (AIStreamEventBase & {
		type: "text-delta";
		delta: string;
		text: string;
	})
	| (AIStreamEventBase & {
		type: "app-partial";
		data: unknown;
		final: boolean;
	})
	| (AIStreamEventBase & {
		type: "tool-call";
		toolCallId: string;
		toolName: string;
		input: unknown;
	})
	| (AIStreamEventBase & {
		type: "tool-output";
		toolCallId: string;
		toolName: string;
		part: unknown;
		output: unknown;
	})
	| (AIStreamEventBase & {
		type: "tool-result";
		toolCallId: string;
		toolName: string;
		output: unknown;
		state: "complete" | "error";
	})
	| (AIStreamEventBase & {
		type: "structured-preview";
		preview: GenerationStructuredPreviewState;
		patches: readonly StructuredPreviewPatchOperation[];
	})
	| (AIStreamEventBase & {
		type: "generation-finish";
		status: GenerationState["status"];
		text: string;
	});

export interface StructuredPreviewPatchOperation {
	op: "add" | "remove" | "replace";
	path: string;
	value?: unknown;
}

export interface GenerationStructuredPreviewState {
	planState: "drafted" | "validated";
	plan: DocumentMutationPlan;
	reviewItems: StructuralReviewItem[];
	targets: StructuredPreviewTargetState[];
}

export interface GenerationState {
	id: string;
	zoneId: string;
	blockId: string;
	target: "selection" | "block";
	sessionId?: string;
	turnId?: string;
	surface?: AISurface;
	prompt: string;
	status: "streaming" | "complete" | "cancelled" | "error";
	tokenCount: number;
	steps: AgenticStep[];
	undoGroupId: string;
	text: string;
	commandId?: string;
	suggestionIds?: string[];
	route?: AIRouteLane;
	mutationMode?: AIMutationMode;
	contentFormat?: AIContentFormat;
	applyStrategy?: AIApplyStrategy;
	planState?: GenerationPlanState;
	plan?: DocumentMutationPlan | null;
	structuredIntent?: StructuredIntent | null;
	reviewItems?: StructuralReviewItem[];
	structuredPreview?: GenerationStructuredPreviewState | null;
	targetKind?: GenerationTargetKind;
	blockClass?: AIBlockClass;
	adapterId?: AIBlockAdapterId;
	transportKind?: AITransportKind;
	mutationReceipt?: AIMutationReceipt | null;
	debug?: GenerationDebugState;
}

export type GenerationPlanState =
	| "none"
	| "drafted"
	| "validated"
	| "rejected";

export type GenerationTargetKind = AITargetKind;

export interface EphemeralSuggestion {
	id: string;
	blockId: string;
	offset: number;
	text: string;
	type: "inline" | "block";
	blockType?: string;
	props?: Record<string, unknown>;
}

export type AIInlineCompletionState = CoreInlineCompletionState;
export type AIInlineCompletionController = CoreInlineCompletionController;

export interface PersistentSuggestion {
	id: string;
	action: "insert" | "delete";
	author: string;
	authorType: "user" | "ai";
	createdAt: number;
	model?: string;
	sessionId?: string;
	blockId: string;
	offset: number;
	length: number;
}

export interface BlockSuggestionMeta {
	id: string;
	action: "insert-block" | "delete-block" | "move-block" | "convert-block";
	author: string;
	authorType: "user" | "ai";
	createdAt: number;
	model?: string;
	sessionId?: string;
	previousState?: {
		type?: string;
		position?: import("@pen/types").Position;
		props?: Record<string, unknown>;
	};
}

export interface AIAwarenessState {
	status: AIStatus;
	activeBlockId: string | null;
	activeTool?: { name: string; toolCallId: string };
	model: string;
	generationZoneId?: string;
}

export interface AICommandContext {
	editor: Editor;
	selection: SelectionState;
	selectedText: string;
	blockType: string | null;
	blockId: string | null;
}

export type AICommandGuard = (ctx: AICommandContext) => boolean;

export interface AICommandBinding {
	id: string;
	label: string;
	description?: string;
	icon?: string;
	group?: string;
	prompt: string | ((ctx: AICommandContext) => string);
	guard?: AICommandGuard;
	shortcut?: string;
	target?: "selection" | "block";
}

export interface AIControllerState {
	status: AIStatus;
	activeGeneration: GenerationState | null;
	sessions: readonly AISession[];
	activeSessionId?: string | null;
	suggestMode: boolean;
	ephemeralSuggestion: EphemeralSuggestion | null;
	commandMenuOpen: boolean;
	lastRoute?: AIRouteLane;
}

export type AIPromptTarget = "auto" | "selection" | "block" | "document";
export type AISessionResolution = "accept" | "reject";
export type AIInlineHistoryDirection = "undo" | "redo";

export interface AIInlineHistoryController {
	canUndoInlineHistory(): boolean;
	canRedoInlineHistory(): boolean;
	canHandleShortcut(direction: AIInlineHistoryDirection): boolean;
	handleShortcut(direction: AIInlineHistoryDirection): boolean;
	undoInlineHistory(): boolean;
	redoInlineHistory(): boolean;
}

export interface AIReviewController {
	getSuggestions(): readonly PersistentSuggestion[];
	acceptSuggestion(id: string): boolean;
	rejectSuggestion(id: string): boolean;
	acceptAllSuggestions(): void;
	rejectAllSuggestions(): void;
}

export interface AICommandExecutionOptions {
	blockId?: string | null;
	maxSteps?: number;
	target?: AIPromptTarget;
}

export interface AIController {
	getState(): AIControllerState;
	subscribe(listener: () => void): () => void;
	getSessions(): readonly AISession[];
	getActiveSession(): AISession | null;
	subscribeSessions(listener: () => void): () => void;
	getStreamEvents(): readonly AIStreamEvent[];
	subscribeStreamEvents(listener: () => void): () => void;
	getCommands(): readonly AICommandBinding[];
	getCommandContext(): AICommandContext;
	startSession(input: {
		surface: AISurface;
		target?: "auto" | "selection" | "block" | "document";
	}): AISession;
	openContextualPrompt(input?: {
		surface?: Extract<AISurface, "inline-edit">;
		target?: "auto" | "selection" | "block" | "document";
	}): AISession | null;
	updateContextualPromptDraft(sessionId: string, draftPrompt: string): void;
	setContextualPromptAnchorRect(
		sessionId: string,
		rect: AIContextualPromptRect | null,
	): void;
	runSessionPrompt(
		sessionId: string,
		prompt: string,
		options?: AICommandExecutionOptions,
	): Promise<GenerationState>;
	resolveSessionTurn(
		sessionId: string,
		turnId: string,
		resolution: AISessionResolution,
	): boolean;
	acceptSessionTurn(sessionId: string, turnId: string): boolean;
	rejectSessionTurn(sessionId: string, turnId: string): boolean;
	resolveSession(sessionId: string, resolution: AISessionResolution): boolean;
	acceptSession(sessionId: string): boolean;
	rejectSession(sessionId: string): boolean;
	cancelSession(sessionId: string): void;
	suspendInlineSession(sessionId: string): void;
	resumeInlineSession(sessionId: string): void;
	canUndoInlineHistory(): boolean;
	canRedoInlineHistory(): boolean;
	undoInlineHistory(): boolean;
	redoInlineHistory(): boolean;
	runCommand(commandId: string, options?: AICommandExecutionOptions): Promise<GenerationState>;
	runPrompt(prompt: string, options?: AICommandExecutionOptions): Promise<GenerationState>;
	retryActiveGeneration(): Promise<GenerationState | null>;
	acceptActiveGeneration(): boolean;
	rejectActiveGeneration(): boolean;
	acceptReviewItem(id: string): boolean;
	rejectReviewItem(id: string): boolean;
	acceptReviewItems(ids: readonly string[]): boolean;
	rejectReviewItems(ids: readonly string[]): boolean;
	cancelActiveGeneration(): void;
	openCommandMenu(): void;
	closeCommandMenu(): void;
	setSuggestMode(enabled: boolean): void;
	showEphemeralSuggestion(suggestion: EphemeralSuggestion): void;
	dismissEphemeralSuggestion(): void;
	acceptEphemeralSuggestion(): void;
	getSuggestions(): readonly PersistentSuggestion[];
	acceptSuggestion(id: string): boolean;
	rejectSuggestion(id: string): boolean;
	acceptAllSuggestions(): void;
	rejectAllSuggestions(): void;
}

export interface AgenticLoopOptions {
	model: ModelAdapter;
	editor: Editor;
	toolRuntime: ToolRuntime;
	prompt: string;
	blockId: string;
	generationId?: string;
	zoneId?: string;
	maxSteps?: number;
	signal?: AbortSignal;
	onStatusChange?: (status: AIAwarenessState["status"]) => void;
	onStep?: (step: AgenticStep) => void;
	onTextDelta?: (delta: string) => void;
	onCompleteText?: (text: string) => void;
	onToolCall?: (event: {
		toolCallId: string;
		toolName: string;
		input: unknown;
	}) => void;
	onToolOutput?: (event: {
		toolCallId: string;
		toolName: string;
		part: unknown;
		output: unknown;
	}) => void;
	onToolResult?: (event: {
		toolCallId: string;
		toolName: string;
		output: unknown;
		state: "complete" | "error";
	}) => void;
	onStructuredData?: (event: {
		data: unknown;
		final: boolean;
	}) => void;
	onMessagesChange?: (messages: ModelMessage[]) => void;
	onStreamingStart?: (zoneId: string, blockId: string) => void;
	onStreamingEnd?: (status: "complete" | "cancelled" | "error") => void;
	workingSet?: AIWorkingSetEnvelope | null;
	validateWorkingSet?: (
		workingSet: AIWorkingSetEnvelope | null,
	) => { valid: boolean; canRefresh: boolean; reason?: string };
	refreshWorkingSet?: () => Promise<AIWorkingSetEnvelope | null>;
	onDebug?: (debug: GenerationDebugState) => void;
}

export interface AIWorkingSetEnvelope {
	documentVersion: number;
	viewMode: AIWorkingSetViewMode;
	source: "cursor-context" | "document-summary" | "selection";
	context: unknown;
	routeConfidence?: number;
	trackedBlockIds: string[];
	blockRevisions: Record<string, number>;
	selectionSignature: string | null;
}

export interface AIWorkingSetRetrievedSpan {
	id: string;
	blockIds: string[];
	range: {
		startBlockId: string;
		endBlockId: string;
	};
	blockTypes: string[];
	headingPath: string[];
	preview: string;
	markdown: string;
	score: number;
	rationale: string;
	neighbors: {
		beforeBlockId: string | null;
		afterBlockId: string | null;
	};
}

export interface GenerationDebugState {
	messageAssemblyLatencyMs: number;
	firstToolStartMs: number | null;
	firstToolResultMs: number | null;
	firstVisibleTextMs: number | null;
	toolExecutionMs: number;
	qualitySignals: Partial<Record<AIQualityMetricId, number>>;
	routeConfidence?: number;
	structured?: StructuredGenerationDebugState;
	fastApply?: FastApplyDebugState;
}

export interface StructuredGenerationDebugState {
	plannerMode?: AIPlannerMode;
	executionMode?: AIExecutionMode;
	targetKind?: AITargetKind;
	validationIssueCount?: number;
}

export interface FastApplyDebugState {
	attempted: boolean;
	succeeded: boolean;
	executionPath?:
	| "native-fast-apply"
	| "scoped-replacement"
	| "plain-markdown";
	contextChars?: number;
	diffChars?: number;
	confidence?: number;
	fallbackReason?: string;
	verificationFailureReason?: string;
	untouchedBlockMutationCount?: number;
	alignment?: FlowPatchAlignmentMetrics;
	fallback?: FastApplyFallbackMetrics;
}

export interface FastApplyFallbackMetrics {
	kind: "scoped-replacement" | "plain-markdown";
	opsCount: number;
	insertedBlockCount: number;
	deletedBlockCount: number;
	targetBlockCount?: number;
}

export type AIMutationReceiptStatus =
	| "applied"
	| "staged_review"
	| "staged_suggestions"
	| "noop"
	| "invalid"
	| "error";

export interface AIMutationReceiptEvidence {
	commitId: string;
	opsCount: number;
	affectedBlockIds: string[];
	createdBlockIds: string[];
	adapterId: AIBlockAdapterId;
	blockClass: AIBlockClass;
	transportKind: AITransportKind;
}

export interface AIMutationReceipt {
	id: string;
	status: AIMutationReceiptStatus;
	evidence: AIMutationReceiptEvidence;
	issues: string[];
}
