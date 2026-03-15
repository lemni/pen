import type {
	Editor,
	Extension,
	FieldEditor,
	InlineCompletionController,
	ModelAdapter,
	ModelStreamEvent,
	TextSelection,
} from "@pen/types";
import {
	createDecorationSet,
	ensureInlineCompletionController,
} from "@pen/core";
import {
	INLINE_COMPLETION_SLOT,
	AI_AUTOCOMPLETE_CONTROLLER_SLOT,
	FIELD_EDITOR_SLOT_KEY,
	defineExtension,
} from "@pen/types";
import {
	DEFAULT_DEBOUNCE_MS,
	DEFAULT_ACCEPTANCE_STRATEGY,
	DEFAULT_MAX_NEIGHBOR_CHARS,
	DEFAULT_MAX_PREFIX_CHARS,
	DEFAULT_MAX_PROVIDER_CHARS,
	DEFAULT_MAX_PROVIDER_TIME_MS,
	DEFAULT_MAX_SUFFIX_CHARS,
	DEFAULT_PREFETCH_AFTER_ACCEPT,
	DEFAULT_STALE_AFTER_MS,
} from "./constants";
import { buildAutocompleteMessages } from "./promptBuilder";
import { builtinAutocompleteProviders } from "./providers/builtins";
import { AutocompleteProviderRegistry } from "./providers/registry";
import type {
	AutocompleteContextProvider,
	AutocompleteProviderDescriptor,
} from "./providers/types";
import type {
	AutocompleteAcceptanceStrategy,
	AutocompleteBlockedReason,
	AutocompleteBlockPolicy,
	AutocompleteController,
	AutocompleteControllerSnapshot,
	AutocompleteControllerState,
	AutocompleteDismissReason,
	AutocompleteExtensionConfig,
	AutocompletePolicyInvalidationStage,
	AutocompleteRequestContext,
} from "./types";
import {
	createAutocompleteStructuredCandidate,
	materializeStructuredCandidateAcceptance,
	type AutocompleteStructuredCandidate,
} from "./structuredCandidate";

export const AI_AUTOCOMPLETE_EXTENSION_NAME = "ai-autocomplete";
export const AUTOCOMPLETE_CONTROLLER_SLOT = AI_AUTOCOMPLETE_CONTROLLER_SLOT;
const AI_AUTOCOMPLETE_LOG_PREFIX = "[ai-autocomplete]";
const PROSE_BLOCK_TYPES = new Set(["paragraph", "heading", "blockquote", "callout"]);
const MIN_PROSE_SINGLE_WORD_COMPLETION_CHARS = 8;

class AutocompleteControllerImpl implements AutocompleteController {
	private readonly _editor: Editor;
	private readonly _model: ModelAdapter | undefined;
	private _debounceMs: number;
	private _acceptanceStrategy: AutocompleteAcceptanceStrategy;
	private _staleAfterMs: number;
	private readonly _maxPrefixChars: number;
	private readonly _maxSuffixChars: number;
	private readonly _maxNeighborChars: number;
	private readonly _maxProviderChars: number;
	private readonly _maxProviderTimeMs: number;
	private _prefetchAfterAccept: boolean;
	private readonly _providerRegistry: AutocompleteProviderRegistry;
	private readonly _inlineCompletion: InlineCompletionController;
	private readonly _listeners = new Set<() => void>();
	private _snapshot: AutocompleteControllerSnapshot | null = null;
	private _providerDescriptorsSnapshot:
		| readonly AutocompleteProviderDescriptor[]
		| null = null;
	private _state: AutocompleteControllerState = {
		enabled: true,
		status: "idle",
		activeRequestId: null,
		visibleSuggestionId: null,
		sequence: null,
		settings: {
			debounceMs: DEFAULT_DEBOUNCE_MS,
			prefetchAfterAccept: DEFAULT_PREFETCH_AFTER_ACCEPT,
			acceptanceStrategy: DEFAULT_ACCEPTANCE_STRATEGY,
			staleAfterMs: DEFAULT_STALE_AFTER_MS,
		},
		blockPolicy: {
			allowInCodeBlocks: true,
			allowInTables: false,
			deniedBlockTypes: ["database"],
		},
		metrics: {
			requestCount: 0,
			successCount: 0,
			cancelCount: 0,
			staleDropCount: 0,
			explicitTabTriggerCount: 0,
			acceptCount: 0,
			partialAcceptCount: 0,
			policyInvalidationScheduledCount: 0,
			policyInvalidationRequestingCount: 0,
			policyInvalidationShowingCount: 0,
		},
		providerTimings: [],
		diagnostics: {
			lastDismissReason: null,
			lastBlockedReason: null,
			lastPolicyInvalidationStage: null,
		},
	};
	private _debounceTimer: ReturnType<typeof setTimeout> | null = null;
	private _abortController: AbortController | null = null;
	private _unsubscribeSelection: (() => void) | null = null;
	private _unsubscribeCommit: (() => void) | null = null;
	private _sequence: {
		requestId: string;
		blockId: string;
		startOffset: number;
		candidate: AutocompleteStructuredCandidate;
		continuationDepth: number;
	} | null = null;
	private _isAcceptingSequenceSegment = false;
	private _prefetchAbortController: AbortController | null = null;
	private _prefetchedContinuation: {
		sourceRequestId: string;
		requestId: string;
		blockId: string;
		startOffset: number;
		candidate: AutocompleteStructuredCandidate;
		continuationDepth: number;
	} | null = null;
	private _pendingAcceptedContinuation: {
		sourceRequestId: string;
		blockId: string;
		startOffset: number;
		continuationDepth: number;
	} | null = null;

