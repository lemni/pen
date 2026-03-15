import type {
	Decoration,
	DocumentOp,
	Editor,
	Extension,
	KeyBinding,
	ModelAdapter,
	SelectionState,
	StreamingTarget,
	TextSelection,
	ToolDefinition,
	ToolRuntime,
} from "@pen/types";
import {
	createDecorationSet,
	ensureInlineCompletionController,
	getInlineCompletionController as getInlineCompletionControllerFromCore,
} from "@pen/core";
import { buildDocumentWriteOps, getDocumentToolRuntime } from "@pen/document-ops";
import type { HistoryAppliedEvent } from "@pen/types";
import {
	AI_CONTROLLER_SLOT as CORE_AI_CONTROLLER_SLOT,
	INLINE_COMPLETION_SLOT as CORE_INLINE_COMPLETION_SLOT,
	AI_INLINE_HISTORY_SLOT as CORE_AI_INLINE_HISTORY_SLOT,
	AI_REVIEW_CONTROLLER_SLOT as CORE_AI_REVIEW_CONTROLLER_SLOT,
	defineExtension,
	shouldExposeBlockInTooling,
} from "@pen/types";
import { runAgenticLoop } from "./agentic/loop";
import { defaultAICommands } from "./commands/defaultCommands";
import { AICommandRegistry } from "./commands/registry";
import { buildAffectedRangeDecorations } from "./decorations/affectedRange";
import { buildGenerationZoneDecorations } from "./decorations/generationZone";
import { buildTrackChangesDecorations } from "./decorations/trackChanges";
import { getBlockAdapter } from "./runtime/blockAdapters";
import type {
	AIApplyStrategy,
	AIContentFormat,
	AITargetKind,
} from "./runtime/contracts";
import { resolveDocumentInsertionAnchor } from "./runtime/documentInsertionAnchor";
import {
	MARKDOWN_FAST_APPLY_ROOT_TAG,
	normalizeFlowMarkdownOutput,
} from "./runtime/flowMarkdown";
import { parseMarkdownPatchPlanContract } from "./runtime/markdownPatchPlan";
import {
	applyMarkdownFastApply,
	parseMarkdownFastApplyContract,
} from "./runtime/markdownFastApply";
import { buildMutationReceipt } from "./runtime/mutationReceipt";
import { buildDocumentMutationPlanExecution } from "./runtime/planExecutor";
import { validateDocumentMutationPlanShape } from "./runtime/planValidation";
import type { StructuralReviewItem } from "./runtime/reviewArtifacts";
import {
	buildStructuralReviewItems,
	removeStructuralReviewItemPlan,
	selectStructuralReviewItemPlan,
} from "./runtime/reviewArtifacts";
import {
	classifyPromptIntent,
	refineRouteWithNavigator,
	routeAIRequest,
} from "./runtime/router";
import { compileStructuredIntentToPlan } from "./runtime/structuredIntentCompiler";
import {
	buildPlannerPrompt,
	parseStructuredPlanPreview,
	parseStructuredPlanResult,
	resolveExecutionMode,
} from "./runtime/structuredPlanner";
import {
	buildGenerationStructuredPreviewState,
	buildStructuredPreviewPatchOperations,
} from "./runtime/structuredPreview";
import {
	acceptAllSuggestions,
	acceptSuggestion,
	acceptSuggestions,
	rejectAllSuggestions,
	rejectSuggestion,
	rejectSuggestions,
} from "./suggestions/acceptReject";
import { readAllSuggestions } from "./suggestions/persistent";
import {
	AI_SESSION_SUGGESTION_ORIGIN,
	interceptApplyForSuggestMode,
	SUGGESTION_RESOLUTION_ORIGIN,
	shouldBypassSuggestMode,
} from "./suggestions/suggestMode";
import type {
	AICommandBinding,
	AICommandContext,
	AICommandExecutionOptions,
	AIContextualPromptRect,
	AIController,
	AIControllerState,
	AIExtensionConfig,
	AIInlineCompletionController,
	AIInlineHistoryController,
	AIInlineHistoryDirection,
	AIInlineHistorySnapshot,
	AIReviewController,
	AIMutationReceipt,
	AISession,
	FastApplyDebugState,
	AISessionMetrics,
	AISessionResolution,
	AISessionSelectionSnapshot,
	AISessionTarget,
	AIStreamEvent,
	AISurface,
	AIWorkingSetEnvelope,
	AIWorkingSetRetrievedSpan,
	GenerationState,
	GenerationStructuredPreviewState,
	PersistentSuggestion,
} from "./types";

export const AI_EXTENSION_NAME = "ai";
export const AI_CONTROLLER_SLOT = CORE_AI_CONTROLLER_SLOT;
export const INLINE_COMPLETION_SLOT = CORE_INLINE_COMPLETION_SLOT;
export const AI_INLINE_COMPLETION_SLOT = INLINE_COMPLETION_SLOT;
export const AI_INLINE_HISTORY_SLOT = CORE_AI_INLINE_HISTORY_SLOT;
export const AI_REVIEW_CONTROLLER_SLOT = CORE_AI_REVIEW_CONTROLLER_SLOT;

const AI_SHORTCUT_KEY_BINDINGS: readonly KeyBinding[] = [
	{
		key: "Mod-z",
		priority: 1000,
		description: "Undo AI inline turn",
		handler: (editor) => {
			const inlineHistory = getAIInlineHistoryController(editor);
			if (!inlineHistory?.canHandleShortcut("undo")) {
				return false;
			}
			return inlineHistory.handleShortcut("undo");
		},
	},
	{
		key: "Mod-Shift-z",
		priority: 1000,
		description: "Redo AI inline turn",
		handler: (editor) => {
			const inlineHistory = getAIInlineHistoryController(editor);
			if (!inlineHistory?.canHandleShortcut("redo")) {
				return false;
			}
			return inlineHistory.handleShortcut("redo");
		},
	},
	{
		key: "Ctrl-y",
		priority: 1000,
		description: "Redo AI inline turn",
		handler: (editor) => {
			const inlineHistory = getAIInlineHistoryController(editor);
			if (!inlineHistory?.canHandleShortcut("redo")) {
				return false;
			}
			return inlineHistory.handleShortcut("redo");
		},
	},
];

type GenerationTarget =
	| {
		type: "block";
		blockId: string;
		offset: number;
	}
	| {
		type: "selection";
		selection: TextSelection;
	};

interface GenerationExecutionContext {
	sessionId?: string;
	surface?: AISurface;
}

const EMPTY_TOOL_RUNTIME: ToolRuntime = {
	registerTool(_def: ToolDefinition): void { },
	unregisterTool(_name: string): void { },
	listTools(): readonly ToolDefinition[] {
		return [];
	},
	getTool(): ToolDefinition | null {
		return null;
	},
	async executeTool(name: string): Promise<unknown> {
		throw new Error(`Unknown tool: "${name}"`);
	},
};

const MAX_STREAM_EVENTS = 200;

interface AIInlineHistoryRestoreRequest {
	direction: AIInlineHistoryDirection;
	targetSnapshotId: string;
}

class AIInlineHistoryService implements AIInlineHistoryController {
	constructor(
		private readonly _handlers: {
			canUndoInlineHistory: () => boolean;
			canRedoInlineHistory: () => boolean;
			canHandleShortcut: (direction: AIInlineHistoryDirection) => boolean;
			handleShortcut: (direction: AIInlineHistoryDirection) => boolean;
			undoInlineHistory: () => boolean;
			redoInlineHistory: () => boolean;
		},
	) { }

	canUndoInlineHistory(): boolean {
		return this._handlers.canUndoInlineHistory();
	}

	canRedoInlineHistory(): boolean {
		return this._handlers.canRedoInlineHistory();
	}

	canHandleShortcut(direction: AIInlineHistoryDirection): boolean {
		return this._handlers.canHandleShortcut(direction);
	}

	handleShortcut(direction: AIInlineHistoryDirection): boolean {
		return this._handlers.handleShortcut(direction);
	}

	undoInlineHistory(): boolean {
		return this._handlers.undoInlineHistory();
	}

	redoInlineHistory(): boolean {
		return this._handlers.redoInlineHistory();
	}
}

class AIReviewService implements AIReviewController {
	constructor(
		private readonly _handlers: {
			getSuggestions: () => readonly PersistentSuggestion[];
			acceptSuggestion: (id: string) => boolean;
			rejectSuggestion: (id: string) => boolean;
			acceptAllSuggestions: () => void;
			rejectAllSuggestions: () => void;
		},
	) { }

	getSuggestions(): readonly PersistentSuggestion[] {
		return this._handlers.getSuggestions();
	}

	acceptSuggestion(id: string): boolean {
		return this._handlers.acceptSuggestion(id);
	}

	rejectSuggestion(id: string): boolean {
		return this._handlers.rejectSuggestion(id);
	}

	acceptAllSuggestions(): void {
		this._handlers.acceptAllSuggestions();
	}

	rejectAllSuggestions(): void {
		this._handlers.rejectAllSuggestions();
	}
}

class AIControllerImpl implements AIController {
	private readonly _editor: Editor;
	private readonly _registry = new AICommandRegistry();
	private readonly _inlineCompletion: AIInlineCompletionController;
	private readonly _renderInlineCompletionDecorations: boolean;
	private readonly _listeners = new Set<() => void>();
	private readonly _sessionListeners = new Set<() => void>();
	private readonly _streamEventListeners = new Set<() => void>();
	private readonly _model: ModelAdapter | undefined;
	private readonly _author: string;
	private readonly _maxAgenticSteps: number;
	private readonly _contentFormat: {
		blockGeneration: AIContentFormat;
		selectionRewrite: "text";
	};
	private _state: AIControllerState;
	private _suggestions: readonly PersistentSuggestion[] = [];
	private _streamEvents: readonly AIStreamEvent[] = [];
	private _abortController: AbortController | null = null;
	private _lastPrompt: string | null = null;
	private _lastCommandId: string | null = null;
	private _documentVersion = 0;
	private _unsubscribeHistoryApplied: (() => void) | null = null;
	private _inlineHistory: AIInlineHistorySnapshot[] = [];
	private _inlineHistoryIndex = -1;
	private _pendingInlineHistoryRestore: AIInlineHistoryRestoreRequest | null = null;
	private _isRestoringInlineHistory = false;

	constructor(
		editor: Editor,
		config: AIExtensionConfig,
		services: {
			inlineCompletion: AIInlineCompletionController;
			renderInlineCompletionDecorations: boolean;
		},
	) {
		this._editor = editor;
		this._inlineCompletion = services.inlineCompletion;
		this._renderInlineCompletionDecorations =
			services.renderInlineCompletionDecorations;
		this._model = config.model;
		this._author = config.author ?? "assistant";
		this._maxAgenticSteps = config.maxAgenticSteps ?? 10;
		this._contentFormat = {
			blockGeneration: config.contentFormat?.blockGeneration ?? "text",
			selectionRewrite: config.contentFormat?.selectionRewrite ?? "text",
		};
		this._state = {
			status: "idle",
			activeGeneration: null,
			sessions: [],
			activeSessionId: null,
			suggestMode: config.suggestMode ?? false,
			ephemeralSuggestion: null,
			commandMenuOpen: false,
		};

		for (const command of defaultAICommands) {
			this._registry.register(command);
		}
		for (const command of config.commands ?? []) {
			this._registry.register(command);
		}

		this._syncSuggestionsFromDocument();

		this._inlineCompletion.subscribe(() => {
			this._setState({
				ephemeralSuggestion: this._inlineCompletion.getState().visibleSuggestion,
			});
		});
		this._unsubscribeHistoryApplied = this._editor.onHistoryApplied((event) => {
			this._handleHistoryApplied(event);
		});
	}

	destroy(): void {
		this._unsubscribeHistoryApplied?.();
		this._unsubscribeHistoryApplied = null;
	}

	getState(): AIControllerState {
		return this._state;
	}

	subscribe(listener: () => void): () => void {
		this._listeners.add(listener);
		return () => this._listeners.delete(listener);
	}

	getSessions(): readonly AISession[] {
		return this._state.sessions;
	}

	getActiveSession(): AISession | null {
		const activeSessionId = this._state.activeSessionId;
		if (!activeSessionId) {
			return null;
		}
		return this._state.sessions.find((session) => session.id === activeSessionId) ?? null;
	}

	subscribeSessions(listener: () => void): () => void {
		this._sessionListeners.add(listener);
		return () => this._sessionListeners.delete(listener);
	}

	getStreamEvents(): readonly AIStreamEvent[] {
		return this._streamEvents;
	}

	subscribeStreamEvents(listener: () => void): () => void {
		this._streamEventListeners.add(listener);
		return () => this._streamEventListeners.delete(listener);
	}

	getCommands(): readonly AICommandBinding[] {
		return this._registry.list(this.getCommandContext());
	}

	getCommandContext(): AICommandContext {
		const selection = this._editor.selection;
		const blockId = resolveActiveBlockId(selection);
		return {
			editor: this._editor,
			selection,
			selectedText:
				selection?.type === "text"
					? resolveSelectionText(this._editor, selection)
					: "",
			blockType: blockId ? this._editor.getBlock(blockId)?.type ?? null : null,
			blockId,
		};
	}

	startSession(input: {
		surface: AISurface;
		target?: "auto" | "selection" | "block" | "document";
	}): AISession {
		const now = Date.now();
		const target = resolveSessionTarget(this._editor, input.target);
		const session: AISession = {
			id: crypto.randomUUID(),
			surface: input.surface,
			status: "idle",
			target,
			contextualPrompt:
				input.surface === "inline-edit"
					? resolveContextualPromptState(target)
					: undefined,
			turns: [],
			activeTurnId: undefined,
			promptHistory: [],
			generationIds: [],
			pendingSuggestionIds: [],
			pendingReviewItemIds: [],
			createdAt: now,
			updatedAt: now,
			metrics: {
				streamEventCount: 0,
				patchCount: 0,
				fastApply: createDefaultSessionFastApplyMetrics(),
			},
			anchor: resolveSessionAnchor(this._editor.selection),
		};
		this._setState({
			sessions: [...this._state.sessions, session],
			activeSessionId: session.id,
		});
		return session;
	}

	openContextualPrompt(input?: {
		surface?: Extract<AISurface, "inline-edit">;
		target?: "auto" | "selection" | "block" | "document";
	}): AISession | null {
		const surface = input?.surface ?? "inline-edit";
		const target = resolveSessionTarget(this._editor, input?.target ?? "selection");
		if (surface === "inline-edit" && target.kind !== "selection") {
			return null;
		}
		const activeSession = this._state.sessions.find(
			(session) =>
				session.id === this._state.activeSessionId &&
				session.surface === surface &&
				session.status !== "cancelled",
		);
		if (activeSession && sessionTargetMatches(activeSession, target)) {
			this._updateSession(activeSession.id, {
				target,
				anchor: resolveSessionAnchor(this._editor.selection),
				contextualPrompt: {
					...(activeSession.contextualPrompt ??
						resolveContextualPromptState(target)),
					anchor: resolveContextualPromptAnchor(target),
					composer: {
						...(activeSession.contextualPrompt?.composer ?? {
							draftPrompt: "",
							isSubmitting: false,
							canSubmitFollowUp: true,
						}),
						isOpen: true,
					},
				},
			});
			return this.getActiveSession();
		}
		if (activeSession?.surface === "inline-edit") {
			this._setInlineSessionComposerOpen(activeSession.id, false);
		}
		const nextSession = this.startSession({
			surface,
			target: input?.target ?? "selection",
		});
		return nextSession.contextualPrompt?.anchor.kind === "text-range"
			? nextSession
			: null;
	}

	updateContextualPromptDraft(sessionId: string, draftPrompt: string): void {
		const session = this._state.sessions.find((item) => item.id === sessionId);
		if (!session?.contextualPrompt) {
			return;
		}
		this._updateSession(sessionId, {
			contextualPrompt: {
				...session.contextualPrompt,
				composer: {
					...session.contextualPrompt.composer,
					draftPrompt,
				},
			},
		});
	}

	setContextualPromptAnchorRect(
		sessionId: string,
		rect: AIContextualPromptRect | null,
	): void {
		const session = this._state.sessions.find((item) => item.id === sessionId);
		if (!session?.contextualPrompt) {
			return;
		}
		this._updateSession(sessionId, {
			contextualPrompt: {
				...session.contextualPrompt,
				anchor: {
					...session.contextualPrompt.anchor,
					lastResolvedRect: rect,
				},
			},
		});
	}

	resolveSessionTurn(
		sessionId: string,
		turnId: string,
		resolution: AISessionResolution,
	): boolean {
		return this._resolveSessionTurn(sessionId, turnId, resolution);
	}

	acceptSessionTurn(sessionId: string, turnId: string): boolean {
		return this.resolveSessionTurn(sessionId, turnId, "accept");
	}

	rejectSessionTurn(sessionId: string, turnId: string): boolean {
		return this.resolveSessionTurn(sessionId, turnId, "reject");
	}

	runSessionPrompt(
		sessionId: string,
		prompt: string,
		options?: AICommandExecutionOptions,
	): Promise<GenerationState> {
		const session = this._state.sessions.find((item) => item.id === sessionId);
		if (!session) {
			return Promise.reject(new Error(`Unknown AI session "${sessionId}"`));
		}
		this._recordInlinePromptSubmissionCheckpoint(sessionId, prompt);
		const target = resolvePromptTargetForSession(
			this._editor,
			session,
			options?.target,
			prompt,
		);
		if (target === "selection") {
			const selection = resolveSessionSelectionTarget(this._editor, session);
			if (!selection) {
				return Promise.reject(
					new Error("Cannot run a session prompt without a valid text selection"),
				);
			}
			return this._runSelectionGeneration(
				prompt,
				selection,
				undefined,
				options?.maxSteps,
				{
					sessionId,
					surface: session.surface,
				},
			);
		}
		if (target === "document") {
			return this._runDocumentGeneration(
				prompt,
				options?.blockId,
				undefined,
				options?.maxSteps,
				{
					sessionId,
					surface: session.surface,
				},
			);
		}
		const blockId =
			options?.blockId ??
			resolveSessionBlockId(this._editor, session) ??
			this._editor.lastBlock()?.id ??
			this._editor.firstBlock()?.id;
		if (!blockId) {
			return Promise.reject(
				new Error("Cannot run an AI session prompt without a target block"),
			);
		}
		return this._runBlockGeneration(
			prompt,
			blockId,
			undefined,
			options?.maxSteps,
			{
				sessionId,
				surface: session.surface,
			},
		);
	}

	resolveSession(sessionId: string, resolution: AISessionResolution): boolean {
		const session = this._state.sessions.find((item) => item.id === sessionId);
		if (!session) {
			return false;
		}
		let resolved = false;
		for (const turn of session.turns) {
			resolved =
				this._resolveSessionTurn(sessionId, turn.id, resolution, {
					finalizeSession: false,
				}) || resolved;
		}
		if (resolved) {
			const nextSession =
				this._state.sessions.find((item) => item.id === sessionId) ?? session;
			this._updateSession(sessionId, {
				status: "complete",
				pendingSuggestionIds: [],
				pendingReviewItemIds: [],
				contextualPrompt: closeInlineSessionPrompt(nextSession),
			});
		}
		return resolved;
	}

	acceptSession(sessionId: string): boolean {
		return this.resolveSession(sessionId, "accept");
	}

	rejectSession(sessionId: string): boolean {
		return this.resolveSession(sessionId, "reject");
	}

	cancelSession(sessionId: string): void {
		if (this._state.activeGeneration?.sessionId === sessionId) {
			this.cancelActiveGeneration();
		}
		const session = this._state.sessions.find((item) => item.id === sessionId);
		this._updateSession(sessionId, {
			status: "cancelled",
			contextualPrompt: session?.contextualPrompt
				? {
					...session.contextualPrompt,
					composer: {
						...session.contextualPrompt.composer,
						isOpen: false,
						isSubmitting: false,
					},
				}
				: undefined,
		});
	}

