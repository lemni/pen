import type {
	AutocompleteController,
	AutocompleteControllerState,
} from "@pen/ai-autocomplete";

type AutocompleteDebugSummary = {
	enabled: boolean;
	status: AutocompleteControllerState["status"];
	activeRequestId: string | null;
	visibleSuggestionId: string | null;
	sequence: AutocompleteControllerState["sequence"];
	requestCount: number;
	successCount: number;
	cancelCount: number;
	staleDropCount: number;
	explicitTabTriggerCount: number;
	acceptCount: number;
	partialAcceptCount: number;
	lastDismissReason: AutocompleteControllerState["diagnostics"]["lastDismissReason"];
	lastBlockedReason: AutocompleteControllerState["diagnostics"]["lastBlockedReason"];
	lastPolicyInvalidationStage:
		AutocompleteControllerState["diagnostics"]["lastPolicyInvalidationStage"];
	providerTimings: string[];
};

const PLAYGROUND_AUTOCOMPLETE_LOG_PREFIX = "[playground:autocomplete]";
const PLAYGROUND_AUTOCOMPLETE_DEBUG_ATTACHED =
	"__playgroundAutocompleteDebugAttached__";

export function summarizeAutocompleteState(
	state: AutocompleteControllerState,
): AutocompleteDebugSummary {
	return {
		enabled: state.enabled,
		status: state.status,
		activeRequestId: state.activeRequestId,
		visibleSuggestionId: state.visibleSuggestionId,
		sequence: state.sequence,
		requestCount: state.metrics.requestCount,
		successCount: state.metrics.successCount,
		cancelCount: state.metrics.cancelCount,
		staleDropCount: state.metrics.staleDropCount,
		explicitTabTriggerCount: state.metrics.explicitTabTriggerCount,
		acceptCount: state.metrics.acceptCount,
		partialAcceptCount: state.metrics.partialAcceptCount,
		lastDismissReason: state.diagnostics.lastDismissReason,
		lastBlockedReason: state.diagnostics.lastBlockedReason,
		lastPolicyInvalidationStage: state.diagnostics.lastPolicyInvalidationStage,
		providerTimings: state.providerTimings.map(
			(timing) => `${timing.id}:${timing.durationMs}ms:${timing.chars}`,
		),
	};
}

export function didAutocompleteSummaryChange(
	previous: AutocompleteDebugSummary | null,
	next: AutocompleteDebugSummary,
): boolean {
	if (previous === null) {
		return true;
	}
	return JSON.stringify(previous) !== JSON.stringify(next);
}

export function logAutocompleteDebug(message: string, details?: unknown): void {
	if (details === undefined) {
		console.log(`${PLAYGROUND_AUTOCOMPLETE_LOG_PREFIX} ${message}`);
		return;
	}
	console.log(`${PLAYGROUND_AUTOCOMPLETE_LOG_PREFIX} ${message}`, details);
}

export function attachPlaygroundAutocompleteLogging(
	controller: AutocompleteController,
): void {
	const instrumentedController = controller as AutocompleteController & {
		[PLAYGROUND_AUTOCOMPLETE_DEBUG_ATTACHED]?: boolean;
	};
	if (instrumentedController[PLAYGROUND_AUTOCOMPLETE_DEBUG_ATTACHED]) {
		return;
	}
	instrumentedController[PLAYGROUND_AUTOCOMPLETE_DEBUG_ATTACHED] = true;

	const originalRequest = controller.request.bind(controller);
	controller.request = (options) => {
		logAutocompleteDebug("request called", {
			explicit: options?.explicit ?? false,
		});
		const result = originalRequest(options);
		logAutocompleteDebug("request returned", {
			result,
			state: summarizeAutocompleteState(controller.getState()),
		});
		return result;
	};

	const originalDismiss = controller.dismiss.bind(controller);
	controller.dismiss = (reason) => {
		logAutocompleteDebug("dismiss called", {
			reason: reason ?? "external-edit",
			stateBeforeDismiss: summarizeAutocompleteState(controller.getState()),
		});
		originalDismiss(reason);
	};

	const originalAcceptVisibleSuggestion =
		controller.acceptVisibleSuggestion.bind(controller);
	controller.acceptVisibleSuggestion = () => {
		logAutocompleteDebug("accept visible suggestion called", {
			stateBeforeAccept: summarizeAutocompleteState(controller.getState()),
		});
		const result = originalAcceptVisibleSuggestion();
		logAutocompleteDebug("accept visible suggestion returned", {
			result,
			state: summarizeAutocompleteState(controller.getState()),
		});
		return result;
	};

	const originalSetEnabled = controller.setEnabled.bind(controller);
	controller.setEnabled = (enabled) => {
		logAutocompleteDebug("set enabled called", { enabled });
		originalSetEnabled(enabled);
	};

	const originalUpdateRuntimeSettings =
		controller.updateRuntimeSettings.bind(controller);
	controller.updateRuntimeSettings = (settings) => {
		logAutocompleteDebug("update runtime settings called", settings);
		originalUpdateRuntimeSettings(settings);
	};

	const originalUpdateBlockPolicy = controller.updateBlockPolicy.bind(controller);
	controller.updateBlockPolicy = (policy) => {
		logAutocompleteDebug("update block policy called", policy);
		originalUpdateBlockPolicy(policy);
	};
}
