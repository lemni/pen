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
	INPUT_RULES_ENGINE_SLOT_KEY,
	UNDO_HISTORY_RESTORE_SLOT_KEY,
	HISTORY_ORIGIN_TAG,
} from "./constants/slots";