	suspendInlineSession(sessionId: string): void {
		this._setInlineSessionComposerOpen(sessionId, false);
	}

	resumeInlineSession(sessionId: string): void {
		this._setInlineSessionComposerOpen(sessionId, true);
	}

	canUndoInlineHistory(): boolean {
		return this._inlineHistoryIndex > 0;
	}

	canRedoInlineHistory(): boolean {
		return this._inlineHistoryIndex >= 0 && this._inlineHistoryIndex < this._inlineHistory.length - 1;
	}

	undoInlineHistory(): boolean {
		return this._navigateInlineHistory("undo");
	}

	redoInlineHistory(): boolean {
		return this._navigateInlineHistory("redo");
	}

	canHandleInlineHistoryShortcut(
		direction: AIInlineHistoryDirection,
	): boolean {
		return this._canHandleInlineHistoryShortcut(direction, { shortcutOnly: true });
	}

	handleInlineHistoryShortcut(
		direction: AIInlineHistoryDirection,
	): boolean {
		return this._navigateInlineHistory(direction, { shortcutOnly: true });
	}

	async runCommand(
		commandId: string,
		options?: AICommandExecutionOptions,
	): Promise<GenerationState> {
		const ctx = this.getCommandContext();
		const command = this._registry.resolve(commandId);
		if (!command) {
			throw new Error(`Unknown AI command "${commandId}"`);
		}
		if (command.guard && !command.guard(ctx)) {
			throw new Error(`AI command "${command.label}" is not available in this context`);
		}

		const prompt = this._registry.resolvePrompt(command, ctx);
		this._lastPrompt = prompt;
		this._lastCommandId = command.id;

		if (command.target === "selection" && ctx.selection?.type === "text" && !ctx.selection.isCollapsed) {
			return this._runSelectionGeneration(prompt, ctx.selection, command.id, options?.maxSteps);
		}

		const targetBlockId =
			options?.blockId ??
			ctx.blockId ??
			this._editor.lastBlock()?.id ??
			this._editor.firstBlock()?.id;
		if (!targetBlockId) {
			throw new Error("Cannot run AI command without a target block");
		}
		return this._runBlockGeneration(prompt, targetBlockId, command.id, options?.maxSteps);
	}

	async runPrompt(
		prompt: string,
		options?: AICommandExecutionOptions,
	): Promise<GenerationState> {
		this._lastPrompt = prompt;
		this._lastCommandId = null;
		const promptTarget = resolvePromptTarget(this._editor.selection, options?.target);
		if (promptTarget === "selection") {
			const selection = this._editor.selection;
			if (selection?.type !== "text" || selection.isCollapsed) {
				throw new Error("Cannot run a selection prompt without selected text");
			}
			return this._runSelectionGeneration(prompt, selection, undefined, options?.maxSteps);
		}
		if (promptTarget === "document") {
			return this._runDocumentGeneration(
				prompt,
				options?.blockId,
				undefined,
				options?.maxSteps,
			);
		}
		const blockId =
			options?.blockId ??
			resolveActiveBlockId(this._editor.selection) ??
			this._editor.lastBlock()?.id ??
			this._editor.firstBlock()?.id;
		if (!blockId) {
			throw new Error("Cannot run AI prompt without a target block");
		}
		return this._runBlockGeneration(prompt, blockId, undefined, options?.maxSteps);
	}

	async retryActiveGeneration(): Promise<GenerationState | null> {
		const prompt = this._lastPrompt;
		if (!prompt) return null;
		this.rejectActiveGeneration();
		const active = this._state.activeGeneration;
		const blockId =
			active?.blockId ??
			resolveActiveBlockId(this._editor.selection) ??
			this._editor.lastBlock()?.id ??
			this._editor.firstBlock()?.id;
		if (!blockId) return null;
		if (active?.sessionId) {
			const activeSession = this._state.sessions.find(
				(session) => session.id === active.sessionId,
			);
			const retryTarget =
				activeSession?.target.kind === "document"
					? "document"
					: active?.target ?? "block";
			return this.runSessionPrompt(active.sessionId, prompt, {
				blockId: retryTarget === "document" ? null : blockId,
				target: retryTarget,
			});
		}
		if (this._lastCommandId) {
			return this.runCommand(this._lastCommandId, { blockId });
		}
		return this.runPrompt(prompt, {
			blockId,
			target: active?.target ?? "block",
		});
	}

	acceptActiveGeneration(): boolean {
		const generation = this._state.activeGeneration;
		if (!generation) {
			return false;
		}

		if (generation.suggestionIds && generation.suggestionIds.length > 0) {
			const accepted = acceptSuggestions(this._editor, generation.suggestionIds);
			if (accepted) {
				this._resolveActiveGeneration({
					suggestionIds: [],
					structuredPreview: null,
				});
				if (generation.sessionId) {
					if (generation.turnId) {
						this._updateSessionTurn(generation.sessionId, generation.turnId, {
							status: "accepted",
							suggestionIds: [],
							structuredPreview: null,
						});
					}
					this._updateSession(generation.sessionId, {
						status: "complete",
						pendingSuggestionIds: [],
					});
				}
			}
			return accepted;
		}

		if (generation.planState !== "validated" || !generation.plan) {
			return false;
		}

		const execution = buildDocumentMutationPlanExecution(
			this._editor,
			generation.plan,
		);
		if (execution.issues.length > 0) {
			this._resolveActiveGeneration({
				planState: "rejected",
			});
			return false;
		}

		this._editor.apply(execution.ops, { origin: "ai", undoGroup: true });
		this._resolveActiveGeneration({
			planState: "none",
			structuredPreview: null,
		});
		if (generation.sessionId) {
			if (generation.turnId) {
				this._updateSessionTurn(generation.sessionId, generation.turnId, {
					status: "accepted",
					reviewItemIds: [],
					structuredPreview: null,
				});
			}
			this._updateSession(generation.sessionId, {
				status: "complete",
				pendingReviewItemIds: [],
			});
		}
		return true;
	}

	rejectActiveGeneration(): boolean {
		const generation = this._state.activeGeneration;
		if (!generation) return false;

		if (generation.suggestionIds && generation.suggestionIds.length > 0) {
			const rejected = rejectSuggestions(this._editor, generation.suggestionIds);
			if (rejected) {
				this._resolveActiveGeneration({
					suggestionIds: [],
					planState: "rejected",
					structuredPreview: null,
				});
				if (generation.sessionId) {
					if (generation.turnId) {
						this._updateSessionTurn(generation.sessionId, generation.turnId, {
							status: "rejected",
							suggestionIds: [],
							structuredPreview: null,
						});
					}
					this._updateSession(generation.sessionId, {
						status: "complete",
						pendingSuggestionIds: [],
					});
				}
			}
			return rejected;
		}

		if (generation.planState === "validated" && generation.plan) {
			this._resolveActiveGeneration({
				status: "cancelled",
				planState: "rejected",
				structuredPreview: null,
			});
			if (generation.sessionId) {
				if (generation.turnId) {
					this._updateSessionTurn(generation.sessionId, generation.turnId, {
						status: "rejected",
						reviewItemIds: [],
						structuredPreview: null,
					});
				}
				this._updateSession(generation.sessionId, {
					status: "complete",
					pendingReviewItemIds: [],
				});
			}
			return true;
		}

		if (generation.status === "streaming") {
			this.cancelActiveGeneration();
		}

		return this._editor.undoManager.undo();
	}

	acceptReviewItem(id: string): boolean {
		return this.acceptReviewItems([id]);
	}

	rejectReviewItem(id: string): boolean {
		return this.rejectReviewItems([id]);
	}

	acceptReviewItems(ids: readonly string[]): boolean {
		return this._applyReviewItems(ids, "accept");
	}

	rejectReviewItems(ids: readonly string[]): boolean {
		return this._applyReviewItems(ids, "reject");
	}

	private _applyReviewItems(
		ids: readonly string[],
		action: "accept" | "reject",
	): boolean {
		const generation = this._state.activeGeneration;
		if (
			!generation ||
			generation.planState !== "validated" ||
			!generation.plan ||
			!generation.reviewItems
		) {
			return false;
		}

		const reviewItems = resolveOrderedReviewItems(generation.reviewItems, ids);
		if (reviewItems.length === 0) {
			return false;
		}

		if (action === "accept") {
			const selectedPlans = reviewItems.map((reviewItem) =>
				selectStructuralReviewItemPlan(generation.plan!, reviewItem),
			);
			if (selectedPlans.some((plan) => !plan)) {
				return false;
			}
			const resolvedSelectedPlans = selectedPlans.filter(
				(
					plan,
				): plan is NonNullable<(typeof selectedPlans)[number]> => plan != null,
			);

			const selectedPlan =
				resolvedSelectedPlans.length === 1
					? resolvedSelectedPlans[0]!
					: {
						kind: "review_bundle" as const,
						label: "Bulk review selection",
						reason: "Apply selected review items together.",
						plans: resolvedSelectedPlans,
					};
			const execution = buildDocumentMutationPlanExecution(
				this._editor,
				selectedPlan,
			);
			if (execution.issues.length > 0) {
				return false;
			}

			this._editor.apply(execution.ops, { origin: "ai", undoGroup: true });
		}

		let nextPlan: GenerationState["plan"] = generation.plan;
		for (const reviewItem of sortReviewItemsForRemoval(reviewItems)) {
			if (!nextPlan) {
				break;
			}
			nextPlan = removeStructuralReviewItemPlan(nextPlan, reviewItem);
		}
		const nextReviewItems = nextPlan
			? buildStructuralReviewItems(this._editor, nextPlan)
			: [];
		this._resolveActiveGeneration({
			status:
				nextPlan || action === "accept" ? generation.status : "cancelled",
			planState: nextPlan ? "validated" : action === "accept" ? "none" : "rejected",
			plan: nextPlan,
			reviewItems: nextReviewItems,
			structuredPreview: nextPlan
				? buildGenerationStructuredPreviewState(this._editor, {
					planState: "validated",
					plan: nextPlan,
				})
				: null,
		});
		if (generation.sessionId) {
			if (generation.turnId) {
				this._updateSessionTurn(generation.sessionId, generation.turnId, {
					status: nextPlan ? "review" : action === "accept" ? "accepted" : "rejected",
					reviewItemIds: nextReviewItems.map((item) => item.id),
				});
			}
			this._updateSession(generation.sessionId, {
				status:
					nextPlan || action === "accept"
						? generation.status === "streaming"
							? "streaming"
							: "complete"
						: "complete",
				pendingReviewItemIds: nextReviewItems.map((item) => item.id),
			});
		}
		return true;
	}

	cancelActiveGeneration(): void {
		this._abortController?.abort();
		this._abortController = null;
		if (this._state.activeGeneration) {
			this._setState({
				status: "idle",
				activeGeneration: {
					...this._state.activeGeneration,
					status: "cancelled",
					structuredPreview: null,
				},
			});
			if (this._state.activeGeneration.sessionId) {
				if (this._state.activeGeneration.turnId) {
					this._updateSessionTurn(
						this._state.activeGeneration.sessionId,
						this._state.activeGeneration.turnId,
						{ status: "cancelled" },
					);
				}
				this._updateSession(this._state.activeGeneration.sessionId, {
					status: "cancelled",
				});
			}
		}
		this._inlineCompletion.dismissSuggestion();
	}

	openCommandMenu(): void {
		this._setState({ commandMenuOpen: true });
	}

	closeCommandMenu(): void {
		this._setState({ commandMenuOpen: false });
	}

	setSuggestMode(enabled: boolean): void {
		this._setState({ suggestMode: enabled });
	}

	showEphemeralSuggestion(
		suggestion: Parameters<AIInlineCompletionController["showSuggestion"]>[0],
	): void {
		this._inlineCompletion.showSuggestion(suggestion);
	}

	dismissEphemeralSuggestion(): void {
		this._inlineCompletion.dismissSuggestion();
	}

	acceptEphemeralSuggestion(): void {
		this._inlineCompletion.acceptSuggestion();
	}

	getSuggestions() {
		return this._suggestions;
	}

	handleDocumentChange(events: readonly { origin: string; affectedBlocks: readonly string[] }[]): void {
		if (events.length > 0) {
			this._documentVersion += 1;
		}
		const previousState = this._state;
		const suggestionsChanged = this._syncSuggestionsFromDocument();
		const sessionsChanged = this._syncSessionsFromDocument();
		this.handleExternalCommit(events);
		if (this._state === previousState) {
			this._editor.requestDecorationUpdate();
			if (suggestionsChanged || sessionsChanged) {
				this._emit();
			}
		}
	}

	acceptSuggestion(id: string): boolean {
		return acceptSuggestion(this._editor, id);
	}

	rejectSuggestion(id: string): boolean {
		return rejectSuggestion(this._editor, id);
	}

	acceptAllSuggestions(): void {
		acceptAllSuggestions(this._editor);
	}

	rejectAllSuggestions(): void {
		rejectAllSuggestions(this._editor);
	}

	buildDecorations(): Decoration[] {
		const decorations = [
			...buildTrackChangesDecorations(this._editor),
			...buildAffectedRangeDecorations(
				this._editor,
				this._state.sessions,
				this._state.activeSessionId,
			),
			...buildGenerationZoneDecorations(this._state.activeGeneration),
			...(this._renderInlineCompletionDecorations
				? this._inlineCompletion.buildDecorations()
				: []),
		];
		return decorations;
	}

	handleExternalCommit(events: readonly { origin: string; affectedBlocks: readonly string[] }[]): void {
		const active = this._state.activeGeneration;
		if (!active || active.status !== "streaming") return;
		if (
			active.route === "tool-loop" ||
			active.route === "context-first" ||
			active.route === "review"
		) {
			return;
		}
		const touched = events.some((event) =>
			event.origin !== "ai" &&
			event.origin !== AI_SESSION_SUGGESTION_ORIGIN &&
			event.origin !== "system" &&
			event.origin !== "extension" &&
			event.affectedBlocks.includes(active.blockId),
		);
		if (!touched) return;
		this.cancelActiveGeneration();
	}

	private async _runBlockGeneration(
		prompt: string,
		blockId: string,
		commandId?: string,
		maxSteps?: number,
		context?: GenerationExecutionContext,
	): Promise<GenerationState> {
		const block = this._editor.getBlock(blockId);
		if (!block) {
			throw new Error(`Block "${blockId}" not found`);
		}

		const target: GenerationTarget = {
			type: "block",
			blockId,
			offset: resolveBlockInsertionOffset(this._editor, blockId),
		};
		return this._executeGeneration(prompt, target, commandId, maxSteps, context);
	}

	private async _runDocumentGeneration(
		prompt: string,
		preferredBlockId?: string | null,
		commandId?: string,
		maxSteps?: number,
		context?: GenerationExecutionContext,
	): Promise<GenerationState> {
		const insertionAnchor = resolveDocumentInsertionAnchor(this._editor, {
			preferredBlockId:
				preferredBlockId ??
				resolveActiveBlockId(this._editor.selection) ??
				null,
		});
		if (!insertionAnchor) {
			throw new Error("Cannot run an AI document prompt without an insertion anchor");
		}

		return this._runBlockGeneration(
			prompt,
			insertionAnchor.blockId,
			commandId,
			maxSteps,
			context,
		);
	}

	private async _runSelectionGeneration(
		prompt: string,
		selection: TextSelection,
		commandId?: string,
		maxSteps?: number,
		context?: GenerationExecutionContext,
	): Promise<GenerationState> {
		return this._executeGeneration(
			prompt,
			{ type: "selection", selection },
			commandId,
			maxSteps,
			context,
		);
	}

