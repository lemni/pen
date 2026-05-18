import type {
	DocumentOp,
	OpOrigin,
	PenDocument,
	CRDTDocument,
	CRDTAdapter,
	CRDTEvent,
	SchemaRegistry,
	CRDTMap,
	CRDTArray,
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
	SetMetaOp,
	CreateAppOp,
	UpdateAppOp,
	DeleteAppOp,
	SetSelectionOp,
	UpdateTableColumnsOp,
} from "@pen/types";
import { generateId, getOpOriginType } from "@pen/types";
import { resolveRuntimeContentType } from "../schema/contentType";
import type { SchemaEngineImpl } from "../schema/normalize";
import {
	type CRDTUnknownArray,
	type CRDTUnknownMap,
	getArrayProp,
	getMapProp,
	getStringProp,
	getTableColumns,
	getTableContent,
	isCRDTMap,
} from "./crdtShapes";
import { DatabaseOpExecutor } from "./databaseOpExecutor";
import type { EventEmitter } from "./events";
import type { SelectionManagerImpl } from "./selection";
import { TableGridExecutor } from "./tableGridExecutor";

// Typed CRDT structure interfaces used by the op executor.
type CRDTBlockMap = CRDTMap<CRDTMap<unknown>>;
type MutableMap = CRDTUnknownMap & { delete(key: string): void };
type MutableBlockStore = MutableMap & {
	get(key: string): CRDTUnknownMap | undefined;
};
type MutableAppStore = MutableMap & {
	get(key: string): CRDTUnknownMap | undefined;
};
type MutableStringArray = CRDTUnknownArray<string>;

interface CRDTInlineText extends CRDTText {
	insertEmbed(offset: number, value: Record<string, unknown>): void;
}

interface CRDTText {
	insert(
		offset: number,
		text: string,
		attributes?: Record<string, unknown | null>,
	): void;
	delete(offset: number, length: number): void;
	format(
		offset: number,
		length: number,
		attributes: Record<string, unknown>,
	): void;
	toDelta(): Array<{
		insert: string | object;
		attributes?: Record<string, unknown>;
	}>;
	toString(): string;
	readonly length: number;
}

const ZERO_WIDTH_SPACE = "\u200B";

export class ApplyPipeline {
	private _doc: PenDocument;
	private _crdtDoc: CRDTDocument;
	private readonly _adapter: CRDTAdapter;
	private readonly _registry: SchemaRegistry;
	private readonly _tableGrid: TableGridExecutor;
	private readonly _databaseOps: DatabaseOpExecutor;
	private _engine: SchemaEngineImpl;
	private readonly _emitter: EventEmitter;
	private readonly _selection: SelectionManagerImpl;
	private _onDidApply: ((event: CRDTEvent) => void) | null = null;
	private _applying = false;
	private _suppressObserver = false;
	private readonly _queue: { ops: DocumentOp[]; origin: OpOrigin }[] = [];
	private _applyBoundaryHooks: Array<
		(event: {
			phase: "before" | "after";
			ops: readonly DocumentOp[];
			origin: OpOrigin;
			applied: boolean;
		}) => void
	> = [];
	private _beforeApplyHooks: Array<{
		hook: (
			ops: DocumentOp[],
			options: { origin?: OpOrigin },
		) => DocumentOp[];
		priority: number;
	}> = [];
	private _finalBeforeApplyHook:
		| ((ops: DocumentOp[], options: { origin?: OpOrigin }) => DocumentOp[])
		| null = null;

	get suppressObserver(): boolean {
		return this._suppressObserver;
	}

	private get blocks(): CRDTBlockMap {
		return this._doc.blocks as CRDTBlockMap;
	}

	private get mutableBlocks(): MutableBlockStore {
		return this._doc.blocks as unknown as MutableBlockStore;
	}

	private get blockOrder(): CRDTArray<string> {
		return this._doc.blockOrder as CRDTArray<string>;
	}

	private get mutableBlockOrder(): MutableStringArray {
		return this._doc.blockOrder as unknown as MutableStringArray;
	}

	private get apps(): CRDTMap<CRDTMap<unknown>> {
		return this._doc.apps as CRDTMap<CRDTMap<unknown>>;
	}

	private get mutableApps(): MutableAppStore {
		return this._doc.apps as unknown as MutableAppStore;
	}

	constructor(
		doc: PenDocument,
		crdtDoc: CRDTDocument,
		adapter: CRDTAdapter,
		registry: SchemaRegistry,
		engine: SchemaEngineImpl,
		emitter: EventEmitter,
		selection: SelectionManagerImpl,
	) {
		this._doc = doc;
		this._crdtDoc = crdtDoc;
		this._adapter = adapter;
		this._registry = registry;
		this._tableGrid = new TableGridExecutor(adapter);
		this._databaseOps = new DatabaseOpExecutor(adapter, this._tableGrid);
		this._engine = engine;
		this._emitter = emitter;
		this._selection = selection;
	}

