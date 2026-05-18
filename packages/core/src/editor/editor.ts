import type {
	Editor,
	EditorInternals,
	CreateEditorOptions,
	PenEventMap,
	DocumentCommitEvent,
	CRDTAdapter,
	CRDTDocument,
	CRDTEvent,
	PenDocument,
	SchemaRegistry,
	Awareness,
	DocumentSession,
	DocumentScope,
	DocumentScopeReplacementEvent,
	DocumentProfile,
	Extension,
	DocumentOp,
	ApplyOptions,
	OpOrigin,
	MutationGroupMetadata,
	SelectionState,
	TextSelection,
	DocumentRange,
	BlockHandle,
	Block,
	DocumentState,
	UndoManager,
	Unsubscribe,
	CRDTMap,
	CRDTArray,
	Position,
	DecorationSet,
	EditorViewMode,
} from "@pen/types";
import {
	AWAIT_EXTENSION_LIFECYCLE_SLOT_KEY,
	COLLECT_KEY_BINDINGS_SLOT_KEY,
	usesInlineTextSelection,
	createMutationGroupMetadata,
	getApplyOptionsGroupId,
	MUTATION_GROUP_METADATA_KEY,
	UNDO_HISTORY_METADATA_CONTROLLER_SLOT_KEY,
} from "@pen/types";
import { yjsAdapter } from "@pen/crdt-yjs";
import { undoExtension } from "@pen/undo";
import { documentOpsExtension } from "@pen/document-ops";
import { deltaStreamExtension } from "@pen/delta-stream";
import { richTextShortcutsExtension } from "@pen/shortcuts";
import { builtInDefaultSchema } from "../defaultSchema";
import { SchemaEngineImpl } from "../schema/normalize";
import { createBlockHandle } from "../schema/handles";
import { EventEmitter } from "./events";
import { ApplyPipeline } from "./apply";
import { resolveCellSelectionMatrix } from "./cellSelection";
import { filterOpsForDocumentProfile } from "./profilePolicy";
import type { CRDTUnknownMap } from "./crdtShapes";
import {
	getTextProp,
	getTableContent,
	getCellText as getCellTextFromRow,
	isCRDTMap,
} from "./crdtShapes";
import { ExtensionManagerImpl } from "./extensionManager";
import { SelectionManagerImpl } from "./selection";
import { DocumentStateImpl } from "./documentState";
import { emptyDecorationSet } from "./decorations";
import { DocumentRangeImpl } from "./range";
import { createDocumentSession } from "./documentSession";

type CRDTBlockMap = CRDTMap<CRDTMap<unknown>>;

type RawPenDocumentLike = {
	getArray?(name: "blockOrder"): CRDTArray<string>;
	getMap?(name: "blocks" | "apps" | "metadata"): CRDTMap<unknown>;
	blockOrder?: CRDTArray<string>;
	blocks?: CRDTMap<unknown>;
	apps?: CRDTMap<unknown>;
	metadata?: CRDTMap<unknown>;
};

let hasWarnedAboutWithoutOption = false;

function createGeneratedBlockId(): string {
	return crypto.randomUUID();
}

function missingPenDocumentRoot(name: string): never {
	throw new Error(`CRDT document is missing required Pen root "${name}".`);
}

// Stub undo manager for when @pen/undo is excluded
const NOOP_UNDO: UndoManager = {
	undo: () => false,
	redo: () => false,
	canUndo: () => false,
	canRedo: () => false,
	stopCapturing: () => {},
	syncExplicitUndoGroup: () => {},
	setGroupTimeout: () => {},
	registerTrackedOrigins: () => () => {},
	onStackChange: () => () => {},
};

class EditorImpl implements Editor {
	private readonly _adapter: CRDTAdapter;
	private readonly _registry: SchemaRegistry;
	private _engine: SchemaEngineImpl;
	private readonly _extensions: ExtensionManagerImpl;
	private _selection: SelectionManagerImpl;
	private readonly _emitter: EventEmitter;
	private _pipeline: ApplyPipeline;
	private _documentState: DocumentStateImpl;
	private _doc!: PenDocument;
	private _crdtDoc!: CRDTDocument;
	private _documentSession: DocumentSession | null = null;
	private _documentScope!: DocumentScope;
	private _releaseSession: Unsubscribe | null = null;
	private _unsubObserve: Unsubscribe | null = null;
	private _awareness: Awareness | null = null;
	private readonly _slots = new Map<string, unknown>();
	private _clientId: number;
	private _documentProfile: DocumentProfile;
	private readonly _explicitEditorViewMode: EditorViewMode | null;
	private _editorViewMode: EditorViewMode;
	private _commitId = 0;
	private readonly _blockRevisions = new Map<string, number>();
	private _decorations: DecorationSet;
	private readonly _viewId = crypto.randomUUID();
	private _extensionLifecycle: Promise<void> = Promise.resolve();
	private _isDestroyed = false;