	private async _executeGeneration(
		prompt: string,
		target: GenerationTarget,
		commandId?: string,
		maxSteps?: number,
		context?: GenerationExecutionContext,
	): Promise<GenerationState> {
		if (!this._model) {
			throw new Error("No AI model configured");
		}

		this.cancelActiveGeneration();
		const toolRuntime =
			getDocumentToolRuntime(this._editor) ??
			EMPTY_TOOL_RUNTIME;
		const abortController = new AbortController();
		this._abortController = abortController;

		const baselineSuggestionIds = new Set(this.getSuggestions().map((item) => item.id));
		const blockId =
			target.type === "block"
				? target.blockId
				: target.selection.toRange().start.blockId;
		const requestedContentFormat = this._resolveContentFormat(
			target.type,
			context?.surface,
		);
		let route = routeAIRequest({
			prompt,
			selection: this._editor.selection,
			blockType: this._editor.getBlock(blockId)?.type ?? null,
			blockCount: this._editor.blockCount(),
			suggestMode: this._state.suggestMode,
			target: target.type,
			contentFormat: requestedContentFormat,
			surface: context?.surface,
		});
		let workingSet = await this._buildWorkingSet(
			toolRuntime,
			route,
			target,
			blockId,
			prompt,
		);
		const refinedRoute = this._refineRouteWithWorkingSet(route, workingSet);
		if (refinedRoute.lane !== route.lane) {
			route = refinedRoute;
			workingSet = await this._buildWorkingSet(
				toolRuntime,
				route,
				target,
				blockId,
				prompt,
			);
		} else {
			route = refinedRoute;
		}
		const adapter = getBlockAdapter(route.adapterId);
		const contentFormat = route.contentFormat;
		let currentText = "";
		const streamingTarget =
			this._editor.internals.getSlot<StreamingTarget>("delta-stream:target") ??
			null;
		let blockStreamingStarted = false;
		const shouldStreamDirectly = route.shouldStreamDirectly;
		const selectionRange =
			target.type === "selection" ? target.selection.toRange() : null;
		const selectionSourceText =
			target.type === "selection"
				? resolveSelectionText(this._editor, target.selection)
				: "";
		const shouldStreamSuggestedText =
			route.mutationMode === "streaming-suggestions" &&
			route.plannerMode !== "structured" &&
			contentFormat === "text";
		const shouldReplaceMarkdownTarget =
			route.plannerMode !== "structured" &&
			contentFormat === "markdown" &&
			target.type === "block" &&
			(
				route.targetKind === "table" ||
				(
					context?.surface === "bottom-chat" &&
					shouldReplaceEmptyMarkdownTarget(this._editor.getBlock(blockId))
				)
			);
		const canStreamSelectionSuggestions =
			shouldStreamSuggestedText &&
			target.type === "selection" &&
			selectionRange?.start.blockId === selectionRange?.end.blockId;
		const canStreamBlockSuggestions =
			shouldStreamSuggestedText && target.type === "block";
		const canStreamMarkdownBlockSuggestions =
			route.mutationMode === "streaming-suggestions" &&
			route.plannerMode !== "structured" &&
			contentFormat === "markdown" &&
			target.type === "block" &&
			route.applyStrategy === "markdown-full-replace" &&
			context?.surface === "bottom-chat";
		let streamedSuggestionInitialized = false;
		let streamedSuggestionLength = 0;
		let streamedMarkdownSuggestionIds: string[] = [];
		let lastStreamedMarkdownPreviewText = "";
		const sessionTurnId = context?.sessionId ? crypto.randomUUID() : undefined;
		let shouldTrimLeadingBlankBlockText =
			target.type === "block" &&
			shouldTrimLeadingBlankBlockGenerationText(this._editor.getBlock(blockId));
		const useStructuredIntentTransport =
			adapter.transportKind !== "flow-text" && supportsStructuredIntent(this._model);
		const generationPrompt =
			useStructuredIntentTransport ||
				(adapter.id === "flow-markdown" && contentFormat === "markdown")
				? adapter.buildPrompt({
					prompt,
					targetKind: route.targetKind,
					activeBlockId: blockId,
					workingSet,
					applyStrategy: route.applyStrategy,
				})
				: route.plannerMode === "structured"
					? buildPlannerPrompt({
						prompt,
						targetKind: route.targetKind,
						workingSet,
					})
					: prompt;

		const seedGeneration: GenerationState = {
			id: crypto.randomUUID(),
			zoneId: crypto.randomUUID(),
			blockId,
			target: target.type,
			sessionId: context?.sessionId,
			turnId: sessionTurnId,
			surface: context?.surface,
			prompt,
			status: "streaming",
			tokenCount: 0,
			steps: [],
			undoGroupId: crypto.randomUUID(),
			text: "",
			commandId,
			suggestionIds: [],
			route: route.lane,
			mutationMode: route.mutationMode,
			contentFormat,
			applyStrategy: route.applyStrategy,
			planState: "none",
			plan: null,
			structuredIntent: null,
			reviewItems: [],
			structuredPreview: null,
			targetKind: route.targetKind,
			blockClass: route.blockClass,
			adapterId: route.adapterId,
			transportKind: route.transportKind,
			mutationReceipt: null,
			debug: {
				messageAssemblyLatencyMs: 0,
				firstToolStartMs: null,
				firstToolResultMs: null,
				firstVisibleTextMs: null,
				toolExecutionMs: 0,
				qualitySignals: {},
				routeConfidence: workingSet?.routeConfidence,
				structured: {
					plannerMode: route.plannerMode,
					executionMode: resolveExecutionMode(route.mutationMode),
					targetKind: route.targetKind,
					validationIssueCount: 0,
				},
				fastApply: {
					attempted: false,
					succeeded: false,
				},
			},
		};
		if (context?.sessionId) {
			const existingSession = this._state.sessions.find(
				(session) => session.id === context.sessionId,
			);
			const nextSelectionSnapshot =
				target.type === "selection"
					? resolveSessionSelectionSnapshot(target.selection)
					: undefined;
			this._updateSession(context.sessionId, {
				status: "streaming",
				activeTurnId: sessionTurnId,
				anchor:
					target.type === "selection"
						? resolveSessionAnchor(target.selection)
						: resolveSessionAnchor(this._editor.selection),
				generationIds: appendUniqueString(
					existingSession?.generationIds ?? [],
					seedGeneration.id,
				),
				promptHistory: [
					...(existingSession?.promptHistory ?? []),
					{
						id: crypto.randomUUID(),
						prompt,
						createdAt: Date.now(),
						generationId: seedGeneration.id,
					},
				],
				turns: sessionTurnId
					? [
						...(existingSession?.turns ?? []),
						{
							id: sessionTurnId,
							prompt,
							createdAt: Date.now(),
							generationId: seedGeneration.id,
							target: target.type,
							status: "streaming",
							suggestionIds: [],
							reviewItemIds: [],
							structuredPreview: null,
							anchor:
								target.type === "selection"
									? resolveSessionAnchor(target.selection)
									: undefined,
							selection:
								target.type === "selection"
									? resolveSessionSelectionSnapshot(target.selection)
									: undefined,
						},
					]
					: existingSession?.turns,
				contextualPrompt:
					existingSession?.contextualPrompt
						? {
							...existingSession.contextualPrompt,
							anchor:
								target.type === "selection"
									? {
										...existingSession.contextualPrompt.anchor,
										selectionSnapshot: nextSelectionSnapshot,
										focusBlockId: target.selection.toRange().start.blockId,
										status: "valid",
									}
									: existingSession.contextualPrompt.anchor,
							composer: {
								...existingSession.contextualPrompt.composer,
								draftPrompt: "",
								isSubmitting: true,
								isOpen: true,
							},
						}
						: undefined,
			});
		}
		this._setState({
			status: "thinking",
			activeGeneration: seedGeneration,
			commandMenuOpen: false,
			lastRoute: route.lane,
			activeSessionId: context?.sessionId ?? this._state.activeSessionId,
		});
		let currentStructuredPreview: GenerationStructuredPreviewState | null = null;
		let currentStructuredIntent: GenerationState["structuredIntent"] = null;
		let currentMutationReceipt: AIMutationReceipt | null = null;
		this._setStreamEvents([
			createAIStreamEvent(seedGeneration, {
				type: "generation-start",
				prompt,
				target: target.type,
			}),
			createAIStreamEvent(seedGeneration, {
				type: "status",
				status: "thinking",
			}),
		]);

		try {
			const result = await runAgenticLoop({
				model: this._model,
				editor: this._editor,
				toolRuntime: route.allowToolUse ? toolRuntime : EMPTY_TOOL_RUNTIME,
				prompt: generationPrompt,
				blockId,
				generationId: seedGeneration.id,
				zoneId: seedGeneration.zoneId,
				maxSteps: route.allowToolUse ? (maxSteps ?? this._maxAgenticSteps) : 1,
				signal: abortController.signal,
				workingSet,
				validateWorkingSet: (activeWorkingSet) =>
					this._validateWorkingSet(route, target, activeWorkingSet),
				refreshWorkingSet: async () =>
					this._buildWorkingSet(toolRuntime, route, target, blockId, prompt),
				onStatusChange: (status) => {
					this._setState({ status });
					this._appendStreamEvent(
						createAIStreamEvent(seedGeneration, {
							type: "status",
							status,
						}),
					);
				},
				onStep: (step) => {
					const active = this._state.activeGeneration;
					if (!active) return;
					this._setState({
						activeGeneration: {
							...active,
							steps: [...active.steps, step],
						},
					});
				},
				onTextDelta: (delta) => {
					const nextDelta =
						target.type === "block" && shouldTrimLeadingBlankBlockText
							? trimLeadingBlankBlockGenerationText(delta)
							: delta;
					if (shouldTrimLeadingBlankBlockText && nextDelta.length > 0) {
						shouldTrimLeadingBlankBlockText = false;
					}
					if (nextDelta.length === 0) {
						return;
					}
					currentText += nextDelta;
					if (target.type === "block" && shouldStreamDirectly) {
						streamingTarget?.appendDelta(nextDelta);
					} else if (canStreamSelectionSuggestions && selectionRange) {
						if (!streamedSuggestionInitialized) {
							this._applySuggestedAIOps(
								[{
									type: "replace-text",
									blockId: selectionRange.start.blockId,
									offset: selectionRange.start.offset,
									length: selectionRange.end.offset - selectionRange.start.offset,
									text: nextDelta,
								}],
								context?.sessionId,
							);
							streamedSuggestionInitialized = true;
							streamedSuggestionLength = nextDelta.length;
						} else if (nextDelta.length > 0) {
							this._applySuggestedAIOps(
								[{
									type: "insert-text",
									blockId: selectionRange.start.blockId,
									offset: selectionRange.end.offset + streamedSuggestionLength,
									text: nextDelta,
								}],
								context?.sessionId,
							);
							streamedSuggestionLength += nextDelta.length;
						}
					} else if (canStreamBlockSuggestions && target.type === "block") {
						if (nextDelta.length > 0) {
							this._applySuggestedAIOps(
								[{
									type: "insert-text",
									blockId: target.blockId,
									offset: target.offset + streamedSuggestionLength,
									text: nextDelta,
								}],
								context?.sessionId,
							);
							streamedSuggestionLength += nextDelta.length;
						}
					} else if (canStreamMarkdownBlockSuggestions && target.type === "block") {
						const previewRefresh = this._refreshStreamingMarkdownBlockPreview(
							target.blockId,
							currentText,
							route.mutationMode,
							context?.sessionId,
							baselineSuggestionIds,
							streamedMarkdownSuggestionIds,
							lastStreamedMarkdownPreviewText,
							shouldReplaceMarkdownTarget,
						);
						streamedMarkdownSuggestionIds = previewRefresh.suggestionIds;
						lastStreamedMarkdownPreviewText = previewRefresh.normalizedText;
					} else if (target.type === "selection") {
						this._inlineCompletion.showSuggestion({
							id: seedGeneration.id,
							blockId: blockId,
							offset: target.selection.toRange().start.offset,
							text: currentText,
							type: "inline",
						});
					}
					const active = this._state.activeGeneration;
					if (!active) return;
					this._setState({
						activeGeneration: {
							...active,
							text: currentText,
							status: "streaming",
						},
					});
					this._appendStreamEvent(
						createAIStreamEvent(seedGeneration, {
							type: "text-delta",
							delta: nextDelta,
							text: currentText,
						}),
					);
					if (route.plannerMode === "structured" && !useStructuredIntentTransport) {
						const previewResult = parseStructuredPlanPreview(
							currentText,
							route.targetKind,
						);
						if (previewResult?.plan) {
							const nextStructuredPreview =
								buildGenerationStructuredPreviewState(this._editor, {
									planState: previewResult.planState === "validated"
										? "validated"
										: "drafted",
									plan: previewResult.plan,
								});
							if (
								!areStructuredValuesEqual(
									currentStructuredPreview,
									nextStructuredPreview,
								)
							) {
								const patches = buildStructuredPreviewPatchOperations(
									currentStructuredPreview,
									nextStructuredPreview,
								);
								currentStructuredPreview = nextStructuredPreview;
								this._resolveActiveGeneration({
									structuredPreview: nextStructuredPreview,
								});
								if (context?.sessionId && sessionTurnId) {
									this._updateSessionTurn(context.sessionId, sessionTurnId, {
										reviewItemIds: nextStructuredPreview.reviewItems.map((item) => item.id),
										structuredPreview: nextStructuredPreview,
									});
								}
								this._appendStreamEvent(
									createAIStreamEvent(seedGeneration, {
										type: "structured-preview",
										preview: nextStructuredPreview,
										patches,
									}),
								);
							}
						}
					}
				},
				onStructuredData: (event) => {
					if (!useStructuredIntentTransport) {
						return;
					}
					const previewResult = adapter.parsePreview?.({
						value: event.data,
						targetKind: route.targetKind,
						activeBlockId: blockId,
					}) ?? null;
					if (!previewResult?.intent) {
						return;
					}
					currentStructuredIntent = previewResult.intent;
					const compilation = compileStructuredIntentToPlan(previewResult.intent, {
						activeBlockId: blockId,
					});
					if (!compilation.plan) {
						return;
					}
					const nextStructuredPreview = buildGenerationStructuredPreviewState(
						this._editor,
						{
							planState:
								previewResult.intentState === "validated" &&
									compilation.issues.length === 0
									? "validated"
									: "drafted",
							plan: compilation.plan,
						},
					);
					if (
						areStructuredValuesEqual(
							currentStructuredPreview,
							nextStructuredPreview,
						)
					) {
						return;
					}
					const patches = buildStructuredPreviewPatchOperations(
						currentStructuredPreview,
						nextStructuredPreview,
					);
					currentStructuredPreview = nextStructuredPreview;
					this._resolveActiveGeneration({
						structuredIntent: previewResult.intent,
						structuredPreview: nextStructuredPreview,
					});
					if (context?.sessionId && sessionTurnId) {
						this._updateSessionTurn(context.sessionId, sessionTurnId, {
							reviewItemIds: nextStructuredPreview.reviewItems.map((item) => item.id),
							structuredPreview: nextStructuredPreview,
						});
					}
					this._appendStreamEvent(
						createAIStreamEvent(seedGeneration, {
							type: "app-partial",
							data: event.data,
							final: event.final,
						}),
					);
					this._appendStreamEvent(
						createAIStreamEvent(seedGeneration, {
							type: "structured-preview",
							preview: nextStructuredPreview,
							patches,
						}),
					);
				},
				onToolCall: (event) => {
					this._appendStreamEvent(
						createAIStreamEvent(seedGeneration, {
							type: "tool-call",
							toolCallId: event.toolCallId,
							toolName: event.toolName,
							input: event.input,
						}),
					);
				},
				onToolOutput: (event) => {
					this._appendStreamEvent(
						createAIStreamEvent(seedGeneration, {
							type: "tool-output",
							toolCallId: event.toolCallId,
							toolName: event.toolName,
							part: event.part,
							output: event.output,
						}),
					);
				},
				onToolResult: (event) => {
					this._appendStreamEvent(
						createAIStreamEvent(seedGeneration, {
							type: "tool-result",
							toolCallId: event.toolCallId,
							toolName: event.toolName,
							output: event.output,
							state: event.state,
						}),
					);
				},
				onDebug: (debug) => {
					const active = this._state.activeGeneration;
					if (!active) return;
					this._setState({
						activeGeneration: {
							...active,
							debug,
						},
					});
				},
				onStreamingStart: (zoneId, targetBlockId) => {
					if (target.type !== "block" || !shouldStreamDirectly || blockStreamingStarted) return;
					streamingTarget?.beginStreaming(zoneId, targetBlockId);
					blockStreamingStarted = true;
				},
				onStreamingEnd: (status) => {
					if (target.type !== "block" || !shouldStreamDirectly || !blockStreamingStarted) return;
					streamingTarget?.endStreaming(status);
					blockStreamingStarted = false;
				},
			});

			if (
				target.type === "selection" &&
				currentText.length > 0 &&
				!canStreamSelectionSuggestions
			) {
				currentMutationReceipt = this._commitSelectionRewrite(
					target.selection,
					currentText,
					route.mutationMode,
					context?.sessionId,
				);
				this._inlineCompletion.dismissSuggestion();
			} else if (
				target.type === "selection" &&
				currentText.length > 0 &&
				canStreamSelectionSuggestions
			) {
				this._recordFastApplyDebug({
					attempted: true,
					succeeded: true,
					executionPath: "native-fast-apply",
					contextChars: selectionSourceText.length,
					diffChars: currentText.length,
				});
			} else if (
				target.type === "block" &&
				currentText.length > 0 &&
				!shouldStreamDirectly &&
				!canStreamBlockSuggestions &&
				!canStreamMarkdownBlockSuggestions &&
				route.plannerMode !== "structured"
			) {
				currentMutationReceipt = this._commitBufferedBlockGeneration(
					target.blockId,
					currentText,
					route.mutationMode,
					contentFormat,
					context?.sessionId,
					{
						applyStrategy: route.applyStrategy,
						insertionOffset: target.offset,
						workingSet,
						replaceTargetBlock: shouldReplaceMarkdownTarget,
					},
				);
				this._inlineCompletion.dismissSuggestion();
			}

			const suggestionIds = this.getSuggestions()
				.map((item) => item.id)
				.filter((id) => !baselineSuggestionIds.has(id));
			const structuredPlanResult =
				route.plannerMode === "structured" && !useStructuredIntentTransport
					? parseStructuredPlanResult(currentText, route.targetKind)
					: null;
			const structuredIntentResolution =
				useStructuredIntentTransport
					? adapter.resolveResult?.({
						value: currentStructuredIntent,
						targetKind: route.targetKind,
						activeBlockId: blockId,
					}) ?? null
					: null;
			const structuredIntentResult = structuredIntentResolution?.parseResult ?? null;
			const structuredIntentCompilation =
				structuredIntentResolution?.compilation ?? null;
			const resolvedStructuredPlan =
				structuredIntentCompilation?.plan ?? structuredPlanResult?.plan ?? null;
			const planExecution = resolvedStructuredPlan
				? buildDocumentMutationPlanExecution(
					this._editor,
					resolvedStructuredPlan,
				)
				: null;
			const reviewItems =
				resolvedStructuredPlan &&
					route.mutationMode !== "direct-stream" &&
					(!planExecution || !planExecution.reviewSafe)
					? buildStructuralReviewItems(this._editor, resolvedStructuredPlan)
					: [];

			if (
				resolvedStructuredPlan &&
				planExecution &&
				planExecution.issues.length === 0
			) {
				currentMutationReceipt = this._commitStructuredPlan(
					planExecution.ops,
					planExecution.reviewSafe,
					route.mutationMode,
					route.adapterId,
					route.blockClass,
					route.transportKind,
				);
			}
			if (!currentMutationReceipt) {
				currentMutationReceipt = this._buildFallbackMutationReceipt({
					currentText,
					suggestionIds,
					reviewItems,
					planExecutionIssueCount: planExecution?.issues.length ?? 0,
					adapterId: route.adapterId,
					blockClass: route.blockClass,
					transportKind: route.transportKind,
				});
			}
			const structuredDebug = {
				plannerMode: route.plannerMode,
				executionMode: resolveExecutionMode(route.mutationMode),
				targetKind: route.targetKind,
				validationIssueCount:
					(structuredPlanResult?.issues.length ?? 0) +
					(structuredIntentResult?.issues.length ?? 0) +
					(structuredIntentCompilation?.issues.length ?? 0) +
					(planExecution?.issues.length ?? 0),
			};
			const resolvedDebug =
				this._state.activeGeneration?.id === seedGeneration.id
					? (this._state.activeGeneration.debug ?? result.debug ?? seedGeneration.debug!)
					: (result.debug ?? seedGeneration.debug!);
			const resolvedPlanState: GenerationState["planState"] =
				planExecution && planExecution.issues.length > 0
					? "rejected"
					: structuredIntentResult?.intentState === "validated" &&
						(structuredIntentCompilation?.issues.length ?? 0) === 0
						? "validated"
						: structuredIntentResult?.intentState === "drafted"
							? "drafted"
							: structuredPlanResult?.planState ?? seedGeneration.planState;

			const finalGeneration: GenerationState = {
				...result,
				blockId,
				target: target.type,
				sessionId: context?.sessionId,
				turnId: sessionTurnId,
				surface: context?.surface,
				commandId,
				text: currentText,
				suggestionIds,
				route: route.lane,
				mutationMode: route.mutationMode,
				contentFormat,
				planState: resolvedPlanState,
				plan: resolvedStructuredPlan,
				structuredIntent:
					structuredIntentResult?.intent ?? currentStructuredIntent ?? null,
				reviewItems,
				structuredPreview:
					resolvedStructuredPlan
						? buildGenerationStructuredPreviewState(this._editor, {
							planState:
								planExecution && planExecution.issues.length === 0
									? "validated"
									: "drafted",
							plan: resolvedStructuredPlan,
						})
						: currentStructuredPreview,
				targetKind: route.targetKind,
				blockClass: route.blockClass,
				adapterId: route.adapterId,
				transportKind: route.transportKind,
				mutationReceipt: currentMutationReceipt,
				debug: {
					...resolvedDebug,
					structured: structuredDebug,
				},
			};
			this._abortController = null;
			this._appendStreamEvent(
				createAIStreamEvent(seedGeneration, {
					type: "generation-finish",
					status: finalGeneration.status,
					text: currentText,
				}),
			);
			this._setState({
				status: "idle",
				activeGeneration: finalGeneration,
			});
			if (context?.sessionId) {
				const structuredPreviewEvents = this.getStreamEvents().filter(
					(event) =>
						event.type === "structured-preview" &&
						event.sessionId === context.sessionId,
				);
				const lastStructuredPreviewEvent =
					structuredPreviewEvents[structuredPreviewEvents.length - 1];
				if (sessionTurnId) {
					this._updateSessionTurn(context.sessionId, sessionTurnId, {
						status:
							suggestionIds.length > 0 || reviewItems.length > 0
								? "review"
								: finalGeneration.status === "complete"
									? "complete"
									: finalGeneration.status,
						suggestionIds,
						reviewItemIds: reviewItems.map((item) => item.id),
						structuredPreview: finalGeneration.structuredPreview ?? null,
					});
				}
				const resolvedGenerationDebug =
					this._state.activeGeneration?.id === finalGeneration.id
						? this._state.activeGeneration.debug
						: finalGeneration.debug;
				this._recordSessionFastApplyMetrics(
					context.sessionId,
					resolvedGenerationDebug?.fastApply,
				);
				this._updateSession(context.sessionId, {
					status: finalGeneration.status === "complete" ? "complete" : finalGeneration.status,
					pendingSuggestionIds: suggestionIds,
					pendingReviewItemIds: reviewItems.map((item) => item.id),
					metrics: {
						...(this._state.sessions.find((session) => session.id === context.sessionId)
							?.metrics ?? {
								streamEventCount: 0,
								patchCount: 0,
								fastApply: createDefaultSessionFastApplyMetrics(),
							}),
						firstTokenMs: resolvedGenerationDebug?.firstVisibleTextMs ?? undefined,
						totalMs: resolvedGenerationDebug?.messageAssemblyLatencyMs != null
							? resolvedGenerationDebug.messageAssemblyLatencyMs +
							(resolvedGenerationDebug.toolExecutionMs ?? 0)
							: undefined,
						toolMs: resolvedGenerationDebug?.toolExecutionMs ?? undefined,
						streamEventCount: this._streamEvents.filter(
							(event) => event.sessionId === context.sessionId,
						).length,
						patchCount:
							lastStructuredPreviewEvent?.type === "structured-preview"
								? lastStructuredPreviewEvent.patches.length
								: 0,
					},
				});
			}

			if (finalGeneration.status === "complete") {
				this._editor.internals.emit("diagnostic", {
					level: "info",
					source: "ai",
					code: "GENERATION_COMPLETE",
					message: "AI generation completed",
					blockId,
					generationId: finalGeneration.id,
				});
			}

			return finalGeneration;
		} catch (error) {
			const isStaleWorkingSet =
				error instanceof Error && error.name === "StaleWorkingSetError";
			const failedGeneration: GenerationState = {
				...(this._state.activeGeneration ?? seedGeneration),
				blockId,
				sessionId: context?.sessionId,
				turnId: sessionTurnId,
				surface: context?.surface,
				prompt,
				commandId,
				text: currentText,
				status:
					abortController.signal.aborted || isStaleWorkingSet
						? "cancelled"
						: "error",
				targetKind: route.targetKind,
			};
			this._abortController = null;
			this._inlineCompletion.dismissSuggestion();
			if (target.type === "block" && blockStreamingStarted) {
				streamingTarget?.endStreaming(
					abortController.signal.aborted ? "cancelled" : "error",
				);
				blockStreamingStarted = false;
			}
			this._appendStreamEvent(
				createAIStreamEvent(seedGeneration, {
					type: "generation-finish",
					status: failedGeneration.status,
					text: currentText,
				}),
			);
			this._setState({
				status: "idle",
				activeGeneration: failedGeneration,
			});
			if (context?.sessionId) {
				if (sessionTurnId) {
					this._updateSessionTurn(context.sessionId, sessionTurnId, {
						status: failedGeneration.status,
						reviewItemIds: [],
						structuredPreview: null,
					});
				}
				this._updateSession(context.sessionId, {
					status: failedGeneration.status,
				});
			}
			if (abortController.signal.aborted || isStaleWorkingSet) {
				return failedGeneration;
			}
			throw error;
		}
	}

