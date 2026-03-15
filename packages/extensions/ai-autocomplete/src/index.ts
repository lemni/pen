export {
	autocompleteExtension,
	AI_AUTOCOMPLETE_EXTENSION_NAME,
	AUTOCOMPLETE_CONTROLLER_SLOT,
	getAutocompleteController,
} from "./extension";
export { createAutocompleteProvider } from "./providers/types";
export { builtinAutocompleteProviders } from "./providers/builtins";

export type {
	AutocompleteAcceptanceStrategy,
	AutocompleteBlockedReason,
	AutocompleteBlockPolicy,
	AutocompleteController,
	AutocompleteControllerSnapshot,
	AutocompleteControllerState,
	AutocompleteDiagnostics,
	AutocompleteDismissReason,
	AutocompleteExtensionConfig,
	AutocompleteMetrics,
	AutocompletePolicyInvalidationStage,
	AutocompleteRequestContext,
	AutocompleteRuntimeSettings,
	AutocompleteSequenceState,
} from "./types";
export type {
	AutocompleteContextProvider,
	AutocompleteProviderDescriptor,
	AutocompleteProviderSection,
	AutocompleteProviderTiming,
} from "./providers/types";
