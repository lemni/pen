export {
	aiExtension,
	AI_EXTENSION_NAME,
	AI_CONTROLLER_SLOT,
	INLINE_COMPLETION_SLOT,
	AI_INLINE_COMPLETION_SLOT,
	AI_INLINE_HISTORY_SLOT,
	AI_REVIEW_CONTROLLER_SLOT,
	getInlineCompletionController,
	getAIController,
	getAIInlineCompletionController,
	getAIInlineHistoryController,
	getAIReviewController,
} from "./extension";

export { runAgenticLoop } from "./agentic/loop";
export { buildAgentMessages, compactToolResult } from "./runtime/stepJournal";
export { AICommandRegistry } from "./commands/registry";
export { defaultAICommands } from "./commands/defaultCommands";
export {
	AI_EXECUTION_MODES,
	AI_APPLY_STRATEGIES,
	AI_BLOCK_ADAPTER_IDS,
	AI_BLOCK_CLASSES,
	AI_PLANNER_MODES,
	AI_STRUCTURED_LANES,
	AI_TARGET_KINDS,
	AI_TRANSPORT_KINDS,
} from "./runtime/contracts";
export type {
	AIBlockAdapterId,
	AIApplyStrategy,
	AIBlockClass,
	AITargetKind,
	AIPlannerMode,
	AIExecutionMode,
	AIStructuredLane,
	AITransportKind,
} from "./runtime/contracts";
export {
	getBlockAdapter,
	listBlockAdapters,
	resolveBlockAdapter,
	resolveBlockAdapterContentFormat,
} from "./runtime/blockAdapters";
export { buildMutationReceipt } from "./runtime/mutationReceipt";
export {
	applyMarkdownFastApply,
	parseMarkdownFastApplyContract,
} from "./runtime/markdownFastApply";
export {
	parseMarkdownPatchPlanContract,
} from "./runtime/markdownPatchPlan";
export {
	DOCUMENT_MUTATION_PLAN_KINDS,
} from "./runtime/planTypes";
export {
	PLAN_VALIDATION_SEVERITIES,
	isDocumentMutationPlan,
	validateDocumentMutationPlanShape,
} from "./runtime/planValidation";
export {
	buildStructuralReviewItems,
} from "./runtime/reviewArtifacts";
export {
	buildDocumentMutationPlanExecution,
} from "./runtime/planExecutor";
export {
	buildPlannerPrompt,
	parseStructuredPlanResult,
	resolveExecutionMode,
	resolveGenerationTargetKind,
	resolvePlannerMode,
} from "./runtime/structuredPlanner";

export {
	acceptSuggestion,
	rejectSuggestion,
	acceptAllSuggestions,
	rejectAllSuggestions,
} from "./suggestions/acceptReject";
export {
	readAllSuggestions,
	readSuggestionsFromBlock,
	readBlockSuggestionMeta,
	createSuggestionMark,
} from "./suggestions/persistent";
export {
	AI_SESSION_SUGGESTION_ORIGIN,
	interceptApplyForSuggestMode,
	SUGGESTION_RESOLUTION_ORIGIN,
	shouldBypassSuggestMode,
} from "./suggestions/suggestMode";
export { EphemeralSuggestionManager } from "./suggestions/ephemeral";

export type {
	AIExtensionConfig,
	AIStatus,
	AIContextualPromptAnchor,
	AIContextualPromptAnchorKind,
	AIContextualPromptAnchorStatus,
	AIContextualPromptComposerState,
	AIContextualPromptRect,
	AIContextualPromptState,
	AISession,
	AISessionAnchor,
	AISessionMetrics,
	AISessionFastApplyMetrics,
	AISessionPrompt,
	AISessionStatus,
	AISessionTarget,
	AISurface,
	AIAwarenessState,
	AgenticStep,
	GenerationState,
	EphemeralSuggestion,
	PersistentSuggestion,
	BlockSuggestionMeta,
	AICommandBinding,
	AICommandContext,
	AICommandGuard,
	AICommandExecutionOptions,
	AIControllerState,
	AIController,
	AIInlineCompletionState,
	AIInlineCompletionController,
	AIInlineHistoryDirection,
	AIInlineHistoryController,
	AIReviewController,
	AIPromptTarget,
	AISessionResolution,
	AIContentFormatOptions,
	GenerationPlanState,
	GenerationTargetKind,
	StructuredGenerationDebugState,
	FastApplyDebugState,
	AIWorkingSetRetrievedSpan,
	AIStreamEvent,
	AIStreamEventType,
	GenerationStructuredPreviewState,
	StructuredPreviewPatchOperation,
	AIMutationReceipt,
	AIMutationReceiptEvidence,
	AIMutationReceiptStatus,
} from "./types";
export type {
	DocumentMutationPlan,
	DocumentMutationPlanKind,
	FlowPatchPlan,
	FlowPatchEdit,
	FlowPatchEditOperation,
	FlowPatchLocator,
	TextEditPlan,
	BlockInsertPlan,
	BlockUpdatePlan,
	BlockMovePlan,
	BlockConvertPlan,
	DatabaseEditPlan,
	DatabaseEditStep,
	ReviewBundlePlan,
	PlanConfidence,
	PlanTextRange,
} from "./runtime/planTypes";
export type {
	PlanValidationContext,
	PlanValidationIssue,
	PlanValidationResult,
	PlanValidationSeverity,
} from "./runtime/planValidation";
export type {
	PlanExecutionIssue,
	PlanExecutionResult,
	PlanExecutionMetrics,
	FlowPatchAlignmentMetrics,
} from "./runtime/planExecutor";
export type {
	StructuralReviewItem,
	StructuralReviewComparisonRow,
} from "./runtime/reviewArtifacts";