	readonly undoManager: UndoManager;

	constructor(options: CreateEditorOptions = {}) {
		this._registry = options.schema ?? builtInDefaultSchema;
		this._explicitEditorViewMode = options.editorViewMode ?? null;
		this._adapter =
			options.documentSession?.adapter ?? options.crdt ?? yjsAdapter();
		const documentSession =
			options.documentSession ??
			createDocumentSession({
				adapter: this._adapter,
				document: options.document,
				destroyWhenIdle: true,
				ownsDocuments: options.document == null,
			});
		this._bindSession(documentSession, options.documentScopeId);
		this._documentProfile = this._resolveDocumentProfile(
			options.documentProfile,
		);
		this._editorViewMode =
			this._explicitEditorViewMode ?? this._documentProfile;
		this._clientId = this._adapter.getClientId(this._crdtDoc);

		this._emitter = new EventEmitter();
		this._engine = new SchemaEngineImpl(
			this._registry,
			this._doc,
			this._crdtDoc,
		);
		this._selection = new SelectionManagerImpl(
			this._doc,
			this._crdtDoc,
			this._registry,
			this._emitter,
		);
		this._pipeline = new ApplyPipeline(
			this._doc,
			this._crdtDoc,
			this._adapter,
			this._registry,
			this._engine,
			this._emitter,
			this._selection,
		);
		this._documentState = new DocumentStateImpl(
			this._doc,
			this._crdtDoc,
			this._registry,
			this._documentProfile,
		);

		this._extensions = new ExtensionManagerImpl(this._emitter);
		const allExtensions = this._resolveExtensions(options);
		for (const ext of allExtensions) {
			this._extensions.register(ext);
		}

		this._pipeline._init((event) => {
			this._dispatchCRDTEvent(event);
		});
		this._installProfilePolicyHook();

		this.undoManager = NOOP_UNDO;
		this._decorations = emptyDecorationSet();
		this._refreshCoreSlots();

		this._wireObservation();
		this._extensionLifecycle = this._activateExtensions();
		this._ensureInitialParagraph();

		this._engine.normalizeAll();
		this._refreshDecorations();
	}

	// ── Public API ───────────────────────────────────────────

	get clientId(): number {
		return this._clientId;
	}

	get documentScope(): DocumentScope {
		return this._documentScope;
	}

	get documentProfile(): DocumentProfile {
		return this._documentProfile;
	}

	get editorViewMode(): EditorViewMode {
		return this._editorViewMode;
	}

	get schema(): SchemaRegistry {
		return this._registry;
	}

	get selection(): SelectionState {
		return this._selection.getSelection();
	}

	get documentState(): DocumentState {
		return this._documentState;
	}

	private _getRawBlockMap(blockId: string): CRDTUnknownMap | null {
		const blockMap = (this._doc.blocks as CRDTBlockMap).get(blockId);
		return (blockMap as unknown as CRDTUnknownMap) ?? null;
	}

	get internals(): EditorInternals {
		return {
			adapter: this._adapter,
			crdtDoc: this._crdtDoc,
			doc: this._doc,
			engine: this._engine,
			awareness: this._awareness,
			documentSession: this._documentSession,
			documentScope: this._documentScope,
			viewId: this._viewId,
			emit: (event, ...args) => {
				this._emitter.emit(event, ...args);
			},
			onApplyBoundary: (hook) =>
				this._pipeline.addApplyBoundaryHook(hook),
			getSlot: <T>(key: string): T | undefined =>
				this._slots.get(key) as T | undefined,
			setSlot: (key: string, value: unknown): void => {
				this._slots.set(key, value);
				if (key === "undo:manager") {
					this._refreshUndoManager();
				}
			},
			getBlockText: (blockId: string): unknown => {
				const blockMap = this._getRawBlockMap(blockId);
				if (!blockMap) return null;
				return getTextProp(blockMap, "content");
			},
			getCellText: (
				blockId: string,
				row: number,
				col: number,
			): unknown => {
				const blockMap = this._getRawBlockMap(blockId);
				if (!blockMap) return null;
				const tableContent = getTableContent(blockMap);
				if (!tableContent || row < 0 || row >= tableContent.length)
					return null;
				const rowMap = tableContent.get(row);
				if (!rowMap || !isCRDTMap(rowMap)) return null;
				return getCellTextFromRow(rowMap, col);
			},
		};
	}

	// ── Mutations ────────────────────────────────────────────