	constructor(
		editor: Editor,
		config: AutocompleteExtensionConfig,
		services: { inlineCompletion: InlineCompletionController },
	) {
		this._editor = editor;
		this._inlineCompletion = services.inlineCompletion;
		this._model = config.model;
		this._debounceMs = config.debounceMs ?? DEFAULT_DEBOUNCE_MS;
		this._acceptanceStrategy =
			config.acceptanceStrategy ?? DEFAULT_ACCEPTANCE_STRATEGY;
		this._staleAfterMs = config.staleAfterMs ?? DEFAULT_STALE_AFTER_MS;
		this._state.blockPolicy = {
			allowInCodeBlocks: true,
			allowInTables: false,
			deniedBlockTypes: ["database"],
			...config.blockPolicy,
		};
		this._maxPrefixChars = config.maxPrefixChars ?? DEFAULT_MAX_PREFIX_CHARS;
		this._maxSuffixChars = config.maxSuffixChars ?? DEFAULT_MAX_SUFFIX_CHARS;
		this._maxNeighborChars = config.maxNeighborChars ?? DEFAULT_MAX_NEIGHBOR_CHARS;
		this._maxProviderChars = config.maxProviderChars ?? DEFAULT_MAX_PROVIDER_CHARS;
		this._maxProviderTimeMs =
			config.maxProviderTimeMs ?? DEFAULT_MAX_PROVIDER_TIME_MS;
		this._prefetchAfterAccept =
			config.prefetchAfterAccept ?? DEFAULT_PREFETCH_AFTER_ACCEPT;
		this._providerRegistry = new AutocompleteProviderRegistry([
			...builtinAutocompleteProviders,
			...(config.providers ?? []),
		]);
		this._state.enabled = config.enabled ?? true;
		this._state.settings = {
			debounceMs: this._debounceMs,
			prefetchAfterAccept: this._prefetchAfterAccept,
			acceptanceStrategy: this._acceptanceStrategy,
			staleAfterMs: this._staleAfterMs,
		};

		this._unsubscribeSelection = this._editor.onSelectionChange(() => {
			if (this._shouldDismissForSelectionChange()) {
				this.dismiss("selection-change");
			}
		});
		this._unsubscribeCommit = this._editor.onDocumentCommit((event) => {
			if (!this._state.enabled) {
				return;
			}
			if (this._isAcceptingSequenceSegment && event.origin === "ai") {
				this._isAcceptingSequenceSegment = false;
				return;
			}
			if (event.origin !== "user" && event.origin !== "input-rule") {
				if (this._shouldDismissForExternalCommit(event.affectedBlocks)) {
					this.dismiss("external-edit");
				}
				return;
			}
			this.request();
		});
	}

	destroy(): void {
		this._unsubscribeSelection?.();
		this._unsubscribeSelection = null;
		this._unsubscribeCommit?.();
		this._unsubscribeCommit = null;
		this._clearDebounceTimer();
		this._abortController?.abort();
		this._abortController = null;
		this._prefetchAbortController?.abort();
		this._prefetchAbortController = null;
		this._pendingAcceptedContinuation = null;
	}

	getSnapshot(): AutocompleteControllerSnapshot {
		if (this._snapshot === null) {
			const state = cloneAutocompleteControllerState(this._state);
			this._snapshot = freezeAutocompleteControllerSnapshot({
				state: freezeAutocompleteControllerState(state),
				providerDescriptors: this._getProviderDescriptorsSnapshot(),
			});
		}
		return this._snapshot;
	}

	getState(): AutocompleteControllerState {
		return this.getSnapshot().state;
	}

	getBlockPolicy(): Readonly<AutocompleteBlockPolicy> {
		return this.getSnapshot().state.blockPolicy;
	}

	subscribe(listener: () => void): () => void {
		this._listeners.add(listener);
		return () => this._listeners.delete(listener);
	}

	setEnabled(enabled: boolean): void {
		if (this._state.enabled === enabled) {
			return;
		}
		this._state = {
			...this._state,
			enabled,
			status: enabled ? "idle" : "idle",
			activeRequestId: null,
		};
		this._invalidateSnapshot();
		if (!enabled) {
			this.dismiss("disabled");
		}
		this._emit();
	}

	request(options?: { explicit?: boolean }): boolean {
		if (!this._state.enabled) {
			this._setBlockedReason("disabled");
			return false;
		}
		if (!this._model) {
			this._setBlockedReason("missing-model");
			return false;
		}
		// Validate that autocomplete is currently eligible, but defer reading the
		// exact caret context until the debounced request actually runs.
		if (!this._buildContext()) {
			return false;
		}
		this.dismiss("request-replaced");
		const requestId = crypto.randomUUID();
		this._setState({
			status: "scheduled",
			activeRequestId: requestId,
			metrics: {
				...this._state.metrics,
				requestCount: this._state.metrics.requestCount + 1,
				explicitTabTriggerCount:
					this._state.metrics.explicitTabTriggerCount +
					(options?.explicit ? 1 : 0),
			},
			diagnostics: {
				...this._state.diagnostics,
				lastBlockedReason: null,
				lastPolicyInvalidationStage: null,
			},
		});
		this._clearDebounceTimer();
		const delay = options?.explicit ? 0 : this._debounceMs;
		logAutocompleteEvent("request scheduled", {
			requestId,
			explicit: options?.explicit ?? false,
			debounceMs: delay,
		});
		this._debounceTimer = setTimeout(() => {
			void this._runRequest(requestId);
		}, delay);
		return true;
	}

	acceptVisibleSuggestion(): boolean {
		if (!this._sequence || !this.hasVisibleSuggestion()) {
			return false;
		}
		const policyFailure = this._resolveCurrentBlockFailure(this._sequence.blockId);
		if (policyFailure) {
			this._recordPolicyInvalidation(policyFailure, "showing");
			return false;
		}
		return this._acceptFullVisibleSuggestion({
			activateContinuation: this._acceptanceStrategy === "sequence",
		});
	}

