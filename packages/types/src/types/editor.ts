import type { Block } from "./block";
import type { SelectionState } from "./selection";
import type {
	CRDTAdapter,
	CRDTDocument,
	CRDTEvent,
	PenDocument,
	Awareness,
	DocumentSession,
	DocumentScope,
	DocumentProfile,
} from "./crdt";
import type { DocumentOp, OpOrigin, ApplyOptions } from "./ops";
import type { Decoration, DecorationSet } from "./decorations";
import type { Extension } from "./extension";
import type { BlockHandle, AppHandle } from "./handles";
import type { Unsubscribe } from "./utility";
import type { SchemaRegistry } from "./schema";
import type { AssetProvider } from "./persistence";

export type EditorViewMode = DocumentProfile;

export type InteractionModel = "content-first" | "block-first";

// ── Document State ──────────────────────────────────────────

export interface DocumentState {
	readonly documentProfile: DocumentProfile;
	readonly blockOrder: readonly string[];
	readonly blockCount: number;
	readonly blocks: Iterable<BlockHandle>;
	readonly isEmpty: boolean;
	readonly generation: number;
	allBlocks(): Iterable<BlockHandle>;
	blockAt(index: number): string | null;
	indexOf(blockId: string): number;
	parentOf(blockId: string): string | null;
}

// ── Undo Manager ────────────────────────────────────────────

export interface UndoManager {
	undo(): boolean;
	redo(): boolean;
	canUndo(): boolean;
	canRedo(): boolean;

	stopCapturing(): void;
	setGroupTimeout(ms: number): void;

	registerTrackedOrigins(origins: OpOrigin[]): Unsubscribe;

	onStackChange(callback: () => void): Unsubscribe;
}

export interface UndoHistoryRestore {
	focusBlockId: string | null;
	requestId: number;
}

export interface HistoryAppliedEvent {
	kind: "undo" | "redo";
	selection: SelectionState;
	focusBlockId: string | null;
	requestId: number;
}

export interface DocumentCommitEvent {
	commitId: number;
	ops: readonly DocumentOp[];
	origin: OpOrigin;
	affectedBlocks: string[];
	blockRevisions: Readonly<Record<string, number>>;
	scope?: DocumentScope;
}

// ── Schema Engine ───────────────────────────────────────────

export interface SchemaEngine {
	markDirty(blockId: string): void;
	normalizeDirty(): void;
	normalizeAll(): void;
}

// ── Diagnostic Events ───────────────────────────────────────

export interface DiagnosticEvent {
	code: string;
	level: "warn" | "error" | "info";
	source: string;
	message: string;
	remediation?: string;
	op?: DocumentOp;
	extension?: string;
	error?: unknown;
	[key: string]: unknown;
}

export interface DocumentValidationError {
	code:
		| "MISSING_SHARED_TYPE"
		| "INVALID_BLOCK_STRUCTURE"
		| "ORPHAN_BLOCK"
		| "DUPLICATE_BLOCK_ORDER"
		| "UNKNOWN_CONTENT_TYPE"
		| "MISSING_BLOCK_MAP_KEY"
		| "INVALID_SUBDOCUMENT";
	blockId?: string;
	message: string;
	severity: "error" | "warning";
}

// ── Editor Events ───────────────────────────────────────────

export interface PenEventMap {
	change: (events: CRDTEvent[]) => void;
	documentCommit: (event: DocumentCommitEvent) => void;
	historyApplied: (event: HistoryAppliedEvent) => void;
	decorationsChange: (generation: number) => void;
	selectionChange: (selection: SelectionState) => void;
	diagnostic: (event: DiagnosticEvent) => void;
	"crdt:corruption": (errors: DocumentValidationError[]) => void;
	"crdt:recovered": (method: "snapshot" | "repair" | "reimport") => void;
}

// ── Hook Priority Constants ─────────────────────────────────

export const HOOK_PRIORITY_AUTH = 100;
export const HOOK_PRIORITY_SUGGEST = 200;
export const HOOK_PRIORITY_INPUT_RULE = 300;
export const HOOK_PRIORITY_DEFAULT = 500;

// ── Editor Options ──────────────────────────────────────────

export interface EditorPresetContext {
	schema: SchemaRegistry;
	documentProfile: DocumentProfile;
}

export interface EditorPresetResult {
	extensions?: Extension[];
}

export interface EditorPreset {
	resolve(context: EditorPresetContext): EditorPresetResult;
}

export interface CreateEditorOptions {
	schema?: SchemaRegistry;
	preset?: EditorPreset;
	extensions?: Extension[];
	/** @deprecated Prefer `preset` for default feature composition. */
	without?: string[];
	crdt?: CRDTAdapter;
	assets?: AssetProvider;
	document?: CRDTDocument;
	documentSession?: DocumentSession;
	documentScopeId?: string;
	documentProfile?: DocumentProfile;
	editorViewMode?: EditorViewMode;
}