	/** Called after EditorImpl construction to wire circular refs. */
	_init(onDidApply?: (event: CRDTEvent) => void): void {
		this._onDidApply = onDidApply ?? null;
	}

	// ── Before-Apply Hooks ───────────────────────────────────

	addBeforeApplyHook(
		hook: (
			ops: DocumentOp[],
			options: { origin?: OpOrigin },
		) => DocumentOp[],
		priority: number,
	): () => void {
		const entry = { hook, priority };
		this._beforeApplyHooks.push(entry);
		this._beforeApplyHooks.sort((a, b) => a.priority - b.priority);
		return () => {
			const idx = this._beforeApplyHooks.indexOf(entry);
			if (idx >= 0) this._beforeApplyHooks.splice(idx, 1);
		};
	}

	addApplyBoundaryHook(
		hook: (event: {
			phase: "before" | "after";
			ops: readonly DocumentOp[];
			origin: OpOrigin;
			applied: boolean;
		}) => void,
	): () => void {
		this._applyBoundaryHooks.push(hook);
		return () => {
			const idx = this._applyBoundaryHooks.indexOf(hook);
			if (idx >= 0) this._applyBoundaryHooks.splice(idx, 1);
		};
	}

	setFinalBeforeApplyHook(
		hook:
			| ((
					ops: DocumentOp[],
					options: { origin?: OpOrigin },
			  ) => DocumentOp[])
			| null,
	): void {
		this._finalBeforeApplyHook = hook;
	}

	// ── Apply ────────────────────────────────────────────────

	apply(ops: DocumentOp[], origin: OpOrigin): void {
		this._applyInternal(ops, origin);
	}

	private _applyInternal(ops: DocumentOp[], origin: OpOrigin): void {
		if (this._applying) {
			this._queue.push({ ops, origin });
			return;
		}

		this._applying = true;
		try {
			this._executeOps(ops, origin);
			while (this._queue.length > 0) {
				const { ops: queued, origin: queuedOrigin } =
					this._queue.shift()!;
				this._executeOps(queued, queuedOrigin);
			}
		} finally {
			this._applying = false;
		}
	}

	// ── Core Pipeline ────────────────────────────────────────

	private _executeOps(ops: DocumentOp[], origin: OpOrigin): void {
		// Let extensions transform ops before validation and execution.
		let transformedOps = ops;
		for (const { hook } of this._beforeApplyHooks) {
			try {
				transformedOps = hook(transformedOps, { origin });
			} catch (err) {
				this._emitter.emit("diagnostic", {
					code: "PEN_APPLY_005",
					level: "error",
					source: "apply",
					message: "onBeforeApply hook threw",
					remediation:
						"Update the onBeforeApply hook to handle incoming ops defensively and " +
						"always return a valid DocumentOp array.",
					error: err,
				});
			}
		}
		if (this._finalBeforeApplyHook) {
			try {
				transformedOps = this._finalBeforeApplyHook(transformedOps, {
					origin,
				});
			} catch (err) {
				this._emitter.emit("diagnostic", {
					code: "PEN_APPLY_007",
					level: "error",
					source: "apply",
					message: "final apply boundary hook threw",
					remediation:
						"Update the final apply boundary hook to handle incoming ops defensively and " +
						"always return a valid DocumentOp array.",
					error: err,
				});
			}
		}

		this._emitApplyBoundary({
			phase: "before",
			ops: transformedOps,
			origin,
			applied: false,
		});

		const affectedBlocks: string[] = [];
		const validatedOps: DocumentOp[] = [];
		const pendingBlockIds = new Set<string>();

		for (const op of transformedOps) {
			const blockId = this._opBlockId(op);

			if (!this._validateOp(op)) continue;

			if (op.type === "insert-block") {
				pendingBlockIds.add(op.blockId);
			}

			if (
				blockId &&
				!this._blockExists(blockId) &&
				!pendingBlockIds.has(blockId) &&
				op.type !== "insert-block"
			) {
				this._emitter.emit("diagnostic", {
					code: "PEN_APPLY_003",
					level: "warn",
					source: "apply",
					message: `apply: skipping ${op.type} for non-existent block "${blockId}"`,
				});
				continue;
			}

			validatedOps.push(op);
		}

		if (validatedOps.length === 0) {
			this._emitApplyBoundary({
				phase: "after",
				ops: transformedOps,
				origin,
				applied: false,
			});
			return;
		}

		this._suppressObserver = true;

		try {
			this._adapter.transact(
				this._crdtDoc,
				() => {
					for (const op of validatedOps) {
						const affected = this._executeSingleOp(op);
						affectedBlocks.push(...affected);
					}

					for (const blockId of affectedBlocks) {
						this._engine.markDirty(blockId);
					}

					this._engine.normalizeDirty();
				},
				getOpOriginType(origin),
			);
		} finally {
			this._suppressObserver = false;
		}

		const event: CRDTEvent = {
			origin,
			affectedBlocks: [...new Set(affectedBlocks)],
			ops: validatedOps,
			timestamp: Date.now(),
		};

		this._onDidApply?.(event);
		this._emitApplyBoundary({
			phase: "after",
			ops: validatedOps,
			origin,
			applied: true,
		});
	}