	private _acceptFullVisibleSuggestion(options?: {
		activateContinuation?: boolean;
	}): boolean {
		if (!this._sequence) {
			return false;
		}
		const candidate = this._sequence.candidate;
		if (
			candidate.inlineText.length === 0 &&
			candidate.previewBlocks.length === 0
		) {
			this.dismiss();
			return false;
		}
		const blockId = this._sequence.blockId;
		const requestId = this._sequence.requestId;
		const continuationDepth = this._sequence.continuationDepth + 1;
		const acceptanceResult = materializeStructuredCandidateAcceptance({
			blockId,
			offset: this._sequence.startOffset,
			candidate,
		});
		logAutocompleteEvent("accept visible suggestion", {
			requestId,
			blockId,
			startOffset: this._sequence.startOffset,
			inlineLength: candidate.inlineText.length,
			inlinePreview: previewAutocompleteTextForLog(candidate.inlineText),
			appendedBlockCount: candidate.appendedBlocks.length,
			appendedBlockTypes: candidate.appendedBlocks.map((block) => block.type),
			opTypes: acceptanceResult.ops.map((op) => op.type),
			nextCaretBlockId: acceptanceResult.selection.blockId,
			nextCaretOffset: acceptanceResult.selection.offset,
		});
		this._isAcceptingSequenceSegment = true;
		this._editor.apply(acceptanceResult.ops, { origin: "ai", undoGroup: true });
		const acceptedBlock = this._editor.getBlock(blockId);
		const firstNextBlock = acceptedBlock?.next ?? null;
		const secondNextBlock = firstNextBlock?.next ?? null;
		logAutocompleteEvent(
			`accept applied summary requestId=${requestId} appendedBlockCount=${candidate.appendedBlocks.length} opTypes=${acceptanceResult.ops.map((op) => op.type).join(",")} currentBlockType=${acceptedBlock?.type ?? "missing"} currentBlockText=${previewAutocompleteTextForLog(acceptedBlock?.textContent() ?? "")} nextBlockType=${firstNextBlock?.type ?? "none"} nextBlockText=${previewAutocompleteTextForLog(firstNextBlock?.textContent() ?? "")} nextNextBlockType=${secondNextBlock?.type ?? "none"} nextNextBlockText=${previewAutocompleteTextForLog(secondNextBlock?.textContent() ?? "")}`,
		);
		const nextCaretBlockId = acceptanceResult.selection.blockId;
		const nextCaretOffset = acceptanceResult.selection.offset;
		this._setState({
			metrics: {
				...this._state.metrics,
				acceptCount: this._state.metrics.acceptCount + 1,
			},
		});
		const fieldEditor = this._getFieldEditor();
		this._editor.selectText(
			nextCaretBlockId,
			nextCaretOffset,
			nextCaretOffset,
		);
		if (fieldEditor) {
			if (typeof fieldEditor.activateTextSelection === "function") {
				fieldEditor.activateTextSelection(
					nextCaretBlockId,
					nextCaretOffset,
					nextCaretOffset,
				);
			} else if (typeof fieldEditor.activate === "function") {
				fieldEditor.activate(nextCaretBlockId);
			}
			if (typeof fieldEditor.focus === "function") {
				fieldEditor.focus();
			}
		}

		if (options?.activateContinuation && this._prefetchAfterAccept) {
			this._pendingAcceptedContinuation = {
				sourceRequestId: requestId,
				blockId: nextCaretBlockId,
				startOffset: nextCaretOffset,
				continuationDepth,
			};
			this._clearVisibleSuggestionAfterAccept();
			this._startPrefetchForAcceptedContinuation({
				sourceRequestId: requestId,
				blockId: nextCaretBlockId,
				startOffset: nextCaretOffset,
				continuationDepth,
			});
		} else {
			this.dismiss("accept");
		}
		return true;
	}

	hasVisibleSuggestion(): boolean {
		return this._sequence !== null && this._state.visibleSuggestionId !== null;
	}

	registerProvider(provider: AutocompleteContextProvider): () => void {
		const unregister = this._providerRegistry.registerProvider(provider);
		this._invalidateProviderDescriptorsSnapshot();
		this._emit();
		return () => {
			unregister();
			this._invalidateProviderDescriptorsSnapshot();
			this._emit();
		};
	}

	listProviderDescriptors() {
		return this.getSnapshot().providerDescriptors;
	}

	updateRuntimeSettings(
		settings: Partial<AutocompleteControllerState["settings"]>,
	): void {
		const nextDebounceMs = settings.debounceMs;
		const nextPrefetchAfterAccept = settings.prefetchAfterAccept;
		const nextAcceptanceStrategy = settings.acceptanceStrategy;
		let changed = false;

		if (
			typeof nextDebounceMs === "number" &&
			Number.isFinite(nextDebounceMs) &&
			nextDebounceMs >= 0 &&
			nextDebounceMs !== this._debounceMs
		) {
			this._debounceMs = nextDebounceMs;
			changed = true;
		}

		if (
			typeof nextPrefetchAfterAccept === "boolean" &&
			nextPrefetchAfterAccept !== this._prefetchAfterAccept
		) {
			this._prefetchAfterAccept = nextPrefetchAfterAccept;
			if (!nextPrefetchAfterAccept) {
				this._prefetchAbortController?.abort();
				this._prefetchAbortController = null;
				this._prefetchedContinuation = null;
				this._pendingAcceptedContinuation = null;
			}
			changed = true;
		}

		if (
			(nextAcceptanceStrategy === "sequence" ||
				nextAcceptanceStrategy === "full") &&
			nextAcceptanceStrategy !== this._acceptanceStrategy
		) {
			this._acceptanceStrategy = nextAcceptanceStrategy;
			changed = true;
		}

		const nextStaleAfterMs = settings.staleAfterMs;
		if (
			typeof nextStaleAfterMs === "number" &&
			Number.isFinite(nextStaleAfterMs) &&
			nextStaleAfterMs >= 0 &&
			nextStaleAfterMs !== this._staleAfterMs
		) {
			this._staleAfterMs = nextStaleAfterMs;
			changed = true;
		}

		if (!changed) {
			return;
		}

		this._setState({
			settings: {
				debounceMs: this._debounceMs,
				prefetchAfterAccept: this._prefetchAfterAccept,
				acceptanceStrategy: this._acceptanceStrategy,
				staleAfterMs: this._staleAfterMs,
			},
		});
	}

	updateBlockPolicy(policy: Partial<AutocompleteBlockPolicy>): void {
		const nextPolicy: AutocompleteBlockPolicy = {
			...this._state.blockPolicy,
			...policy,
		};
		if (areBlockPoliciesEqual(this._state.blockPolicy, nextPolicy)) {
			return;
		}
		this._setState({
			blockPolicy: nextPolicy,
		});
		this._invalidateForPolicyChange();
	}

	dismiss(reason: AutocompleteDismissReason = "external-edit"): void {
		this._clearDebounceTimer();
		const cancelledRequest =
			this._state.status === "scheduled" || this._state.status === "requesting";
		this._abortController?.abort();
		this._abortController = null;
		this._prefetchAbortController?.abort();
		this._prefetchAbortController = null;
		this._clearSequence();
		this._prefetchedContinuation = null;
		this._pendingAcceptedContinuation = null;
		this._setState({
			status: "idle",
			activeRequestId: null,
			visibleSuggestionId: null,
			sequence: null,
			metrics: {
				...this._state.metrics,
				cancelCount:
					this._state.metrics.cancelCount + (cancelledRequest ? 1 : 0),
			},
			diagnostics: {
				...this._state.diagnostics,
				lastDismissReason: reason,
			},
		});
		this._inlineCompletion.dismissSuggestion();
	}