	apply(ops: DocumentOp[], options?: ApplyOptions): void {
		const origin = options?.origin ?? "user";
		const groupId = getApplyOptionsGroupId(origin, options);
		const undo = this._slots.get("undo:manager") as UndoManager | undefined;

		undo?.syncExplicitUndoGroup(groupId ?? null);

		if (options?.undoGroup && !groupId) {
			undo?.stopCapturing();
		}

		this._pipeline.apply(ops, origin);
		this._recordMutationGroupMetadata(origin, groupId);
	}

	private _recordMutationGroupMetadata(
		origin: OpOrigin,
		groupId: string | undefined,
	): void {
		if (!groupId) {
			return;
		}
		const controller = this._slots.get(
			UNDO_HISTORY_METADATA_CONTROLLER_SLOT_KEY,
		) as
			| {
					setCurrentEntryMetadata<T>(
						key: string,
						value: { before: T | null; after: T | null },
					): boolean;
			  }
			| undefined;
		controller?.setCurrentEntryMetadata<MutationGroupMetadata>(
			MUTATION_GROUP_METADATA_KEY,
			{
				before: null,
				after: createMutationGroupMetadata(origin, groupId),
			},
		);
	}

	loadDocument(doc: CRDTDocument): void {
		this._queueExtensionLifecycle(async () => {
			await this._extensions.deactivateAll(this);
			if (this._isDestroyed) {
				return;
			}
			this._teardownObservation();
			this._releaseSession?.();
			this._releaseSession = null;
			this._bindSession(
				createDocumentSession({
					adapter: this._adapter,
					document: doc,
					destroyWhenIdle: true,
					ownsDocuments: false,
				}),
			);
			await this._rebindActiveScope();
		});
	}

	onBeforeApply(
		hook: (ops: DocumentOp[], options: ApplyOptions) => DocumentOp[],
		options?: { priority?: number },
	): Unsubscribe {
		return this._pipeline.addBeforeApplyHook(
			hook,
			options?.priority ?? 500,
		);
	}

	// ── Block Traversal ──────────────────────────────────────

	*blocks(type?: string): Iterable<BlockHandle> {
		for (let i = 0; i < this._doc.blockOrder.length; i++) {
			const id = (this._doc.blockOrder as CRDTArray<string>).get(
				i,
			) as string;
			if (type) {
				const blockMap = (this._doc.blocks as CRDTBlockMap).get(id);
				if (!blockMap || blockMap.get("type") !== type) continue;
			}
			yield createBlockHandle(
				id,
				this._doc,
				this._crdtDoc,
				this._registry,
			);
		}
	}

	getBlock(blockId: string): BlockHandle | null {
		if (!(this._doc.blocks as CRDTBlockMap).has(blockId)) return null;
		return createBlockHandle(
			blockId,
			this._doc,
			this._crdtDoc,
			this._registry,
		);
	}

	firstBlock(): BlockHandle | null {
		if (this._doc.blockOrder.length === 0) return null;
		const id = (this._doc.blockOrder as CRDTArray<string>).get(0) as string;
		return createBlockHandle(id, this._doc, this._crdtDoc, this._registry);
	}

	lastBlock(): BlockHandle | null {
		const len = this._doc.blockOrder.length;
		if (len === 0) return null;
		const id = (this._doc.blockOrder as CRDTArray<string>).get(
			len - 1,
		) as string;
		return createBlockHandle(id, this._doc, this._crdtDoc, this._registry);
	}

	blockCount(): number {
		return this._doc.blockOrder.length;
	}

	getBlockRevision(blockId: string): number {
		return this._blockRevisions.get(blockId) ?? 0;
	}

	// ── Selection ────────────────────────────────────────────

	setSelection(selection: SelectionState): void {
		this._selection.setSelection(selection);
	}

	getSelection(): SelectionState {
		return this._selection.getSelection();
	}

	selectBlock(blockId: string): void {
		this._selection.selectBlock(blockId);
	}

	selectBlocks(blockIds: string[]): void {
		this._selection.selectBlocks(blockIds);
	}

	selectCell(blockId: string, row: number, col: number): void {
		this._selection.selectCell(blockId, row, col);
	}

	selectCellRange(
		blockId: string,
		anchor: { row: number; col: number },
		head: { row: number; col: number },
	): void {
		this._selection.selectCellRange(blockId, anchor, head);
	}

	selectText(blockId: string, from: number, to: number): void {
		this._selection.selectText(blockId, from, to);
	}

	selectTextRange(
		anchor: { blockId: string; offset: number },
		focus: { blockId: string; offset: number },
	): void {
		this._selection.selectTextRange(anchor, focus);
	}

	selectAll(): void {
		this._selection.selectAll();
	}

	getSelectedText(): string {
		return this._selection.getSelectedText();
	}

	getSelectedBlocks(): BlockHandle[] {
		return this._selection.getSelectedBlocks();
	}