	private _emitApplyBoundary(event: {
		phase: "before" | "after";
		ops: readonly DocumentOp[];
		origin: OpOrigin;
		applied: boolean;
	}): void {
		for (const hook of this._applyBoundaryHooks) {
			try {
				hook(event);
			} catch (err) {
				this._emitter.emit("diagnostic", {
					code: "PEN_APPLY_008",
					level: "error",
					source: "apply",
					message: "apply boundary hook threw",
					remediation:
						"Update the apply boundary hook to avoid throwing during transaction lifecycle notifications.",
					error: err,
				});
			}
		}
	}

	// ── Schema Validation ────────────────────────────────────

	private _validateOp(op: DocumentOp): boolean {
		switch (op.type) {
			case "insert-block": {
				const schema = this._registry.resolve(op.blockType);
				if (!schema) {
					this._emitter.emit("diagnostic", {
						code: "PEN_APPLY_002",
						level: "warn",
						source: "apply",
						message: `Unknown block type: "${op.blockType}"`,
						op,
					});
					return false;
				}
				return true;
			}
			case "convert-block": {
				const schema = this._registry.resolve(op.newType);
				if (!schema) {
					this._emitter.emit("diagnostic", {
						code: "PEN_APPLY_002",
						level: "warn",
						source: "apply",
						message: `Unknown block type: "${op.newType}"`,
						op,
					});
					return false;
				}
				return true;
			}
			case "insert-inline-node": {
				const schema = this._registry.resolveInline(op.nodeType);
				if (!schema || schema.kind !== "node") {
					this._emitter.emit("diagnostic", {
						code: "PEN_APPLY_002",
						level: "warn",
						source: "apply",
						message: `Unknown inline node type: "${op.nodeType}"`,
						op,
					});
					return false;
				}
				return true;
			}
			default:
				return true;
		}
	}

	// ── Position Resolution ──────────────────────────────────

	_resolvePosition(position: import("@pen/types").Position): number {
		const blockOrder = this._doc.blockOrder;

		if (position === "first") return 0;
		if (position === "last") return blockOrder.length;

		if (typeof position === "object" && "after" in position) {
			for (let i = 0; i < blockOrder.length; i++) {
				if ((blockOrder.get(i) as string) === position.after)
					return i + 1;
			}
			return blockOrder.length;
		}

		if (typeof position === "object" && "before" in position) {
			for (let i = 0; i < blockOrder.length; i++) {
				if ((blockOrder.get(i) as string) === position.before) return i;
			}
			return 0;
		}

		if (typeof position === "object" && "parent" in position) {
			const parentMap = this.blocks.get(position.parent);
			if (!parentMap) return blockOrder.length;
			const children = parentMap.get("children") as
				| CRDTArray<string>
				| undefined;
			if (!children) return 0;
			return Math.min(position.index, children.length);
		}

		return blockOrder.length;
	}

	// ── Op Dispatch ──────────────────────────────────────────