	private async _runRequest(requestId: string): Promise<void> {
		if (this._state.activeRequestId !== requestId || !this._model) {
			logAutocompleteEvent("request skipped before start", {
				requestId,
				hasModel: !!this._model,
				activeRequestId: this._state.activeRequestId,
			});
			return;
		}
		this._abortController?.abort();
		const abortController = new AbortController();
		this._abortController = abortController;
		const context = this._buildContext();
		if (!context) {
			logAutocompleteEvent("request blocked before prompt build", {
				requestId,
				lastBlockedReason: this._state.diagnostics.lastBlockedReason,
			});
			this._setState({
				status: "idle",
				activeRequestId: null,
			});
			return;
		}
		this._setState({
			status: "requesting",
			activeRequestId: requestId,
		});
		logAutocompleteEvent("request started", {
			requestId,
			blockId: context.blockId,
			offset: context.offset,
		});

		const { messages, providerTimings } = await buildAutocompleteMessages({
			context,
			registry: this._providerRegistry,
			maxProviderChars: this._maxProviderChars,
			maxProviderTimeMs: this._maxProviderTimeMs,
			continuationDepth: 0,
		});
		if (!this._shouldContinueRequest(requestId, context)) {
			logAutocompleteEvent("request cancelled after prompt build", {
				requestId,
				activeRequestId: this._state.activeRequestId,
				lastBlockedReason: this._state.diagnostics.lastBlockedReason,
			});
			return;
		}
		this._setState({ providerTimings });
		logAutocompleteEvent("request prompt ready", {
			requestId,
			providerTimings,
			promptLength: String(messages[1]?.content ?? "").length,
		});
		const startedAt = Date.now();

		let text = "";
		try {
			logAutocompleteEvent("request model stream opening", { requestId });
			for await (const event of this._model.stream({
				messages,
				tools: [],
				signal: abortController.signal,
			})) {
				if (!this._shouldContinueRequest(requestId, context)) {
					logAutocompleteEvent("request cancelled during stream", {
						requestId,
						activeRequestId: this._state.activeRequestId,
						lastBlockedReason: this._state.diagnostics.lastBlockedReason,
					});
					abortController.abort();
					return;
				}
				logAutocompleteEvent("request model event", {
					requestId,
					type: event.type,
				});
				if (!handleModelEvent(event, (delta) => {
					text += delta;
				})) {
					break;
				}
			}
		} catch {
			logAutocompleteEvent("request stream threw", {
				requestId,
				aborted: abortController.signal.aborted,
			});
			if (!abortController.signal.aborted) {
				this._setState({
					status: "idle",
					activeRequestId: null,
				});
			}
			return;
		}

		if (!this._shouldContinueRequest(requestId, context)) {
			logAutocompleteEvent("request cancelled after stream", {
				requestId,
				activeRequestId: this._state.activeRequestId,
				lastBlockedReason: this._state.diagnostics.lastBlockedReason,
			});
			return;
		}
		if (Date.now() - startedAt > this._staleAfterMs) {
			logAutocompleteEvent("request dropped as stale", {
				requestId,
				elapsedMs: Date.now() - startedAt,
				staleAfterMs: this._staleAfterMs,
			});
			this._setState({
				status: "idle",
				activeRequestId: null,
				metrics: {
					...this._state.metrics,
					staleDropCount: this._state.metrics.staleDropCount + 1,
				},
				diagnostics: {
					...this._state.diagnostics,
					lastDismissReason: "stale",
				},
			});
			return;
		}
		const normalizedText = normalizeCompletionText(context, text);
		logAutocompleteEvent("request normalized text", {
			requestId,
			blockType: context.blockType,
			rawLength: text.length,
			rawPreview: previewAutocompleteTextForLog(text),
			normalizedLength: normalizedText.length,
			normalizedPreview: previewAutocompleteTextForLog(normalizedText),
		});
		if (!normalizedText) {
			logAutocompleteEvent("request produced empty normalized text", {
				requestId,
				rawLength: text.length,
			});
			this._setState({
				status: "idle",
				activeRequestId: null,
			});
			return;
		}

		const candidate = createAutocompleteStructuredCandidate(
			this._editor,
			normalizedText,
			{
				activeBlockType: context.blockType,
				continuationDepth: 0,
			},
		);
		this._sequence = {
			requestId,
			blockId: context.blockId,
			startOffset: context.offset,
			candidate,
			continuationDepth: 0,
		};
		this._setState({
			metrics: {
				...this._state.metrics,
				successCount: this._state.metrics.successCount + 1,
			},
		});
		logAutocompleteEvent("request produced suggestion", {
			requestId,
			blockType: context.blockType,
			normalizedLength: normalizedText.length,
			inlineLength: candidate.inlineText.length,
			inlinePreview: previewAutocompleteTextForLog(candidate.inlineText),
			appendedBlockCount: candidate.appendedBlocks.length,
			appendedBlockTypes: candidate.appendedBlocks.map((block) => block.type),
			previewBlockCount: candidate.previewBlocks.length,
		});
		this._showSequenceSuggestion();
	}

	private _buildContext(): AutocompleteRequestContext | null {
		const selection = this._editor.selection;
		if (selection == null) {
			this._setBlockedReason("missing-context");
			return null;
		}
		if (selection.type !== "text") {
			this._setBlockedReason("selection-not-text");
			return null;
		}
		if (!selection.isCollapsed) {
			this._setBlockedReason("selection-not-collapsed");
			return null;
		}
		if (selection.isMultiBlock) {
			this._setBlockedReason("selection-multi-block");
			return null;
		}
		const fieldEditor = this._getFieldEditor();
		if (!fieldEditor) {
			this._setBlockedReason("field-editor-unavailable");
			return null;
		}
		if (!fieldEditor.isEditing) {
			this._setBlockedReason("field-editor-not-editing");
			return null;
		}
		if (!fieldEditor.isFocused) {
			this._setBlockedReason("field-editor-not-focused");
			return null;
		}
		if (fieldEditor.isComposing) {
			this._setBlockedReason("field-editor-composing");
			return null;
		}
		return this._buildContextForPosition(
			selection.focus.blockId,
			selection.focus.offset,
		);
	}

	private _buildContextForPosition(
		blockId: string,
		offset: number,
	): AutocompleteRequestContext | null {
		const block = this._editor.getBlock(blockId);
		if (!block) {
			this._setBlockedReason("block-missing");
			return null;
		}
		const blockPolicyFailure = this._resolveContextEligibilityFailure(
			block.id,
			block.type,
		);
		if (blockPolicyFailure) {
			this._setBlockedReason(blockPolicyFailure);
			return null;
		}
		const blockText = block.textContent();
		return {
			editor: this._editor,
			blockId: block.id,
			blockType: block.type,
			offset,
			prefixText: tail(blockText.slice(0, offset), this._maxPrefixChars),
			suffixText: head(blockText.slice(offset), this._maxSuffixChars),
			previousBlockText: tail(block.prev?.textContent() ?? "", this._maxNeighborChars),
			nextBlockText: head(block.next?.textContent() ?? "", this._maxNeighborChars),
		};
	}

