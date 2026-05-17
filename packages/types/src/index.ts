// Types
export * from "./types/index";

// Runtime
export { prop, resolveSchema } from "./prop";
export { defineBlock } from "./defineBlock";
export { defineExtension } from "./defineExtension";
export {
  SchemaRegistryImpl,
  mergeSchemas,
} from "./schemaRegistry";
export type { SchemaRegistryConfig } from "./schemaRegistry";
export { suggestion } from "./suggestion";
export {
  coerceDatabaseValue,
  formatStoredMultiSelectValue,
  formatStoredSelectValue,
  normalizeDatabaseValueForType,
  normalizeStoredMultiSelectValue,
  normalizeStoredSelectValue,
  parseDatabaseMultiSelectValue,
  resolveStoredSelectOption,
} from "./utils/databaseValues";
export { generateId } from "./utils/generateId";
export {
	isScopedSelectionTarget,
	renderSelectionTargetBlockText,
	renderSelectionTargetText,
	resolveSelectionTargetBlockIds,
} from "./utils/operationSelectionTargets";
export {
  getBlockSelectionRoleFromSchema,
  getBlockSelectionRoleFromType,
  getFlowCapabilityFromSchema,
  getFlowCapabilityFromType,
  isContinuousTextFlowCapability,
  shouldAllowDirectBlockPaste,
  shouldAllowFlowInsertionInSlashMenu,
  shouldExposeBlockInTooling,
  shouldShowBlockInDefaultMenus,
  shouldFallbackMixedSelectionToBlock,
  shouldForceBlockScopedSelectAll,
} from "./utils/blockCapabilities";
export {
	FIELD_EDITOR_SLOT_KEY,
	COLLECT_KEY_BINDINGS_SLOT_KEY,
	AWAIT_EXTENSION_LIFECYCLE_SLOT_KEY,
	INPUT_RULES_ENGINE_SLOT_KEY,
	UNDO_HISTORY_RESTORE_SLOT_KEY,
	UNDO_HISTORY_METADATA_CONTROLLER_SLOT_KEY,
  INLINE_COMPLETION_SLOT,
  AI_CONTROLLER_SLOT,
  AI_INLINE_COMPLETION_SLOT,
  AI_INLINE_HISTORY_SLOT,
  AI_REVIEW_CONTROLLER_SLOT,
  AI_AUTOCOMPLETE_CONTROLLER_SLOT,
  AI_SUGGESTIONS_CONTROLLER_SLOT,
  SEARCH_CONTROLLER_SLOT,
  MULTIPLAYER_CONTROLLER_SLOT,
  HISTORY_CONTROLLER_SLOT,
	HISTORY_ORIGIN_TAG,
} from "./constants/slots";
export {
	INLINE_COMPLETION_VISIBLE_BLOCK_ATTRIBUTE,
} from "./constants/decorations";