	private _executeSingleOp(op: DocumentOp): string[] {
		switch (op.type) {
			case "insert-block":
				return this._insertBlock(op);
			case "update-block":
				return this._updateBlock(op);
			case "delete-block":
				return this._deleteBlock(op);
			case "move-block":
				return this._moveBlock(op);
			case "convert-block":
				return this._convertBlock(op);
			case "split-block":
				return this._splitBlock(op);
			case "merge-blocks":
				return this._mergeBlocks(op);
			case "insert-text":
				return this._insertText(op);
			case "delete-text":
				return this._deleteText(op);
			case "format-text":
				return this._formatText(op);
			case "replace-text":
				return this._replaceText(op);
			case "insert-inline-node":
				return this._insertInlineNode(op);
			case "remove-inline-node":
				return this._removeInlineNode(op);
			case "set-selection":
				return this._setSelection(op);
			case "update-layout":
				return this._updateLayout(op);
			case "create-app":
				return this._createApp(op);
			case "update-app":
				return this._updateApp(op);
			case "delete-app":
				return this._deleteApp(op);
			case "insert-table-row":
			case "delete-table-row":
			case "insert-table-column":
			case "delete-table-column":
			case "merge-table-cells":
			case "split-table-cell":
			case "insert-table-cell-text":
			case "delete-table-cell-text":
			case "format-table-cell-text":
			case "update-table-columns":
				return this._tableOp(op);
			case "database-add-column":
			case "database-update-column":
			case "database-convert-column":
			case "database-remove-column":
			case "database-insert-row":
			case "database-update-cell":
			case "database-delete-row":
			case "database-delete-rows":
			case "database-duplicate-row":
			case "database-move-row":
			case "database-add-view":
			case "database-update-view":
			case "database-remove-view":
			case "database-set-active-view":
			case "database-update-select-options":
				return this._databaseOp(op);
			case "set-meta":
				return this._setMeta(op);
			default:
				return [];
		}
	}

	// ── Block Ops ────────────────────────────────────────────

	private _insertBlock(op: InsertBlockOp): string[] {
		const schema = this._registry.resolve(op.blockType);
		if (!schema) return [];

		const contentType = resolveRuntimeContentType(schema);
		const blockMap = this._adapter.initBlockMap(
			this._crdtDoc,
			op.blockId,
			op.blockType,
			contentType,
		) as MutableMap;

		if (op.props && Object.keys(op.props).length > 0) {
			const propsMap = this._getOrCreateMapProp(blockMap, "props");
			for (const [key, value] of Object.entries(op.props)) {
				propsMap.set(key, value);
			}
		}

		if ((schema as { content: unknown }).content === "subdocument") {
			const propsMap = this._getOrCreateMapProp(blockMap, "props");
			const subdocument = blockMap.get("subdocument") as
				| { guid?: unknown }
				| undefined;
			if (
				subdocument &&
				typeof subdocument === "object" &&
				typeof subdocument.guid === "string"
			) {
				propsMap.set("subdocumentGuid", subdocument.guid);
			}
		}

		if (typeof op.position === "object" && "parent" in op.position) {
			const parentMap = this._getMutableBlockMap(op.position.parent);
			if (parentMap) {
				const children = this._getOrCreateStringArrayProp(
					parentMap,
					"children",
				);
				const idx = Math.min(op.position.index, children.length);
				children.insert(idx, [op.blockId]);
			}
		} else {
			const idx = this._resolvePosition(op.position);
			this.mutableBlockOrder.insert(idx, [op.blockId]);
		}

		if ((schema as { content: unknown }).content === "database") {
			this._databaseOps.seedDatabaseBlock(blockMap);
		}

		return [op.blockId];
	}

	private _updateBlock(op: UpdateBlockOp): string[] {
		const blockMap = this._getMutableBlockMap(op.blockId);
		if (!blockMap) return [];

		const propsMap = this._getOrCreateMapProp(blockMap, "props");

		for (const [key, value] of Object.entries(op.props)) {
			if (value === undefined || value === null) {
				propsMap.delete(key);
			} else {
				propsMap.set(key, value);
			}
		}

		return [op.blockId];
	}

	private _deleteBlock(op: DeleteBlockOp): string[] {
		this.mutableBlocks.delete(op.blockId);
		this._removeBlockIdFromArray(this.mutableBlockOrder, op.blockId);
		this._removeBlockIdFromAllChildren(op.blockId);

		return [op.blockId];
	}

	private _moveBlock(op: MoveBlockOp): string[] {
		this._removeBlockIdFromArray(this.mutableBlockOrder, op.blockId, true);
		this._removeBlockIdFromAllChildren(op.blockId);

		// Insert at new position
		if (typeof op.position === "object" && "parent" in op.position) {
			const parentMap = this._getMutableBlockMap(op.position.parent);
			if (parentMap) {
				const children = this._getOrCreateStringArrayProp(
					parentMap,
					"children",
				);
				const idx = Math.min(op.position.index, children.length);
				children.insert(idx, [op.blockId]);
			}
		} else {
			const idx = this._resolvePosition(op.position);
			this.mutableBlockOrder.insert(idx, [op.blockId]);
		}

		return [op.blockId];
	}