	private _shouldContinueRequest(
		requestId: string,
		context: AutocompleteRequestContext,
	): boolean {
		if (this._state.activeRequestId !== requestId) {
			logAutocompleteEvent("request continuation blocked: replaced", {
				requestId,
				activeRequestId: this._state.activeRequestId,
			});
			return false;
		}
		const selection = this._editor.selection;
		if (
			selection?.type !== "text" ||
			!selection.isCollapsed ||
			selection.isMultiBlock ||
			selection.focus.blockId !== context.blockId ||
			selection.focus.offset !== context.offset
		) {
			logAutocompleteEvent("request continuation blocked: selection changed", {
				requestId,
				expected: {
					blockId: context.blockId,
					offset: context.offset,
				},
				actual:
					selection?.type === "text"
						? {
							type: selection.type,
							blockId: selection.focus.blockId,
							offset: selection.focus.offset,
							isCollapsed: selection.isCollapsed,
							isMultiBlock: selection.isMultiBlock,
						}
						: selection,
			});
			return false;
		}
		const fieldEditor = this._getFieldEditor();
		if (!fieldEditor?.isEditing || !fieldEditor.isFocused || fieldEditor.isComposing) {
			logAutocompleteEvent("request continuation blocked: field editor state", {
				requestId,
				fieldEditor: fieldEditor
					? {
						isEditing: fieldEditor.isEditing,
						isFocused: fieldEditor.isFocused,
						isComposing: fieldEditor.isComposing,
						focusBlockId: fieldEditor.focusBlockId,
					}
					: null,
			});
			return false;
		}
		const block = this._editor.getBlock(context.blockId);
		const policyFailure = block
			? this._resolveContextEligibilityFailure(block.id, block.type)
			: "block-missing";
		if (policyFailure) {
			this._setBlockedReason(policyFailure);
			return false;
		}
		return true;
	}

	private _shouldDismissForExternalCommit(affectedBlocks: readonly string[]): boolean {
		const visibleSuggestion = this._inlineCompletion.getState().visibleSuggestion;
		return !!visibleSuggestion && affectedBlocks.includes(visibleSuggestion.blockId);
	}

	private _shouldDismissForSelectionChange(): boolean {
		const visibleSuggestion = this._inlineCompletion.getState().visibleSuggestion;
		if (!visibleSuggestion || visibleSuggestion.type !== "inline") {
			return false;
		}
		const selection = this._editor.selection;
		if (selection?.type !== "text" || !selection.isCollapsed || selection.isMultiBlock) {
			return true;
		}
		return (
			selection.focus.blockId !== visibleSuggestion.blockId ||
			selection.focus.offset !== visibleSuggestion.offset
		);
	}

	private _getFieldEditor(): FieldEditor | null {
		return this._editor.internals.getSlot<FieldEditor>(FIELD_EDITOR_SLOT_KEY) ?? null;
	}

	private _showSequenceSuggestion(): void {
		if (!this._sequence) {
			return;
		}
		const suggestionId = this._sequence.requestId;
		const preview = this._sequence.candidate;
		this._inlineCompletion.showSuggestion({
			id: suggestionId,
			blockId: this._sequence.blockId,
			offset: this._sequence.startOffset,
			text: preview.inlineText,
			type: "inline",
			previewBlocks: preview.previewBlocks,
		});
		this._setState({
			status: "showing",
			activeRequestId: this._sequence.requestId,
			visibleSuggestionId: suggestionId,
			sequence: {
				totalSegments: 1,
				acceptedSegments: 0,
				remainingSegments: 1,
			},
		});
	}

	private _startPrefetchForAcceptedContinuation(options: {
		sourceRequestId: string;
		blockId: string;
		startOffset: number;
		continuationDepth: number;
	}): void {
		if (!this._prefetchAfterAccept) {
			return;
		}
		const context = this._buildContextForPosition(
			options.blockId,
			options.startOffset,
		);
		if (!context) {
			return;
		}
		this._prefetchAbortController?.abort();
		const abortController = new AbortController();
		this._prefetchAbortController = abortController;
		void this._runPrefetchRequest({
			abortController,
			context,
			continuationDepth: options.continuationDepth,
			sourceRequestId: options.sourceRequestId,
		});
	}

	private async _runPrefetchRequest(options: {
		abortController: AbortController;
		context: AutocompleteRequestContext;
		continuationDepth: number;
		sourceRequestId: string;
	}): Promise<void> {
		if (!this._model) {
			return;
		}
		const { abortController, context, continuationDepth, sourceRequestId } =
			options;
		const requestId = crypto.randomUUID();
		const { messages } = await buildAutocompleteMessages({
			context,
			registry: this._providerRegistry,
			maxProviderChars: this._maxProviderChars,
			maxProviderTimeMs: this._maxProviderTimeMs,
			mode: "continuation",
			continuationDepth,
		});
		if (abortController.signal.aborted) {
			return;
		}

		let text = "";
		try {
			for await (const event of this._model.stream({
				messages,
				tools: [],
				signal: abortController.signal,
			})) {
				if (abortController.signal.aborted) {
					return;
				}
				if (!handleModelEvent(event, (delta) => {
					text += delta;
				})) {
					break;
				}
			}
		} catch {
			return;
		}

		if (abortController.signal.aborted) {
			return;
		}
		const normalizedText = normalizeCompletionText(context, text);
		if (!normalizedText) {
			logAutocompleteEvent("prefetch produced empty normalized text", {
				requestId,
				sourceRequestId,
				blockType: context.blockType,
				rawLength: text.length,
				rawPreview: previewAutocompleteTextForLog(text),
			});
			return;
		}
		const candidate = createAutocompleteStructuredCandidate(
			this._editor,
			normalizedText,
			{
				activeBlockType: context.blockType,
				continuationDepth,
			},
		);
		logAutocompleteEvent("prefetch produced suggestion", {
			requestId,
			sourceRequestId,
			blockType: context.blockType,
			rawLength: text.length,
			rawPreview: previewAutocompleteTextForLog(text),
			normalizedLength: normalizedText.length,
			normalizedPreview: previewAutocompleteTextForLog(normalizedText),
			inlineLength: candidate.inlineText.length,
			inlinePreview: previewAutocompleteTextForLog(candidate.inlineText),
			appendedBlockCount: candidate.appendedBlocks.length,
			appendedBlockTypes: candidate.appendedBlocks.map((block) => block.type),
			previewBlockCount: candidate.previewBlocks.length,
		});
		this._prefetchedContinuation = {
			sourceRequestId,
			requestId,
			blockId: context.blockId,
			startOffset: context.offset,
			candidate,
			continuationDepth,
		};
		this._activatePendingAcceptedContinuation();
	}

	private _activatePendingAcceptedContinuation(): boolean {
		const prefetched = this._prefetchedContinuation;
		const pending = this._pendingAcceptedContinuation;
		if (!prefetched || !pending) {
			return false;
		}
		if (
			prefetched.sourceRequestId !== pending.sourceRequestId ||
			prefetched.blockId !== pending.blockId ||
			prefetched.startOffset !== pending.startOffset
		) {
			return false;
		}
		const selection = this._editor.selection;
		if (
			selection?.type !== "text" ||
			!selection.isCollapsed ||
			selection.isMultiBlock ||
			selection.focus.blockId !== pending.blockId ||
			selection.focus.offset !== pending.startOffset
		) {
			return false;
		}
		this._pendingAcceptedContinuation = null;
		this._sequence = {
			requestId: prefetched.requestId,
			blockId: prefetched.blockId,
			startOffset: prefetched.startOffset,
			candidate: prefetched.candidate,
			continuationDepth: prefetched.continuationDepth,
		};
		this._prefetchedContinuation = null;
		this._showSequenceSuggestion();
		return true;
	}

