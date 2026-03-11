// ── Branded IDs ─────────────────────────────────────────────
export {
	type BlockId,
	type AppId,
	type ZoneId,
	type DocId,
	blockId,
	appId,
	zoneId,
	docId,
} from "./ids";

// ── Utility ─────────────────────────────────────────────────
export type { Unsubscribe, Spacing, BorderDef } from "./utility";

// ── Block ───────────────────────────────────────────────────
export type {
	Block,
	App,
	Range,
	AppPlacement,
	AnchorPosition,
} from "./block";

// ── Selection ───────────────────────────────────────────────
export type {
	SelectionState,
	TextSelection,
	BlockSelection,
	AppSelection,
	CellSelection,
} from "./selection";

// ── Document Range ──────────────────────────────────────────
export type { DocumentRange } from "./documentRange";

// ── Layout ──────────────────────────────────────────────────
export type { LayoutSchema, LayoutProps, LayoutChildProps } from "./layout";

// ── Input ───────────────────────────────────────────────────
export type {
	KeyBinding,
	KeyBindingContext,
	InputRule,
	InputRuleHandler,
	InputRuleContext,
} from "./input";

// ── Operations ──────────────────────────────────────────────
export type {
	DocumentOp,
	OpOrigin,
	ApplyOptions,
	Position,
	InsertBlockOp,
	UpdateBlockOp,
	DeleteBlockOp,
	MoveBlockOp,
	ConvertBlockOp,
	SplitBlockOp,
	MergeBlocksOp,
	InsertTextOp,
	DeleteTextOp,
	FormatTextOp,
	ReplaceTextOp,
	InsertInlineNodeOp,
	RemoveInlineNodeOp,
	UpdateLayoutOp,
	InsertTableRowOp,
	DeleteTableRowOp,
	InsertTableColumnOp,
	DeleteTableColumnOp,
	MergeTableCellsOp,
	SplitTableCellOp,
	InsertTableCellTextOp,
	DeleteTableCellTextOp,
	FormatTableCellTextOp,
	UpdateTableColumnsOp,
	DatabaseAddColumnOp,
	DatabaseUpdateColumnOp,
	DatabaseConvertColumnOp,
	DatabaseRemoveColumnOp,
	DatabaseInsertRowOp,
	DatabaseUpdateCellOp,
	DatabaseDeleteRowOp,
	DatabaseDeleteRowsOp,
	DatabaseDuplicateRowOp,
	DatabaseMoveRowOp,
	DatabaseAddViewOp,
	DatabaseUpdateViewOp,
	DatabaseRemoveViewOp,
	DatabaseSetActiveViewOp,
	DatabaseUpdateSelectOptionsOp,
	SetMetaOp,
	CreateAppOp,
	UpdateAppOp,
	DeleteAppOp,
	SetSelectionOp,
} from "./ops";

// ── Stream ──────────────────────────────────────────────────
export type {
	PenStreamPart,
	PenStreamRequest,
	GenStartPart,
	GenDeltaPart,
	GenEndPart,
	BlockInsertPart,
	BlockUpdatePart,
	BlockDeletePart,
	BlockMovePart,
	LayoutUpdatePart,
	AppCreatePart,
	AppUpdatePart,
	AppDeletePart,
	StepStartPart,
	StepEndPart,
	ToolInputStartPart,
	ToolInputDeltaPart,
	ToolInputAvailablePart,
	ToolOutputPart,
	ToolErrorPart,
	DataPart,
	ErrorPart,
	AbortPart,
	PingPart,
	DonePart,
} from "./stream";

// ── Schema ──────────────────────────────────────────────────
export {
	type PropSchema,
	type ContentType,
	type BlockDisplay,
	type BlockAuthoring,
	type BlockSelectionRole,
	type FlowBlockCapability,
	type ImportInlineMark,
	type ImportContentSource,
	type BlockImportMatch,
	type BlockSchema,
	type InlineSchema,
	type AppSchema,
	type SchemaRegistry,
	type ComposableSchema,
	type FieldEditorType,
	isNestedContent,
} from "./schema";

