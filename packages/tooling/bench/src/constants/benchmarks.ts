import type { BenchDefinition } from "../bench";

type BenchMetadata = Pick<
	BenchDefinition,
	"id" | "name" | "targetMs" | "critical"
>;

export const CRDT_INSERT_1000_BLOCKS_BENCH: BenchMetadata = {
	id: "crdt.insert-1000-blocks",
	name: "insert 1000 blocks sequentially",
	targetMs: 500,
};

export const CRDT_ENCODE_STATE_500_BENCH: BenchMetadata = {
	id: "crdt.encode-state-500",
	name: "encodeState 500-block document",
	targetMs: 50,
};

export const CRDT_LOAD_DOCUMENT_500_BENCH: BenchMetadata = {
	id: "crdt.load-document-500",
	name: "loadDocument 500-block document",
	targetMs: 100,
};

export const CRDT_FORK_MERGE_100_BENCH: BenchMetadata = {
	id: "crdt.fork-merge-100",
	name: "fork + merge 100-block document",
};

export const SCHEMA_RESOLVE_X10000_BENCH: BenchMetadata = {
	id: "schema.resolve-x10000",
	name: "schema resolve x10000",
	targetMs: 10,
};

export const SCHEMA_NORMALIZE_500_BLOCK_DOCUMENT_BENCH: BenchMetadata = {
	id: "schema.normalize-500-block-document",
	name: "normalize 500-block document",
	targetMs: 200,
	critical: true,
};

export const SCHEMA_ALL_BLOCK_DISPLAYS_BENCH: BenchMetadata = {
	id: "schema.all-block-displays",
	name: "allBlockDisplays (slash menu population)",
};

export const STREAMING_GEN_DELTA_1000_PARTS_BENCH: BenchMetadata = {
	id: "streaming.gen-delta-1000-parts",
	name: "streaming 1000 gen-delta parts at 100/sec",
	targetMs: 10,
};

export const STREAMING_BATCH_FLUSH_LATENCY_BENCH: BenchMetadata = {
	id: "streaming.batch-flush-latency",
	name: "streaming batch flush latency",
	targetMs: 10,
	critical: true,
};

export const EXTENSION_DISPATCH_OBSERVE_X5_BENCH: BenchMetadata = {
	id: "extension.dispatch-observe-x5",
	name: "extension dispatchObserve with 5 extensions",
	targetMs: 1,
	critical: true,
};

export const EXTENSION_COLLECT_DECORATIONS_X5_BENCH: BenchMetadata = {
	id: "extension.collect-decorations-x5",
	name: "extension collectDecorations with 5 extensions",
};

export const EDITOR_APPLY_INSERT_TEXT_X1000_BENCH: BenchMetadata = {
	id: "editor.apply-insert-text-x1000",
	name: "editor.apply insert-text x1000",
};

export const EDITOR_APPLY_INSERT_DELETE_BLOCK_X500_BENCH: BenchMetadata = {
	id: "editor.apply-insert-delete-block-x500",
	name: "editor.apply insert-block + delete-block x500",
};

export const AI_READ_DOCUMENT_SUMMARY_200_BLOCKS_BENCH: BenchMetadata = {
	id: "ai.read-document-summary-200-blocks",
	name: "ai read_document summary on 200 blocks",
};

export const AI_GET_CONTEXT_SUMMARY_200_BLOCKS_BENCH: BenchMetadata = {
	id: "ai.get-context-summary-200-blocks",
	name: "ai get_context summary on 200 blocks",
};

export const AI_GET_CURSOR_CONTEXT_BENCH: BenchMetadata = {
	id: "ai.get-cursor-context",
	name: "ai get_cursor_context",
};

export const AI_PROMPT_ASSEMBLY_TOOL_JOURNAL_BENCH: BenchMetadata = {
	id: "ai.prompt-assembly-tool-journal",
	name: "ai prompt assembly from tool journal",
};

export const AI_READ_DOCUMENT_RANGE_20_BLOCKS_BENCH: BenchMetadata = {
	id: "ai.read-document-range-20-blocks",
	name: "ai read_document markdown range on 20 blocks",
};

export const AI_RETRIEVE_DOCUMENT_SPANS_BENCH: BenchMetadata = {
	id: "ai.retrieve-document-spans",
	name: "ai retrieve_document_spans ranked lookup",
};

export const AI_MARKDOWN_FAST_APPLY_TABLE_INSERT_BENCH: BenchMetadata = {
	id: "ai.markdown-fast-apply-table-insert",
	name: "ai markdown fast apply table insert",
};

export const AI_MARKDOWN_FULL_REPLACE_TABLE_INSERT_BENCH: BenchMetadata = {
	id: "ai.markdown-full-replace-table-insert",
	name: "ai markdown full replace table insert",
};

