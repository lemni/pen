import "./InspectorPanel.css";
import type {
	AutocompleteAcceptanceStrategy,
	AutocompleteBlockPolicy,
} from "@pen/ai-autocomplete";
import type { Editor } from "@pen/types";
import { IconConsole } from "./icons";
import { useEditorInspector } from "../hooks/useEditorInspector";
import { usePlaygroundAutocomplete } from "../hooks/usePlaygroundAutocomplete";

type InspectorPanelProps = {
	editor: Editor;
	isOpen: boolean;
	onToggle: () => void;
	autocompleteSettings: {
		enabled: boolean;
		debounceMs: number;
		prefetchAfterAccept: boolean;
		acceptanceStrategy: AutocompleteAcceptanceStrategy;
		blockPolicy: AutocompleteBlockPolicy;
	};
	onAutocompleteEnabledChange: (enabled: boolean) => void;
	onAutocompletePrefetchChange: (enabled: boolean) => void;
	onAutocompleteDebounceChange: (debounceMs: number) => void;
	onAutocompleteAcceptanceStrategyChange: (
		acceptanceStrategy: AutocompleteAcceptanceStrategy,
	) => void;
	onAutocompleteBlockPolicyChange: (
		blockPolicy: Partial<AutocompleteBlockPolicy>,
	) => void;
};