	private _clearSequence(): void {
		this._sequence = null;
		this._isAcceptingSequenceSegment = false;
	}

	private _clearVisibleSuggestionAfterAccept(): void {
		this._clearSequence();
		this._setState({
			status: "idle",
			activeRequestId: null,
			visibleSuggestionId: null,
			sequence: null,
			diagnostics: {
				...this._state.diagnostics,
				lastDismissReason: "accept",
			},
		});
		this._inlineCompletion.dismissSuggestion();
	}

	private _setBlockedReason(reason: AutocompleteBlockedReason): void {
		this._setState({
			diagnostics: {
				...this._state.diagnostics,
				lastBlockedReason: reason,
			},
		});
	}

	private _recordPolicyInvalidation(
		policyFailure: AutocompleteBlockedReason,
		invalidationStage: AutocompletePolicyInvalidationStage | null,
	): void {
		this._setBlockedReason(policyFailure);
		if (invalidationStage) {
			this._setState({
				metrics: incrementPolicyInvalidationMetrics(
					this._state.metrics,
					invalidationStage,
				),
				diagnostics: {
					...this._state.diagnostics,
					lastPolicyInvalidationStage: invalidationStage,
				},
			});
		}
		if (invalidationStage || this._prefetchedContinuation) {
			this.dismiss("policy-change");
		}
	}

	private _invalidateForPolicyChange(): void {
		const activeBlockId = this._sequence?.blockId ?? this._getActiveSelectionBlockId();
		if (!activeBlockId) {
			return;
		}
		const policyFailure = this._resolveCurrentBlockFailure(activeBlockId);
		if (!policyFailure) {
			return;
		}
		const invalidationStage = this._getPolicyInvalidationStage();
		this._recordPolicyInvalidation(policyFailure, invalidationStage);
	}

	private _getActiveSelectionBlockId(): string | null {
		const selection = this._editor.selection;
		return selection?.type === "text" ? selection.focus.blockId : null;
	}

	private _getPolicyInvalidationStage(): AutocompletePolicyInvalidationStage | null {
		if (this._state.status === "scheduled" || this._state.status === "requesting") {
			return this._state.status;
		}
		if (this._state.status === "showing" || this._sequence || this._prefetchedContinuation) {
			return "showing";
		}
		return null;
	}

	private _resolveCurrentBlockFailure(
		blockId: string,
	): AutocompleteBlockedReason | null {
		const block = this._editor.getBlock(blockId);
		if (!block) {
			return "block-missing";
		}
		return this._resolveContextEligibilityFailure(block.id, block.type);
	}

	private _resolveContextEligibilityFailure(
		blockId: string,
		blockType: string | null,
	): AutocompleteBlockedReason | null {
		const blockPolicyFailure = this._resolveBlockPolicyFailure(blockType);
		if (blockPolicyFailure) {
			return blockPolicyFailure;
		}
		const fieldEditor = this._getFieldEditor() as
			| (FieldEditor & { activeCellCoord?: { blockId: string } | null })
			| null;
		if (
			fieldEditor?.activeCellCoord &&
			fieldEditor.activeCellCoord.blockId === blockId &&
			this._state.blockPolicy.allowInTables !== true
		) {
			return "table-cell-active";
		}
		return null;
	}

	private _resolveBlockPolicyFailure(
		blockType: string | null,
	): AutocompleteBlockedReason | null {
		if (!blockType) {
			return null;
		}
		const allowedBlockTypes = this._state.blockPolicy.allowedBlockTypes;
		if (
			allowedBlockTypes &&
			allowedBlockTypes.length > 0 &&
			!allowedBlockTypes.includes(blockType)
		) {
			return "block-type-not-allowed";
		}
		const deniedBlockTypes = this._state.blockPolicy.deniedBlockTypes;
		if (deniedBlockTypes?.includes(blockType)) {
			return "block-type-denied";
		}
		if (
			blockType === "codeBlock" &&
			this._state.blockPolicy.allowInCodeBlocks === false
		) {
			return "code-block-disabled";
		}
		if (blockType === "table" && this._state.blockPolicy.allowInTables !== true) {
			return "table-disabled";
		}
		return null;
	}

	private _clearDebounceTimer(): void {
		if (this._debounceTimer !== null) {
			clearTimeout(this._debounceTimer);
			this._debounceTimer = null;
		}
	}

	private _setState(next: Partial<AutocompleteControllerState>): void {
		this._state = {
			...this._state,
			...next,
		};
		this._invalidateSnapshot();
		this._emit();
	}

	private _getProviderDescriptorsSnapshot(): readonly AutocompleteProviderDescriptor[] {
		if (this._providerDescriptorsSnapshot === null) {
			this._providerDescriptorsSnapshot = freezeProviderDescriptors(
				this._providerRegistry.listProviderDescriptors(),
			);
		}
		return this._providerDescriptorsSnapshot;
	}

	private _invalidateSnapshot(): void {
		this._snapshot = null;
	}

	private _invalidateProviderDescriptorsSnapshot(): void {
		this._providerDescriptorsSnapshot = null;
		this._invalidateSnapshot();
	}

	private _emit(): void {
		for (const listener of this._listeners) {
			listener();
		}
	}
}

export function autocompleteExtension(
	config: AutocompleteExtensionConfig = {},
): Extension {
	let controller: AutocompleteControllerImpl | null = null;
	let inlineCompletion: InlineCompletionController | null = null;
	let ownsInlineCompletion = false;
	let activeEditor: Editor | null = null;

	return defineExtension({
		name: AI_AUTOCOMPLETE_EXTENSION_NAME,
		activateClient: async ({ editor }) => {
			activeEditor = editor;
			const inlineCompletionRegistration = ensureInlineCompletionController(editor);
			inlineCompletion = inlineCompletionRegistration.controller;
			ownsInlineCompletion = inlineCompletionRegistration.isOwner;
			controller = new AutocompleteControllerImpl(editor, config, {
				inlineCompletion,
			});
			editor.internals.setSlot(AUTOCOMPLETE_CONTROLLER_SLOT, controller);
		},
		deactivateClient: async () => {
			controller?.destroy();
			activeEditor?.internals.setSlot(AUTOCOMPLETE_CONTROLLER_SLOT, null);
			if (ownsInlineCompletion) {
				inlineCompletion?.destroy();
				activeEditor?.internals.setSlot(INLINE_COMPLETION_SLOT, null);
			}
			controller = null;
			inlineCompletion = null;
			ownsInlineCompletion = false;
			activeEditor = null;
		},
		decorations: () => createDecorationSet([
			...(ownsInlineCompletion
				? (inlineCompletion?.buildDecorations() ?? [])
				: []),
		]),
	});
}

