import {
	filterOpsForDocumentProfile,
	filterPendingBlocksForDocumentProfile,
	createImportResult,
	isContinuousTextFlowCapability,
	normalizePendingBlocksForImport,
	reportPendingBlockImportViolations,
	reportPendingBlockProfileViolations,
	resolveBlockFlowCapability,
	shouldAllowDirectBlockPaste,
	shouldAllowFlowInsertionInSlashMenu,
	shouldFallbackMixedSelectionToBlock,
	shouldForceBlockScopedSelectAll,
} from "./editor/profilePolicy";

// Contracts live in @pen/types.
// Keep @pen/core focused on runtime entrypoints and advanced internals.

// Schema engine runtime
export { SchemaRegistryImpl, mergeSchemas } from "./schema/registry";
export type { SchemaRegistryConfig } from "./schema/registry";

export {
	SchemaEngineImpl,
	deepEqual,
	sortDeltaAttributes,
} from "./schema/normalize";

export { createBlockHandle, createAppHandle } from "./schema/handles";

export { suggestion } from "./schema/system-marks/suggestion";

// Editor runtime
export { createEditor, createHeadlessEditor } from "./editor/editor";
export type { CreateHeadlessEditorOptions } from "./editor/editor";
export {
	createDocumentSession,
	DocumentSessionImpl,
} from "./editor/documentSession";
export { EventEmitter } from "./editor/events";
export {
	createDecorationSet,
	emptyDecorationSet,
	mergeDecorationSets,
} from "./editor/decorations";
export {
	ensureInlineCompletionController,
	getInlineCompletionController,
} from "./editor/inlineCompletion";
export { DocumentStateImpl } from "./editor/documentState";
export { DocumentRangeImpl } from "./editor/range";
export { SelectionManagerImpl } from "./editor/selection";
export { ExtensionManagerImpl } from "./editor/extensionManager";
export { ApplyPipeline } from "./editor/apply";
export {
	hasIndexedCellSelectionMetadata,
	resolveCellSelectionCoord,
	resolveCellSelectionMatrix,
} from "./editor/cellSelection";
export { getNumberedListItemValue } from "./editor/orderedList";
export {
	createImportResult,
	filterOpsForDocumentProfile,
	filterPendingBlocksForDocumentProfile,
	isContinuousTextFlowCapability,
	normalizePendingBlocksForImport,
	reportPendingBlockImportViolations,
	reportPendingBlockProfileViolations,
	resolveBlockFlowCapability,
	shouldAllowDirectBlockPaste,
	shouldAllowFlowInsertionInSlashMenu,
	shouldFallbackMixedSelectionToBlock,
	shouldForceBlockScopedSelectAll,
};
export type {
	PendingBlockImportPolicyViolation,
	PendingBlockProfilePolicyViolation,
	ProfilePolicyViolation,
} from "./editor/profilePolicy";

// Importer utilities (used by Wave 4 importers)
export { blocksToOps } from "./importerUtils";
export type {
	PendingBlock,
	ImportOptions as ImporterOptions,
} from "./importerUtils";

// Exporter utilities (shared by Wave 4 exporters)
export { buildTableChildren, buildDatabaseData } from "./exporterUtils";
export type { ExportedDatabaseData } from "./exporterUtils";

// Stub (to be implemented in later waves)
export { toZod } from "./toZod";
