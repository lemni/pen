import type { ModelAdapter } from "@pen/types";
import type {
	AutocompleteContextProvider,
	AutocompleteProviderDescriptor,
	AutocompleteRequestContext,
	AutocompleteProviderTiming,
} from "./providers/types";

export interface AutocompleteExtensionConfig {
	model?: ModelAdapter;
	enabled?: boolean;
	debounceMs?: number;
	acceptanceStrategy?: AutocompleteAcceptanceStrategy;
	staleAfterMs?: number;
	blockPolicy?: AutocompleteBlockPolicy;
	maxPrefixChars?: number;
	maxSuffixChars?: number;
	maxNeighborChars?: number;
	maxProviderChars?: number;
	maxProviderTimeMs?: number;
	prefetchAfterAccept?: boolean;
	providers?: readonly AutocompleteContextProvider[];
}

export interface AutocompleteControllerState {
	enabled: boolean;
	status: "idle" | "scheduled" | "requesting" | "showing";
	activeRequestId: string | null;
	visibleSuggestionId: string | null;
	sequence: AutocompleteSequenceState | null;
	settings: AutocompleteRuntimeSettings;
	blockPolicy: AutocompleteBlockPolicy;
	metrics: AutocompleteMetrics;
	providerTimings: readonly AutocompleteProviderTiming[];
	diagnostics: AutocompleteDiagnostics;
}

export interface AutocompleteControllerSnapshot {
	state: AutocompleteControllerState;
	providerDescriptors: readonly AutocompleteProviderDescriptor[];
}

export interface AutocompleteSequenceState {
	totalSegments: number;
	acceptedSegments: number;
	remainingSegments: number;
}

export interface AutocompleteRuntimeSettings {
	debounceMs: number;
	prefetchAfterAccept: boolean;
	acceptanceStrategy: AutocompleteAcceptanceStrategy;
	staleAfterMs: number;
}

export type AutocompleteAcceptanceStrategy = "sequence" | "full";

export interface AutocompleteBlockPolicy {
	allowedBlockTypes?: readonly string[];
	deniedBlockTypes?: readonly string[];
	allowInCodeBlocks?: boolean;
	allowInTables?: boolean;
}

export interface AutocompleteMetrics {
	requestCount: number;
	successCount: number;
	cancelCount: number;
	staleDropCount: number;
	explicitTabTriggerCount: number;
	acceptCount: number;
	partialAcceptCount: number;
	policyInvalidationScheduledCount: number;
	policyInvalidationRequestingCount: number;
	policyInvalidationShowingCount: number;
}

export interface AutocompleteDiagnostics {
	lastDismissReason: AutocompleteDismissReason | null;
	lastBlockedReason: AutocompleteBlockedReason | null;
	lastPolicyInvalidationStage: AutocompletePolicyInvalidationStage | null;
}

export type AutocompleteDismissReason =
	| "accept"
	| "disabled"
	| "external-edit"
	| "policy-change"
	| "request-replaced"
	| "selection-change"
	| "stale"
	| "typing";

export type AutocompleteBlockedReason =
	| "disabled"
	| "missing-model"
	| "missing-context"
	| "block-type-not-allowed"
	| "block-type-denied"
	| "code-block-disabled"
	| "table-disabled"
	| "table-cell-active"
	| "selection-not-collapsed"
	| "selection-not-text"
	| "selection-multi-block"
	| "field-editor-unavailable"
	| "field-editor-not-editing"
	| "field-editor-not-focused"
	| "field-editor-composing"
	| "block-missing";

export type AutocompletePolicyInvalidationStage =
	| "scheduled"
	| "requesting"
	| "showing";

export interface AutocompleteController {
	getSnapshot(): AutocompleteControllerSnapshot;
	getState(): AutocompleteControllerState;
	getBlockPolicy(): Readonly<AutocompleteBlockPolicy>;
	subscribe(listener: () => void): () => void;
	request(options?: { explicit?: boolean }): boolean;
	acceptVisibleSuggestion(): boolean;
	hasVisibleSuggestion(): boolean;
	registerProvider(provider: AutocompleteContextProvider): () => void;
	listProviderDescriptors(): readonly AutocompleteProviderDescriptor[];
	updateRuntimeSettings(settings: Partial<AutocompleteRuntimeSettings>): void;
	updateBlockPolicy(policy: Partial<AutocompleteBlockPolicy>): void;
	dismiss(reason?: AutocompleteDismissReason): void;
	setEnabled(enabled: boolean): void;
}
export type { AutocompleteRequestContext };