	replaceSelection(content: string | Block[]): void {
		const sel = this._selection.getSelection();
		if (!sel) return;

		if (sel.type === "text") {
			const range = this._getSelectionRange(sel);
			if (range.isMultiBlock) {
				if (typeof content === "string") {
					this._replaceMultiBlockTextRange(range, content);
				}
				return;
			}

			const from = range.start.offset;
			const to = range.end.offset;
			const ops: DocumentOp[] = [];
			if (to > from) {
				ops.push({
					type: "delete-text",
					blockId: range.start.blockId,
					offset: from,
					length: to - from,
				});
			}
			if (typeof content === "string" && content.length > 0) {
				ops.push({
					type: "insert-text",
					blockId: range.start.blockId,
					offset: from,
					text: content,
				});
			}
			if (ops.length > 0) {
				this.apply(ops);
			}
			const nextOffset =
				typeof content === "string" ? from + content.length : from;
			this._collapseToPoint({
				blockId: range.start.blockId,
				offset: nextOffset,
			});
			return;
		}

		if (sel.type === "block" && sel.blockIds.length > 0) {
			const firstId = sel.blockIds[0];
			const firstIndex = this._pipeline._resolvePosition({
				before: firstId,
			});
			const ops: DocumentOp[] = [];

			for (const id of sel.blockIds) {
				ops.push({ type: "delete-block", blockId: id });
			}

			const insertPosition: Position =
				firstIndex === 0
					? "first"
					: {
							after: (
								this._doc.blockOrder as CRDTArray<string>
							).get(firstIndex - 1) as string,
						};

			if (typeof content === "string") {
				const newId = createGeneratedBlockId();
				ops.push({
					type: "insert-block",
					blockId: newId,
					blockType: "paragraph",
					props: {},
					position: insertPosition,
				});
				if (content.length > 0) {
					ops.push({
						type: "insert-text",
						blockId: newId,
						offset: 0,
						text: content,
					});
				}
			} else if (Array.isArray(content)) {
				let prevPosition = insertPosition;
				for (const block of content) {
					const newId = createGeneratedBlockId();
					ops.push({
						type: "insert-block",
						blockId: newId,
						blockType: block.type,
						props: block.props ?? {},
						position: prevPosition,
					});
					if (
						typeof block.content === "string" &&
						block.content.length > 0
					) {
						ops.push({
							type: "insert-text",
							blockId: newId,
							offset: 0,
							text: block.content,
						});
					}
					prevPosition = { after: newId };
				}
			}

			this.apply(ops);
		}
	}

	deleteSelection(options?: ApplyOptions): void {
		const sel = this._selection.getSelection();
		if (!sel) return;

		if (sel.type === "text") {
			const range = this._getSelectionRange(sel);
			if (range.isMultiBlock) {
				this._deleteMultiBlockTextRange(range, options);
				return;
			}

			if (
				!this._usesInlineTextSelection(range.start.blockId) &&
				this._isWholeBlockSelection(
					range.start.blockId,
					range.start.offset,
					range.end.offset,
				)
			) {
				this.apply(
					[
						{
							type: "delete-block",
							blockId: range.start.blockId,
						},
					],
					options,
				);
				this.setSelection(null);
				return;
			}

			const from = range.start.offset;
			const to = range.end.offset;
			if (to > from) {
				this.apply(
					[
						{
							type: "delete-text",
							blockId: range.start.blockId,
							offset: from,
							length: to - from,
						},
					],
					options,
				);
			}
			this._collapseToPoint({
				blockId: range.start.blockId,
				offset: from,
			});
			return;
		}

		if (sel.type === "block") {
			const ops: DocumentOp[] = sel.blockIds.map((id) => ({
				type: "delete-block" as const,
				blockId: id,
			}));
			this.apply(ops, options);
			this.setSelection(null);
		}

		if (sel.type === "cell") {
			const block = this.getBlock(sel.blockId);
			if (!block) return;
			const ops: DocumentOp[] = [];
			for (const rowCells of resolveCellSelectionMatrix(block, sel)) {
				for (const cellCoord of rowCells) {
					const cell = block.tableCell(cellCoord.row, cellCoord.col);
					if (!cell) continue;
					const len = cell.length();
					if (len > 0) {
						ops.push({
							type: "delete-table-cell-text",
							blockId: sel.blockId,
							row: cellCoord.row,
							col: cellCoord.col,
							offset: 0,
							length: len,
						} as DocumentOp);
					}
				}
			}
			if (ops.length > 0) {
				this.apply(ops, options);
			}
			this.setSelection({
				...sel,
				head: sel.anchor,
			});
		}
	}

	// ── Decorations ──────────────────────────────────────────