	private _convertBlock(op: ConvertBlockOp): string[] {
		const blockMap = this._getMutableBlockMap(op.blockId);
		if (!blockMap) return [];

		const oldType = blockMap.get("type") as string;
		const oldSchema = this._registry.resolve(oldType);
		const newSchema = this._registry.resolve(op.newType);
		if (!newSchema) return [];

		blockMap.set("type", op.newType);

		const propsMap = getMapProp(blockMap, "props");
		if (propsMap) {
			const mutablePropsMap = propsMap as MutableMap;
			const newPropKeys = new Set(
				Object.keys(newSchema.propSchema ?? {}),
			);
			for (const key of [...(mutablePropsMap.keys?.() ?? [])]) {
				if (!newPropKeys.has(key)) {
					mutablePropsMap.delete(key);
				}
			}
		}

		if (op.newProps) {
			const props = this._getOrCreateMapProp(blockMap, "props");
			for (const [key, value] of Object.entries(op.newProps)) {
				props.set(key, value);
			}
		}

		const oldContent = oldSchema?.content;
		const newContent = newSchema.content;
		const preservedInlineDeltas =
			oldContent === "inline"
				? this._getPreservedInlineDeltas(this._getTextContent(blockMap))
				: [];

		if (oldContent === "inline" && newContent !== "inline") {
			if (
				newContent === "none" ||
				newContent === "table" ||
				Array.isArray(newContent)
			) {
				blockMap.delete("content");
			}
		} else if (oldContent !== "inline" && newContent === "inline") {
			const ytext = this._adapter.createText();
			blockMap.set("content", ytext);
		}

		const targetContent = resolveRuntimeContentType(newSchema);
		if (targetContent !== "database") {
			this._clearDatabaseState(blockMap);
		}
		if (targetContent === "table") {
			blockMap.delete("tableColumns");
		} else if (targetContent !== "database") {
			this._clearTableState(blockMap);
		}

		if (targetContent === "table" && !getTableContent(blockMap)) {
			this._tableGrid.seedTableBlock(blockMap, {
				rowCount: 2,
				colCount: 2,
				preservedInlineDeltas,
			});
		}

		if (targetContent === "database") {
			if (oldType === "table") {
				this._migrateTableToDatabase(blockMap, propsMap);
			}
			this._databaseOps.seedDatabaseBlock(blockMap);
		}

		return [op.blockId];
	}

	private _migrateTableToDatabase(
		blockMap: MutableMap,
		propsMap: CRDTUnknownMap | null,
	): void {
		const tableContent = getTableContent(blockMap);
		if (!tableContent) {
			return;
		}

		const hasHeaderRow = propsMap?.get("hasHeaderRow") !== false;
		const existingColumns = getTableColumns(blockMap);
		if (!existingColumns || existingColumns.length === 0) {
			const columnCount =
				this._tableGrid.resolveGridColumnCount(blockMap);
			const columns = Array.from({ length: columnCount }, (_, index) => {
				const title =
					hasHeaderRow && tableContent.length > 0
						? this._tableGrid
								.readTableCellText(
									tableContent.get(0) as CRDTUnknownMap,
									index,
								)
								.trim() || `Column ${index + 1}`
						: `Column ${index + 1}`;
				return {
					id: `column-${index + 1}`,
					title,
					type: "text" as const,
				};
			});
			if (columns.length > 0) {
				this._tableGrid.setStructuredTableColumns(blockMap, columns);
			}
		}

		if (hasHeaderRow && tableContent.length > 0) {
			tableContent.delete(0, 1);
		}

		for (let rowIndex = 0; rowIndex < tableContent.length; rowIndex++) {
			const row = tableContent.get(rowIndex);
			if (!row || !isCRDTMap(row)) {
				continue;
			}
			if (!getStringProp(row, "id")) {
				row.set("id", generateId());
			}
		}
	}