	private _commitSelectionRewrite(
		selection: TextSelection,
		text: string,
		mutationMode: NonNullable<GenerationState["mutationMode"]>,
		sessionId?: string,
	): AIMutationReceipt {
		const selectedText = resolveSelectionText(this._editor, selection);
		const ops = buildSelectionReplacementOps(this._editor, selection, text);
		if (
			mutationMode === "persistent-suggestions" ||
			mutationMode === "streaming-suggestions" ||
			mutationMode === "staged-review"
		) {
			this._applySuggestedAIOps(ops, sessionId);
			this._recordFastApplyDebug({
				attempted: true,
				succeeded: true,
				executionPath: "native-fast-apply",
				contextChars: selectedText.length,
				diffChars: text.length,
			});
			return buildMutationReceipt({
				status: "staged_suggestions",
				ops,
				adapterId: "flow-markdown",
				blockClass: "flow",
				transportKind: "flow-text",
			});
		}
		this._editor.selectTextRange(selection.anchor, selection.focus);
		this._editor.deleteSelection({ origin: "ai" });
		const nextSelection = this._editor.selection;
		if (nextSelection?.type !== "text") {
			this._recordFastApplyDebug({
				attempted: true,
				succeeded: false,
				contextChars: selectedText.length,
				diffChars: text.length,
				fallbackReason: "selection-lost",
			});
			return buildMutationReceipt({
				status: "invalid",
				ops,
				adapterId: "flow-markdown",
				blockClass: "flow",
				transportKind: "flow-text",
				issues: ["Selection rewrite lost the active text selection."],
			});
		}
		const caret = nextSelection.anchor;
		if (text.length > 0) {
			this._editor.apply(
				[{
					type: "insert-text",
					blockId: caret.blockId,
					offset: caret.offset,
					text,
				}],
				{ origin: "ai" },
			);
		}
		this._editor.selectTextRange(
			{
				blockId: caret.blockId,
				offset: caret.offset + text.length,
			},
			{
				blockId: caret.blockId,
				offset: caret.offset + text.length,
			},
		);
		this._recordFastApplyDebug({
			attempted: true,
			succeeded: true,
			executionPath: "native-fast-apply",
			contextChars: selectedText.length,
			diffChars: text.length,
		});
		return buildMutationReceipt({
			status: "applied",
			ops,
			adapterId: "flow-markdown",
			blockClass: "flow",
			transportKind: "flow-text",
		});
	}

	private _commitBufferedBlockGeneration(
		blockId: string,
		text: string,
		mutationMode: NonNullable<GenerationState["mutationMode"]>,
		contentFormat: AIContentFormat,
		sessionId?: string,
		options?: {
			applyStrategy?: AIApplyStrategy;
			insertionOffset?: number;
			workingSet?: AIWorkingSetEnvelope | null;
			replaceTargetBlock?: boolean;
		},
	): AIMutationReceipt {
		let fastApplyFallbackMode:
			| "plain-markdown"
			| null = null;
		if (
			contentFormat === "markdown" &&
			options?.applyStrategy === "markdown-fast-apply"
		) {
			const fastApplyReceipt = this._commitBufferedMarkdownFastApply(
				blockId,
				text,
				mutationMode,
				sessionId,
				options.workingSet ?? null,
			);
			if (fastApplyReceipt) {
				return fastApplyReceipt;
			}
			if (!text.trim().startsWith(`<${MARKDOWN_FAST_APPLY_ROOT_TAG}>`)) {
				// Backward compatibility: tolerate plain markdown when the model
				// does not honor the fast-apply contract.
				fastApplyFallbackMode = "plain-markdown";
			} else {
				return buildMutationReceipt({
					status: "invalid",
					adapterId: "flow-markdown",
					blockClass: "flow",
					transportKind: "flow-text",
					issues: ["Fast apply contract could not be compiled safely."],
				});
			}
		}

		const normalizedText =
			contentFormat === "markdown"
				? normalizeFlowMarkdownOutput(text)
				: text;
		if (
			contentFormat === "markdown" &&
			(mutationMode === "persistent-suggestions" ||
				mutationMode === "streaming-suggestions" ||
				mutationMode === "staged-review") &&
			this._applySuggestedMarkdownPlaceholderReplacement(
				blockId,
				normalizedText,
				sessionId,
				options?.replaceTargetBlock,
			)
		) {
			if (fastApplyFallbackMode) {
				this._recordFastApplyDebug({
					executionPath: "plain-markdown",
					fallback: this._summarizeFastApplyFallbackOps(
						"plain-markdown",
						[],
					),
				});
			}
			return buildMutationReceipt({
				status: "staged_suggestions",
				adapterId: "flow-markdown",
				blockClass: "flow",
				transportKind: "flow-text",
			});
		}

		const ops =
			contentFormat === "markdown"
				? this._buildMarkdownBlockGenerationOps(
					blockId,
					normalizedText,
					options?.replaceTargetBlock,
				)
				: this._buildTextBlockGenerationOps(
					blockId,
					normalizedText,
					options?.insertionOffset,
				);
		if (ops.length === 0) {
			if (fastApplyFallbackMode) {
				this._recordFastApplyDebug({
					executionPath: "plain-markdown",
					fallback: this._summarizeFastApplyFallbackOps(
						"plain-markdown",
						ops,
					),
				});
			}
			return buildMutationReceipt({
				status: "noop",
				ops,
				adapterId: "flow-markdown",
				blockClass: "flow",
				transportKind: "flow-text",
			});
		}
		if (
			mutationMode === "persistent-suggestions" ||
			mutationMode === "streaming-suggestions" ||
			mutationMode === "staged-review"
		) {
			this._applySuggestedAIOps(ops, sessionId);
			if (fastApplyFallbackMode) {
				this._recordFastApplyDebug({
					executionPath: "plain-markdown",
					fallback: this._summarizeFastApplyFallbackOps(
						"plain-markdown",
						ops,
					),
				});
			}
			return buildMutationReceipt({
				status: "staged_suggestions",
				ops,
				adapterId: "flow-markdown",
				blockClass: "flow",
				transportKind: "flow-text",
			});
		}
		this._editor.apply(ops, { origin: "ai", undoGroup: true });
		if (fastApplyFallbackMode) {
			this._recordFastApplyDebug({
				executionPath: "plain-markdown",
				fallback: this._summarizeFastApplyFallbackOps(
					"plain-markdown",
					ops,
				),
			});
		}
		return buildMutationReceipt({
			status: "applied",
			ops,
			adapterId: "flow-markdown",
			blockClass: "flow",
			transportKind: "flow-text",
		});
	}

	private _commitBufferedMarkdownFastApply(
		blockId: string,
		text: string,
		mutationMode: NonNullable<GenerationState["mutationMode"]>,
		sessionId: string | undefined,
		workingSet: AIWorkingSetEnvelope | null,
	): AIMutationReceipt | null {
		const fastApplyScope = this._resolveMarkdownFastApplyScope(blockId, workingSet);
		if (!fastApplyScope) {
			this._recordFastApplyDebug({
				attempted: true,
				succeeded: false,
				fallbackReason: "missing-scope",
			});
			return null;
		}

		const patchPlan = parseMarkdownPatchPlanContract(text);
		if (patchPlan) {
			const validation = validateDocumentMutationPlanShape(
				patchPlan,
				this._buildPlanValidationContext(blockId, fastApplyScope.blockIds),
			);
			if (!validation.valid) {
				this._recordFastApplyDebug({
					attempted: true,
					succeeded: false,
					contextChars: fastApplyScope.markdown.length,
					fallbackReason: "invalid-patch-plan",
					verificationFailureReason: validation.issues[0]?.message,
				});
				return null;
			}

			const execution = buildDocumentMutationPlanExecution(this._editor, patchPlan);
			if (execution.issues.length > 0) {
				this._recordFastApplyDebug({
					attempted: true,
					succeeded: false,
					contextChars: fastApplyScope.markdown.length,
					fallbackReason: "patch-plan-execution",
					verificationFailureReason: execution.issues[0]?.message,
					alignment: execution.metrics?.flowPatchAlignment,
					executionPath: "native-fast-apply",
				});
				return null;
			}

			const verification = this._verifyFlowPatchPlanResult(
				patchPlan,
				execution.ops,
				fastApplyScope.blockIds,
			);
			if (!verification.valid) {
				this._recordFastApplyDebug({
					attempted: true,
					succeeded: false,
					contextChars: fastApplyScope.markdown.length,
					diffChars: text.length,
					fallbackReason: "verification-failed",
					verificationFailureReason: verification.reason,
					untouchedBlockMutationCount: verification.untouchedBlockMutationCount,
					alignment: execution.metrics?.flowPatchAlignment,
					executionPath: "native-fast-apply",
				});
				return null;
			}

			if (execution.ops.length === 0) {
				this._recordFastApplyDebug({
					attempted: true,
					succeeded: true,
					contextChars: fastApplyScope.markdown.length,
					diffChars: text.length,
					confidence: patchPlan.confidence?.score,
					untouchedBlockMutationCount: verification.untouchedBlockMutationCount,
					alignment: execution.metrics?.flowPatchAlignment,
					executionPath: "native-fast-apply",
				});
				return buildMutationReceipt({
					status: "noop",
					ops: execution.ops,
					adapterId: "flow-markdown",
					blockClass: "flow",
					transportKind: "flow-text",
				});
			}

			if (
				mutationMode === "persistent-suggestions" ||
				mutationMode === "streaming-suggestions" ||
				mutationMode === "staged-review"
			) {
				this._applySuggestedAIOps(execution.ops, sessionId);
				this._recordFastApplyDebug({
					attempted: true,
					succeeded: true,
					contextChars: fastApplyScope.markdown.length,
					diffChars: text.length,
					confidence: patchPlan.confidence?.score,
					untouchedBlockMutationCount: verification.untouchedBlockMutationCount,
					alignment: execution.metrics?.flowPatchAlignment,
					executionPath: "native-fast-apply",
				});
				return buildMutationReceipt({
					status: "staged_suggestions",
					ops: execution.ops,
					adapterId: "flow-markdown",
					blockClass: "flow",
					transportKind: "flow-text",
				});
			}

			this._editor.apply(execution.ops, { origin: "ai", undoGroup: true });
			this._recordFastApplyDebug({
				attempted: true,
				succeeded: true,
				contextChars: fastApplyScope.markdown.length,
				diffChars: text.length,
				confidence: patchPlan.confidence?.score,
				untouchedBlockMutationCount: verification.untouchedBlockMutationCount,
				alignment: execution.metrics?.flowPatchAlignment,
				executionPath: "native-fast-apply",
			});
			return buildMutationReceipt({
				status: "applied",
				ops: execution.ops,
				adapterId: "flow-markdown",
				blockClass: "flow",
				transportKind: "flow-text",
			});
		}

		const contract = parseMarkdownFastApplyContract(text);
		if (!contract) {
			this._recordFastApplyDebug({
				attempted: true,
				succeeded: false,
				contextChars: fastApplyScope.markdown.length,
				fallbackReason: "unparseable-contract",
			});
			return null;
		}

		const merged = applyMarkdownFastApply({
			originalMarkdown: fastApplyScope.markdown,
			contract,
		});
		if (!merged.success || !merged.mergedMarkdown) {
			this._recordFastApplyDebug({
				attempted: true,
				succeeded: false,
				contextChars: fastApplyScope.markdown.length,
				confidence: merged.confidence,
				fallbackReason: merged.fallbackReason ?? "merge-failed",
				verificationFailureReason: merged.issues[0],
			});
			return null;
		}

		const verification = this._verifyMarkdownFastApplyResult(
			fastApplyScope.blockIds,
			merged.mergedMarkdown,
		);
		if (!verification.valid) {
			this._recordFastApplyDebug({
				attempted: true,
				succeeded: false,
				contextChars: fastApplyScope.markdown.length,
				diffChars: merged.diff?.length ?? 0,
				confidence: merged.confidence,
				fallbackReason: "verification-failed",
				verificationFailureReason: verification.reason,
				untouchedBlockMutationCount: 0,
			});
			return null;
		}

		const ops = this._buildMarkdownScopedReplacementOps(
			fastApplyScope.blockIds,
			merged.mergedMarkdown,
		);
		const scopedReplacementFallback = this._summarizeFastApplyFallbackOps(
			"scoped-replacement",
			ops,
			fastApplyScope.blockIds.length,
		);
		if (ops.length === 0) {
			this._recordFastApplyDebug({
				attempted: true,
				succeeded: true,
				executionPath: "scoped-replacement",
				contextChars: fastApplyScope.markdown.length,
				diffChars: merged.diff?.length ?? 0,
				confidence: merged.confidence,
				untouchedBlockMutationCount: 0,
				fallback: scopedReplacementFallback,
			});
			return buildMutationReceipt({
				status: "noop",
				ops,
				adapterId: "flow-markdown",
				blockClass: "flow",
				transportKind: "flow-text",
			});
		}

		if (
			mutationMode === "persistent-suggestions" ||
			mutationMode === "streaming-suggestions" ||
			mutationMode === "staged-review"
		) {
			this._applySuggestedAIOps(ops, sessionId);
			this._recordFastApplyDebug({
				attempted: true,
				succeeded: true,
				executionPath: "scoped-replacement",
				contextChars: fastApplyScope.markdown.length,
				diffChars: merged.diff?.length ?? 0,
				confidence: merged.confidence,
				untouchedBlockMutationCount: 0,
				fallback: scopedReplacementFallback,
			});
			return buildMutationReceipt({
				status: "staged_suggestions",
				ops,
				adapterId: "flow-markdown",
				blockClass: "flow",
				transportKind: "flow-text",
			});
		}

		this._editor.apply(ops, { origin: "ai", undoGroup: true });
		this._recordFastApplyDebug({
			attempted: true,
			succeeded: true,
			executionPath: "scoped-replacement",
			contextChars: fastApplyScope.markdown.length,
			diffChars: merged.diff?.length ?? 0,
			confidence: merged.confidence,
			untouchedBlockMutationCount: 0,
			fallback: scopedReplacementFallback,
		});
		return buildMutationReceipt({
			status: "applied",
			ops,
			adapterId: "flow-markdown",
			blockClass: "flow",
			transportKind: "flow-text",
		});
	}

	private _resolveMarkdownFastApplyScope(
		blockId: string,
		workingSet: AIWorkingSetEnvelope | null,
	): { markdown: string; blockIds: string[] } | null {
		const context =
			workingSet?.context && typeof workingSet.context === "object"
				? (workingSet.context as {
					markdown?: string | null;
					retrievedSpan?: AIWorkingSetRetrievedSpan | null;
					markdownWindow?: {
						blockIds?: string[];
					} | null;
				})
				: null;
		const markdown = context?.markdown?.trim() ?? "";
		const blockIds = context?.retrievedSpan?.blockIds?.length
			? context.retrievedSpan.blockIds
			: context?.markdownWindow?.blockIds?.length
				? context.markdownWindow.blockIds
				: [blockId];
		if (markdown.length === 0 || blockIds.length === 0) {
			return null;
		}
		return {
			markdown,
			blockIds: [...new Set(blockIds)],
		};
	}

	private _buildPlanValidationContext(
		blockId: string,
		scopeBlockIds: readonly string[],
	): Parameters<typeof validateDocumentMutationPlanShape>[1] {
		const knownBlockTypes = this._editor.schema
			.allBlocks()
			.filter((schema) =>
				shouldExposeBlockInTooling(this._editor.documentProfile, schema),
			)
			.map((schema) => schema.type);
		const editableTargetBlockIds = scopeBlockIds.filter((targetBlockId) => {
			const block = this._editor.getBlock(targetBlockId);
			if (!block) {
				return false;
			}
			const schema = this._editor.schema.resolve(block.type);
			return shouldExposeBlockInTooling(this._editor.documentProfile, schema);
		});

		return {
			documentProfile: this._editor.documentProfile,
			targetKind: this._resolvePlanValidationTargetKind(blockId),
			knownBlockTypes,
			allowedTargetBlockIds: [...scopeBlockIds],
			editableTargetBlockIds,
		};
	}

	private _resolvePlanValidationTargetKind(blockId: string): AITargetKind {
		const blockType = this._editor.getBlock(blockId)?.type ?? null;
		if (blockType === "database") {
			return "database";
		}
		if (blockType === "table") {
			return "table";
		}
		return "block";
	}

	private _verifyMarkdownFastApplyResult(
		blockIds: readonly string[],
		markdown: string,
	): { valid: boolean; reason?: string } {
		if (markdown.trim().length === 0) {
			return { valid: false, reason: "empty-merged-markdown" };
		}
		const startBlockId = blockIds[0];
		const verificationResult = buildDocumentWriteOps(this._editor, {
			format: "markdown",
			content: markdown,
			position: startBlockId ? { before: startBlockId } : undefined,
			surface: "ai-markdown-fast-apply-verify",
		});
		if (verificationResult.blocks.length === 0) {
			return { valid: false, reason: "markdown-parse-produced-no-blocks" };
		}
		return { valid: true };
	}

	private _verifyFlowPatchPlanResult(
		plan: { edits: Array<{ locator: { blockId?: string; blockIds?: string[] } }> },
		ops: readonly DocumentOp[],
		scopeBlockIds: readonly string[],
	): {
		valid: boolean;
		reason?: string;
		untouchedBlockMutationCount: number;
	} {
		const targetedBlockIds = new Set<string>(
			plan.edits.flatMap((edit) => [
				...(edit.locator.blockId ? [edit.locator.blockId] : []),
				...(edit.locator.blockIds ?? []),
			]),
		);
		const scopeSet = new Set(scopeBlockIds);
		const mutatedExistingBlockIds = new Set<string>();
		const outOfScopeMutations = new Set<string>();
		const createdBlockIds = new Set<string>();

		for (const op of ops) {
			if (op.type === "insert-block") {
				createdBlockIds.add(op.blockId);
			}
			for (const blockId of this._readBlockIdsFromOp(op)) {
				if (scopeSet.has(blockId)) {
					mutatedExistingBlockIds.add(blockId);
				} else if (!createdBlockIds.has(blockId) && op.type !== "insert-block") {
					outOfScopeMutations.add(blockId);
				}
			}
		}

		if (outOfScopeMutations.size > 0) {
			return {
				valid: false,
				reason: `flow-patch-mutated-outside-scope:${[...outOfScopeMutations].join(",")}`,
				untouchedBlockMutationCount: 0,
			};
		}

		const untouchedBlockMutationCount = [...mutatedExistingBlockIds].filter(
			(blockId) => !targetedBlockIds.has(blockId),
		).length;
		return {
			valid: untouchedBlockMutationCount === 0,
			reason:
				untouchedBlockMutationCount > 0
					? "flow-patch-mutated-untargeted-blocks"
					: undefined,
			untouchedBlockMutationCount,
		};
	}