	requestDecorationUpdate(): void {
		const decoSet = this._refreshDecorations();
		this._emitter.emit("decorationsChange", decoSet.generation);
	}

	getDecorations(): DecorationSet {
		return this._decorations;
	}

	// ── Events ───────────────────────────────────────────────

	on<K extends keyof PenEventMap>(
		event: K,
		handler: PenEventMap[K],
	): Unsubscribe;
	on(event: string, handler: (...args: unknown[]) => void): Unsubscribe;
	on(event: string, handler: (...args: unknown[]) => void): Unsubscribe {
		return this._emitter.on(event, handler);
	}

	private _refreshDecorations(): DecorationSet {
		this._decorations = this._extensions.collectDecorations(
			this._documentState,
			this,
		);
		return this._decorations;
	}

	onDocumentCommit(callback: PenEventMap["documentCommit"]): Unsubscribe {
		return this.on("documentCommit", callback);
	}

	onSelectionChange(callback: PenEventMap["selectionChange"]): Unsubscribe {
		return this.on("selectionChange", callback);
	}

	onHistoryApplied(callback: PenEventMap["historyApplied"]): Unsubscribe {
		return this.on("historyApplied", callback);
	}

	// ── Extension State ──────────────────────────────────────

	getExtensionState<T>(name: string): T | undefined {
		return this._extensions.getExtensionState<T>(name);
	}

	// ── Normalization ────────────────────────────────────────

	normalizeAll(): void {
		this._engine.normalizeAll();
	}

	// ── Destroy ──────────────────────────────────────────────

	destroy(): void {
		if (this._isDestroyed) {
			return;
		}
		this._isDestroyed = true;
		this._queueExtensionLifecycle(async () => {
			await this._extensions.deactivateAll(this);
			this._teardownObservation();
			this._releaseSession?.();
			this._releaseSession = null;
			this._emitter.removeAllListeners();
		});
	}

	// ── Private ──────────────────────────────────────────────

	private _createPenDocument(crdtDoc: CRDTDocument): PenDocument {
		const wrapped = crdtDoc as CRDTDocument & { penDocument?: PenDocument };
		if (wrapped.penDocument) {
			return wrapped.penDocument;
		}

		const raw = this._adapter.raw<RawPenDocumentLike>(crdtDoc);
		const blockOrder =
			(raw.getArray ? raw.getArray("blockOrder") : raw.blockOrder) ??
			missingPenDocumentRoot("blockOrder");
		const blocks =
			(raw.getMap ? raw.getMap("blocks") : raw.blocks) ??
			missingPenDocumentRoot("blocks");
		const apps =
			(raw.getMap ? raw.getMap("apps") : raw.apps) ??
			missingPenDocumentRoot("apps");
		const metadata =
			(raw.getMap ? raw.getMap("metadata") : raw.metadata) ??
			missingPenDocumentRoot("metadata");
		return {
			blockOrder,
			blocks,
			apps,
			metadata,
			adapter: this._adapter,
		};
	}

	private _resolveExtensions(options: CreateEditorOptions): Extension[] {
		const without = new Set(options.without ?? []);
		if (without.size > 0 && !hasWarnedAboutWithoutOption) {
			hasWarnedAboutWithoutOption = true;
			console.warn(
				"Pen: createEditor({ without }) is deprecated. Prefer createEditor({ preset: defaultPreset(...) }) for default feature composition.",
			);
		}
		const defaultExtensions = options.preset?.resolve({
			schema: this._registry,
			documentProfile: this._documentProfile,
		}).extensions ?? [
			documentOpsExtension(),
			deltaStreamExtension(),
			undoExtension(),
			richTextShortcutsExtension(),
		];
		const defaults = defaultExtensions.filter(
			(ext) => !without.has(ext.name),
		);

		const userExtensions = options.extensions ?? [];
		return [...defaults, ...userExtensions];
	}

	private _installProfilePolicyHook(): void {
		this._pipeline.setFinalBeforeApplyHook((ops) =>
			this._enforceDocumentProfileBoundary(ops),
		);
	}

	private _enforceDocumentProfileBoundary(ops: DocumentOp[]): DocumentOp[] {
		const result = filterOpsForDocumentProfile(
			ops,
			this._documentProfile,
			this._registry,
		);

		for (const violation of result.violations) {
			this._emitter.emit("diagnostic", {
				code: "PEN_PROFILE_001",
				level: "warn",
				source: "profile-policy",
				message:
					`profile-policy: dropped ${violation.op.type} for disallowed ` +
					`block type "${violation.blockType}" in ${violation.documentProfile} documents`,
				remediation:
					"Use a block type allowed by the active documentProfile or " +
					"change the documentProfile before applying structural mutations.",
				op: violation.op,
				blockType: violation.blockType,
				documentProfile: violation.documentProfile,
			});
		}

		return result.ops;
	}