	private _splitBlock(op: SplitBlockOp): string[] {
		const blockMap = this._getMutableBlockMap(op.blockId);
		if (!blockMap) return [];

		const content = this._getTextContent(blockMap);
		if (!content) return [];

		const oldType = blockMap.get("type") as string;
		const newType = op.newBlockType ?? oldType;
		const schema = this._registry.resolve(newType);

		const deltas = content.toDelta();
		const tailDeltas: Array<{
			insert: string | object;
			attributes?: Record<string, unknown>;
		}> = [];
		let pos = 0;

		for (const delta of deltas) {
			const len =
				typeof delta.insert === "string" ? delta.insert.length : 1;
			if (pos + len <= op.offset) {
				pos += len;
				continue;
			}

			if (pos < op.offset) {
				const splitAt = op.offset - pos;
				const tailText = (delta.insert as string).slice(splitAt);
				if (tailText) {
					tailDeltas.push({
						insert: tailText,
						attributes: delta.attributes,
					});
				}
			} else {
				tailDeltas.push(delta);
			}
			pos += len;
		}

		const totalLength = content.length;
		if (op.offset < totalLength) {
			content.delete(op.offset, totalLength - op.offset);
		}

		// Initialize the new block through the adapter so shared CRDT state stays consistent.
		const contentType = resolveRuntimeContentType(schema);
		const newBlockMap = this._adapter.initBlockMap(
			this._crdtDoc,
			op.newBlockId,
			newType,
			contentType,
		) as MutableMap;

		const newContent = this._getTextContent(newBlockMap);
		if (newContent) {
			for (const delta of tailDeltas) {
				newContent.insert(
					newContent.length,
					delta.insert as string,
					delta.attributes,
				);
			}
		}

		// Copy parentId if present
		const propsMap = getMapProp(blockMap, "props");
		if (propsMap?.get?.("parentId")) {
			const newProps = getMapProp(newBlockMap, "props");
			if (newProps) {
				newProps.set("parentId", propsMap.get("parentId"));
			}
		}

		// Insert new block right after original in blockOrder
		for (let i = 0; i < this.blockOrder.length; i++) {
			if (this.blockOrder.get(i) === op.blockId) {
				this.mutableBlockOrder.insert(i + 1, [op.newBlockId]);
				break;
			}
		}

		return [op.blockId, op.newBlockId];
	}

	private _mergeBlocks(op: MergeBlocksOp): string[] {
		const targetMap = this._getMutableBlockMap(op.targetBlockId);
		const sourceMap = this._getMutableBlockMap(op.sourceBlockId);
		if (!targetMap || !sourceMap) return [];

		const targetContent = this._getTextContent(targetMap);
		const sourceContent = this._getTextContent(sourceMap);

		if (
			targetContent &&
			sourceContent &&
			typeof sourceContent.toDelta === "function"
		) {
			if (
				targetContent.length === 1 &&
				targetContent.toString() === ZERO_WIDTH_SPACE
			) {
				targetContent.delete(0, 1);
			}

			const deltas = sourceContent.toDelta();
			for (const delta of deltas) {
				if (
					typeof delta.insert === "string" &&
					delta.insert === ZERO_WIDTH_SPACE
				) {
					continue;
				}
				targetContent.insert(
					targetContent.length,
					delta.insert as string,
					delta.attributes,
				);
			}

			while (targetContent.length > 1) {
				const placeholderOffset = targetContent
					.toString()
					.indexOf(ZERO_WIDTH_SPACE);
				if (placeholderOffset < 0) break;
				targetContent.delete(placeholderOffset, 1);
			}
		}

		this.mutableBlocks.delete(op.sourceBlockId);
		for (let i = this.mutableBlockOrder.length - 1; i >= 0; i--) {
			if (this.blockOrder.get(i) === op.sourceBlockId) {
				this.mutableBlockOrder.delete(i, 1);
				break;
			}
		}

		return [op.targetBlockId, op.sourceBlockId];
	}

	// ── Text Ops ─────────────────────────────────────────────

	private _insertText(op: InsertTextOp): string[] {
		const blockMap = this._getMutableBlockMap(op.blockId);
		if (!blockMap) return [];
		const content = this._getTextContent(blockMap);
		if (!content) return [];

		if (content.length === 1 && content.toString() === ZERO_WIDTH_SPACE) {
			content.delete(0, 1);
		}

		const marks = op.marks ? this._resolveMarks(op.marks) : undefined;
		content.insert(op.offset, op.text, marks);
		return [op.blockId];
	}

	private _deleteText(op: DeleteTextOp): string[] {
		const blockMap = this._getMutableBlockMap(op.blockId);
		if (!blockMap) return [];
		const content = this._getTextContent(blockMap);
		if (!content) return [];

		content.delete(op.offset, op.length);
		return [op.blockId];
	}

	private _formatText(op: FormatTextOp): string[] {
		const blockMap = this._getMutableBlockMap(op.blockId);
		if (!blockMap) return [];
		const content = this._getTextContent(blockMap);
		if (!content) return [];

		content.format(op.offset, op.length, op.marks);
		return [op.blockId];
	}

	private _replaceText(op: ReplaceTextOp): string[] {
		const blockMap = this._getMutableBlockMap(op.blockId);
		if (!blockMap) return [];
		const content = this._getTextContent(blockMap);
		if (!content) return [];

		if (content.length === 1 && content.toString() === ZERO_WIDTH_SPACE) {
			content.delete(0, 1);
		}

		content.delete(op.offset, op.length);
		const marks = op.marks ? this._resolveMarks(op.marks) : undefined;
		content.insert(op.offset, op.text, marks);
		return [op.blockId];
	}

