// ── @pen/react — React rendering layer for Pen ─────────────
//
// Package entry. Re-exports all public API:
// - Pen.* compound component namespace
// - Individual primitives
// - Hooks
// - Contexts (for advanced use)
// - Field editor internals (for extension authors)
// - Renderer registry
// - Utilities

// ── Convenience component ───────────────────────────────────
export { PenEditor, type PenEditorProps } from "./penEditor";

// ── Compound component namespace ────────────────────────────
export { Pen } from "./primitives/index";

// ── Editor primitives ───────────────────────────────────────
export {
	CARET,
	EditorRoot,
	EditorContent,
	EditorBlock,
	InlineContent,
	EditorCaretOverlay,
	EditorBlockHandle,
	EditorDragOverlay,
	EditorRegionSelector,
	EditorSelectionRect,
	EditorFieldEditor,
	type EditorCaretVariant,
	type EditorRootProps,
	type InlineAtomRenderProps,
	type InlineAtomRenderer,
	type InlineAtomRenderers,
	type EditorContentProps,
	type EditorBlockProps,
	type InlineContentProps,
	type EditorCaretOverlayProps,
	type EditorCaretRenderProps,
	type BlockHandleProps,
	type DragOverlayProps,
	type RegionSelectorProps,
	type SelectionRectProps,
	type FieldEditorWrapperProps,
} from "./primitives/editor/index";

// ── Toolbar primitives ──────────────────────────────────────
export {
	ToolbarRoot,
	ToolbarGroup,
	ToolbarButton,
	ToolbarToggle,
	ToolbarSelect,
	ToolbarSeparator,
	type ToolbarRootProps,
	type ToolbarGroupProps,
	type ToolbarButtonProps,
	type ToolbarToggleProps,
	type ToolbarSelectProps,
	type ToolbarSeparatorProps,
} from "./primitives/toolbar/index";

// ── Slash menu primitives ───────────────────────────────────
export {
	SlashMenuRoot,
	SlashMenuContent,
	SlashMenuInput,
	SlashMenuList,
	SlashMenuGroup,
	SlashMenuItem,
	SlashMenuEmpty,
	useSlashMenuContext,
	type SlashMenuContextValue,
	type SlashMenuRootProps,
	type SlashMenuContentProps,
	type SlashMenuInputProps,
	type SlashMenuListProps,
	type SlashMenuGroupProps,
	type SlashMenuItemProps,
	type SlashMenuEmptyProps,
} from "./primitives/slash-menu/index";

// ── Suggestion menu primitives ───────────────────────────────
export {
	SuggestionMenuRoot,
	SuggestionMenuContent,
	SuggestionMenuList,
	SuggestionMenuGroup,
	SuggestionMenuItem,
	SuggestionMenuEmpty,
	useSuggestionMenuContext,
	type SuggestionMenuContextValue,
	type SuggestionMenuRootProps,
	type SuggestionMenuContentProps,
	type SuggestionMenuListProps,
	type SuggestionMenuGroupProps,
	type SuggestionMenuItemProps,
	type SuggestionMenuEmptyProps,
} from "./primitives/suggestion-menu/index";

// ── Selection toolbar primitives ────────────────────────────
export {
	SelectionToolbarRoot,
	SelectionToolbarContent,
	useSelectionToolbarContext,
	type SelectionToolbarRootProps,
	type SelectionToolbarContentProps,
	type SelectionToolbarContextValue,
} from "./primitives/selection-toolbar/index";

// ── Search primitives ────────────────────────────────────────
export {
	SearchRoot,
	SearchInput,
	SearchResults,
	SearchNext,
	SearchPrevious,
	SearchReplaceInput,
	SearchReplace,
	SearchReplaceAll,
	SearchCaseSensitive,
	SearchRegExpToggle,
	SearchWholeWord,
	useSearchContext,
	type SearchRootProps,
	type SearchInputProps,
	type SearchResultsProps,
	type SearchNavigationButtonProps,
	type SearchReplaceInputProps,
	type SearchReplaceButtonProps,
	type SearchToggleProps,
	type SearchContextValue,
} from "./primitives/search/index";