	private _refreshCoreSlots(): void {
		this._slots.set("core:engine", this._engine);
		this._slots.set(
			AWAIT_EXTENSION_LIFECYCLE_SLOT_KEY,
			() => this._extensionLifecycle,
		);
		this._slots.set(
			COLLECT_KEY_BINDINGS_SLOT_KEY,
			(registry: SchemaRegistry) =>
				this._extensions.collectKeyBindings(registry),
		);
	}

	private _bindSession(session: DocumentSession, scopeId?: string): void {
		this._bindScope(session, scopeId);
		this._releaseSession = session.attachEditor({
			onScopeReplaced: (event) => {
				this._handleScopeReplacement(session, event);
			},
		});
	}

	private _bindScope(session: DocumentSession, scopeId?: string): void {
		this._documentSession = session;
		const scope =
			(scopeId ? session.getScope(scopeId) : null) ?? session.rootScope;
		this._documentScope = scope;
		this._crdtDoc = scope.doc;
		this._doc = this._createPenDocument(scope.doc);
		this._awareness = session.getAwareness(scope.id);
	}

	private _handleScopeReplacement(
		session: DocumentSession,
		event: DocumentScopeReplacementEvent,
	): void {
		if (event.previousScope.id !== this._documentScope.id) {
			return;
		}
		this._queueExtensionLifecycle(async () => {
			await this._extensions.deactivateAll(this);
			if (this._isDestroyed) {
				return;
			}
			this._teardownObservation();
			this._bindScope(session, event.scope.id);
			await this._rebindActiveScope();
		});
	}

	private _resolveDocumentProfile(
		requestedProfile?: DocumentProfile,
	): DocumentProfile {
		const persistedProfile =
			this._adapter.getDocumentProfile?.(this._crdtDoc) ?? null;
		const resolvedProfile =
			persistedProfile ?? requestedProfile ?? "structured";
		if (persistedProfile == null) {
			this._adapter.setDocumentProfile?.(this._crdtDoc, resolvedProfile);
		}
		return resolvedProfile;
	}

	private async _rebindActiveScope(): Promise<void> {
		this._documentProfile = this._resolveDocumentProfile();
		this._editorViewMode =
			this._explicitEditorViewMode ?? this._documentProfile;
		this._clientId = this._adapter.getClientId(this._crdtDoc);

		this._engine = new SchemaEngineImpl(
			this._registry,
			this._doc,
			this._crdtDoc,
		);
		this._selection.updateDocument(this._doc, this._crdtDoc);
		this._pipeline.updateDocument(this._doc, this._crdtDoc, this._engine);
		this._documentState.updateDocument(
			this._doc,
			this._crdtDoc,
			this._documentProfile,
		);
		this._pipeline._init((event) => {
			this._dispatchCRDTEvent(event);
		});
		this._refreshCoreSlots();

		this._wireObservation();
		await this._activateExtensions();
		this._engine.normalizeAll();
		this._refreshDecorations();
	}

	private _refreshUndoManager(): void {
		const slotUndo = this._slots.get("undo:manager") as
			| UndoManager
			| undefined;
		(this as { undoManager: UndoManager }).undoManager =
			slotUndo ?? NOOP_UNDO;
	}

	private async _activateExtensions(): Promise<void> {
		const activation = this._extensions.activateAll(this);
		this._refreshUndoManager();
		await activation;
		this._refreshUndoManager();
	}

	private _queueExtensionLifecycle(task: () => Promise<void>): void {
		const runTask = async (): Promise<void> => {
			try {
				await task();
			} catch (error) {
				if (this._isDestroyed) {
					return;
				}
				this._emitter.emit("diagnostic", {
					code: "PEN_EXT_006",
					level: "error",
					source: "extension",
					message: "Editor extension lifecycle transition failed",
					remediation:
						"Inspect async extension activate/deactivate hooks involved in document reload or scope replacement and ensure they resolve safely.",
					error,
				});
			}
		};

		this._extensionLifecycle = this._extensionLifecycle.then(
			runTask,
			runTask,
		);
	}

	private _ensureInitialParagraph(): void {
		if (this._doc.blockOrder.length > 0) {
			return;
		}

		this.apply(
			[
				{
					type: "insert-block",
					blockId: createGeneratedBlockId(),
					blockType: "paragraph",
					props: {},
					position: "last",
				},
			],
			{ origin: "system" },
		);
	}