// ── Handles ─────────────────────────────────────────────────
export type {
	BlockHandle,
	AppHandle,
	TableCellHandle,
	TableColumnSchema,
	TableRowHandle,
} from "./handles";

// ── Database ────────────────────────────────────────────────
export type {
	ColumnType,
	SelectOption,
	NumberFormat,
	DateFormat,
	DatabaseSort,
	FilterOperator,
	FilterCondition,
	FilterGroup,
	DatabaseRowPinning,
	DatabaseViewState,
	DatabaseQuery,
} from "./database";
export { DEFAULT_DATABASE_COLUMN_WIDTH } from "./database";

// ── Field Editor ────────────────────────────────────────────
export type {
	FieldEditor,
	InputBackend,
	StreamingTarget,
} from "./fieldEditor";
export type {
	FieldEditorBehavior,
	FieldEditorInputMode,
} from "./fieldEditorCapabilities";
export {
	delegatesToGridEditing,
	hasFieldEditorSurface,
	resolveFieldEditorBehavior,
	resolveFieldEditorInputMode,
	supportsInlineInputRules,
	supportsInlineMarks,
	usesInlineTextSelection,
} from "./fieldEditorCapabilities";

// ── CRDT ────────────────────────────────────────────────────
export type {
	CRDTAdapter,
	CRDTDocument,
	PenDocument,
	CRDTUndoManager,
	CRDTUndoStackItem,
	CRDTArray,
	CRDTMap,
	Awareness,
	AwarenessChangeEvent,
	CRDTEvent,
	GenerationZone,
	UndoManagerOptions,
	AttributionRange,
	DocumentProfile,
	DocumentScopeKind,
	DocumentScopeInfo,
	DocumentScope,
	DocumentScopeLookupOptions,
	CreateSubdocumentOptions,
	DocumentSession,
} from "./crdt";

// ── Extension ───────────────────────────────────────────────
export type {
	Extension,
	ExtensionStateSpec,
	ServerExtensionContext,
	ClientExtensionContext,
} from "./extension";

// ── Editor ──────────────────────────────────────────────────
export {
	type Editor,
	type EditorInternals,
	type CreateEditorOptions,
	type DocumentState,
	type PenEventMap,
	type UndoManager,
	type UndoHistoryRestore,
	type HistoryAppliedEvent,
	type DocumentCommitEvent,
	type SchemaEngine,
	type DiagnosticEvent,
	type DocumentValidationError,
	type CommandContext,
	type EditorViewMode,
	type InteractionModel,
	HOOK_PRIORITY_AUTH,
	HOOK_PRIORITY_SUGGEST,
	HOOK_PRIORITY_INPUT_RULE,
	HOOK_PRIORITY_DEFAULT,
} from "./editor";

// ── Tools ───────────────────────────────────────────────────
export type {
	ToolServer,
	ToolDefinition,
	ToolContext,
	ToolSchema,
	ModelAdapter,
	ModelStreamEvent,
	ModelMessage,
	ModelMessagePart,
} from "./tools";

// ── Persistence ─────────────────────────────────────────────
export type {
	PenPersistence,
	VersionMetadata,
	VersionEntry,
	AssetRef,
	AssetUploadOptions,
	AssetProvider,
} from "./persistence";

// ── Decorations ─────────────────────────────────────────────
export type {
	Decoration,
	InlineDecoration,
	BlockDecoration,
	AppDecoration,
	DecorationSet,
	PositionMapping,
} from "./decorations";

// ── Transport ───────────────────────────────────────────────
export type { PenTransport, ServerConfig } from "./transport";

// ── Serialization ───────────────────────────────────────────
export type {
	MarkdownNode,
	HTMLImportElement,
	HTMLImportNode,
	HTMLImportTextNode,
	XMLElement,
	Exporter,
	ExportOptions,
	Importer,
	ImportOptions,
	ImportResult,
} from "./serialization";

// ── Rendering ───────────────────────────────────────────────
export type { BlockRenderContext, BlockRenderer } from "./rendering";

// ── Suggestions ─────────────────────────────────────────────
export type { BlockSuggestion } from "./suggestions";