// ── AI primitives ────────────────────────────────────────────
export {
	AIRoot,
	AITrigger,
	AISelectionTrigger,
	AICommandMenu,
	AICommandInput,
	AICommandList,
	AICommandItem,
	AIGenerationZone,
	AIStructuredTargetPreview,
	AIActionBar,
	AIAcceptButton,
	AIRejectButton,
	AIRetryButton,
	AISuggestion,
	AITrackChanges,
	AIDiffView,
	AIChangeList,
	AIProgress,
	AIToolStream,
	AIContextualPromptTrigger,
	AIContextualPromptSurface,
	AIContextualPromptComposer,
	AIInlineSuggestionControls,
	AIInlineSuggestionFloatingSurface,
	AIInlineSuggestionCount,
	AIInlineSuggestionPreviousButton,
	AIInlineSuggestionNextButton,
	AIInlineSuggestionAcceptButton,
	AIInlineSuggestionRejectButton,
	AIInlineSession,
	AIInlineSessionActions,
	useAIContext,
	type AIRootProps,
	type AITriggerProps,
	type AISelectionTriggerProps,
	type AICommandMenuProps,
	type AICommandInputProps,
	type AICommandListProps,
	type AICommandItemProps,
	type AIGenerationZoneProps,
	type AIStructuredTargetPreviewProps,
	type AIActionBarProps,
	type AIAcceptButtonProps,
	type AIRejectButtonProps,
	type AIRetryButtonProps,
	type AISuggestionProps,
	type AITrackChangesProps,
	type AIDiffViewProps,
	type AIChangeListProps,
	type AIProgressProps,
	type AIToolStreamProps,
	type AIContextualPromptTriggerProps,
	type AIContextualPromptSurfaceProps,
	type AIContextualPromptComposerProps,
	type AIInlineSuggestionControlsProps,
	type AIInlineSuggestionFloatingSurfaceProps,
	type AIInlineSuggestionCountProps,
	type AIInlineSuggestionPreviousButtonProps,
	type AIInlineSuggestionNextButtonProps,
	type AIInlineSuggestionAcceptButtonProps,
	type AIInlineSuggestionRejectButtonProps,
	type AIInlineSessionProps,
	type AIInlineSessionActionsProps,
} from "./primitives/ai/index";
export {
	AISuggestionsRoot,
	AISuggestionsPopover,
	type AISuggestionsRootProps,
	type AISuggestionsPopoverProps,
} from "./primitives/aiSuggestions/index";
export {
	MultiplayerPresenceList,
	MultiplayerRemoteCursors,
	MultiplayerCaretOverlay,
	type MultiplayerPresenceListProps,
	type MultiplayerCaretOverlayProps,
	type MultiplayerCaretRenderProps,
	type MultiplayerRemoteCursorsProps,
} from "./primitives/multiplayer/index";

// ── Hooks ───────────────────────────────────────────────────
export {
	useAI,
	useAISuggestions,
	useAISuggestionPopover,
	useAISuggestionsMetrics,
	useAIDebugLog,
	useAISessions,
	useActiveAISession,
	useActiveAIStructuredPreview,
	useAIStructuredPreview,
	useAIStructuredPreviewContent,
	useAIStructuredTargetPreview,
	useContextualPromptSession,
	useContextualPromptAnchor,
	useContextualPromptPlacement,
	useAIActions,
	useAISessionActions,
	useAttribution,
	useEditor,
	useFieldEditor,
	useHistory,
	useSearch,
	useMultiplayer,
	useRemoteCursors,
	useRemoteSelections,
	useSelection,
	useDecorations,
	useGeneration,
	useSuggestions,
	useInlineSuggestionControls,
	useSuggestMode,
	useExtensionState,
	useToolbar,
	useSelectionToolbar,
	useSlashMenu,
	useSuggestionMenu,
	resolveSuggestionMenuTarget,
	useBlockList,
	useBlockDragHandle,
	useVisualViewport,
	type AIDebugLogEntry,
	type AIDebugLogFastApplyMetrics,
	type AIDebugLogState,
	type AttributionState,
	type AIStructuredPreviewSelection,
	type AIStructuredTargetPreviewSelection,
	type AISuggestionPopoverPosition,
	type ContextualPromptMode,
	type ContextualPromptPlacement,
	type ContextualPromptSide,
	type UseContextualPromptPlacementOptions,
	type InlineSuggestionControlPosition,
	type InlineSuggestionControlsState,
	type BlockDragHandleHookResult,
	type SelectionToolbarState,
	type SlashMenuState,
	type SlashMenuActions,
	type SlashMenuTarget,
	type SuggestionMenuActions,
	type SuggestionMenuBoundary,
	type SuggestionMenuController,
	type SuggestionMenuGetItemsOptions,
	type SuggestionMenuSelectOptions,
	type SuggestionMenuState,
	type SuggestionMenuStatus,
	type SuggestionMenuTarget,
	type SuggestionMenuTrigger,
	type UseSuggestionMenuOptions,
	type VisualViewportState,
} from "./hooks/index";