	private _createCommitEvent(event: CRDTEvent): DocumentCommitEvent {
		const blockRevisions: Record<string, number> = {};
		for (const blockId of event.affectedBlocks) {
			const nextRevision = (this._blockRevisions.get(blockId) ?? 0) + 1;
			this._blockRevisions.set(blockId, nextRevision);
			blockRevisions[blockId] = nextRevision;
		}
		this._commitId += 1;
		return {
			commitId: this._commitId,
			ops: event.ops,
			origin: event.origin,
			affectedBlocks: [...event.affectedBlocks],
			blockRevisions,
			scope: this._documentScope,
		};
	}

	private _dispatchCRDTEvent(event: CRDTEvent): void {
		this._syncDocumentProfileFromStorage();
		const commitEvent = this._createCommitEvent(event);
		this._documentState.incrementalUpdate(event.affectedBlocks);
		this._extensions.dispatchObserve([event], this);
		const previousDecorationGeneration = this._decorations.generation;
		const nextDecorations = this._refreshDecorations();
		if (nextDecorations.generation !== previousDecorationGeneration) {
			this._emitter.emit("decorationsChange", nextDecorations.generation);
		}
		this._emitter.emit("change", [event]);
		this._emitter.emit("documentCommit", commitEvent);
	}

	private _syncDocumentProfileFromStorage(): void {
		const persistedProfile =
			this._adapter.getDocumentProfile?.(this._crdtDoc) ?? null;
		if (!persistedProfile || persistedProfile === this._documentProfile) {
			return;
		}

		this._documentProfile = persistedProfile;
		if (this._explicitEditorViewMode == null) {
			this._editorViewMode = persistedProfile;
		}
		this._documentState.setDocumentProfile(persistedProfile);
	}

	private _wireObservation(): void {
		if (this._documentSession) {
			this._unsubObserve = this._documentSession.observe(
				this._documentScope.id,
				(event: CRDTEvent) => {
					if (this._pipeline.suppressObserver) return;
					this._dispatchCRDTEvent(event);
				},
			);
			return;
		}

		this._unsubObserve = this._adapter.observe(
			this._crdtDoc,
			(event: CRDTEvent) => {
				if (this._pipeline.suppressObserver) return;
				this._dispatchCRDTEvent(event);
			},
		);
	}

	private _teardownObservation(): void {
		if (this._unsubObserve) {
			this._unsubObserve();
			this._unsubObserve = null;
		}
	}

	private _getTextForBlock(blockId: string): string {
		return this.getBlock(blockId)?.textContent() ?? "";
	}

	private _getSelectionRange(sel: TextSelection): DocumentRange {
		return sel.toRange();
	}

	private _usesInlineTextSelection(blockId: string): boolean {
		const block = this.getBlock(blockId);
		if (!block) {
			return false;
		}

		const schema = this._registry.resolve(block.type);
		if (!schema) {
			return false;
		}

		return usesInlineTextSelection(schema);
	}

	private _getBlockSelectionSpan(blockId: string): number {
		if (this._usesInlineTextSelection(blockId)) {
			return this._getTextForBlock(blockId).length;
		}
		return this.getBlock(blockId) ? 1 : 0;
	}

	private _isWholeBlockSelection(
		blockId: string,
		startOffset: number,
		endOffset: number,
	): boolean {
		const span = this._getBlockSelectionSpan(blockId);
		if (span <= 0) {
			return false;
		}
		return startOffset <= 0 && endOffset >= span;
	}

	private _collapseToPoint(point: { blockId: string; offset: number }): void {
		this.selectTextRange(point, point);
	}

	private _sliceInlineDeltas(
		blockId: string,
		startOffset: number,
	): Array<{ insert: string; attributes?: Record<string, unknown> }> {
		const handle = this.getBlock(blockId);
		if (!handle) {
			return [];
		}

		const deltas = handle
			.textDeltas()
			.filter((delta) => delta.insert !== "\u200B");
		const sliced: Array<{
			insert: string;
			attributes?: Record<string, unknown>;
		}> = [];
		let offset = 0;

		for (const delta of deltas) {
			const length = delta.insert.length;
			if (startOffset >= offset + length) {
				offset += length;
				continue;
			}

			const localStart = Math.max(0, startOffset - offset);
			const text = delta.insert.slice(localStart);
			if (text.length > 0) {
				sliced.push({
					insert: text,
					...(delta.attributes
						? { attributes: delta.attributes }
						: {}),
				});
			}
			offset += length;
		}

		return sliced;
	}

