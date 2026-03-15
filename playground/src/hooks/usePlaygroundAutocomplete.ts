import { getAutocompleteController } from "@pen/ai-autocomplete";
import type {
	AutocompleteBlockPolicy,
	AutocompleteControllerState,
	AutocompleteControllerSnapshot,
	AutocompleteProviderDescriptor,
} from "@pen/ai-autocomplete";
import type { Editor } from "@pen/types";
import { useEffect, useRef, useSyncExternalStore } from "react";
import {
	didAutocompleteSummaryChange,
	logAutocompleteDebug,
	summarizeAutocompleteState,
} from "../utils/autocompleteDebug";

const EMPTY_AUTOCOMPLETE_STATE: AutocompleteControllerState = {
	enabled: false,
	status: "idle",
	activeRequestId: null,
	visibleSuggestionId: null,
	sequence: null,
	settings: {
		debounceMs: 0,
		prefetchAfterAccept: false,
		acceptanceStrategy: "sequence",
		staleAfterMs: 0,
	},
	blockPolicy: {
		allowInCodeBlocks: false,
		allowInTables: false,
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
const EMPTY_PROVIDER_DESCRIPTORS: readonly AutocompleteProviderDescriptor[] = [];
const EMPTY_PLAYGROUND_AUTOCOMPLETE_SNAPSHOT = {
	state: EMPTY_AUTOCOMPLETE_STATE,
	providerDescriptors: EMPTY_PROVIDER_DESCRIPTORS,
} satisfies AutocompleteControllerSnapshot;

export function usePlaygroundAutocomplete(editor: Editor): {
	state: AutocompleteControllerState;
	blockPolicy: Readonly<AutocompleteBlockPolicy>;
	providerDescriptors: readonly AutocompleteProviderDescriptor[];
} {
	const controller = getAutocompleteController(editor);
	const previousSummaryRef = useRef<ReturnType<typeof summarizeAutocompleteState> | null>(
		null,
	);
	const snapshot = useSyncExternalStore(
		(callback) => {
			if (!controller) {
				return () => {};
			}
			return controller.subscribe(callback);
		},
		() => controller?.getSnapshot() ?? EMPTY_PLAYGROUND_AUTOCOMPLETE_SNAPSHOT,
		() => EMPTY_PLAYGROUND_AUTOCOMPLETE_SNAPSHOT,
	);

	useEffect(() => {
		if (!controller) {
			logAutocompleteDebug("controller unavailable");
			return;
		}
		const nextSummary = summarizeAutocompleteState(snapshot.state);
		if (!didAutocompleteSummaryChange(previousSummaryRef.current, nextSummary)) {
			return;
		}
		logAutocompleteDebug("snapshot updated", {
			providerCount: snapshot.providerDescriptors.length,
			state: nextSummary,
		});
		previousSummaryRef.current = nextSummary;
	}, [controller, snapshot]);

	return {
		state: snapshot.state,
		blockPolicy: snapshot.state.blockPolicy,
		providerDescriptors: snapshot.providerDescriptors,
	};
}