	private _buildMarkdownScopedReplacementOps(
		blockIds: readonly string[],
		text: string,
	): DocumentOp[] {
		const startBlockId = blockIds[0];
		if (!startBlockId) {
			return [];
		}
		const { ops } = buildDocumentWriteOps(this._editor, {
			format: "markdown",
			content: text,
			position: { before: startBlockId },
			surface: "ai-markdown-fast-apply",
		});
		return [
			...ops,
			...blockIds.map((currentBlockId) => ({
				type: "delete-block",
				blockId: currentBlockId,
			}) satisfies DocumentOp),
		];
	}

	private _summarizeFastApplyFallbackOps(
		kind: "scoped-replacement" | "plain-markdown",
		ops: readonly DocumentOp[],
		targetBlockCount?: number,
	): {
		kind: "scoped-replacement" | "plain-markdown";
		opsCount: number;
		insertedBlockCount: number;
		deletedBlockCount: number;
		targetBlockCount?: number;
	} {
		let insertedBlockCount = 0;
		let deletedBlockCount = 0;
		for (const op of ops) {
			if (op.type === "insert-block") {
				insertedBlockCount += 1;
			} else if (op.type === "delete-block") {
				deletedBlockCount += 1;
			}
		}
		return {
			kind,
			opsCount: ops.length,
			insertedBlockCount,
			deletedBlockCount,
			targetBlockCount,
		};
	}

	private _readBlockIdsFromOp(op: DocumentOp): string[] {
		const blockIds = new Set<string>();
		if ("blockId" in op && typeof op.blockId === "string") {
			blockIds.add(op.blockId);
		}
		if ("targetBlockId" in op && typeof op.targetBlockId === "string") {
			blockIds.add(op.targetBlockId);
		}
		if ("sourceBlockId" in op && typeof op.sourceBlockId === "string") {
			blockIds.add(op.sourceBlockId);
		}
		return [...blockIds];
	}

	private _recordFastApplyDebug(
		overrides: Partial<NonNullable<NonNullable<GenerationState["debug"]>["fastApply"]>>,
	): void {
		const activeGeneration = this._state.activeGeneration;
		if (!activeGeneration?.debug) {
			return;
		}
		const currentFastApply = activeGeneration.debug.fastApply ?? {
			attempted: false,
			succeeded: false,
		};
		this._resolveActiveGeneration({
			debug: {
				...activeGeneration.debug,
				fastApply: {
					...currentFastApply,
					...overrides,
				},
			},
		});
	}

	private _applySuggestedMarkdownPlaceholderReplacement(
		blockId: string,
		text: string,
		sessionId?: string,
		replaceTargetBlock?: boolean,
	): DocumentOp[] | null {
		const targetBlock = this._editor.getBlock(blockId);
		if (
			!replaceTargetBlock &&
			!shouldReplaceEmptyMarkdownTarget(targetBlock)
		) {
			return null;
		}

		const { ops } = buildDocumentWriteOps(this._editor, {
			format: "markdown",
			content: text,
			position: { before: blockId },
			surface: "ai-markdown",
		});
		if (ops.length === 0) {
			return null;
		}

		const replacementOps = [
			...ops,
			{ type: "delete-block", blockId },
		] satisfies DocumentOp[];
		this._applySuggestedAIOps(replacementOps, sessionId);
		return replacementOps;
	}

	private _refreshStreamingMarkdownBlockPreview(
		blockId: string,
		text: string,
		mutationMode: NonNullable<GenerationState["mutationMode"]>,
		sessionId: string | undefined,
		baselineSuggestionIds: ReadonlySet<string>,
		previewSuggestionIds: readonly string[],
		previousNormalizedText: string,
		replaceTargetBlock?: boolean,
	): { suggestionIds: string[]; normalizedText: string } {
		const normalizedText = normalizeFlowMarkdownOutput(text);
		if (normalizedText === previousNormalizedText) {
			return {
				suggestionIds: [...previewSuggestionIds],
				normalizedText,
			};
		}

		for (const suggestionId of previewSuggestionIds) {
			this.rejectSuggestion(suggestionId);
		}

		if (normalizedText.trim().length === 0) {
			return {
				suggestionIds: [],
				normalizedText,
			};
		}

		this._commitBufferedBlockGeneration(
			blockId,
			normalizedText,
			mutationMode,
			"markdown",
			sessionId,
			{ replaceTargetBlock },
		);

		return {
			suggestionIds: this.getSuggestions()
				.map((item) => item.id)
				.filter((suggestionId) => !baselineSuggestionIds.has(suggestionId)),
			normalizedText,
		};
	}

	private _commitStructuredPlan(
		ops: DocumentOp[],
		reviewSafe: boolean,
		mutationMode: NonNullable<GenerationState["mutationMode"]>,
		adapterId: NonNullable<GenerationState["adapterId"]>,
		blockClass: NonNullable<GenerationState["blockClass"]>,
		transportKind: NonNullable<GenerationState["transportKind"]>,
	): AIMutationReceipt {
		if (ops.length === 0) {
			return buildMutationReceipt({
				status: "noop",
				ops,
				adapterId,
				blockClass,
				transportKind,
			});
		}

		if (mutationMode === "direct-stream") {
			this._editor.apply(ops, { origin: "ai", undoGroup: true });
			return buildMutationReceipt({
				status: "applied",
				ops,
				adapterId,
				blockClass,
				transportKind,
			});
		}

		if (reviewSafe) {
			this._applySuggestedAIOps(ops);
			return buildMutationReceipt({
				status: "staged_suggestions",
				ops,
				adapterId,
				blockClass,
				transportKind,
			});
		}
		return buildMutationReceipt({
			status: "staged_review",
			ops,
			adapterId,
			blockClass,
			transportKind,
		});
	}

	private _buildFallbackMutationReceipt(input: {
		currentText: string;
		suggestionIds: readonly string[];
		reviewItems: readonly StructuralReviewItem[];
		planExecutionIssueCount: number;
		adapterId: NonNullable<GenerationState["adapterId"]>;
		blockClass: NonNullable<GenerationState["blockClass"]>;
		transportKind: NonNullable<GenerationState["transportKind"]>;
	}): AIMutationReceipt {
		if (input.planExecutionIssueCount > 0) {
			return buildMutationReceipt({
				status: "invalid",
				adapterId: input.adapterId,
				blockClass: input.blockClass,
				transportKind: input.transportKind,
				issues: ["The generated mutation plan could not be executed."],
			});
		}
		if (input.reviewItems.length > 0) {
			return buildMutationReceipt({
				status: "staged_review",
				adapterId: input.adapterId,
				blockClass: input.blockClass,
				transportKind: input.transportKind,
			});
		}
		if (input.suggestionIds.length > 0) {
			return buildMutationReceipt({
				status: "staged_suggestions",
				adapterId: input.adapterId,
				blockClass: input.blockClass,
				transportKind: input.transportKind,
			});
		}
		return buildMutationReceipt({
			status: input.currentText.trim().length > 0 ? "applied" : "noop",
			adapterId: input.adapterId,
			blockClass: input.blockClass,
			transportKind: input.transportKind,
		});
	}

	private async _buildWorkingSet(
		toolRuntime: ToolRuntime,
		route: ReturnType<typeof routeAIRequest>,
		target: GenerationTarget,
		blockId: string,
		prompt: string,
	): Promise<AIWorkingSetEnvelope | null> {
		const selectionSignature = this._createSelectionSignature(this._editor.selection);
		if (target.type === "selection") {
			const trackedBlockIds = [...new Set(target.selection.toRange().blockRange)];
			return {
				documentVersion: this._documentVersion,
				viewMode: this._state.suggestMode ? "raw" : "resolved",
				source: "selection",
				routeConfidence: route.confidence,
				context: {
					selection: target.selection,
					selectedText: resolveSelectionText(this._editor, target.selection),
				},
				trackedBlockIds,
				blockRevisions: this._captureBlockRevisions(trackedBlockIds),
				selectionSignature,
			};
		}

		if (route.useCursorContext) {
			const retrievedSpan = await this._resolveMarkdownFastApplyRetrievedSpan(
				toolRuntime,
				route,
				blockId,
				prompt,
			);
			if (route.applyStrategy === "markdown-fast-apply" && retrievedSpan) {
				const context = await toolRuntime.executeTool(
					"get_context",
					{
						format: "markdown",
						includeSelection: true,
						includeSuggestions: this._state.suggestMode,
						range: retrievedSpan.range,
					},
					{} as never,
				) as {
					activeBlockType?: string | null;
					markdown?: string | null;
					surroundingBlocks?: Array<{ id: string }>;
					selectedText?: string | null;
					structuredTarget?: {
						target?: {
							kind?: "block" | "table" | "database";
						};
					} | null;
				};
				return {
					documentVersion: this._documentVersion,
					viewMode: this._state.suggestMode ? "raw" : "resolved",
					source: "cursor-context",
					context: {
						...context,
						retrievedSpan,
					},
					routeConfidence: refineRouteWithNavigator(route, {
						surroundingBlockCount: retrievedSpan.blockIds.length,
						selectedTextLength: context.selectedText?.length ?? 0,
						activeBlockType: context.activeBlockType ?? null,
						structuredTargetKind: context.structuredTarget?.target?.kind ?? null,
					}).confidence,
					trackedBlockIds: [...new Set(retrievedSpan.blockIds)],
					blockRevisions: this._captureBlockRevisions(retrievedSpan.blockIds),
					selectionSignature,
				};
			}
			const context = await toolRuntime.executeTool(
				"get_cursor_context",
				{ includeSuggestions: this._state.suggestMode },
				{} as never,
			) as {
				activeBlockType?: string | null;
				markdown?: string | null;
				surroundingBlocks?: Array<{ id: string }>;
				selectedText?: string | null;
				structuredTarget?: {
					target?: {
						kind?: "block" | "table" | "database";
					};
				} | null;
			};
			const trackedBlockIds = [
				blockId,
				...(context.surroundingBlocks ?? []).map((block) => block.id),
			];
			return {
				documentVersion: this._documentVersion,
				viewMode: this._state.suggestMode ? "raw" : "resolved",
				source: "cursor-context",
				context,
				routeConfidence: refineRouteWithNavigator(route, {
					surroundingBlockCount: context.surroundingBlocks?.length ?? 0,
					selectedTextLength: context.selectedText?.length ?? 0,
					activeBlockType: context.activeBlockType ?? null,
					structuredTargetKind: context.structuredTarget?.target?.kind ?? null,
				}).confidence,
				trackedBlockIds: [...new Set(trackedBlockIds)],
				blockRevisions: this._captureBlockRevisions(trackedBlockIds),
				selectionSignature,
			};
		}

		if (route.useDocumentSummary) {
			const retrievedSpan = await this._resolveMarkdownFastApplyRetrievedSpan(
				toolRuntime,
				route,
				blockId,
				prompt,
			);
			if (route.applyStrategy === "markdown-fast-apply" && retrievedSpan) {
				const context = await toolRuntime.executeTool(
					"get_context",
					{
						format: "markdown",
						includeSelection: true,
						includeSuggestions: this._state.suggestMode,
						range: retrievedSpan.range,
					},
					{} as never,
				) as {
					activeBlockType?: string | null;
					markdown?: string | null;
					surroundingBlocks?: Array<{ id: string }>;
					selectedText?: string | null;
					structuredTarget?: {
						target?: {
							kind?: "block" | "table" | "database";
						};
					} | null;
				};
				return {
					documentVersion: this._documentVersion,
					viewMode: this._state.suggestMode ? "raw" : "resolved",
					source: "document-summary",
					context: {
						...context,
						retrievedSpan,
					},
					routeConfidence: refineRouteWithNavigator(route, {
						surroundingBlockCount: retrievedSpan.blockIds.length,
						selectedTextLength: context.selectedText?.length ?? 0,
						activeBlockType: context.activeBlockType ?? null,
						structuredTargetKind: context.structuredTarget?.target?.kind ?? null,
					}).confidence,
					trackedBlockIds: [...new Set(retrievedSpan.blockIds)],
					blockRevisions: this._captureBlockRevisions(retrievedSpan.blockIds),
					selectionSignature,
				};
			}
			const context = await toolRuntime.executeTool(
				"get_context",
				{
					format: "markdown",
					includeSelection: true,
					includeSuggestions: this._state.suggestMode,
					range: {
						startBlockId: blockId,
						endBlockId: blockId,
					},
				},
				{} as never,
			) as {
				activeBlockType?: string | null;
				markdown?: string | null;
				surroundingBlocks?: Array<{ id: string }>;
				selectedText?: string | null;
				structuredTarget?: {
					target?: {
						kind?: "block" | "table" | "database";
					};
				} | null;
			};
			const trackedBlockIds = [
				blockId,
				...(context.surroundingBlocks ?? []).map((block) => block.id),
			];
			return {
				documentVersion: this._documentVersion,
				viewMode: this._state.suggestMode ? "raw" : "resolved",
				source: "document-summary",
				context,
				routeConfidence: refineRouteWithNavigator(route, {
					surroundingBlockCount: context.surroundingBlocks?.length ?? 0,
					selectedTextLength: context.selectedText?.length ?? 0,
					activeBlockType: context.activeBlockType ?? null,
					structuredTargetKind: context.structuredTarget?.target?.kind ?? null,
				}).confidence,
				trackedBlockIds: [...new Set(trackedBlockIds)],
				blockRevisions: this._captureBlockRevisions(trackedBlockIds),
				selectionSignature,
			};
		}

		return {
			documentVersion: this._documentVersion,
			viewMode: this._state.suggestMode ? "raw" : "resolved",
			source: "document-summary",
			context: null,
			routeConfidence: route.confidence,
			trackedBlockIds: [blockId],
			blockRevisions: this._captureBlockRevisions([blockId]),
			selectionSignature,
		};
	}

	private _refineRouteWithWorkingSet(
		route: ReturnType<typeof routeAIRequest>,
		workingSet: AIWorkingSetEnvelope | null,
	): ReturnType<typeof routeAIRequest> {
		if (!workingSet?.context || typeof workingSet.context !== "object") {
			return route;
		}
		const context = workingSet.context as {
			activeBlockType?: string | null;
			markdown?: string | null;
			surroundingBlocks?: Array<{ id: string }>;
			selectedText?: string | null;
			structuredTarget?: {
				target?: {
					kind?: "block" | "table" | "database";
				};
			} | null;
		};
		return refineRouteWithNavigator(route, {
			surroundingBlockCount: context.surroundingBlocks?.length ?? 0,
			selectedTextLength: context.selectedText?.length ?? 0,
			activeBlockType: context.activeBlockType ?? null,
			structuredTargetKind: context.structuredTarget?.target?.kind ?? null,
		});
	}

	private _validateWorkingSet(
		route: ReturnType<typeof routeAIRequest>,
		target: GenerationTarget,
		workingSet: AIWorkingSetEnvelope | null,
	): { valid: boolean; canRefresh: boolean; reason?: string } {
		if (!workingSet) {
			return { valid: true, canRefresh: false };
		}

		const selectionSignature = this._createSelectionSignature(this._editor.selection);
		const selectionChanged = workingSet.selectionSignature !== selectionSignature;
		const revisionChanged =
			workingSet.documentVersion !== this._documentVersion ||
			workingSet.trackedBlockIds.some(
				(blockId) =>
					this._editor.getBlockRevision(blockId) !==
					workingSet.blockRevisions[blockId],
			);

		if (!selectionChanged && !revisionChanged) {
			return { valid: true, canRefresh: false };
		}

		if (route.lane === "selection-rewrite" || route.lane === "cursor-context") {
			return {
				valid: false,
				canRefresh: false,
				reason: selectionChanged
					? "selection-provenance-changed"
					: "local-context-changed",
			};
		}

		return {
			valid: false,
			canRefresh: target.type === "block",
			reason: revisionChanged ? "document-revision-mismatch" : "selection-changed",
		};
	}

	private _resolveMarkdownFastApplyWindow(
		route: ReturnType<typeof routeAIRequest>,
		blockId: string,
	): {
		range: { startBlockId: string; endBlockId: string };
		blockIds: string[];
	} | null {
		const blocks = Array.from(this._editor.blocks());
		const blockIndex = blocks.findIndex((block) => block.id === blockId);
		if (blockIndex === -1) {
			return null;
		}

		const radius =
			route.targetKind === "table"
				? 0
				: route.intent === "continue"
					? 0
					: route.intent === "rewrite" || route.intent === "local-edit"
						? 1
						: 0;
		const startIndex = Math.max(0, blockIndex - radius);
		const endIndex = Math.min(blocks.length - 1, blockIndex + radius);
		const blockIds = blocks
			.slice(startIndex, endIndex + 1)
			.map((block) => block.id);
		return {
			range: {
				startBlockId: blockIds[0] ?? blockId,
				endBlockId: blockIds[blockIds.length - 1] ?? blockId,
			},
			blockIds,
		};
	}

	private async _resolveMarkdownFastApplyRetrievedSpan(
		toolRuntime: ToolRuntime,
		route: ReturnType<typeof routeAIRequest>,
		blockId: string,
		prompt: string,
	): Promise<AIWorkingSetRetrievedSpan | null> {
		if (route.applyStrategy !== "markdown-fast-apply") {
			return null;
		}

		try {
			const retrieved = await toolRuntime.executeTool(
				"retrieve_document_spans",
				{
					query: prompt,
					maxResults: 1,
					includeSuggestions: this._state.suggestMode,
					activeBlockId: blockId,
					targetBlockId: blockId,
				},
				{} as never,
			) as {
				spans?: AIWorkingSetRetrievedSpan[];
			};
			const retrievedSpan = retrieved.spans?.[0] ?? null;
			if (retrievedSpan?.blockIds?.length) {
				return retrievedSpan;
			}
		} catch {
			// Older test fixtures or stale builds may not register the retriever yet.
		}

		const markdownWindow = this._resolveMarkdownFastApplyWindow(route, blockId);
		if (!markdownWindow) {
			return null;
		}
		return {
			id: `span:${markdownWindow.blockIds.join(":")}`,
			blockIds: markdownWindow.blockIds,
			range: markdownWindow.range,
			blockTypes: [],
			headingPath: [],
			preview: "",
			markdown: "",
			score: 0,
			rationale: "window-fallback",
			neighbors: {
				beforeBlockId: null,
				afterBlockId: null,
			},
		};
	}

	private _applySuggestedAIOps(
		ops: DocumentOp[],
		sessionId?: string,
	): void {
		if (this._state.suggestMode && !sessionId) {
			this._editor.apply(ops, { origin: "ai", undoGroup: true });
			return;
		}

		const intercepted = interceptApplyForSuggestMode(
			ops,
			this._editor,
			this._author,
			"ai",
			readModelId(this._model),
			sessionId,
		);
		const origin = sessionId ? AI_SESSION_SUGGESTION_ORIGIN : "extension";
		this._editor.apply(intercepted, { origin, undoGroup: true });
	}

	private _captureBlockRevisions(blockIds: string[]): Record<string, number> {
		return Object.fromEntries(
			blockIds.map((trackedBlockId) => [
				trackedBlockId,
				this._editor.getBlockRevision(trackedBlockId),
			]),
		);
	}