	private _resolveMarks(
		marks: Record<string, unknown | null>,
	): Record<string, unknown | null> {
		const resolved: Record<string, unknown | null> = {};
		for (const [type, value] of Object.entries(marks)) {
			const schema = this._registry.resolveInline(type);
			if (!schema) continue;
			resolved[type] = value;
		}
		return resolved;
	}

	// ── Inline Node Ops ──────────────────────────────────────

	private _insertInlineNode(op: InsertInlineNodeOp): string[] {
		const blockMap = this._getMutableBlockMap(op.blockId);
		if (!blockMap) return [];
		const content = this._getInlineTextContent(blockMap);
		if (!content) return [];

		content.insertEmbed(op.offset, {
			type: op.nodeType,
			...op.props,
		});
		return [op.blockId];
	}

	private _removeInlineNode(op: RemoveInlineNodeOp): string[] {
		const blockMap = this._getMutableBlockMap(op.blockId);
		if (!blockMap) return [];
		const content = this._getTextContent(blockMap);
		if (!content) return [];

		content.delete(op.offset, 1);
		return [op.blockId];
	}

	// ── Selection Op ─────────────────────────────────────────

	private _setSelection(op: SetSelectionOp): string[] {
		this._selection.setSelection(op.selection);
		return [];
	}

	// ── Layout Op ────────────────────────────────────────────

	private _updateLayout(op: UpdateLayoutOp): string[] {
		const blockMap = this._getMutableBlockMap(op.blockId);
		if (!blockMap) return [];

		const layoutMap = this._getOrCreateMapProp(blockMap, "layout");

		for (const [key, value] of Object.entries(op.layout)) {
			if (value === undefined || value === null) {
				layoutMap.delete(key);
			} else {
				layoutMap.set(key, value);
			}
		}

		return [op.blockId];
	}

	// ── App Ops ──────────────────────────────────────────────

	private _createApp(op: CreateAppOp): string[] {
		const appMap = this._createMutableMap();
		appMap.set("type", op.appType);
		appMap.set("placement", op.placement);

		if (op.config && Object.keys(op.config).length > 0) {
			const configMap = this._createMutableMap();
			for (const [key, value] of Object.entries(op.config)) {
				configMap.set(key, value);
			}
			appMap.set("config", configMap);
		}

		this.mutableApps.set(op.appId, appMap);
		return [];
	}

	private _updateApp(op: UpdateAppOp): string[] {
		const appMap = this._getMutableAppMap(op.appId);
		if (!appMap) return [];

		const configMap = this._getOrCreateMapProp(appMap, "config");

		for (const [key, value] of Object.entries(op.patch)) {
			if (value === undefined || value === null) {
				configMap.delete(key);
			} else {
				configMap.set(key, value);
			}
		}
		return [];
	}

	private _deleteApp(op: DeleteAppOp): string[] {
		this.mutableApps.delete(op.appId);
		return [];
	}

	// ── Table Ops ────────────────────────────────────────────

	private _tableOp(op: DocumentOp): string[] {
		const tableOp = op as { blockId: string; type: string };
		const blockMap = this._getMutableBlockMap(tableOp.blockId);
		if (!blockMap) return [];

		const blockType = blockMap.get("type");
		if (blockType === "database") {
			if (op.type === "update-table-columns") {
				return this._databaseOps.replaceColumns(
					blockMap,
					(op as UpdateTableColumnsOp).columns,
				)
					? [tableOp.blockId]
					: [];
			}

			if (this._isDatabaseStructuralTableOp(op.type)) {
				this._emitter.emit("diagnostic", {
					code: "PEN_APPLY_006",
					level: "warn",
					source: "apply",
					message: `apply: skipping ${op.type} for database block "${tableOp.blockId}"`,
					remediation:
						"Use database operations for structural database changes so row ids, column schema, and views stay in sync.",
					op,
				});
				return [];
			}
		}

		return this._tableGrid.execute(blockMap, op);
	}

	private _databaseOp(op: DocumentOp): string[] {
		const databaseOp = op as { type: string; blockId: string };
		const blockMap = this._getMutableBlockMap(databaseOp.blockId);
		if (!blockMap) return [];

		return this._databaseOps.execute(blockMap, op);
	}

	private _clearTableState(blockMap: MutableMap): void {
		blockMap.delete("tableContent");
		blockMap.delete("tableColumns");
	}

	private _clearDatabaseState(blockMap: MutableMap): void {
		blockMap.delete("databaseViews");
		blockMap.delete("databasePrimaryViewId");
	}

	private _isDatabaseStructuralTableOp(type: string): boolean {
		return (
			type === "insert-table-row" ||
			type === "delete-table-row" ||
			type === "insert-table-column" ||
			type === "delete-table-column" ||
			type === "merge-table-cells" ||
			type === "split-table-cell"
		);
	}

