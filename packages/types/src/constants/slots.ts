export const FIELD_EDITOR_SLOT_KEY = "field-editor";
export const COLLECT_KEY_BINDINGS_SLOT_KEY = "core:collect-key-bindings";
export const INPUT_RULES_ENGINE_SLOT_KEY = "input-rules:engine";
export const UNDO_HISTORY_RESTORE_SLOT_KEY = "undo:history-restore";
export const INLINE_COMPLETION_SLOT = "ai:inline-completion";
export const AI_CONTROLLER_SLOT = "ai:controller";
export const AI_INLINE_COMPLETION_SLOT = INLINE_COMPLETION_SLOT;
export const AI_INLINE_HISTORY_SLOT = "ai:inline-history";
export const AI_REVIEW_CONTROLLER_SLOT = "ai:review";
export const AI_AUTOCOMPLETE_CONTROLLER_SLOT = "ai-autocomplete:controller";

/**
 * Tag placed on Yjs transaction origins by the undo manager. The rendering
 * layer checks this instead of relying on `constructor.name` (which breaks
 * under minification).
 */
export const HISTORY_ORIGIN_TAG = "__pen_history__";