// ── Contexts (for advanced composition) ─────────────────────
export {
	EditorContext,
	useEditorContext,
	FieldEditorContext,
	useFieldEditorContext,
	ToolbarContext,
	useToolbarContext,
	EMPTY_TOOLBAR_STATE,
	SelectionToolbarContext,
	type EditorContextValue,
	type BlockControlsProps,
	type BlockControlsRenderer,
	type BlockDragAndDropOptions,
	type BlockSelectionOptions,
	type ResolvedBlockDragAndDropOptions,
	type ResolvedBlockSelectionOptions,
	type ResolvedInteractionModel,
	type PasteImporters,
	type RendererOverrides,
	type ToolbarState,
	type ToolbarContextValue,
} from "./context/index";

// ── Renderer registry ───────────────────────────────────────
export {
	resolveRenderer,
	registerRenderer,
	ParagraphRenderer,
	HeadingRenderer,
	BulletListItemRenderer,
	NumberedListItemRenderer,
	CheckListItemRenderer,
	CodeBlockRenderer,
	ImageRenderer,
	TableRenderer,
	DividerRenderer,
	CalloutRenderer,
	ToggleRenderer,
	BlockquoteRenderer,
	SubdocumentRenderer,
	DefaultRenderer,
} from "./renderers/index";

// ── Extensions ───────────────────────────────────────────────
export {
	richTextShortcutsExtension,
	RICH_TEXT_SHORTCUTS_EXTENSION_NAME,
	type RichTextShortcutsOptions,
} from "@pen/shortcuts";

// ── Field editor extension helpers ───────────────────────────
export type {
	FieldEditorStore,
	FieldEditorStoreSnapshot,
} from "./field-editor/store";
export {
	applyDeltaToDOM,
	fullReconcileToDOM,
	fullReconcileDeltasToDOM,
	saveSelection,
	restoreSelection,
} from "./field-editor/reconciler";
export { resolveMarksAtPosition } from "./field-editor/markBoundary";
export {
	computeTextDiff,
	extractTextFromDOM,
	getSelectionOffsets,
	type TextDiffOp,
	type SelectionPoint,
} from "./field-editor/selectionBridge";
export {
	classifySelectionSurface,
	getExpandedBlockRole,
	type ExpandedBlockRole,
	type FieldEditorSurfaceMode,
	type FieldEditorSurfaceState,
} from "./field-editor/crossBlock";
export {
	handlePaste,
	handleClipboardPaste,
	handleCopy,
	handleCut,
} from "./field-editor/clipboard";

// ── Internal hooks (for extension authors) ──────────────────
export { useFieldEditorState } from "./hooks/useFieldEditorState";
export { useCellTextSnapshot } from "./hooks/useCellTextSnapshot";
export { useAIStreamEvents } from "./hooks/useAIStreamEvents";

// ── Table primitives (for extension authors) ────────────────
export {
	TableCellContent,
	type TableCellContentProps,
} from "./primitives/editor/tableCellContent";

// ── Utilities ───────────────────────────────────────────────
export { composeRefs } from "./utils/composeRefs";
export { renderAsChild, type AsChildProps } from "./utils/asChild";
export { DATA_ATTRS, buildDataAttributes } from "./utils/dataAttributes";
export {
	getAttachedFieldEditor,
	getAttachedFieldEditorStore,
} from "./utils/fieldEditor";
export { isCellInSelection } from "./utils/cellSelection";

// ── Re-export key types from @pen/types for convenience ─────
export type {
	BlockRenderContext,
	BlockRenderer,
	BlockHandle,
	Editor,
	SelectionState,
	DecorationSet,
	Decoration,
	InlineDecoration,
	BlockDecoration,
	FieldEditor,
	InputBackend,
} from "@pen/types";

export type {
	BlameRange,
	CharacterAttribution,
	HistoryState,
} from "@pen/history";
export type { MultiplayerState, PeerState } from "@pen/multiplayer";
export type { RemoteCursorState, RemoteSelectionState } from "@pen/multiplayer";

export type { CreateEditorOptions } from "@pen/types";