	private _getPreservedInlineDeltas(content: CRDTText | undefined): Array<{
		insert: string;
		attributes?: Record<string, unknown>;
	}> {
		if (!content || typeof content.toDelta !== "function") {
			return [];
		}

		return content.toDelta().filter(
			(
				delta,
			): delta is {
				insert: string;
				attributes?: Record<string, unknown>;
			} =>
				typeof delta.insert === "string" &&
				delta.insert !== ZERO_WIDTH_SPACE,
		);
	}

	// ── Meta Op ──────────────────────────────────────────────

	private _setMeta(op: SetMetaOp): string[] {
		const blockMap = this._getMutableBlockMap(op.blockId);
		if (!blockMap) return [];

		const metaMap = this._getOrCreateMapProp(blockMap, "meta");

		// Persist metadata as plain JSON so adapters can round-trip it predictably.
		if (op.data === null) {
			metaMap.delete(op.namespace);
		} else {
			metaMap.set(op.namespace, op.data);
		}

		return [op.blockId];
	}

	// ── Helpers ──────────────────────────────────────────────

	private _blockExists(blockId: string): boolean {
		return this.blocks.has(blockId);
	}

	private _createMutableMap(): MutableMap {
		return this._adapter.createMap() as MutableMap;
	}

	private _getMutableBlockMap(blockId: string): MutableMap | null {
		return (
			(this.blocks.get(blockId) as unknown as MutableMap | undefined) ??
			null
		);
	}

	private _getMutableAppMap(appId: string): MutableMap | null {
		return (
			(this.apps.get(appId) as unknown as MutableMap | undefined) ?? null
		);
	}

	private _getOrCreateMapProp(
		container: CRDTUnknownMap,
		key: string,
	): MutableMap {
		const existing = getMapProp(container, key);
		if (existing) {
			return existing as MutableMap;
		}
		const map = this._createMutableMap();
		container.set(key, map);
		return map;
	}

	private _getOrCreateStringArrayProp(
		container: CRDTUnknownMap,
		key: string,
	): MutableStringArray {
		const existing = getArrayProp<string>(container, key);
		if (existing) {
			return existing as MutableStringArray;
		}
		const array = this._adapter.createArray() as MutableStringArray;
		container.set(key, array);
		return array;
	}

	private _removeBlockIdFromArray(
		array: MutableStringArray,
		blockId: string,
		stopAfterFirst = false,
	): void {
		for (let index = array.length - 1; index >= 0; index--) {
			if (array.get(index) !== blockId) {
				continue;
			}
			array.delete(index, 1);
			if (stopAfterFirst) {
				return;
			}
		}
	}

	private _removeBlockIdFromAllChildren(blockId: string): void {
		for (const [, parentMap] of this.blocks.entries()) {
			const children = getArrayProp<string>(
				parentMap as unknown as CRDTUnknownMap,
				"children",
			);
			if (!children) {
				continue;
			}
			this._removeBlockIdFromArray(
				children as MutableStringArray,
				blockId,
			);
		}
	}

	private _getTextContent(blockMap: CRDTUnknownMap): CRDTText | undefined {
		const content = blockMap.get("content");
		return content &&
			typeof content === "object" &&
			typeof (content as { insert?: unknown }).insert === "function" &&
			typeof (content as { delete?: unknown }).delete === "function" &&
			typeof (content as { format?: unknown }).format === "function" &&
			typeof (content as { toDelta?: unknown }).toDelta === "function" &&
			typeof (content as { toString?: unknown }).toString ===
				"function" &&
			typeof (content as { length?: unknown }).length === "number"
			? (content as CRDTText)
			: undefined;
	}

	private _getInlineTextContent(
		blockMap: CRDTUnknownMap,
	): CRDTInlineText | undefined {
		const content = this._getTextContent(blockMap);
		return content &&
			typeof (content as { insertEmbed?: unknown }).insertEmbed ===
				"function"
			? (content as CRDTInlineText)
			: undefined;
	}

	private _opBlockId(op: DocumentOp): string | null {
		if ("blockId" in op) return (op as { blockId: string }).blockId;
		if ("targetBlockId" in op)
			return (op as { targetBlockId: string }).targetBlockId;
		if ("appId" in op) return null;
		return null;
	}

	updateDocument(
		doc: PenDocument,
		crdtDoc: CRDTDocument,
		engine: SchemaEngineImpl,
	): void {
		this._doc = doc;
		this._crdtDoc = crdtDoc;
		this._engine = engine;
	}
}