	private _resolveContentFormat(
		target: GenerationState["target"],
		surface?: AISurface,
	): AIContentFormat {
		if (target === "selection") {
			return this._contentFormat.selectionRewrite;
		}
		return this._contentFormat.blockGeneration;
	}

	private _buildTextBlockGenerationOps(
		blockId: string,
		text: string,
		insertionOffset?: number,
	): DocumentOp[] {
		const targetBlock = this._editor.getBlock(blockId);
		const normalizedText = shouldTrimLeadingBlankBlockGenerationText(targetBlock)
			? trimLeadingBlankBlockGenerationText(text)
			: text;
		if (normalizedText.length === 0) {
			return [];
		}
		return [{
			type: "insert-text",
			blockId,
			offset: insertionOffset ?? targetBlock?.textContent().length ?? 0,
			text: normalizedText,
		}];
	}

	private _buildMarkdownBlockGenerationOps(
		blockId: string,
		text: string,
		replaceTargetBlock?: boolean,
	): DocumentOp[] {
		const targetBlock = this._editor.getBlock(blockId);
		if (!targetBlock) {
			return [];
		}

		const { ops } = buildDocumentWriteOps(this._editor, {
			format: "markdown",
			content: text,
			position: { after: blockId },
			surface: "ai-markdown",
		});
		if (
			!replaceTargetBlock &&
			!shouldReplaceEmptyMarkdownTarget(targetBlock)
		) {
			return ops;
		}

		return [
			...ops,
			{ type: "delete-block", blockId },
		];
	}

	private _createSelectionSignature(selection: SelectionState): string | null {
		if (!selection) {
			return null;
		}
		if (selection.type === "text") {
			return [
				"text",
				selection.anchor.blockId,
				selection.anchor.offset,
				selection.focus.blockId,
				selection.focus.offset,
				String(selection.isCollapsed),
			].join(":");
		}
		if (selection.type === "block") {
			return `block:${selection.blockIds.join(",")}`;
		}
		if (selection.type === "cell") {
			return [
				"cell",
				selection.blockId,
				selection.anchor.row,
				selection.anchor.col,
				selection.head.row,
				selection.head.col,
			].join(":");
		}
		return selection.type;
	}

	private _setState(partial: Partial<AIControllerState>): void {
		const previousState = this._state;
		const nextState = { ...this._state, ...partial };
		if (areAIControllerStatesEqual(previousState, nextState)) {
			return;
		}
		this._state = nextState;
		if (!this._isRestoringInlineHistory && !this._pendingInlineHistoryRestore) {
			this._recordInlineHistorySnapshot(previousState, nextState);
		}
		this._editor.requestDecorationUpdate();
		this._emit();
	}

	private _resolveActiveGeneration(
		overrides: Partial<GenerationState>,
	): void {
		const activeGeneration = this._state.activeGeneration;
		if (!activeGeneration) {
			return;
		}

		this._setState({
			activeGeneration: {
				...activeGeneration,
				...overrides,
				plan:
					overrides.planState === "none" || overrides.planState === "rejected"
						? null
						: (overrides.plan ?? activeGeneration.plan),
				reviewItems:
					overrides.planState === "none" || overrides.planState === "rejected"
						? []
						: (overrides.reviewItems ?? activeGeneration.reviewItems ?? []),
				structuredPreview:
					overrides.planState === "none" || overrides.planState === "rejected"
						? null
						: (overrides.structuredPreview ?? activeGeneration.structuredPreview ?? null),
				suggestionIds:
					overrides.suggestionIds ?? activeGeneration.suggestionIds ?? [],
			},
		});
	}

	private _resolveSessionTurn(
		sessionId: string,
		turnId: string,
		resolution: AISessionResolution,
		options?: { finalizeSession?: boolean },
	): boolean {
		const session = this._state.sessions.find((item) => item.id === sessionId);
		const turn = session?.turns.find((item) => item.id === turnId);
		if (!session || !turn) {
			return false;
		}
		const resolveSuggestionsForTurn =
			resolution === "accept"
				? (suggestionIds: readonly string[]) =>
						acceptSuggestions(this._editor, suggestionIds)
				: (suggestionIds: readonly string[]) =>
						rejectSuggestions(this._editor, suggestionIds);
		const resolveReviewItems =
			resolution === "accept"
				? (reviewItemIds: readonly string[]) => this.acceptReviewItems(reviewItemIds)
				: (reviewItemIds: readonly string[]) => this.rejectReviewItems(reviewItemIds);
		let resolved = false;
		resolved =
			resolveSuggestionsForTurn(turn.suggestionIds) || resolved;
		if (
			this._state.activeGeneration?.sessionId === sessionId &&
			this._state.activeGeneration.turnId === turnId &&
			this._state.activeGeneration.planState === "validated" &&
			turn.reviewItemIds.length > 0
		) {
			resolved = resolveReviewItems(turn.reviewItemIds) || resolved;
		}
		if (!resolved) {
			return false;
		}
		this._updateSessionTurn(sessionId, turnId, {
			status: resolution === "accept" ? "accepted" : "rejected",
			suggestionIds: [],
			reviewItemIds: [],
			structuredPreview: null,
		});
		if (options?.finalizeSession === false) {
			return true;
		}
		const nextSession =
			this._state.sessions.find((item) => item.id === sessionId) ?? session;
		this._updateSession(sessionId, {
			status: "complete",
			contextualPrompt: closeInlineSessionPrompt(nextSession),
		});
		return true;
	}

	private _updateSession(
		sessionId: string,
		overrides: Partial<AISession>,
	): void {
		const nextSessions = this._state.sessions.map((session) =>
			session.id !== sessionId
				? session
				: {
					...session,
					...overrides,
					contextualPrompt:
						overrides.contextualPrompt ?? session.contextualPrompt
							? {
								...(session.contextualPrompt ??
									resolveContextualPromptState(
										overrides.target ?? session.target,
									)),
								...(overrides.contextualPrompt ?? {}),
								anchor: {
									...((session.contextualPrompt ??
										resolveContextualPromptState(
											overrides.target ?? session.target,
										)).anchor),
									...(overrides.contextualPrompt?.anchor ?? {}),
								},
								composer: {
									...((session.contextualPrompt ??
										resolveContextualPromptState(
											overrides.target ?? session.target,
										)).composer),
									...(overrides.contextualPrompt?.composer ?? {}),
									isSubmitting:
										overrides.contextualPrompt?.composer?.isSubmitting ??
										(overrides.status === "streaming"
											? true
											: overrides.status
												? false
												: (session.contextualPrompt ??
													resolveContextualPromptState(
														overrides.target ?? session.target,
													)).composer.isSubmitting),
								},
							}
							: undefined,
					updatedAt: Date.now(),
					metrics: {
						...session.metrics,
						...(overrides.metrics ?? {}),
					},
				},
		);
		if (nextSessions === this._state.sessions) {
			return;
		}
		this._setState({
			sessions: nextSessions,
			activeSessionId:
				this._state.activeSessionId === sessionId || this._state.activeSessionId == null
					? sessionId
					: this._state.activeSessionId,
		});
	}

	private _recordSessionFastApplyMetrics(
		sessionId: string,
		fastApply: FastApplyDebugState | undefined,
	): void {
		const session = this._state.sessions.find((item) => item.id === sessionId);
		if (!session) {
			return;
		}
		this._updateSession(sessionId, {
			metrics: {
				...session.metrics,
				fastApply: accumulateSessionFastApplyMetrics(
					session.metrics.fastApply,
					fastApply,
				),
			},
		});
	}

	private _updateSessionTurn(
		sessionId: string,
		turnId: string,
		overrides: Partial<AISession["turns"][number]>,
	): void {
		const session = this._state.sessions.find((item) => item.id === sessionId);
		if (!session) {
			return;
		}
		const nextTurns = session.turns.map((turn) =>
			turn.id !== turnId
				? turn
				: {
					...turn,
					...overrides,
				},
		);
		if (areStructuredValuesEqual(session.turns, nextTurns)) {
			return;
		}
		const pendingSuggestionIds = [
			...new Set(nextTurns.flatMap((turn) => turn.suggestionIds)),
		];
		const pendingReviewItemIds = [
			...new Set(nextTurns.flatMap((turn) => turn.reviewItemIds)),
		];
		this._updateSession(sessionId, {
			turns: nextTurns,
			pendingSuggestionIds,
			pendingReviewItemIds,
		});
	}

	private _syncSessionsFromDocument(): boolean {
		if (this._state.sessions.length === 0) {
			return false;
		}
		const nextSessions = this._state.sessions.map((session) => {
			const nextTurns = session.turns.map((turn) => {
				const suggestionIds = turn.suggestionIds.filter((sessionSuggestionId) =>
					this._suggestions.some((suggestion) => suggestion.id === sessionSuggestionId),
				);
				const activeGenerationMatchesTurn =
					this._state.activeGeneration?.sessionId === session.id &&
					this._state.activeGeneration.turnId === turn.id;
				const activeGenerationForTurn = activeGenerationMatchesTurn
					? this._state.activeGeneration
					: null;
				const reviewItemIds =
					activeGenerationForTurn
						? (activeGenerationForTurn.reviewItems ?? [])
							.map((item) => item.id)
							.filter((id) => turn.reviewItemIds.includes(id))
						: [];
				const structuredPreview = activeGenerationForTurn
					? (activeGenerationForTurn.structuredPreview ?? turn.structuredPreview ?? null)
					: (turn.reviewItemIds.length > 0 ? (turn.structuredPreview ?? null) : null);
				return {
					...turn,
					suggestionIds,
					reviewItemIds,
					structuredPreview,
				};
			});
			const pendingSuggestionIds = [...new Set(nextTurns.flatMap((turn) => turn.suggestionIds))];
			const pendingReviewItemIds =
				[...new Set(nextTurns.flatMap((turn) => turn.reviewItemIds))];
			const nextStatus =
				pendingSuggestionIds.length === 0 &&
					pendingReviewItemIds.length === 0 &&
					session.status === "streaming"
					? "complete"
					: session.status;
			return {
				...session,
				status: nextStatus,
				turns: nextTurns,
				pendingSuggestionIds,
				pendingReviewItemIds,
			};
		});
		if (areSessionsEqual(this._state.sessions, nextSessions)) {
			return false;
		}
		this._setState({
			sessions: nextSessions,
		});
		return true;
	}

	private _setStreamEvents(nextEvents: readonly AIStreamEvent[]): void {
		this._streamEvents = nextEvents;
		this._emitStreamEvents();
	}

	private _appendStreamEvent(event: AIStreamEvent): void {
		const lastEvent = this._streamEvents[this._streamEvents.length - 1];
		if (
			lastEvent?.type === "status" &&
			event.type === "status" &&
			lastEvent.generationId === event.generationId &&
			lastEvent.status === event.status
		) {
			return;
		}
		const nextEvents =
			this._streamEvents.length >= MAX_STREAM_EVENTS
				? [...this._streamEvents.slice(-(MAX_STREAM_EVENTS - 1)), event]
				: [...this._streamEvents, event];
		this._setStreamEvents(nextEvents);
	}

	private _emit(): void {
		for (const listener of this._listeners) {
			listener();
		}
		for (const listener of this._sessionListeners) {
			listener();
		}
	}

	private _emitStreamEvents(): void {
		for (const listener of this._streamEventListeners) {
			listener();
		}
	}

	private _syncSuggestionsFromDocument(): boolean {
		const nextSuggestions = readAllSuggestions(this._editor);
		if (areSuggestionsEqual(this._suggestions, nextSuggestions)) {
			return false;
		}
		this._suggestions = nextSuggestions;
		return true;
	}

	private _recordInlineHistorySnapshot(
		previousState: AIControllerState,
		nextState: AIControllerState,
	): void {
		if (
			!didInlineHistoryCheckpointChange(previousState, nextState)
		) {
			return;
		}
		if (
			previousState.sessions === nextState.sessions &&
			previousState.activeSessionId === nextState.activeSessionId
		) {
			return;
		}
		const currentSnapshot = this._inlineHistory[this._inlineHistoryIndex];
		const nextHistory = this._inlineHistory.slice(0, this._inlineHistoryIndex + 1);
		if (nextHistory.length === 0) {
			const baselineSnapshot = createInlineHistorySnapshot(
				this._editor,
				previousState.sessions,
				previousState.activeSessionId ?? null,
				this._documentVersion,
			);
			nextHistory.push(baselineSnapshot);
		}
		const previousSnapshot = nextHistory[nextHistory.length - 1] ?? currentSnapshot ?? null;
		const snapshot = createInlineHistorySnapshot(
			this._editor,
			nextState.sessions,
			nextState.activeSessionId ?? null,
			this._documentVersion,
			{
				kind:
					previousSnapshot?.documentVersion === this._documentVersion
						? "ui-local"
						: "document-coupled",
			},
		);
		if (currentSnapshot && areInlineHistorySnapshotsEqual(currentSnapshot, snapshot)) {
			return;
		}
		nextHistory.push(snapshot);
		this._inlineHistory = nextHistory;
		this._inlineHistoryIndex = nextHistory.length - 1;
	}

	private _recordInlinePromptSubmissionCheckpoint(
		sessionId: string,
		prompt: string,
	): void {
		const session = this._state.sessions.find((item) => item.id === sessionId);
		if (
			!session ||
			session.surface !== "inline-edit" ||
			!session.contextualPrompt
		) {
			return;
		}
		const checkpointState: AIControllerState = {
			...this._state,
			activeSessionId: sessionId,
			sessions: this._state.sessions.map((item) =>
				item.id !== sessionId
					? item
					: {
						...item,
						contextualPrompt: {
							...item.contextualPrompt!,
							composer: {
								...item.contextualPrompt!.composer,
								draftPrompt: prompt,
								isOpen: true,
								isSubmitting: false,
							},
						},
					},
			),
		};
		const snapshot = createInlineHistorySnapshot(
			this._editor,
			checkpointState.sessions,
			checkpointState.activeSessionId ?? null,
			this._documentVersion,
			{ kind: "ui-local" },
		);
		const currentSnapshot = this._inlineHistory[this._inlineHistoryIndex];
		if (currentSnapshot && areInlineHistorySnapshotsEqual(currentSnapshot, snapshot)) {
			return;
		}
		const nextHistory = this._inlineHistory.slice(0, this._inlineHistoryIndex + 1);
		nextHistory.push(snapshot);
		this._inlineHistory = nextHistory;
		this._inlineHistoryIndex = nextHistory.length - 1;
	}

	private _resolveInlineHistoryTargetIndex(
		direction: AIInlineHistoryDirection,
		options?: { shortcutOnly?: boolean },
	): number {
		const step = direction === "undo" ? -1 : 1;
		if (!options?.shortcutOnly) {
			return this._inlineHistoryIndex + step;
		}
		const currentSnapshot = this._inlineHistory[this._inlineHistoryIndex] ?? null;
		const scopedSessionId = this._resolveShortcutInlineHistorySessionId(
			currentSnapshot,
		);
		const currentSettledTurnCount = currentSnapshot
			? countSettledInlineTurns(currentSnapshot, scopedSessionId)
			: 0;
		let targetIndex = this._inlineHistoryIndex + step;
		while (targetIndex >= 0 && targetIndex < this._inlineHistory.length) {
			const targetSnapshot = this._inlineHistory[targetIndex];
			if (
				targetSnapshot &&
				targetSnapshot.kind !== "ui-local" &&
				countSettledInlineTurns(targetSnapshot, scopedSessionId) !== currentSettledTurnCount
			) {
				return targetIndex;
			}
			targetIndex += step;
		}
		return -1;
	}

	private _resolveShortcutInlineHistorySessionId(
		currentSnapshot: AIInlineHistorySnapshot | null,
	): string | null {
		const activeSession = this.getActiveSession();
		if (activeSession?.surface === "inline-edit") {
			return activeSession.id;
		}
		const selection = this._editor.selection;
		if (currentSnapshot && selection?.type === "text" && !selection.isCollapsed) {
			const matchingSession = [...currentSnapshot.sessions]
				.reverse()
				.find(
					(session) =>
						session.surface === "inline-edit" &&
						sessionSelectionMatches(session, selection),
				);
			if (matchingSession) {
				return matchingSession.id;
			}
		}
		if (
			currentSnapshot?.activeSessionId &&
			currentSnapshot.sessions.some(
				(session) =>
					session.id === currentSnapshot.activeSessionId &&
					session.surface === "inline-edit",
			)
		) {
			return currentSnapshot.activeSessionId;
		}
		return (
			[...(currentSnapshot?.sessions ?? [])]
				.reverse()
				.find((session) => session.surface === "inline-edit")
				?.id ?? null
		);
	}

	private _canHandleInlineHistoryShortcut(
		direction: AIInlineHistoryDirection,
		options?: { shortcutOnly?: boolean },
	): boolean {
		const targetIndex = this._resolveInlineHistoryTargetIndex(direction, options);
		const targetSnapshot = this._inlineHistory[targetIndex];
		if (!targetSnapshot) {
			return false;
		}
		if (targetSnapshot.kind !== "ui-local") {
			return true;
		}
		return direction === "undo"
			? !this._editor.undoManager.canUndo()
			: !this._editor.undoManager.canRedo();
	}

	private _navigateInlineHistory(
		direction: AIInlineHistoryDirection,
		options?: { shortcutOnly?: boolean },
	): boolean {
		const targetIndex = this._resolveInlineHistoryTargetIndex(direction, options);
		const targetSnapshot = this._inlineHistory[targetIndex];
		if (!targetSnapshot) {
			return false;
		}
		const currentSnapshot = this._inlineHistory[this._inlineHistoryIndex] ?? null;
		if (targetSnapshot.kind === "ui-local") {
			this._applyInlineHistorySnapshot(targetSnapshot);
			this._inlineHistoryIndex = targetIndex;
			return true;
		}
		if (
			currentSnapshot &&
			currentSnapshot.documentVersion !== targetSnapshot.documentVersion
		) {
			this._pendingInlineHistoryRestore = {
				direction,
				targetSnapshotId: targetSnapshot.id,
			};
			const restored =
				direction === "undo"
					? this._editor.undoManager.undo()
					: this._editor.undoManager.redo();
			if (!restored) {
				this._pendingInlineHistoryRestore = null;
			}
			return restored;
		}
		this._applyInlineHistorySnapshot(targetSnapshot);
		this._inlineHistoryIndex = targetIndex;
		return true;
	}

	private _applyInlineHistorySnapshot(snapshot: AIInlineHistorySnapshot): void {
		this._isRestoringInlineHistory = true;
		try {
			this._setState({
				sessions: cloneInlineHistorySessions(this._editor, snapshot.sessions),
				activeSessionId: snapshot.activeSessionId,
			});
		} finally {
			this._isRestoringInlineHistory = false;
		}
	}

	private _handleHistoryApplied(event: HistoryAppliedEvent): void {
		if (
			this._pendingInlineHistoryRestore &&
			this._pendingInlineHistoryRestore.direction === event.kind
		) {
			const targetIndex = this._inlineHistory.findIndex(
				(snapshot) =>
					snapshot.id === this._pendingInlineHistoryRestore?.targetSnapshotId,
			);
			if (targetIndex >= 0) {
				this._inlineHistoryIndex = targetIndex;
				this._applyInlineHistorySnapshot(this._inlineHistory[targetIndex]!);
			}
			this._pendingInlineHistoryRestore = null;
			return;
		}
		const selection = event.selection;
		if (selection?.type !== "text" || selection.isCollapsed) {
			return;
		}
		const matchingSession = [...this._state.sessions]
			.reverse()
			.find(
				(session) =>
					session.surface === "inline-edit" &&
					session.status !== "cancelled" &&
					sessionSelectionMatches(session, selection),
			);
		if (!matchingSession) {
			return;
		}
		this._setInlineSessionComposerOpen(matchingSession.id, true);
	}