export function getAutocompleteController(
	editor: Editor,
): AutocompleteController | null {
	return editor.internals.getSlot<AutocompleteController>(
		AUTOCOMPLETE_CONTROLLER_SLOT,
	) ?? null;
}

function handleModelEvent(
	event: ModelStreamEvent,
	onTextDelta: (delta: string) => void,
): boolean {
	if (event.type === "text-delta") {
		onTextDelta(event.delta);
		return true;
	}
	if (event.type === "done" || event.type === "error") {
		return false;
	}
	return true;
}

function normalizeCompletionText(
	context: AutocompleteRequestContext,
	text: string,
): string {
	const normalized = text.replace(/\r/g, "");
	const withoutFence = normalized.replace(/^```[a-zA-Z0-9_-]*\n?/, "").replace(/```$/, "");
	const withoutWrappedQuotes = stripWrappedCompletionQuotes(context, withoutFence);
	const trimmedLeading =
		withoutWrappedQuotes.startsWith("\n\n") ||
			startsWithStructuredBlockContinuation(withoutWrappedQuotes)
			? withoutWrappedQuotes
			: withoutWrappedQuotes.replace(/^\s*\n/, "");
	if (!trimmedLeading) {
		return "";
	}
	let candidate = trimmedLeading;
	const suffixEcho = longestCommonPrefix(context.suffixText, trimmedLeading);
	if (suffixEcho.length > 0) {
		candidate = trimmedLeading.slice(suffixEcho.length);
	} else if (context.suffixText.length === 0) {
		const prefixEcho = longestSuffixPrefixOverlap(
			context.prefixText,
			trimmedLeading,
		);
		if (prefixEcho.length > 0) {
			candidate = trimmedLeading.slice(prefixEcho.length);
		}
	}
	candidate = maybeInsertMissingBoundarySpace(context, candidate);
	candidate = stripLeadingBoundaryPunctuationArtifacts(context, candidate);
	candidate = collapseDuplicateBoundaryWhitespace(context, candidate);
	candidate = maybeCapitalizeSentenceStart(context, candidate);
	if (shouldRejectLowQualityCompletion(context, candidate)) {
		return "";
	}
	return candidate;
}

