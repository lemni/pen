import type { DocumentOp, OpOrigin } from "./ops";
import type { Unsubscribe } from "./utility";
import type { DocumentRange } from "./documentRange";

export type DocumentProfile = "structured" | "flow";

// ── Abstract CRDT Collections ───────────────────────────────

export interface CRDTArray<T> {
	readonly length: number;
	get(index: number): T;
	toArray(): T[];
	[Symbol.iterator](): Iterator<T>;
}

export interface CRDTMap<T> {
	get(key: string): T | undefined;
	has(key: string): boolean;
	entries(): IterableIterator<[string, T]>;
	keys(): IterableIterator<string>;
	readonly size: number;
}

// ── CRDT Adapter ────────────────────────────────────────────

export interface CRDTAdapter {
	createDocument(): CRDTDocument;
	loadDocument(binary: Uint8Array): CRDTDocument;

	encodeState(doc: CRDTDocument): Uint8Array;
	encodeUpdate(doc: CRDTDocument, since?: Uint8Array): Uint8Array;
	applyUpdate(doc: CRDTDocument, update: Uint8Array): void;

	transact(doc: CRDTDocument, fn: () => void, origin?: unknown): void;

	createUndoManager(
		doc: CRDTDocument,
		options?: UndoManagerOptions,
	): CRDTUndoManager;

	createAwareness?(doc: CRDTDocument): Awareness;

	observe(
		doc: CRDTDocument,
		callback: (event: CRDTEvent) => void,
	): Unsubscribe;

	createSnapshot(doc: CRDTDocument): Uint8Array;
	restoreSnapshot(doc: CRDTDocument, snapshot: Uint8Array): CRDTDocument;

	mergeUpdates?(updates: Uint8Array[]): Uint8Array;

	fork?(doc: CRDTDocument): CRDTDocument;
	merge?(target: CRDTDocument, source: CRDTDocument): void;

	getClientId(doc: CRDTDocument): number;

	getDocumentProfile?(doc: CRDTDocument): DocumentProfile | null;
	setDocumentProfile?(doc: CRDTDocument, profile: DocumentProfile): void;

	raw<T>(doc: CRDTDocument): T;

	// Factory methods
	createMap(): unknown;
	createArray(): unknown;
	createText(): unknown;
	initBlockMap(
		doc: CRDTDocument,
		blockId: string,
		blockType: string,
		contentType:
			| "inline"
			| "nested"
			| "table"
			| "database"
			| "subdocument"
			| "none",
	): unknown;

	// Attribution (per-character authorship)
	getAttributionRanges?(
		doc: CRDTDocument,
		blockId: string,
	): AttributionRange[];
}

export interface AttributionRange {
	offset: number;
	length: number;
	clientId: number;
}

export type DocumentScopeKind = "root" | "subdocument";

export interface DocumentScopeInfo {
	id: string;
	guid: string;
	kind: DocumentScopeKind;
	parentId: string | null;
	ownerBlockId: string | null;
}

export interface DocumentScope extends DocumentScopeInfo {
	readonly doc: CRDTDocument;
}

export interface CreateSubdocumentOptions {
	scopeId?: string;
	guid?: string;
	autoLoad?: boolean;
}

export interface DocumentScopeLookupOptions {
	scopeId?: string;
}

export interface ReplaceScopeDocumentOptions {
	destroyReplacedDoc?: boolean;
}

export interface DocumentScopeReplacementEvent {
	previousScope: DocumentScopeInfo;
	scope: DocumentScope;
}

export interface DocumentSessionAttachOptions {
	onScopeReplaced?: (event: DocumentScopeReplacementEvent) => void;
}

export interface DocumentSession {
	readonly adapter: CRDTAdapter;
	readonly rootScope: DocumentScope;

	getScope(scopeId: string): DocumentScope | null;
	getScopeByGuid(guid: string): DocumentScope | null;
	getScopeForBlock(
		blockId: string,
		options?: DocumentScopeLookupOptions,
	): DocumentScope | null;
	listScopes(): readonly DocumentScope[];

	getAwareness(scopeId?: string): Awareness | null;

	observe(scopeId: string, callback: (event: CRDTEvent) => void): Unsubscribe;
	observeAll(callback: (event: CRDTEvent) => void): Unsubscribe;

	createSubdocument(
		blockId: string,
		options?: CreateSubdocumentOptions,
	): DocumentScope | null;
	loadSubdocument(scopeId: string): void;
	replaceScopeDocument(
		scopeId: string,
		doc: CRDTDocument,
		options?: ReplaceScopeDocumentOptions,
	): void;
	attachEditor(options?: DocumentSessionAttachOptions): Unsubscribe;

	destroy(): void;
}

// ── CRDT Document ───────────────────────────────────────────

export interface CRDTDocument {
	readonly adapter: CRDTAdapter;
}

export interface PenDocument {
	readonly blockOrder: CRDTArray<string>;
	readonly blocks: CRDTMap<unknown>;
	readonly apps: CRDTMap<unknown>;
	readonly metadata: CRDTMap<unknown>;
	readonly adapter: CRDTAdapter;
}

// ── Undo Manager ────────────────────────────────────────────

export interface UndoManagerOptions {
	trackedOrigins?: OpOrigin[];
	captureTimeout?: number;
}

export interface CRDTUndoManager {
	undo(): boolean;
	redo(): boolean;
	canUndo(): boolean;
	canRedo(): boolean;
	stopCapturing(): void;
	setCaptureTimeout?(ms: number): void;
	addTrackedOrigin(origin: OpOrigin): void;
	removeTrackedOrigin(origin: OpOrigin): void;
	onStackItemAdded?(
		callback: (stackItem: CRDTUndoStackItem, kind: "undo" | "redo") => void,
	): Unsubscribe;
	onStackItemUpdated?(
		callback: (stackItem: CRDTUndoStackItem, kind: "undo" | "redo") => void,
	): Unsubscribe;
	onStackItemPopped?(
		callback: (stackItem: CRDTUndoStackItem, kind: "undo" | "redo") => void,
	): Unsubscribe;
}

export interface CRDTUndoStackItem {
	getMeta<T>(key: string): T | undefined;
	setMeta(key: string, value: unknown): void;
}

// ── Awareness ───────────────────────────────────────────────

export interface AwarenessChangeEvent {
	added: number[];
	updated: number[];
	removed: number[];
}

export interface Awareness {
	getLocalState(): Record<string, unknown> | null;
	setLocalState(state: Record<string, unknown> | null): void;
	getStates(): Map<number, Record<string, unknown>>;
	on(
		event: "change",
		callback: (changes: AwarenessChangeEvent) => void,
	): void;
	off(
		event: "change",
		callback: (changes: AwarenessChangeEvent) => void,
	): void;
	destroy(): void;
}

// ── Generation Zone ─────────────────────────────────────────

export interface GenerationZone {
	id: string;
	blockId: string;
	range: DocumentRange;
	status: "idle" | "streaming" | "complete" | "error";
}

// ── CRDT Event ──────────────────────────────────────────────

export interface CRDTEvent {
	origin: OpOrigin;
	readonly affectedBlocks: readonly string[];
	ops: readonly DocumentOp[];
	timestamp: number;
	scope?: DocumentScopeInfo;
}