	private _setInlineSessionComposerOpen(sessionId: string, isOpen: boolean): void {
		const session = this._state.sessions.find((item) => item.id === sessionId);
		if (
			!session ||
			session.surface !== "inline-edit" ||
			!session.contextualPrompt
		) {
			return;
		}
		const nextActiveSessionId = isOpen
			? sessionId
			: this._state.activeSessionId === sessionId
				? null
				: this._state.activeSessionId;
		if (
			session.contextualPrompt.composer.isOpen === isOpen &&
			nextActiveSessionId === this._state.activeSessionId
		) {
			return;
		}
		const nextSessions = this._state.sessions.map((item) =>
			item.id !== sessionId
				? item
				: {
					...item,
					contextualPrompt: {
						...item.contextualPrompt!,
						composer: {
							...item.contextualPrompt!.composer,
							isOpen,
						},
					},
					updatedAt: Date.now(),
				},
		);
		this._setState({
			sessions: nextSessions,
			activeSessionId: nextActiveSessionId,
		});
	}
}

export function aiExtension(config: AIExtensionConfig = {}): Extension {
	let unsubscribeBeforeApply: (() => void) | null = null;
	let unsubscribeTrackedOrigins: (() => void) | null = null;
	let controller: AIControllerImpl | null = null;
	let inlineCompletion: AIInlineCompletionController | null = null;
	let ownsInlineCompletion = false;
	let inlineHistory: AIInlineHistoryService | null = null;
	let reviewController: AIReviewService | null = null;
	let activeEditor: Editor | null = null;

	return defineExtension({
		name: AI_EXTENSION_NAME,
		dependencies: ["document-ops", "delta-stream", "undo"],
		keyBindings: AI_SHORTCUT_KEY_BINDINGS,

		activateClient: async ({ editor }) => {
			activeEditor = editor;
			const inlineCompletionRegistration = ensureInlineCompletionController(editor);
			inlineCompletion = inlineCompletionRegistration.controller;
			ownsInlineCompletion = inlineCompletionRegistration.isOwner;
			controller = new AIControllerImpl(editor, config, {
				inlineCompletion,
				renderInlineCompletionDecorations: ownsInlineCompletion,
			});
			inlineHistory = new AIInlineHistoryService({
				canUndoInlineHistory: () =>
					controller ? controller.canUndoInlineHistory() : false,
				canRedoInlineHistory: () =>
					controller ? controller.canRedoInlineHistory() : false,
				canHandleShortcut: (direction) =>
					controller
						? controller.canHandleInlineHistoryShortcut(direction)
						: false,
				handleShortcut: (direction) =>
					controller
						? controller.handleInlineHistoryShortcut(direction)
						: false,
				undoInlineHistory: () =>
					controller ? controller.undoInlineHistory() : false,
				redoInlineHistory: () =>
					controller ? controller.redoInlineHistory() : false,
			});
			reviewController = new AIReviewService({
				getSuggestions: () => controller?.getSuggestions() ?? [],
				acceptSuggestion: (id) => controller?.acceptSuggestion(id) ?? false,
				rejectSuggestion: (id) => controller?.rejectSuggestion(id) ?? false,
				acceptAllSuggestions: () => controller?.acceptAllSuggestions(),
				rejectAllSuggestions: () => controller?.rejectAllSuggestions(),
			});
			editor.internals.setSlot(AI_CONTROLLER_SLOT, controller);
			editor.internals.setSlot(AI_INLINE_HISTORY_SLOT, inlineHistory);
			editor.internals.setSlot(AI_REVIEW_CONTROLLER_SLOT, reviewController);
			unsubscribeTrackedOrigins = editor.undoManager.registerTrackedOrigins([
				AI_SESSION_SUGGESTION_ORIGIN,
				SUGGESTION_RESOLUTION_ORIGIN,
			]);

			unsubscribeBeforeApply = editor.onBeforeApply(
				(ops, options) => {
					if (!controller?.getState().suggestMode) return ops;
					if (shouldBypassSuggestMode(options.origin)) return ops;
					return interceptApplyForSuggestMode(
						ops,
						editor,
						options.origin === "ai" ? "assistant" : config.author ?? "user",
						options.origin === "ai" ? "ai" : "user",
						readModelId(config.model),
					);
				},
				{ priority: 200 },
			);
		},

		deactivateClient: async () => {
			controller?.cancelActiveGeneration();
			controller?.destroy();
			activeEditor?.internals.setSlot(AI_CONTROLLER_SLOT, null);
			activeEditor?.internals.setSlot(AI_INLINE_HISTORY_SLOT, null);
			activeEditor?.internals.setSlot(AI_REVIEW_CONTROLLER_SLOT, null);
			if (ownsInlineCompletion) {
				inlineCompletion?.destroy();
				activeEditor?.internals.setSlot(INLINE_COMPLETION_SLOT, null);
			}
			unsubscribeTrackedOrigins?.();
			unsubscribeTrackedOrigins = null;
			unsubscribeBeforeApply?.();
			unsubscribeBeforeApply = null;
			controller = null;
			inlineCompletion = null;
			ownsInlineCompletion = false;
			inlineHistory = null;
			reviewController = null;
			activeEditor = null;
		},

		observe: (events, editor) => {
			if (!controller) {
				editor.requestDecorationUpdate();
				return;
			}
			controller.handleDocumentChange(events);
		},

		decorations: () => {
			const decorations = controller?.buildDecorations() ?? [];
			return createDecorationSet(decorations);
		},
	});
}

export function getAIController(editor: Editor): AIController | null {
	return editor.internals.getSlot<AIController>(AI_CONTROLLER_SLOT) ?? null;
}

export function getInlineCompletionController(
	editor: Editor,
): AIInlineCompletionController | null {
	return getInlineCompletionControllerFromCore(editor);
}

export function getAIInlineCompletionController(
	editor: Editor,
): AIInlineCompletionController | null {
	return getInlineCompletionController(editor);
}

export function getAIInlineHistoryController(
	editor: Editor,
): AIInlineHistoryController | null {
	return editor.internals.getSlot<AIInlineHistoryController>(
		AI_INLINE_HISTORY_SLOT,
	) ?? null;
}

export function getAIReviewController(editor: Editor): AIReviewController | null {
	return editor.internals.getSlot<AIReviewController>(
		AI_REVIEW_CONTROLLER_SLOT,
	) ?? null;
}

function resolveOrderedReviewItems(
	reviewItems: readonly StructuralReviewItem[],
	ids: readonly string[],
): StructuralReviewItem[] {
	const remainingIds = new Set(ids);
	const orderedReviewItems: StructuralReviewItem[] = [];
	for (const reviewItem of reviewItems) {
		if (!remainingIds.has(reviewItem.id)) {
			continue;
		}
		orderedReviewItems.push(reviewItem);
		remainingIds.delete(reviewItem.id);
	}
	return orderedReviewItems;
}

function sortReviewItemsForRemoval(
	reviewItems: readonly StructuralReviewItem[],
): StructuralReviewItem[] {
	return [...reviewItems].sort(compareReviewItemRemovalOrder);
}

function compareReviewItemRemovalOrder(
	left: StructuralReviewItem,
	right: StructuralReviewItem,
): number {
	const maxPathLength = Math.max(left.bundlePath.length, right.bundlePath.length);
	for (let index = 0; index < maxPathLength; index += 1) {
		const leftPart = left.bundlePath[index] ?? -1;
		const rightPart = right.bundlePath[index] ?? -1;
		if (leftPart !== rightPart) {
			return rightPart - leftPart;
		}
	}

	const leftStepIndex = left.stepIndex ?? -1;
	const rightStepIndex = right.stepIndex ?? -1;
	return rightStepIndex - leftStepIndex;
}

function resolveActiveBlockId(selection: SelectionState): string | null {
	if (!selection) return null;
	if (selection.type === "text") return selection.focus.blockId;
	if (selection.type === "block") return selection.blockIds[0] ?? null;
	if (selection.type === "cell") return selection.blockId;
	return null;
}

function readModelId(model: ModelAdapter | undefined): string | undefined {
	if (!model || typeof model !== "object") return undefined;
	const candidate = model as ModelAdapter & {
		name?: string;
		modelId?: string;
	};
	return candidate.modelId ?? candidate.name;
}

function supportsStructuredIntent(
	model: ModelAdapter | undefined,
): boolean {
	return model?.capabilities?.structuredIntent === true;
}

type AIStreamEventInput =
	| {
		type: "generation-start";
		prompt: string;
		target: GenerationState["target"];
	}
	| {
		type: "status";
		status: AIControllerState["status"];
	}
	| {
		type: "text-delta";
		delta: string;
		text: string;
	}
	| {
		type: "app-partial";
		data: unknown;
		final: boolean;
	}
	| {
		type: "tool-call";
		toolCallId: string;
		toolName: string;
		input: unknown;
	}
	| {
		type: "tool-output";
		toolCallId: string;
		toolName: string;
		part: unknown;
		output: unknown;
	}
	| {
		type: "tool-result";
		toolCallId: string;
		toolName: string;
		output: unknown;
		state: "complete" | "error";
	}
	| {
		type: "structured-preview";
		preview: GenerationStructuredPreviewState;
		patches: readonly {
			op: "add" | "remove" | "replace";
			path: string;
			value?: unknown;
		}[];
	}
	| {
		type: "generation-finish";
		status: GenerationState["status"];
		text: string;
	};

function createAIStreamEvent(
	generation: Pick<GenerationState, "id" | "zoneId" | "blockId" | "sessionId">,
	event: AIStreamEventInput,
): AIStreamEvent {
	return {
		...event,
		generationId: generation.id,
		sessionId: generation.sessionId,
		zoneId: generation.zoneId,
		blockId: generation.blockId,
		timestamp: Date.now(),
	};
}

function resolvePromptTarget(
	selection: SelectionState,
	target: "auto" | "selection" | "block" | "document" | undefined,
): "selection" | "block" | "document" {
	if (target === "selection") {
		return "selection";
	}
	if (target === "block") {
		return "block";
	}
	if (target === "document") {
		return "document";
	}
	return selection?.type === "text" && !selection.isCollapsed ? "selection" : "block";
}

function resolveSessionTarget(
	editor: Editor,
	target: "auto" | "selection" | "block" | "document" | undefined,
): AISessionTarget {
	if (target === "document") {
		return { kind: "document" };
	}
	const selection = editor.selection;
	if (
		(target === "selection" || target === "auto") &&
		selection?.type === "text" &&
		!selection.isCollapsed
	) {
		const range = selection.toRange();
		return {
			kind: "selection",
			selection,
			blockId: range.start.blockId,
		};
	}
	const blockId =
		(target === "block" || target === "auto")
			? resolveActiveBlockId(selection) ??
			editor.lastBlock()?.id ??
			editor.firstBlock()?.id ??
			null
			: null;
	return blockId ? { kind: "block", blockId } : { kind: "document" };
}

function resolveSessionAnchor(
	selection: SelectionState | TextSelection,
): AISession["anchor"] | undefined {
	if (selection?.type !== "text") {
		return undefined;
	}
	const range = selection.toRange();
	return {
		blockId: range.start.blockId,
		from: range.start.offset,
		to: range.end.offset,
	};
}

function resolveSessionSelectionSnapshot(
	selection: TextSelection,
): AISessionSelectionSnapshot {
	return {
		anchor: { ...selection.anchor },
		focus: { ...selection.focus },
		blockRange: [...selection.blockRange],
		isMultiBlock: selection.isMultiBlock,
	};
}

function resolveContextualPromptAnchor(
	target: AISessionTarget,
): NonNullable<AISession["contextualPrompt"]>["anchor"] {
	if (target.kind === "selection") {
		const range = target.selection.toRange();
		return {
			kind: "text-range",
			selectionSnapshot: resolveSessionSelectionSnapshot(target.selection),
			focusBlockId: range.start.blockId,
			status: "valid",
			lastResolvedRect: null,
		};
	}
	if (target.kind === "block") {
		return {
			kind: "block",
			focusBlockId: target.blockId,
			status: "valid",
			lastResolvedRect: null,
		};
	}
	return {
		kind: "document",
		focusBlockId: null,
		status: "valid",
		lastResolvedRect: null,
	};
}

function resolveContextualPromptState(
	target: AISessionTarget,
): NonNullable<AISession["contextualPrompt"]> {
	return {
		anchor: resolveContextualPromptAnchor(target),
		composer: {
			draftPrompt: "",
			isOpen: true,
			isSubmitting: false,
			canSubmitFollowUp: true,
		},
	};
}

function createInlineHistorySnapshot(
	editor: Editor,
	sessions: readonly AISession[],
	activeSessionId: string | null,
	documentVersion: number,
	options?: {
		kind?: AIInlineHistorySnapshot["kind"];
	},
): AIInlineHistorySnapshot {
	return {
		id: crypto.randomUUID(),
		sessionId: activeSessionId,
		sessions: cloneInlineHistorySessions(editor, sessions),
		activeSessionId,
		documentVersion,
		kind: options?.kind ?? "document-coupled",
	};
}

function cloneSessionTarget(
	editor: Editor,
	target: AISessionTarget,
): AISessionTarget {
	if (target.kind !== "selection") {
		return { ...target };
	}
	return {
		kind: "selection",
		blockId: target.blockId,
		selection: recreateTextSelection(
			editor,
			resolveSessionSelectionSnapshot(target.selection),
		),
	};
}

function cloneInlineHistorySessions(
	editor: Editor,
	sessions: readonly AISession[],
): AISession[] {
	return sessions.map((session) => ({
		...session,
		target: cloneSessionTarget(editor, session.target),
		contextualPrompt: session.contextualPrompt
			? {
				...session.contextualPrompt,
				anchor: {
					...session.contextualPrompt.anchor,
					selectionSnapshot: session.contextualPrompt.anchor.selectionSnapshot
						? {
							...session.contextualPrompt.anchor.selectionSnapshot,
							anchor: {
								...session.contextualPrompt.anchor.selectionSnapshot.anchor,
							},
							focus: {
								...session.contextualPrompt.anchor.selectionSnapshot.focus,
							},
							blockRange: [
								...session.contextualPrompt.anchor.selectionSnapshot.blockRange,
							],
						}
						: undefined,
				},
				composer: {
					...session.contextualPrompt.composer,
				},
			}
			: undefined,
		turns: session.turns.map((turn) => ({
			...turn,
			suggestionIds: [...turn.suggestionIds],
			reviewItemIds: [...turn.reviewItemIds],
			anchor: turn.anchor ? { ...turn.anchor } : undefined,
			selection: turn.selection
				? {
					...turn.selection,
					anchor: { ...turn.selection.anchor },
					focus: { ...turn.selection.focus },
					blockRange: [...turn.selection.blockRange],
				}
				: undefined,
		})),
		promptHistory: session.promptHistory.map((prompt) => ({ ...prompt })),
		generationIds: [...session.generationIds],
		pendingSuggestionIds: [...session.pendingSuggestionIds],
		pendingReviewItemIds: [...session.pendingReviewItemIds],
		metrics: {
			...session.metrics,
			fastApply: { ...session.metrics.fastApply },
		},
		anchor: session.anchor ? { ...session.anchor } : undefined,
	}));
}

function recreateTextSelection(
	editor: Editor,
	snapshot: AISessionSelectionSnapshot,
): TextSelection {
	const blockRange = resolveSelectionSnapshotBlockRange(editor, snapshot);
	const isCollapsed =
		snapshot.anchor.blockId === snapshot.focus.blockId &&
		snapshot.anchor.offset === snapshot.focus.offset;
	const documentRange = {
		start: resolveSelectionSnapshotRangeStart(snapshot, blockRange),
		end: resolveSelectionSnapshotRangeEnd(snapshot, blockRange),
		get isMultiBlock() {
			return blockRange.length > 1;
		},
		get blockRange() {
			return [...blockRange];
		},
		contains(point: { blockId: string; offset: number }): boolean {
			if (!blockRange.includes(point.blockId)) {
				return false;
			}
			const isSingleBlock = blockRange.length === 1;
			if (isSingleBlock) {
				return (
					point.offset >= this.start.offset && point.offset <= this.end.offset
				);
			}
			if (point.blockId === this.start.blockId) {
				return point.offset >= this.start.offset;
			}
			if (point.blockId === this.end.blockId) {
				return point.offset <= this.end.offset;
			}
			return true;
		},
		overlaps(other: {
			start: { blockId: string; offset: number };
			end: { blockId: string; offset: number };
			contains: (point: { blockId: string; offset: number }) => boolean;
		}): boolean {
			return this.contains(other.start) || this.contains(other.end) || other.contains(this.start);
		},
		equals(other: {
			start: { blockId: string; offset: number };
			end: { blockId: string; offset: number };
		}): boolean {
			return (
				this.start.blockId === other.start.blockId &&
				this.start.offset === other.start.offset &&
				this.end.blockId === other.end.blockId &&
				this.end.offset === other.end.offset
			);
		},
		toTextSelection() {
			return recreateTextSelection(editor, snapshot);
		},
	};
	return {
		type: "text",
		anchor: { ...snapshot.anchor },
		focus: { ...snapshot.focus },
		get isCollapsed() {
			return isCollapsed;
		},
		get isMultiBlock() {
			return blockRange.length > 1;
		},
		get blockRange() {
			return [...blockRange];
		},
		toRange() {
			return documentRange;
		},
	};
}

function resolveSelectionSnapshotBlockRange(
	editor: Editor,
	snapshot: AISessionSelectionSnapshot,
): string[] {
	if (snapshot.blockRange.length > 0) {
		return [...snapshot.blockRange];
	}
	const blockOrder = editor.documentState.blockOrder;
	const anchorIndex = blockOrder.indexOf(snapshot.anchor.blockId);
	const focusIndex = blockOrder.indexOf(snapshot.focus.blockId);
	if (anchorIndex === -1 || focusIndex === -1) {
		return [snapshot.anchor.blockId];
	}
	const startIndex = Math.min(anchorIndex, focusIndex);
	const endIndex = Math.max(anchorIndex, focusIndex);
	return blockOrder.slice(startIndex, endIndex + 1);
}

function resolveSelectionSnapshotRangeStart(
	snapshot: AISessionSelectionSnapshot,
	blockRange: readonly string[],
): { blockId: string; offset: number } {
	if (blockRange.length <= 1) {
		return {
			blockId: snapshot.anchor.blockId,
			offset: Math.min(snapshot.anchor.offset, snapshot.focus.offset),
		};
	}
	const firstBlockId = blockRange[0] ?? snapshot.anchor.blockId;
	return snapshot.anchor.blockId === firstBlockId
		? { ...snapshot.anchor }
		: { ...snapshot.focus };
}

function resolveSelectionSnapshotRangeEnd(
	snapshot: AISessionSelectionSnapshot,
	blockRange: readonly string[],
): { blockId: string; offset: number } {
	if (blockRange.length <= 1) {
		return {
			blockId: snapshot.anchor.blockId,
			offset: Math.max(snapshot.anchor.offset, snapshot.focus.offset),
		};
	}
	const lastBlockId = blockRange[blockRange.length - 1] ?? snapshot.focus.blockId;
	return snapshot.anchor.blockId === lastBlockId
		? { ...snapshot.anchor }
		: { ...snapshot.focus };
}

function resolvePromptTargetForSession(
	editor: Editor,
	session: AISession,
	target: "auto" | "selection" | "block" | "document" | undefined,
	prompt?: string,
): "selection" | "block" | "document" {
	if (session.surface === "inline-edit" && session.target.kind === "selection") {
		return "selection";
	}
	if (target === "selection") {
		return "selection";
	}
	if (target === "block") {
		return "block";
	}
	if (target === "document") {
		return "document";
	}
	if (session.target.kind === "selection") {
		const promptIntent = prompt ? classifyPromptIntent(prompt) : null;
		if (
			session.surface === "inline-edit" &&
			promptIntent != null &&
			promptIntent !== "rewrite"
		) {
			return "block";
		}
		return "selection";
	}
	if (session.target.kind === "document") {
		return "document";
	}
	return resolvePromptTarget(editor.selection, target);
}