export function InspectorPanel({
	editor,
	isOpen,
	onToggle,
	autocompleteSettings,
	onAutocompleteEnabledChange,
	onAutocompletePrefetchChange,
	onAutocompleteDebounceChange,
	onAutocompleteAcceptanceStrategyChange,
	onAutocompleteBlockPolicyChange,
}: InspectorPanelProps) {
	const inspectorJson = useEditorInspector(editor);
	const autocomplete = usePlaygroundAutocomplete(editor);
	const configuredBlockPolicy = autocompleteSettings.blockPolicy;
	const activeBlockPolicy = autocomplete.blockPolicy;
	const allowedBlockTypesValue = formatBlockTypeList(
		autocompleteSettings.blockPolicy.allowedBlockTypes,
	);
	const deniedBlockTypesValue = formatBlockTypeList(
		autocompleteSettings.blockPolicy.deniedBlockTypes,
	);
	const autocompleteMetricItems = [
		{
			label: "Status",
			value: autocomplete.state.status,
		},
		{
			label: "Visible suggestion",
			value: autocomplete.state.visibleSuggestionId ?? "None",
		},
		{
			label: "Request",
			value: autocomplete.state.activeRequestId ?? "None",
		},
		{
			label: "Sequence",
			value: autocomplete.state.sequence
				? `${autocomplete.state.sequence.acceptedSegments}/${autocomplete.state.sequence.totalSegments}`
				: "None",
		},
		{
			label: "Acceptance",
			value: autocomplete.state.settings.acceptanceStrategy,
		},
		{
			label: "Stale window",
			value: `${autocomplete.state.settings.staleAfterMs}ms`,
		},
		{
			label: "Providers",
			value: `${autocomplete.providerDescriptors.length}`,
		},
		{
			label: "Requests",
			value: `${autocomplete.state.metrics.requestCount}`,
		},
		{
			label: "Successes",
			value: `${autocomplete.state.metrics.successCount}`,
		},
		{
			label: "Cancels",
			value: `${autocomplete.state.metrics.cancelCount}`,
		},
		{
			label: "Stale drops",
			value: `${autocomplete.state.metrics.staleDropCount}`,
		},
		{
			label: "Explicit Tab",
			value: `${autocomplete.state.metrics.explicitTabTriggerCount}`,
		},
		{
			label: "Accepts",
			value: `${autocomplete.state.metrics.acceptCount}`,
		},
		{
			label: "Partial accepts",
			value: `${autocomplete.state.metrics.partialAcceptCount}`,
		},
		{
			label: "Policy scheduled",
			value: `${autocomplete.state.metrics.policyInvalidationScheduledCount}`,
		},
		{
			label: "Policy requesting",
			value: `${autocomplete.state.metrics.policyInvalidationRequestingCount}`,
		},
		{
			label: "Policy showing",
			value: `${autocomplete.state.metrics.policyInvalidationShowingCount}`,
		},
		{
			label: "Last dismiss",
			value: autocomplete.state.diagnostics.lastDismissReason ?? "None",
		},
		{
			label: "Last blocked",
			value: autocomplete.state.diagnostics.lastBlockedReason ?? "None",
		},
		{
			label: "Policy invalidation",
			value: autocomplete.state.diagnostics.lastPolicyInvalidationStage ?? "None",
		},
	];
	const autocompleteMetricRows = autocompleteMetricItems.map((item) => (
		<div className="inspector-metric" key={item.label}>
			<span className="inspector-metric-label">{item.label}</span>
			<span className="inspector-metric-value">{item.value}</span>
		</div>
	));
	const providerItems = autocomplete.providerDescriptors.map((provider) => (
		<li className="inspector-provider-item" key={provider.id}>
			<span className="inspector-provider-id">{provider.id}</span>
			<span className="inspector-provider-description">
				{provider.description}
			</span>
		</li>
	));
	const providerTimingItems = autocomplete.state.providerTimings.map((timing) => (
		<li className="inspector-provider-item" key={`timing:${timing.id}`}>
			<span className="inspector-provider-id">{timing.id}</span>
			<span className="inspector-provider-description">
				{`${timing.durationMs}ms, ${timing.chars} chars`}
			</span>
		</li>
	));
	const blockPolicyItems = [
		{
			label: "Code blocks",
			configured: formatToggleValue(configuredBlockPolicy.allowInCodeBlocks),
			active: formatToggleValue(activeBlockPolicy.allowInCodeBlocks),
		},
		{
			label: "Tables",
			configured: formatToggleValue(configuredBlockPolicy.allowInTables),
			active: formatToggleValue(activeBlockPolicy.allowInTables),
		},
		{
			label: "Allowed types",
			configured: formatBlockTypeList(configuredBlockPolicy.allowedBlockTypes) || "Any",
			active: formatBlockTypeList(activeBlockPolicy.allowedBlockTypes) || "Any",
		},
		{
			label: "Denied types",
			configured: formatBlockTypeList(configuredBlockPolicy.deniedBlockTypes) || "None",
			active: formatBlockTypeList(activeBlockPolicy.deniedBlockTypes) || "None",
		},
	];
	const blockPolicyRows = blockPolicyItems.map((item) => (
		<li className="inspector-provider-item" key={`policy:${item.label}`}>
			<span className="inspector-provider-id">{item.label}</span>
			<span className="inspector-provider-description">
				{`Configured: ${item.configured}`}
			</span>
			<span className="inspector-provider-description">
				{`Runtime: ${item.active}`}
			</span>
		</li>
	));

	return (
		<aside className="playground-inspector" data-open={isOpen || undefined}>
			<header className="inspector-header">
				<h4 className="inspector-title">Document</h4>
			</header>

			<div className="inspector">
				<section className="inspector-section">
					<div className="inspector-section-header">
						<h5 className="inspector-section-title">Autocomplete</h5>
					</div>
					<div className="inspector-controls">
						<label className="inspector-toggle-row">
							<span>Enabled</span>
							<input
								type="checkbox"
								checked={autocompleteSettings.enabled}
								onChange={(event) =>
									onAutocompleteEnabledChange(event.target.checked)
								}
							/>
						</label>
						<label className="inspector-toggle-row">
							<span>Prefetch after accept</span>
							<input
								type="checkbox"
								checked={autocompleteSettings.prefetchAfterAccept}
								onChange={(event) =>
									onAutocompletePrefetchChange(event.target.checked)
								}
							/>
						</label>
						<label className="inspector-range-row">
							<span>
								Debounce
								<strong>{` ${autocompleteSettings.debounceMs}ms`}</strong>
							</span>
							<input
								type="range"
								min={0}
								max={300}
								step={10}
								value={autocompleteSettings.debounceMs}
								onChange={(event) =>
									onAutocompleteDebounceChange(
										Number(event.target.value),
									)
								}
							/>
						</label>
						<label className="inspector-range-row">
							<span>Acceptance</span>
							<select
								value={autocompleteSettings.acceptanceStrategy}
								onChange={(event) =>
									onAutocompleteAcceptanceStrategyChange(
										event.target.value as AutocompleteAcceptanceStrategy,
									)
								}
							>
								<option value="sequence">Sequence</option>
								<option value="full">Full</option>
							</select>
						</label>
						<label className="inspector-toggle-row">
							<span>Allow in code blocks</span>
							<input
								type="checkbox"
								checked={autocompleteSettings.blockPolicy.allowInCodeBlocks ?? false}
								onChange={(event) =>
									onAutocompleteBlockPolicyChange({
										allowInCodeBlocks: event.target.checked,
									})
								}
							/>
						</label>
						<label className="inspector-toggle-row">
							<span>Allow in tables</span>
							<input
								type="checkbox"
								checked={autocompleteSettings.blockPolicy.allowInTables ?? false}
								onChange={(event) =>
									onAutocompleteBlockPolicyChange({
										allowInTables: event.target.checked,
									})
								}
							/>
						</label>
						<label className="inspector-range-row">
							<span>Allowed block types</span>
							<input
								className="inspector-text-input"
								type="text"
								value={allowedBlockTypesValue}
								placeholder="heading, paragraph"
								onChange={(event) =>
									onAutocompleteBlockPolicyChange({
										allowedBlockTypes: parseBlockTypeList(event.target.value),
									})
								}
							/>
						</label>
						<label className="inspector-range-row">
							<span>Denied block types</span>
							<input
								className="inspector-text-input"
								type="text"
								value={deniedBlockTypesValue}
								placeholder="database"
								onChange={(event) =>
									onAutocompleteBlockPolicyChange({
										deniedBlockTypes: parseBlockTypeList(event.target.value),
									})
								}
							/>
						</label>
					</div>
					<div className="inspector-metrics">{autocompleteMetricRows}</div>
					<div className="inspector-provider-list-wrap">
						<h6 className="inspector-subtitle">Block policy</h6>
						<ul className="inspector-provider-list">
							{blockPolicyRows}
						</ul>
					</div>
					{providerItems.length > 0 ? (
						<div className="inspector-provider-list-wrap">
							<h6 className="inspector-subtitle">Providers</h6>
							<ul className="inspector-provider-list">
								{providerItems}
							</ul>
						</div>
					) : null}
					{providerTimingItems.length > 0 ? (
						<div className="inspector-provider-list-wrap">
							<h6 className="inspector-subtitle">Provider timings</h6>
							<ul className="inspector-provider-list">
								{providerTimingItems}
							</ul>
						</div>
					) : null}
				</section>
				<pre className="inspector-json">{inspectorJson}</pre>
			</div>

			<div className="inspector-footer">
				<button
					className="inspector-toggle-button"
					type="button"
					onClick={onToggle}
					data-active={isOpen || undefined}
					title={isOpen ? "Hide document inspector" : "Show document inspector"}
					aria-label={isOpen ? "Hide document inspector" : "Show document inspector"}
				>
					<IconConsole className="inspector-toggle-icon" />
				</button>
			</div>
		</aside>
	);
}

function formatBlockTypeList(blockTypes: readonly string[] | undefined): string {
	return blockTypes?.join(", ") ?? "";
}

function formatToggleValue(value: boolean | undefined): string {
	return value ? "Allowed" : "Blocked";
}

function parseBlockTypeList(value: string): string[] | undefined {
	const blockTypes = value
		.split(",")
		.map((part) => part.trim())
		.filter(Boolean);
	return blockTypes.length > 0 ? blockTypes : undefined;
}
