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
	EditorRoot,
	EditorContent,
	EditorBlock,
	InlineContent,
	EditorBlockHandle,
	EditorDragOverlay,
	EditorRegionSelector,
	EditorSelectionRect,
	EditorFieldEditor,
	type EditorRootProps,
	type EditorContentProps,
	type EditorBlockProps,
	type InlineContentProps,
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
} from "./primitives/toolbar/index";

// ── Slash menu primitives ───────────────────────────────────
export {
	SlashMenuRoot,
	SlashMenuInput,
	SlashMenuList,
	SlashMenuGroup,
	SlashMenuItem,
	SlashMenuEmpty,
	type SlashMenuRootProps,
	type SlashMenuInputProps,
	type SlashMenuListProps,
	type SlashMenuGroupProps,
	type SlashMenuItemProps,
	type SlashMenuEmptyProps,
} from "./primitives/slash-menu/index";

// ── Selection toolbar primitives ────────────────────────────
export {
	SelectionToolbarRoot,
	SelectionToolbarContent,
	useSelectionToolbarContext,
	type SelectionToolbarRootProps,
	type SelectionToolbarContentProps,
	type SelectionToolbarContextValue,
} from "./primitives/selection-toolbar/index";

// ── Hooks ───────────────────────────────────────────────────
export {
	useEditor,
	useFieldEditor,
	useSelection,
	useDecorations,
	useExtensionState,
	useToolbar,
	useSelectionToolbar,
	useSlashMenu,
	useBlockList,
	useBlockDragHandle,
	useVisualViewport,
	type BlockDragHandleHookResult,
	type SelectionToolbarState,
	type SlashMenuState,
	type SlashMenuActions,
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
	type ResolvedBlockDragAndDropOptions,
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

// ── Re-export key types from @pen/core for convenience ──────
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
} from "@pen/core";

export type { CreateEditorOptions } from "@pen/core";