function resolveSessionSelectionTarget(
	editor: Editor,
	session: AISession,
): TextSelection | null {
	const anchorSelection = session.contextualPrompt?.anchor.selectionSnapshot;
	if (session.target.kind !== "selection" && !anchorSelection) {
		return null;
	}
	const selection = editor.selection;
	if (
		selection?.type === "text" &&
		!selection.isCollapsed &&
		selectionMatchesSnapshot(
			selection,
			session.target.kind === "selection"
				? resolveSessionSelectionSnapshot(session.target.selection)
				: (anchorSelection ?? null),
		)
	) {
		return selection;
	}
	const activeTurnSelection = session.activeTurnId
		? session.turns.find((turn) => turn.id === session.activeTurnId)?.selection
		: session.turns[session.turns.length - 1]?.selection;
	if (activeTurnSelection) {
		editor.selectTextRange(
			activeTurnSelection.anchor,
			activeTurnSelection.focus,
		);
		const restoredSelection = editor.selection;
		if (restoredSelection?.type === "text" && !restoredSelection.isCollapsed) {
			return restoredSelection;
		}
	}
	if (anchorSelection) {
		editor.selectTextRange(anchorSelection.anchor, anchorSelection.focus);
		const restoredSelection = editor.selection;
		if (restoredSelection?.type === "text" && !restoredSelection.isCollapsed) {
			return restoredSelection;
		}
	}
	return session.target.kind === "selection" && !session.target.selection.isCollapsed
		? session.target.selection
		: null;
}

function shouldCloseInlineSessionPrompt(session: AISession): boolean {
	return session.surface === "inline-edit" && session.contextualPrompt != null;
}

function closeInlineSessionPrompt(
	session: AISession,
): AISession["contextualPrompt"] | undefined {
	if (!shouldCloseInlineSessionPrompt(session) || !session.contextualPrompt) {
		return session.contextualPrompt;
	}

	return {
		...session.contextualPrompt,
		composer: {
			...session.contextualPrompt.composer,
			isOpen: false,
			isSubmitting: false,
		},
	};
}

function createDefaultSessionFastApplyMetrics(): AISessionMetrics["fastApply"] {
	return {
		attemptCount: 0,
		nativeFastApplyCount: 0,
		scopedReplacementCount: 0,
		plainMarkdownCount: 0,
		failedCount: 0,
	};
}

function accumulateSessionFastApplyMetrics(
	current: AISessionMetrics["fastApply"] | undefined,
	fastApply: FastApplyDebugState | undefined,
): AISessionMetrics["fastApply"] {
	const next = {
		...(current ?? createDefaultSessionFastApplyMetrics()),
	};
	if (!fastApply?.attempted) {
		return next;
	}
	next.attemptCount += 1;
	switch (fastApply.executionPath) {
		case "native-fast-apply":
			next.nativeFastApplyCount += 1;
			return next;
		case "scoped-replacement":
			next.scopedReplacementCount += 1;
			return next;
		case "plain-markdown":
			next.plainMarkdownCount += 1;
			return next;
		default:
			next.failedCount += 1;
			return next;
	}
}

function selectionMatchesSnapshot(
	selection: TextSelection,
	snapshot: AISessionSelectionSnapshot | null,
): boolean {
	if (!snapshot) {
		return false;
	}

	return (
		selection.anchor.blockId === snapshot.anchor.blockId &&
		selection.anchor.offset === snapshot.anchor.offset &&
		selection.focus.blockId === snapshot.focus.blockId &&
		selection.focus.offset === snapshot.focus.offset &&
		selection.isMultiBlock === snapshot.isMultiBlock &&
		selection.blockRange.length === snapshot.blockRange.length &&
		selection.blockRange.every((blockId, index) => blockId === snapshot.blockRange[index])
	);
}

function resolveSessionSelectionSnapshots(
	session: AISession,
): readonly AISessionSelectionSnapshot[] {
	const snapshots: AISessionSelectionSnapshot[] = [];
	const activeTurn =
		session.activeTurnId != null
			? session.turns.find((turn) => turn.id === session.activeTurnId) ?? null
			: session.turns[session.turns.length - 1] ?? null;
	if (activeTurn?.selection) {
		snapshots.push(activeTurn.selection);
	}
	if (session.contextualPrompt?.anchor.selectionSnapshot) {
		snapshots.push(session.contextualPrompt.anchor.selectionSnapshot);
	}
	if (session.target.kind === "selection") {
		snapshots.push(resolveSessionSelectionSnapshot(session.target.selection));
	}
	return snapshots;
}

function sessionTargetMatches(
	session: AISession,
	target: AISessionTarget,
): boolean {
	if (session.target.kind !== target.kind) {
		return false;
	}
	if (target.kind !== "selection") {
		return areStructuredValuesEqual(session.target, target);
	}
	return sessionSelectionMatches(session, target.selection);
}

function sessionSelectionMatches(
	session: AISession,
	selection: TextSelection,
): boolean {
	return resolveSessionSelectionSnapshots(session).some((snapshot) =>
		selectionMatchesSnapshot(selection, snapshot),
	);
}

function resolveSessionBlockId(
	editor: Editor,
	session: AISession,
): string | null {
	if (session.target.kind === "block") {
		return session.target.blockId;
	}
	if (session.target.kind === "selection") {
		return session.target.blockId;
	}
	return (
		resolveActiveBlockId(editor.selection) ??
		editor.lastBlock()?.id ??
		editor.firstBlock()?.id ??
		null
	);
}

function resolveBlockInsertionOffset(editor: Editor, blockId: string): number {
	const selection = editor.selection;
	const block = editor.getBlock(blockId);
	const fallbackOffset =
		block && isVisuallyEmptyInlineText(block.textContent())
			? 0
			: block?.textContent().length ?? 0;
	if (selection?.type !== "text") {
		return fallbackOffset;
	}
	const range = selection.toRange();
	if (selection.isCollapsed) {
		return selection.anchor.blockId === blockId
			? selection.anchor.offset
			: fallbackOffset;
	}
	if (range.start.blockId === blockId && range.end.blockId === blockId) {
		return range.end.offset;
	}
	if (range.end.blockId === blockId) {
		return range.end.offset;
	}
	if (range.start.blockId === blockId) {
		return range.start.offset;
	}
	return fallbackOffset;
}

function appendUniqueString(values: readonly string[], value: string): string[] {
	return values.includes(value) ? [...values] : [...values, value];
}

function areSuggestionsEqual(
	previous: readonly PersistentSuggestion[],
	next: readonly PersistentSuggestion[],
): boolean {
	if (previous.length !== next.length) {
		return false;
	}

	for (let index = 0; index < previous.length; index += 1) {
		const previousSuggestion = previous[index];
		const nextSuggestion = next[index];
		if (
			previousSuggestion.id !== nextSuggestion.id ||
			previousSuggestion.blockId !== nextSuggestion.blockId ||
			previousSuggestion.action !== nextSuggestion.action ||
			previousSuggestion.offset !== nextSuggestion.offset ||
			previousSuggestion.length !== nextSuggestion.length ||
			previousSuggestion.author !== nextSuggestion.author ||
			previousSuggestion.authorType !== nextSuggestion.authorType ||
			previousSuggestion.createdAt !== nextSuggestion.createdAt ||
			previousSuggestion.model !== nextSuggestion.model ||
			previousSuggestion.sessionId !== nextSuggestion.sessionId
		) {
			return false;
		}
	}

	return true;
}

function areAIControllerStatesEqual(
	previous: AIControllerState,
	next: AIControllerState,
): boolean {
	if (
		previous.status !== next.status ||
		previous.activeSessionId !== next.activeSessionId ||
		previous.suggestMode !== next.suggestMode ||
		previous.commandMenuOpen !== next.commandMenuOpen ||
		previous.lastRoute !== next.lastRoute
	) {
		return false;
	}

	if (!areGenerationsEqual(previous.activeGeneration, next.activeGeneration)) {
		return false;
	}

	if (
		!areEphemeralSuggestionsEqual(
			previous.ephemeralSuggestion,
			next.ephemeralSuggestion,
		)
	) {
		return false;
	}

	return areSessionsEqual(previous.sessions, next.sessions);
}

function areGenerationsEqual(
	previous: AIControllerState["activeGeneration"],
	next: AIControllerState["activeGeneration"],
): boolean {
	if (previous === next) {
		return true;
	}
	if (!previous || !next) {
		return previous === next;
	}

	if (
		previous.id !== next.id ||
		previous.zoneId !== next.zoneId ||
		previous.blockId !== next.blockId ||
		previous.target !== next.target ||
		previous.sessionId !== next.sessionId ||
		previous.surface !== next.surface ||
		previous.prompt !== next.prompt ||
		previous.status !== next.status ||
		previous.tokenCount !== next.tokenCount ||
		previous.undoGroupId !== next.undoGroupId ||
		previous.text !== next.text ||
		previous.commandId !== next.commandId ||
		previous.contentFormat !== next.contentFormat ||
		previous.route !== next.route ||
		previous.mutationMode !== next.mutationMode ||
		previous.planState !== next.planState ||
		previous.targetKind !== next.targetKind ||
		!areStructuredValuesEqual(previous.structuredPreview, next.structuredPreview) ||
		!areStructuredValuesEqual(previous.reviewItems, next.reviewItems) ||
		!areStructuredValuesEqual(previous.plan, next.plan) ||
		!areStructuredValuesEqual(previous.debug, next.debug)
	) {
		return false;
	}

	if (!areStringArraysEqual(previous.suggestionIds, next.suggestionIds)) {
		return false;
	}

	if (previous.steps.length !== next.steps.length) {
		return false;
	}

	for (let index = 0; index < previous.steps.length; index += 1) {
		const previousStep = previous.steps[index];
		const nextStep = next.steps[index];
		if (
			previousStep.index !== nextStep.index ||
			previousStep.type !== nextStep.type ||
			previousStep.toolName !== nextStep.toolName ||
			previousStep.toolCallId !== nextStep.toolCallId ||
			previousStep.status !== nextStep.status ||
			previousStep.input !== nextStep.input ||
			previousStep.output !== nextStep.output
		) {
			return false;
		}
	}

	return true;
}

function areSessionsEqual(
	previous: readonly AISession[],
	next: readonly AISession[],
): boolean {
	if (previous.length !== next.length) {
		return false;
	}
	for (let index = 0; index < previous.length; index += 1) {
		const previousSession = previous[index];
		const nextSession = next[index];
		if (
			!previousSession ||
			!nextSession ||
			previousSession.id !== nextSession.id ||
			previousSession.surface !== nextSession.surface ||
			previousSession.status !== nextSession.status ||
			previousSession.createdAt !== nextSession.createdAt ||
			previousSession.updatedAt !== nextSession.updatedAt ||
			previousSession.activeTurnId !== nextSession.activeTurnId ||
			!areStructuredValuesEqual(previousSession.target, nextSession.target) ||
			!areStructuredValuesEqual(previousSession.anchor, nextSession.anchor) ||
			!areStructuredValuesEqual(
				previousSession.contextualPrompt,
				nextSession.contextualPrompt,
			) ||
			!areStructuredValuesEqual(previousSession.turns, nextSession.turns) ||
			!areStructuredValuesEqual(previousSession.promptHistory, nextSession.promptHistory) ||
			!areStringArraysEqual(
				previousSession.generationIds,
				nextSession.generationIds,
			) ||
			!areStringArraysEqual(
				previousSession.pendingSuggestionIds,
				nextSession.pendingSuggestionIds,
			) ||
			!areStringArraysEqual(
				previousSession.pendingReviewItemIds,
				nextSession.pendingReviewItemIds,
			) ||
			!areStructuredValuesEqual(previousSession.metrics, nextSession.metrics)
		) {
			return false;
		}
	}
	return true;
}

function areInlineHistorySnapshotsEqual(
	previous: AIInlineHistorySnapshot,
	next: AIInlineHistorySnapshot,
): boolean {
	return (
		previous.activeSessionId === next.activeSessionId &&
		previous.documentVersion === next.documentVersion &&
		previous.kind === next.kind &&
		areSessionsEqual(previous.sessions, next.sessions)
	);
}

function didInlineHistoryCheckpointChange(
	previousState: AIControllerState,
	nextState: AIControllerState,
): boolean {
	return !areStructuredValuesEqual(
		buildInlineHistoryCheckpoint(previousState),
		buildInlineHistoryCheckpoint(nextState),
	);
}

function buildInlineHistoryCheckpoint(
	state: AIControllerState,
): {
	activeSessionId: string | null;
	sessions: Array<{
		id: string;
		isOpen: boolean;
		target: AISessionSelectionSnapshot | null;
		latestSettledTurn: {
			id: string;
			prompt: string;
			selection: AISessionSelectionSnapshot | null;
		} | null;
		settledTurnCount: number;
	}>;
} {
	const inlineSessions = state.sessions.filter(
		(session) => session.surface === "inline-edit",
	);
	return {
		activeSessionId: state.activeSessionId ?? null,
		sessions: inlineSessions.map((session) => {
			const settledTurns = session.turns.filter(
				(turn) => turn.status !== "streaming",
			);
			const latestSettledTurn = settledTurns[settledTurns.length - 1] ?? null;
			return {
				id: session.id,
				isOpen: session.contextualPrompt?.composer.isOpen ?? false,
				target:
					session.contextualPrompt?.anchor.selectionSnapshot ??
					(session.target.kind === "selection"
						? resolveSessionSelectionSnapshot(session.target.selection)
						: null),
				latestSettledTurn: latestSettledTurn
					? {
						id: latestSettledTurn.id,
						prompt: latestSettledTurn.prompt,
						selection: latestSettledTurn.selection ?? null,
					}
					: null,
				settledTurnCount: settledTurns.length,
			};
		}),
	};
}

function countSettledInlineTurns(
	snapshot: AIInlineHistorySnapshot,
	sessionId?: string | null,
): number {
	if (sessionId) {
		const session = snapshot.sessions.find(
			(item) => item.id === sessionId && item.surface === "inline-edit",
		);
		if (!session) {
			return 0;
		}
		return session.turns.filter((turn) => turn.status !== "streaming").length;
	}
	return snapshot.sessions
		.filter((session) => session.surface === "inline-edit")
		.reduce(
			(count, session) =>
				count + session.turns.filter((turn) => turn.status !== "streaming").length,
			0,
		);
}

function areEphemeralSuggestionsEqual(
	previous: AIControllerState["ephemeralSuggestion"],
	next: AIControllerState["ephemeralSuggestion"],
): boolean {
	if (previous === next) {
		return true;
	}
	if (!previous || !next) {
		return previous === next;
	}

	return (
		previous.id === next.id &&
		previous.blockId === next.blockId &&
		previous.offset === next.offset &&
		previous.text === next.text &&
		previous.type === next.type &&
		previous.blockType === next.blockType &&
		previous.props === next.props
	);
}

function areStringArraysEqual(
	previous: readonly string[] | undefined,
	next: readonly string[] | undefined,
): boolean {
	if (previous === next) {
		return true;
	}
	if (!previous || !next) {
		return previous === next;
	}
	if (previous.length !== next.length) {
		return false;
	}

	for (let index = 0; index < previous.length; index += 1) {
		if (previous[index] !== next[index]) {
			return false;
		}
	}

	return true;
}

function areStructuredValuesEqual(
	previous: unknown,
	next: unknown,
): boolean {
	if (previous === next) {
		return true;
	}
	if (!previous || !next) {
		return previous === next;
	}

	try {
		return JSON.stringify(previous) === JSON.stringify(next);
	} catch {
		return false;
	}
}

function buildSelectionReplacementOps(
	editor: Editor,
	selection: TextSelection,
	insertedText: string,
): DocumentOp[] {
	const range = selection.toRange();
	if (range.start.blockId === range.end.blockId) {
		return [
			{
				type: "replace-text",
				blockId: range.start.blockId,
				offset: range.start.offset,
				length: range.end.offset - range.start.offset,
				text: insertedText,
			},
		];
	}
	const startId = range.start.blockId;
	const endId = range.end.blockId;
	const startText = editor.getBlock(startId)?.textContent() ?? "";
	const middleIds = range.blockRange.slice(1, -1);
	const suffixDeltas = sliceInlineDeltasFromOffset(
		editor.getBlock(endId)?.textDeltas() ?? [],
		range.end.offset,
	);
	const ops: DocumentOp[] = [];

	if (range.start.offset < startText.length) {
		ops.push({
			type: "delete-text",
			blockId: startId,
			offset: range.start.offset,
			length: startText.length - range.start.offset,
		});
	}

	if (range.end.offset > 0) {
		ops.push({
			type: "delete-text",
			blockId: endId,
			offset: 0,
			length: range.end.offset,
		});
	}

	for (const blockId of middleIds) {
		ops.push({
			type: "delete-block",
			blockId,
		});
	}

	let insertionOffset = range.start.offset;
	if (insertedText.length > 0) {
		ops.push({
			type: "insert-text",
			blockId: startId,
			offset: insertionOffset,
			text: insertedText,
		});
		insertionOffset += insertedText.length;
	}

	for (const delta of suffixDeltas) {
		ops.push({
			type: "insert-text",
			blockId: startId,
			offset: insertionOffset,
			text: delta.insert,
			marks: delta.attributes,
		});
		insertionOffset += delta.insert.length;
	}

	ops.push({
		type: "delete-block",
		blockId: endId,
	});
	return ops;
}

function sliceInlineDeltasFromOffset(
	deltas: readonly { insert: string; attributes?: Record<string, unknown> }[],
	startOffset: number,
): Array<{ insert: string; attributes?: Record<string, unknown> }> {
	const sliced: Array<{ insert: string; attributes?: Record<string, unknown> }> = [];
	let offset = 0;
	for (const delta of deltas) {
		const length = delta.insert.length;
		if (startOffset >= offset + length) {
			offset += length;
			continue;
		}
		const localStart = Math.max(0, startOffset - offset);
		const text = delta.insert.slice(localStart);
		if (text.length > 0) {
			sliced.push(
				delta.attributes
					? { insert: text, attributes: delta.attributes }
					: { insert: text },
			);
		}
		offset += length;
	}
	return sliced;
}

function resolveSelectionText(editor: Editor, selection: TextSelection): string {
	const range = selection.toRange();
	const blockIds = range.blockRange;
	const parts = blockIds.map((blockId, index) => {
		const block = editor.getBlock(blockId);
		if (!block) return "";

		let rawOffset = 0;
		let resolved = "";
		const startOffset = index === 0 ? range.start.offset : 0;
		const endOffset =
			index === blockIds.length - 1 ? range.end.offset : Number.POSITIVE_INFINITY;

		for (const delta of block.textDeltas()) {
			const length = delta.insert.length;
			const rawStart = rawOffset;
			const rawEnd = rawOffset + length;
			rawOffset = rawEnd;

			if (endOffset <= rawStart || startOffset >= rawEnd) {
				continue;
			}

			const sliceStart = Math.max(0, startOffset - rawStart);
			const sliceEnd = Math.min(length, endOffset - rawStart);
			if (sliceEnd <= sliceStart) {
				continue;
			}

			const suggestion = delta.attributes?.suggestion as
				| { action?: string }
				| undefined;
			if (suggestion?.action === "delete") {
				continue;
			}

			resolved += delta.insert.slice(sliceStart, sliceEnd);
		}

		return resolved;
	});

	return parts.join("\n");
}

function shouldReplaceEmptyMarkdownTarget(
	block: ReturnType<Editor["getBlock"]>,
): boolean {
	if (!block) {
		return false;
	}

	return (
		block.type === "paragraph" &&
		isVisuallyEmptyInlineText(block.textContent({ resolved: true }))
	);
}

function shouldTrimLeadingBlankBlockGenerationText(
	block: ReturnType<Editor["getBlock"]>,
): boolean {
	if (!block) {
		return false;
	}
	return isVisuallyEmptyInlineText(block.textContent({ resolved: true }));
}

function trimLeadingBlankBlockGenerationText(text: string): string {
	return text.replace(/^(?:[ \t]*\r?\n)+/, "");
}

function isVisuallyEmptyInlineText(text: string): boolean {
	return text.replace(/\u200B/g, "").trim().length === 0;
}