export const AI_FLOW_PATCH_TEXT_EDIT_BENCH: BenchMetadata = {
	id: "ai.flow-patch-text-edit",
	name: "ai flow patch compile text edit",
};

export const AI_FLOW_PATCH_ALIGNMENT_BENCH: BenchMetadata = {
	id: "ai.flow-patch-alignment",
	name: "ai flow patch alignment metrics",
};

export const AI_FLOW_PATCH_SCOPED_REPLACEMENT_BENCH: BenchMetadata = {
	id: "ai.flow-patch-scoped-replacement",
	name: "ai flow patch scoped replacement metrics",
};

export const AI_AUTOCOMPLETE_CANCEL_CHURN_BENCH: BenchMetadata = {
	id: "ai.autocomplete-cancel-churn",
	name: "ai autocomplete cancel churn",
	targetMs: 10,
	critical: true,
};

export const AI_AUTOCOMPLETE_REQUESTING_CANCEL_CHURN_BENCH: BenchMetadata = {
	id: "ai.autocomplete-requesting-cancel-churn",
	name: "ai autocomplete requesting cancel churn",
	targetMs: 20,
};

export const AI_AUTOCOMPLETE_PROVIDER_BUDGET_BENCH: BenchMetadata = {
	id: "ai.autocomplete-provider-budget",
	name: "ai autocomplete provider budget",
	targetMs: 25,
	critical: true,
};

export const AI_AUTOCOMPLETE_PARTIAL_ACCEPT_BENCH: BenchMetadata = {
	id: "ai.autocomplete-partial-accept",
	name: "ai autocomplete partial accept",
	targetMs: 20,
	critical: true,
};

export const AI_AUTOCOMPLETE_PREFETCH_AFTER_ACCEPT_BENCH: BenchMetadata = {
	id: "ai.autocomplete-prefetch-after-accept",
	name: "ai autocomplete prefetch after accept",
	targetMs: 30,
	critical: true,
};

export const BENCHMARK_METADATA: BenchMetadata[] = [
	CRDT_INSERT_1000_BLOCKS_BENCH,
	CRDT_ENCODE_STATE_500_BENCH,
	CRDT_LOAD_DOCUMENT_500_BENCH,
	CRDT_FORK_MERGE_100_BENCH,
	SCHEMA_RESOLVE_X10000_BENCH,
	SCHEMA_NORMALIZE_500_BLOCK_DOCUMENT_BENCH,
	SCHEMA_ALL_BLOCK_DISPLAYS_BENCH,
	STREAMING_GEN_DELTA_1000_PARTS_BENCH,
	STREAMING_BATCH_FLUSH_LATENCY_BENCH,
	EXTENSION_DISPATCH_OBSERVE_X5_BENCH,
	EXTENSION_COLLECT_DECORATIONS_X5_BENCH,
	EDITOR_APPLY_INSERT_TEXT_X1000_BENCH,
	EDITOR_APPLY_INSERT_DELETE_BLOCK_X500_BENCH,
	AI_READ_DOCUMENT_SUMMARY_200_BLOCKS_BENCH,
	AI_GET_CONTEXT_SUMMARY_200_BLOCKS_BENCH,
	AI_GET_CURSOR_CONTEXT_BENCH,
	AI_PROMPT_ASSEMBLY_TOOL_JOURNAL_BENCH,
	AI_READ_DOCUMENT_RANGE_20_BLOCKS_BENCH,
	AI_RETRIEVE_DOCUMENT_SPANS_BENCH,
	AI_MARKDOWN_FAST_APPLY_TABLE_INSERT_BENCH,
	AI_MARKDOWN_FULL_REPLACE_TABLE_INSERT_BENCH,
	AI_FLOW_PATCH_TEXT_EDIT_BENCH,
	AI_FLOW_PATCH_ALIGNMENT_BENCH,
	AI_FLOW_PATCH_SCOPED_REPLACEMENT_BENCH,
	AI_AUTOCOMPLETE_CANCEL_CHURN_BENCH,
	AI_AUTOCOMPLETE_REQUESTING_CANCEL_CHURN_BENCH,
	AI_AUTOCOMPLETE_PROVIDER_BUDGET_BENCH,
	AI_AUTOCOMPLETE_PARTIAL_ACCEPT_BENCH,
	AI_AUTOCOMPLETE_PREFETCH_AFTER_ACCEPT_BENCH,
];

export function findBenchMetadataById(id: string): BenchMetadata | undefined {
	return BENCHMARK_METADATA.find((bench) => bench.id === id);
}

export function findBenchMetadataByName(name: string): BenchMetadata | undefined {
	return BENCHMARK_METADATA.find((bench) => bench.name === name);
}