// ── Command Context ─────────────────────────────────────────

export interface CommandContext {
	editor: Editor;
	selection: SelectionState;
	activeBlock: BlockHandle | null;
}

export interface InlineCompletionSuggestion {
	id: string;
	blockId: string;
	offset: number;
	text: string;
	type: "inline" | "block";
	blockType?: string;
	props?: Record<string, unknown>;
	previewBlocks?: readonly InlineCompletionPreviewBlock[];
}

export interface InlineCompletionPreviewBlock {
	id: string;
	text: string;
	blockType?: string;
	props?: Record<string, unknown>;
}

export interface InlineCompletionState {
	visibleSuggestion: InlineCompletionSuggestion | null;
}

export interface InlineCompletionController {
	getState(): InlineCompletionState;
	subscribe(listener: () => void): () => void;
	showSuggestion(suggestion: InlineCompletionSuggestion): void;
	dismissSuggestion(): void;
	acceptSuggestion(): boolean;
	hasVisibleSuggestion(): boolean;
	buildDecorations(): readonly Decoration[];
	destroy(): void;
}

// ── Editor Interface ────────────────────────────────────────

export interface Editor {
	apply(ops: DocumentOp[], options?: ApplyOptions): void;
	loadDocument(doc: CRDTDocument): void;

	onBeforeApply(
		hook: (ops: DocumentOp[], options: ApplyOptions) => DocumentOp[],
		options?: { priority?: number },
	): Unsubscribe;

	readonly schema: SchemaRegistry;
	readonly selection: SelectionState;
	readonly documentState: DocumentState;
	readonly internals: EditorInternals;
	readonly clientId: number;
	readonly documentScope: DocumentScope;
	readonly documentProfile: DocumentProfile;
	readonly editorViewMode: EditorViewMode;

	blocks(type?: string): Iterable<BlockHandle>;
	getBlock(blockId: string): BlockHandle | null;
	firstBlock(): BlockHandle | null;
	lastBlock(): BlockHandle | null;
	blockCount(): number;
	getBlockRevision(blockId: string): number;

	setSelection(selection: SelectionState): void;
	getSelection(): SelectionState;
	selectBlock(blockId: string): void;
	selectBlocks(blockIds: string[]): void;
	selectCell(blockId: string, row: number, col: number): void;
	selectCellRange(
		blockId: string,
		anchor: { row: number; col: number },
		head: { row: number; col: number },
	): void;
	selectText(blockId: string, from: number, to: number): void;
	selectTextRange(
		anchor: { blockId: string; offset: number },
		focus: { blockId: string; offset: number },
	): void;
	selectAll(): void;

	getSelectedText(): string;
	getSelectedBlocks(): BlockHandle[];
	replaceSelection(content: string | Block[]): void;
	deleteSelection(options?: ApplyOptions): void;

	requestDecorationUpdate(): void;
	getDecorations(): DecorationSet;
	scrollToBlock?(blockId: string): void;

	onDocumentCommit(callback: PenEventMap["documentCommit"]): Unsubscribe;
	onSelectionChange(callback: PenEventMap["selectionChange"]): Unsubscribe;
	onHistoryApplied(callback: PenEventMap["historyApplied"]): Unsubscribe;

	on<K extends keyof PenEventMap>(
		event: K,
		handler: PenEventMap[K],
	): Unsubscribe;
	on(event: string, handler: (...args: unknown[]) => void): Unsubscribe;

	readonly undoManager: UndoManager;

	getExtensionState<T>(name: string): T | undefined;

	normalizeAll(): void;
	destroy(): void;
}

export interface EditorInternals {
	readonly adapter: CRDTAdapter;
	readonly crdtDoc: CRDTDocument;
	readonly doc: PenDocument;
	readonly engine: SchemaEngine;
	readonly awareness: Awareness | null;
	readonly documentSession: DocumentSession | null;
	readonly documentScope: DocumentScope;
	readonly viewId: string;
	emit<K extends keyof PenEventMap>(
		event: K,
		...args: Parameters<PenEventMap[K]>
	): void;
	onApplyBoundary(
		hook: (event: {
			phase: "before" | "after";
			ops: readonly DocumentOp[];
			origin: OpOrigin;
			applied: boolean;
		}) => void,
	): Unsubscribe;
	getSlot<T>(key: string): T | undefined;
	setSlot(key: string, value: unknown): void;
	getBlockText(blockId: string): unknown;
	getCellText(blockId: string, row: number, col: number): unknown;
}