function startsWithStructuredBlockContinuation(text: string): boolean {
	return /^\s*\n(?=(?:#{1,6}\s|>\s|[-*+]\s|\d+[.)]\s|\[[ xX]\]\s|```))/.test(text);
}

function longestCommonPrefix(left: string, right: string): string {
	const maxLength = Math.min(left.length, right.length);
	let index = 0;
	while (index < maxLength && left[index] === right[index]) {
		index += 1;
	}
	return left.slice(0, index);
}

function longestSuffixPrefixOverlap(left: string, right: string): string {
	const maxLength = Math.min(left.length, right.length);
	for (let length = maxLength; length > 0; length -= 1) {
		const overlap = right.slice(0, length);
		if (left.endsWith(overlap)) {
			return overlap;
		}
	}
	return "";
}

function maybeInsertMissingBoundarySpace(
	context: AutocompleteRequestContext,
	completion: string,
): string {
	if (
		!completion ||
		context.suffixText.length > 0 ||
		!PROSE_BLOCK_TYPES.has(context.blockType ?? "")
	) {
		return completion;
	}
	const lastPrefixChar = context.prefixText.slice(-1);
	const firstCompletionChar = completion[0];
	if (!isWordLikeChar(lastPrefixChar) || !isWordLikeChar(firstCompletionChar)) {
		return completion;
	}
	if (!hasLikelyWordBoundary(completion)) {
		return completion;
	}
	return ` ${completion}`;
}

function stripWrappedCompletionQuotes(
	context: AutocompleteRequestContext,
	completion: string,
): string {
	if (!completion || context.suffixText.length > 0) {
		return completion;
	}
	const trimmed = completion.trim();
	if (trimmed.length < 2 || isLikelyInsideOpenQuote(context.prefixText)) {
		return completion;
	}
	const unwrapped = unwrapMatchingQuotes(trimmed);
	if (unwrapped == null) {
		return completion;
	}
	const leadingWhitespace = completion.match(/^\s*/)?.[0] ?? "";
	const trailingWhitespace = completion.match(/\s*$/)?.[0] ?? "";
	return `${leadingWhitespace}${unwrapped}${trailingWhitespace}`;
}

function stripLeadingBoundaryPunctuationArtifacts(
	context: AutocompleteRequestContext,
	completion: string,
): string {
	if (
		!completion ||
		context.suffixText.length > 0 ||
		!PROSE_BLOCK_TYPES.has(context.blockType ?? "")
	) {
		return completion;
	}
	const prefixEndsWithWhitespace = /\s$/.test(context.prefixText);
	const prefixEndsSentence = /[.!?]["')\]]*\s*$/.test(context.prefixText);
	if (!prefixEndsWithWhitespace && !prefixEndsSentence) {
		return completion;
	}
	if (prefixEndsWithWhitespace) {
		return completion.replace(/^([ \t]*)([,.;:!?]+)(?=\s|["'A-Z])/u, "$1");
	}
	if (prefixEndsSentence) {
		return completion.replace(/^([ \t]*)([,;:]+)(?=\s|["'A-Z])/u, "$1");
	}
	return completion;
}

function collapseDuplicateBoundaryWhitespace(
	context: AutocompleteRequestContext,
	completion: string,
): string {
	if (!completion || context.suffixText.length > 0) {
		return completion;
	}
	if (!/\s$/.test(context.prefixText)) {
		return completion;
	}
	return completion.replace(/^[ \t]+/u, "");
}

function maybeCapitalizeSentenceStart(
	context: AutocompleteRequestContext,
	completion: string,
): string {
	if (
		!completion ||
		context.suffixText.length > 0 ||
		!PROSE_BLOCK_TYPES.has(context.blockType ?? "") ||
		!/[.!?]["')\]]*\s*$/.test(context.prefixText)
	) {
		return completion;
	}
	return completion.replace(
		/^(\s*["'([{“‘-]*)([a-z])/u,
		(_, prefix: string, character: string) => `${prefix}${character.toUpperCase()}`,
	);
}

function shouldRejectLowQualityCompletion(
	context: AutocompleteRequestContext,
	completion: string,
): boolean {
	const trimmed = completion.trim();
	if (!trimmed) {
		return true;
	}
	if (
		PROSE_BLOCK_TYPES.has(context.blockType ?? "") &&
		context.suffixText.length === 0 &&
		countWordLikeTokens(trimmed) === 1 &&
		trimmed.length < MIN_PROSE_SINGLE_WORD_COMPLETION_CHARS &&
		!/[.!?]$/.test(trimmed)
	) {
		return true;
	}
	return false;
}

function countWordLikeTokens(value: string): number {
	return value.match(/[A-Za-z0-9_'-]+/g)?.length ?? 0;
}

function hasLikelyWordBoundary(value: string): boolean {
	return /[\s.,!?;:]/.test(value.slice(1));
}

function isWordLikeChar(value: string): boolean {
	return /[A-Za-z0-9]/.test(value);
}

function unwrapMatchingQuotes(value: string): string | null {
	const quotePairs: Array<[string, string]> = [
		['"', '"'],
		["'", "'"],
		["“", "”"],
		["‘", "’"],
	];
	for (const [open, close] of quotePairs) {
		if (value.startsWith(open) && value.endsWith(close)) {
			const inner = value.slice(open.length, value.length - close.length).trim();
			return inner.length > 0 ? inner : null;
		}
	}
	return null;
}

function isLikelyInsideOpenQuote(value: string): boolean {
	const asciiDoubleQuotes = value.match(/"/g)?.length ?? 0;
	const asciiSingleQuotes = value.match(/'/g)?.length ?? 0;
	const smartOpenQuotes = value.match(/“/g)?.length ?? 0;
	const smartCloseQuotes = value.match(/”/g)?.length ?? 0;
	const smartOpenSingles = value.match(/‘/g)?.length ?? 0;
	const smartCloseSingles = value.match(/’/g)?.length ?? 0;
	return (
		asciiDoubleQuotes % 2 === 1 ||
		asciiSingleQuotes % 2 === 1 ||
		smartOpenQuotes > smartCloseQuotes ||
		smartOpenSingles > smartCloseSingles
	);
}

function head(value: string, maxChars: number): string {
	return value.length <= maxChars ? value : value.slice(0, maxChars);
}

function tail(value: string, maxChars: number): string {
	return value.length <= maxChars ? value : value.slice(-maxChars);
}

function areBlockPoliciesEqual(
	left: AutocompleteBlockPolicy,
	right: AutocompleteBlockPolicy,
): boolean {
	return (
		left.allowInCodeBlocks === right.allowInCodeBlocks &&
		left.allowInTables === right.allowInTables &&
		areStringArraysEqual(left.allowedBlockTypes, right.allowedBlockTypes) &&
		areStringArraysEqual(left.deniedBlockTypes, right.deniedBlockTypes)
	);
}

function areStringArraysEqual(
	left: readonly string[] | undefined,
	right: readonly string[] | undefined,
): boolean {
	if (left === right) {
		return true;
	}
	if (!left || !right || left.length !== right.length) {
		return false;
	}
	for (let index = 0; index < left.length; index += 1) {
		if (left[index] !== right[index]) {
			return false;
		}
	}
	return true;
}

function cloneBlockPolicy(
	policy: AutocompleteBlockPolicy,
): AutocompleteBlockPolicy {
	return {
		allowInCodeBlocks: policy.allowInCodeBlocks,
		allowInTables: policy.allowInTables,
		allowedBlockTypes: policy.allowedBlockTypes
			? [...policy.allowedBlockTypes]
			: undefined,
		deniedBlockTypes: policy.deniedBlockTypes
			? [...policy.deniedBlockTypes]
			: undefined,
	};
}

function cloneAutocompleteControllerState(
	state: AutocompleteControllerState,
): AutocompleteControllerState {
	return {
		enabled: state.enabled,
		status: state.status,
		activeRequestId: state.activeRequestId,
		visibleSuggestionId: state.visibleSuggestionId,
		sequence: state.sequence ? { ...state.sequence } : null,
		settings: { ...state.settings },
		blockPolicy: cloneBlockPolicy(state.blockPolicy),
		metrics: { ...state.metrics },
		providerTimings: state.providerTimings.map((timing) => ({ ...timing })),
		diagnostics: { ...state.diagnostics },
	};
}

function freezeBlockPolicy(
	policy: AutocompleteBlockPolicy,
): AutocompleteBlockPolicy {
	if (policy.allowedBlockTypes) {
		Object.freeze(policy.allowedBlockTypes);
	}
	if (policy.deniedBlockTypes) {
		Object.freeze(policy.deniedBlockTypes);
	}
	return Object.freeze(policy);
}

function freezeAutocompleteControllerState(
	state: AutocompleteControllerState,
): AutocompleteControllerState {
	if (state.sequence) {
		Object.freeze(state.sequence);
	}
	Object.freeze(state.settings);
	freezeBlockPolicy(state.blockPolicy);
	Object.freeze(state.metrics);
	for (const timing of state.providerTimings) {
		Object.freeze(timing);
	}
	Object.freeze(state.providerTimings);
	Object.freeze(state.diagnostics);
	return Object.freeze(state);
}

function freezeProviderDescriptors(
	descriptors: readonly AutocompleteProviderDescriptor[],
): readonly AutocompleteProviderDescriptor[] {
	for (const descriptor of descriptors) {
		Object.freeze(descriptor);
	}
	return Object.freeze([...descriptors]);
}

function freezeAutocompleteControllerSnapshot(
	snapshot: AutocompleteControllerSnapshot,
): AutocompleteControllerSnapshot {
	return Object.freeze(snapshot);
}

function incrementPolicyInvalidationMetrics(
	metrics: AutocompleteControllerState["metrics"],
	stage: AutocompletePolicyInvalidationStage,
): AutocompleteControllerState["metrics"] {
	return {
		...metrics,
		policyInvalidationScheduledCount:
			metrics.policyInvalidationScheduledCount + (stage === "scheduled" ? 1 : 0),
		policyInvalidationRequestingCount:
			metrics.policyInvalidationRequestingCount + (stage === "requesting" ? 1 : 0),
		policyInvalidationShowingCount:
			metrics.policyInvalidationShowingCount + (stage === "showing" ? 1 : 0),
	};
}

function logAutocompleteEvent(message: string, details?: unknown): void {
	if (details === undefined) {
		console.log(`${AI_AUTOCOMPLETE_LOG_PREFIX} ${message}`);
		return;
	}
	console.log(`${AI_AUTOCOMPLETE_LOG_PREFIX} ${message}`, details);
}

function previewAutocompleteTextForLog(text: string): string {
	return JSON.stringify(text.length > 160 ? `${text.slice(0, 160)}...` : text);
}