	private _buildMultiBlockTextReplacement(
		range: DocumentRange,
		insertedText: string,
	): { ops: DocumentOp[]; caret: { blockId: string; offset: number } } {
		const startId = range.start.blockId;
		const endId = range.end.blockId;
		const startText = this._getTextForBlock(startId);
		const middleIds = range.blockRange.slice(1, -1);
		const suffixDeltas = this._sliceInlineDeltas(endId, range.end.offset);
		const ops: DocumentOp[] = [];

		if (range.start.offset < startText.length) {
			ops.push({
				type: "delete-text",
				blockId: startId,
				offset: range.start.offset,
				length: startText.length - range.start.offset,
			});
		}

		if (range.end.offset > 0) {
			ops.push({
				type: "delete-text",
				blockId: endId,
				offset: 0,
				length: range.end.offset,
			});
		}

		for (const blockId of middleIds) {
			ops.push({
				type: "delete-block",
				blockId,
			});
		}

		let insertionOffset = range.start.offset;
		if (insertedText.length > 0) {
			ops.push({
				type: "insert-text",
				blockId: startId,
				offset: insertionOffset,
				text: insertedText,
			});
			insertionOffset += insertedText.length;
		}

		for (const delta of suffixDeltas) {
			ops.push({
				type: "insert-text",
				blockId: startId,
				offset: insertionOffset,
				text: delta.insert,
				marks: delta.attributes,
			});
			insertionOffset += delta.insert.length;
		}

		ops.push({
			type: "delete-block",
			blockId: endId,
		});

		return {
			ops,
			caret: {
				blockId: startId,
				offset: range.start.offset + insertedText.length,
			},
		};
	}

	private _deleteMultiBlockTextRange(
		range: DocumentRange,
		options?: ApplyOptions,
	): { blockId: string; offset: number } | null {
		const startId = range.start.blockId;
		const endId = range.end.blockId;
		if (startId === endId) {
			const from = range.start.offset;
			const to = range.end.offset;
			if (to > from) {
				this.apply(
					[
						{
							type: "delete-text",
							blockId: startId,
							offset: from,
							length: to - from,
						},
					],
					options,
				);
			}
			const caret = { blockId: startId, offset: from };
			this._collapseToPoint(caret);
			return caret;
		}

		const startInline = this._usesInlineTextSelection(startId);
		const endInline = this._usesInlineTextSelection(endId);
		if (startInline && endInline) {
			const { ops, caret } = this._buildMultiBlockTextReplacement(
				range,
				"",
			);
			this.apply(ops, options);
			this._collapseToPoint(caret);
			return caret;
		}

		const middleIds = range.blockRange.slice(1, -1);
		const ops: DocumentOp[] = [];

		if (startInline) {
			const startText = this._getTextForBlock(startId);
			if (range.start.offset < startText.length) {
				ops.push({
					type: "delete-text",
					blockId: startId,
					offset: range.start.offset,
					length: startText.length - range.start.offset,
				});
			}
		} else if (
			this._isWholeBlockSelection(
				startId,
				range.start.offset,
				this._getBlockSelectionSpan(startId),
			)
		) {
			ops.push({
				type: "delete-block",
				blockId: startId,
			});
		}

		for (const blockId of middleIds) {
			ops.push({
				type: "delete-block",
				blockId,
			});
		}

		if (endInline) {
			if (range.end.offset > 0) {
				ops.push({
					type: "delete-text",
					blockId: endId,
					offset: 0,
					length: range.end.offset,
				});
			}
		} else if (this._isWholeBlockSelection(endId, 0, range.end.offset)) {
			ops.push({
				type: "delete-block",
				blockId: endId,
			});
		}

		if (ops.length > 0) {
			this.apply(ops, options);
		}

		const caret = startInline
			? { blockId: startId, offset: range.start.offset }
			: endInline
				? { blockId: endId, offset: 0 }
				: null;
		if (caret) {
			this._collapseToPoint(caret);
		} else {
			this.setSelection(null);
		}
		return caret;
	}

	private _replaceMultiBlockTextRange(
		range: DocumentRange,
		text: string,
	): { blockId: string; offset: number } {
		const { ops, caret } = this._buildMultiBlockTextReplacement(
			range,
			text,
		);
		this.apply(ops);
		this._collapseToPoint(caret);
		return caret;
	}
}

export function createEditor(options?: CreateEditorOptions): Editor {
	return new EditorImpl(options);
}

const headlessPreset = {
	resolve() {
		return { extensions: [] };
	},
};

export interface CreateHeadlessEditorOptions extends CreateEditorOptions {
	/**
	 * Headless server/workflow editors default to the core apply pipeline only.
	 * Enable default extensions when a host explicitly needs undo, shortcuts, or
	 * delta stream behavior in a non-rendered environment.
	 */
	useDefaultExtensions?: boolean;
}

export function createHeadlessEditor(
	options: CreateHeadlessEditorOptions = {},
): Editor {
	const { useDefaultExtensions = false, ...editorOptions } = options;
	return createEditor({
		...editorOptions,
		preset:
			editorOptions.preset ??
			(useDefaultExtensions ? undefined : headlessPreset),
	});
}
