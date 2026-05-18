import type {
	FieldEditor,
	Editor,
	BlockSchema,
	HistoryAppliedEvent,
	SelectionState,
	Unsubscribe,
	InputBackend,
} from "@pen/types";
import { DocumentRangeImpl } from "@pen/core";
import {
	hasFieldEditorSurface,
	resolveFieldEditorInputMode,
	usesInlineTextSelection,
} from "@pen/types";
import { EditContextBackend } from "./editContextBackend";
import { ContentEditableBackend } from "./contenteditableBackend";
import { ExpandedContentEditableBackend } from "./expandedContentEditableBackend";
import { HistorySelectionCoordinator } from "./historySelectionCoordinator";
import { SessionReconciler } from "./sessionReconciler";
import { classifySelectionSurface } from "./crossBlock";
import { resolveMarksAtPosition } from "./markBoundary";
import type {
	ActiveCellCoord,
	FieldEditorInputController,
	FieldEditorSession,
} from "./controller";
import {
	getCellYText,
	getResolvedYText,
	resolveCellInlineElement,
} from "./contentResolution";
import type { FieldEditorTextLike } from "./crdt";
import {
	domSelectionToEditor,
	queryBlockElement,
	queryInlineElement,
} from "./selectionBridge";
import {
	getEditorBlockSelectionLength,
	getEditorBlockSelectionRole,
} from "../utils/blockSelectionSemantics";
import {
	getEditorFlowCapability,
	shouldForceBlockScopedSelectAll,
} from "../utils/flowCapabilities";
import type { FieldEditorStoreSnapshot } from "./store";
import {
	resolveSelectAllBehavior,
	type EditorSelectAllBehavior,
} from "../constants/selectAll";

type FieldEditorOptions = {
	selectAllBehavior?: EditorSelectAllBehavior;
	inputBackend?: "contenteditable" | "edit-context";
};

export class FieldEditorImpl implements FieldEditorSession {
	private _focusBlockId: string | null = null;
	private _activeBlockIds: string[] = [];
	private _attachedElement: HTMLElement | null = null;
	private _isEditing = false;
	private _isFocused = false;
	private _isComposing = false;
	private _inputMode: "richtext" | "code" | "table" | "none" = "none";
	private _mode: "inactive" | "single" | "expanded" | "block" = "inactive";
	private _backend: InputBackend | null = null;
	private _editor: Editor;
	private _rootElement: HTMLElement | null = null;
	private _activateListeners = new Set<(blockIds: string[]) => void>();
	private _deactivateListeners = new Set<(blockIds: string[]) => void>();
	private _storeListeners = new Set<() => void>();
	private _unsubscribeSelection: Unsubscribe | null = null;
	private _unsubscribeHistoryApplied: Unsubscribe | null = null;
	private _pendingMarks: Record<string, unknown | null> = {};
	private _syncDomVersion = 0;
	private _domSyncVersion = 0;
	private _suppressNextDomSelectionProjection = false;
	private _pointerSelectionDepth = 0;
	private _pendingSelectionProjectionVersion: number | null = null;
	private readonly _sessionReconciler: SessionReconciler;
	private readonly _historySelectionCoordinator: HistorySelectionCoordinator;
	private _selectAllBehavior: EditorSelectAllBehavior;
	private _inputBackend: "contenteditable" | "edit-context";
	private _selectAllCycle: {
		blockId: string;
		scope: "cell" | "block" | "document";
	} | null = null;
	private _preserveSelectAllCycle = false;
	private _programmaticTextSelection: {
		blockId: string;
		anchorOffset: number;
		focusOffset: number;
	} | null = null;
	private _pendingProgrammaticTextSelection: {
		blockId: string;
		anchorOffset: number;
		focusOffset: number;
	} | null = null;
	private _activeCellCoord: ActiveCellCoord | null = null;

	constructor(editor: Editor, options?: FieldEditorOptions) {
		this._editor = editor;
		this._selectAllBehavior =
			options?.selectAllBehavior ??
			resolveSelectAllBehavior("content-first");
		this._inputBackend = options?.inputBackend ?? "edit-context";
		this._historySelectionCoordinator = new HistorySelectionCoordinator(
			this._editor,
		);
		this._unsubscribeSelection = this._editor.onSelectionChange(
			(selection) => {
				const preserveSelectAllCycle =
					this._preserveSelectAllCycle ||
					this._selectionMatchesSelectAllCycle(selection);
				this._preserveSelectAllCycle = false;
				if (!preserveSelectAllCycle) {
					this._selectAllCycle = null;
				}
				if (
					selection?.type !== "text" ||
					!selection.isCollapsed ||
					selection.isMultiBlock
				) {
					this._clearPendingMarks(true);
				}
				const suppressSelectionSync =
					this._consumeDomSelectionProjectionSuppression() ||
					this._shouldSuppressSelectionSync();
				this._recomputeSurfaceFromSelection({
					syncSelectionToBackend: !suppressSelectionSync,
				});
			},
		);
		this._unsubscribeHistoryApplied = this._editor.onHistoryApplied(
			(event) => {
				this._handleHistoryApplied(event);
			},
		);
		this._sessionReconciler = new SessionReconciler(this._editor, {
			getSnapshot: () => this.getSnapshot(),
			getAttachedElement: () => this._attachedElement,
			getInlineElement: (blockId) => this._resolveInlineElement(blockId),
			getYText: (blockId) => this._getYText(blockId),
			shouldPreserveSelection: () =>
				this._shouldProjectSelectionAfterReconcile(),
			shouldProjectSelection: () =>
				this._shouldProjectSelectionAfterReconcile(),
			projectSelection: () => this._syncDomSelectionOnce(),
			notifyDomReconciled: (blockId) => this.notifyDomReconciled(blockId),
		});
	}

	get focusBlockId(): string | null {
		return this._focusBlockId;
	}
	get activeBlockIds(): readonly string[] {
		return this._activeBlockIds;
	}
	get isEditing(): boolean {
		return this._isEditing;
	}
	get isFocused(): boolean {
		return this._isFocused;
	}
	get isComposing(): boolean {
		return this._isComposing;
	}
	get inputMode(): "richtext" | "code" | "table" | "none" {
		return this._inputMode;
	}
	get selection(): SelectionState | null {
		return this._isEditing ? this._editor.selection : null;
	}
	set selection(sel: SelectionState | null) {
		this._editor.setSelection(sel);
		this._emitStateChange();
	}
	get activeCellCoord(): ActiveCellCoord | null {
		return this._activeCellCoord;
	}

	setSelectAllBehavior(behavior: EditorSelectAllBehavior): void {
		if (this._selectAllBehavior === behavior) {
			return;
		}
		this._selectAllBehavior = behavior;
		this.resetSelectAllCycle();
	}

	setInputBackend(inputBackend: "contenteditable" | "edit-context"): void {
		if (this._inputBackend === inputBackend) {
			return;
		}
		this._inputBackend = inputBackend;
		this._syncBackendForSurfaceMode();
	}

	// ── Lifecycle ─────────────────────────────────────────────

	activate(blockId: string): void {
		if (this._focusBlockId === blockId) return;
		this._startSession(blockId, {
			stopCapturing: true,
			syncSelectionToBackend: true,
			attachImmediately: true,
		});
	}

	activateCell(blockId: string, row: number, col: number): void {
		this._activateCell(blockId, row, col);
		this._trySyncCellBackend(0);
	}

	activateCellFromElement(
		blockId: string,
		row: number,
		col: number,
		element: HTMLElement,
	): void {
		this._activateCell(blockId, row, col);
		this.attachElement(element);
		this._placeCaretInCell(element);
	}

	private _activateCell(blockId: string, row: number, col: number): void {
		this._activeCellCoord = { blockId, row, col };
		if (!this._isEditing || this._focusBlockId !== blockId) {
			this._startSession(blockId, {
				stopCapturing: true,
				syncSelectionToBackend: false,
				attachImmediately: false,
			});
		}
		this._inputMode = "table";
		this._emitStateChange();
	}

	private _trySyncCellBackend(attempt: number): void {
		const coord = this._activeCellCoord;
		if (!coord) return;

		const ytext = this._getYTextForCell(
			coord.blockId,
			coord.row,
			coord.col,
		);
		if (!ytext) return;

		const root = this._findEditorRoot();
		if (!root) return;

		const cellEl = this._resolveCellElement(
			coord.blockId,
			coord.row,
			coord.col,
			root,
		);

		if (cellEl) {
			this._attachedElement = null;
			this.attachElement(cellEl);
			this._placeCaretInCell(cellEl);
			return;
		}

		if (attempt < 3) {
			requestAnimationFrame(() => this._trySyncCellBackend(attempt + 1));
		}
	}

	private _placeCaretInCell(cellEl: HTMLElement): void {
		cellEl.focus({ preventScroll: true });
		const selection = cellEl.ownerDocument?.getSelection();
		if (!selection) return;

		const range = cellEl.ownerDocument.createRange();
		range.selectNodeContents(cellEl);
		range.collapse(false);
		selection.removeAllRanges();
		selection.addRange(range);
	}

	deactivate(): void {
		this._deactivate({ restoreFocus: true });
	}

	selectAll(rootElement?: HTMLElement | null): boolean {
		const activeCellElement = this._resolveActiveCellElement(rootElement);
		if (activeCellElement) {
			const activeCellBlockId =
				this._activeCellCoord?.blockId ??
				this._resolveSelectAllBlockId(rootElement);
			const shouldSelectCellContents =
				!isDomSelectionCoveringElementContents(activeCellElement) ||
				this._selectAllCycle?.scope !== "cell" ||
				this._selectAllCycle.blockId !== activeCellBlockId;
			if (shouldSelectCellContents) {
				if (
					this._attachedElement !== activeCellElement ||
					!this._attachedElement?.isConnected
				) {
					this.attachElement(activeCellElement);
				}
				selectElementContents(activeCellElement);
				if (activeCellBlockId) {
					this._recordSelectAllScope(activeCellBlockId, "cell");
				}
				return true;
			}
		}

		if (this._selectAllBehavior === "document-first") {
			const activeBlockId = this._resolveSelectAllBlockId(rootElement);
			const activeCapability = activeBlockId
				? getEditorFlowCapability(this._editor, activeBlockId)
				: null;
			if (
				!shouldForceBlockScopedSelectAll(
					this._editor.documentProfile,
					activeCapability,
				)
			) {
				return this._selectEntireDocument();
			}
		}

		const blockId = this._resolveSelectAllBlockId(rootElement);
		if (blockId) {
			const blockLength = getEditorBlockSelectionLength(
				this._editor,
				blockId,
			);
			const blockRole = getEditorBlockSelectionRole(
				this._editor,
				blockId,
			);
			const shouldSelectDocument =
				blockLength === 0 ||
				(this._selectAllCycle?.blockId === blockId &&
					this._selectAllCycle.scope === "block");
			const nextScope = shouldSelectDocument ? "document" : "block";
			if (nextScope === "block") {
				if (blockRole && blockRole !== "editable-inline") {
					this.deactivate();
					this._editor.selectBlock(blockId);
					this._recordSelectAllScope(blockId, "block");
					return true;
				}
				this.activateTextSelection(blockId, 0, blockLength);
				this._recordSelectAllScope(blockId, "block");
				return true;
			}
		}

		return this._selectEntireDocument(blockId ?? null);
	}

	private _selectEntireDocument(blockId?: string | null): boolean {
		const range = getFullDocumentTextRange(this._editor);
		if (!range) {
			return true;
		}

		if (!this._isEditing) {
			this.activate(range.focusBlockId);
		}
		this._editor.selectTextRange(range.start, range.end);
		this._recomputeSurfaceFromSelection();
		if (this._selectAllBehavior === "block-first") {
			this._recordSelectAllScope(
				blockId ?? range.focusBlockId,
				"document",
			);
		}
		this._syncSelectionToDOM();
		return true;
	}

	suspendForPointerSelection(): void {
		if (this._isComposing) return;
		this._deactivate({ restoreFocus: false });
	}

	beginPointerSelection(): void {
		this._programmaticTextSelection = null;
		this._pendingProgrammaticTextSelection = null;
		this._pointerSelectionDepth += 1;
	}

	endPointerSelection(): void {
		if (this._pointerSelectionDepth === 0) {
			return;
		}
		this._pointerSelectionDepth -= 1;
	}

	setComposing(composing: boolean): void {
		if (this._isComposing === composing) return;
		this._isComposing = composing;
		this._emitStateChange();
	}

	private _deactivate(options: { restoreFocus: boolean }): void {
		if (!this._isEditing) return;

		const blockIds = [...this._activeBlockIds];
		const focusTargetId = this._focusBlockId ?? blockIds[0] ?? null;
		this._backend?.deactivate();
		this._backend = null;
		this._attachedElement = null;
		this._activeCellCoord = null;

		this._focusBlockId = null;
		this._activeBlockIds = [];
		this._isEditing = false;
		this._isComposing = false;
		this._historySelectionCoordinator.reset();
		this._suppressNextDomSelectionProjection = false;
		this._programmaticTextSelection = null;
		this._pendingProgrammaticTextSelection = null;
		this._pointerSelectionDepth = 0;
		this._inputMode = "none";
		this._mode = "inactive";
		this._pendingMarks = {};

		for (const cb of this._deactivateListeners) cb(blockIds);
		if (options.restoreFocus) {
			this._restoreFocusAfterDeactivate(focusTargetId);
		}
		this._emitStateChange();
	}

	focus(): void {
		if (!this._isEditing || !this._focusBlockId) return;
		const root = this._findEditorRoot();

		if (!root) return;

		const blockEl = queryBlockElement(root, this._focusBlockId);
		const inlineEl = blockEl?.querySelector(
			"[data-pen-inline-content]",
		) as HTMLElement | null;

		if (!inlineEl) return;

		const selection = this._editor.selection;
		inlineEl.focus({ preventScroll: false });

		if (
			selection?.type === "text" &&
			selection.anchor.blockId === this._focusBlockId &&
			selection.focus.blockId === this._focusBlockId
		) {
			this._backend?.updateSelection(null);
			return;
		}

		const nativeSelection = root.ownerDocument?.getSelection();
		if (!nativeSelection) return;

		const range = root.ownerDocument.createRange();
		range.selectNodeContents(inlineEl);
		range.collapse(false);

		nativeSelection.removeAllRanges();
		nativeSelection.addRange(range);
	}

	blur(): void {
		const root = this._findEditorRoot();
		if (!root) return;
		const activeEl = root.ownerDocument?.activeElement;
		if (activeEl instanceof HTMLElement && root.contains(activeEl)) {
			activeEl.blur();
		}
	}

	setRootElement(element: HTMLElement | null): void {
		this._rootElement = element;
		if (element && this._isEditing) {
			this._syncActiveElement(false);
		}
	}

	setFocused(focused: boolean): void {
		if (this._isFocused === focused) return;
		this._isFocused = focused;
		this._emitStateChange();
	}

	private _findEditorRoot(): HTMLElement | null {
		if (!this._rootElement?.isConnected) return null;
		return this._rootElement;
	}

	private _findExpandedHost(): HTMLElement | null {
		const root = this._findEditorRoot();
		if (!root) return null;
		return root.querySelector(
			"[data-pen-editor-blocks-host]",
		) as HTMLElement | null;
	}

	attachElement(element: HTMLElement): void {
		if (!this._focusBlockId) return;
		if (this._attachedElement === element && this._backend) return;
		this._backend?.deactivate();
		this._backend = this.createBackend();

		const ytext = this._getYText(this._focusBlockId);
		if (!ytext) return;

		this._backend.activate(element, ytext);
		this._attachedElement = element;
	}

	syncTextSelection(
		blockId: string,
		anchorOffset: number,
		focusOffset: number,
	): void {
		if (!this._isEditing) return;
		if (this._focusBlockId !== blockId) return;

		this.setTextSelection(blockId, anchorOffset, focusOffset);
		const pendingProgrammaticSelection =
			this._pendingProgrammaticTextSelection;
		if (
			pendingProgrammaticSelection &&
			(pendingProgrammaticSelection.blockId !== blockId ||
				pendingProgrammaticSelection.anchorOffset !== anchorOffset ||
				pendingProgrammaticSelection.focusOffset !== focusOffset)
		) {
			this._pendingProgrammaticTextSelection = null;
		}
	}

	applyDocumentTextSelection(
		anchor: { blockId: string; offset: number },
		focus: { blockId: string; offset: number },
	): void {
		this._suppressNextDomSelectionProjection = true;

		if (!this._isEditing || !this._focusBlockId) {
			this._startSession(anchor.blockId, {
				stopCapturing: false,
				syncSelectionToBackend: false,
				attachImmediately: false,
			});
		} else {
			const blockRange = new DocumentRangeImpl(
				anchor,
				focus,
				this._editor.internals.doc,
			).blockRange;
			if (!blockRange.includes(this._focusBlockId)) {
				this._focusBlockId = anchor.blockId;
			}
		}

		this._editor.selectTextRange(anchor, focus);
		this._emitStateChange();
	}

	applyDomTextSelection(
		anchor: { blockId: string; offset: number },
		focus: { blockId: string; offset: number },
		options?: {
			focusBlockId?: string;
		},
	): void {
		if (anchor.blockId !== focus.blockId) {
			this.applyDocumentTextSelection(anchor, focus);
			return;
		}

		this._suppressNextDomSelectionProjection = true;

		if (
			anchor.blockId === focus.blockId &&
			(!this._isEditing || this._focusBlockId !== anchor.blockId)
		) {
			this._startSession(anchor.blockId, {
				stopCapturing: false,
				syncSelectionToBackend: false,
				attachImmediately: false,
			});
		}

		if (anchor.blockId === focus.blockId) {
			this.setTextSelection(anchor.blockId, anchor.offset, focus.offset);
			return;
		}

		if (options?.focusBlockId) {
			this._focusBlockId = options.focusBlockId;
		}
		this._editor.selectTextRange(anchor, focus);
		this._emitStateChange();
	}

	shouldHandleDomSelectionChange(isApplyingSelection: number): boolean {
		return (
			isApplyingSelection === 0 &&
			this._pointerSelectionDepth === 0 &&
			this._pendingProgrammaticTextSelection === null &&
			!this._shouldSuppressSelectionSync()
		);
	}

	resolveProgrammaticInputRange(
		blockId: string | null,
		liveRange: { start: number; end: number } | null,
	): { start: number; end: number } | null {
		const programmaticSelection =
			this._getActiveProgrammaticTextSelection(blockId);
		if (!programmaticSelection) {
			return null;
		}
		if (!liveRange) {
			this._programmaticTextSelection = null;
			return {
				start: programmaticSelection.anchorOffset,
				end: programmaticSelection.focusOffset,
			};
		}
		if (
			liveRange.start === liveRange.end &&
			(liveRange.start !== programmaticSelection.anchorOffset ||
				liveRange.end !== programmaticSelection.focusOffset)
		) {
			this._programmaticTextSelection = null;
			return {
				start: programmaticSelection.anchorOffset,
				end: programmaticSelection.focusOffset,
			};
		}
		return null;
	}

	shouldIgnoreDomTextSelection(
		anchor: { blockId: string; offset: number },
		focus: { blockId: string; offset: number },
	): boolean {
		const programmaticSelection = this._getActiveProgrammaticTextSelection(
			anchor.blockId,
		);
		if (!programmaticSelection || anchor.blockId !== focus.blockId) {
			return false;
		}
		if (
			anchor.offset === programmaticSelection.anchorOffset &&
			focus.offset === programmaticSelection.focusOffset
		) {
			return false;
		}
		return anchor.offset === focus.offset;
	}

	setTextSelection(
		blockId: string,
		anchorOffset: number,
		focusOffset: number,
	): void {
		if (anchorOffset !== focusOffset) {
			this._clearPendingMarks(true);
		}
		this._editor.selectText(blockId, anchorOffset, focusOffset);
		const programmaticSelection = this._programmaticTextSelection;
		if (
			programmaticSelection &&
			(programmaticSelection.blockId !== blockId ||
				programmaticSelection.anchorOffset !== anchorOffset ||
				programmaticSelection.focusOffset !== focusOffset)
		) {
			this._programmaticTextSelection = null;
		}
		this._emitStateChange();
	}

	activateTextSelection(
		blockId: string,
		anchorOffset: number,
		focusOffset: number,
	): void {
		this._programmaticTextSelection = null;
		this._pendingProgrammaticTextSelection = null;
		this._projectTextSelection(blockId, anchorOffset, focusOffset);
	}

	commitProgrammaticTextSelection(
		blockId: string,
		anchorOffset: number,
		focusOffset: number,
	): void {
		this._programmaticTextSelection = {
			blockId,
			anchorOffset,
			focusOffset,
		};
		this._pendingProgrammaticTextSelection = {
			blockId,
			anchorOffset,
			focusOffset,
		};
		this._projectTextSelection(blockId, anchorOffset, focusOffset, {
			syncBackendImmediately: true,
		});
	}

	collapseSelectionToFocus(): void {
		const selection = this._editor.selection;
		if (selection?.type !== "text") return;

		this._collapseAndProject(selection.focus);
	}

	collapseSelectionToAnchor(): void {
		const selection = this._editor.selection;
		if (selection?.type !== "text") return;

		this._collapseAndProject(selection.anchor);
	}

	collapseSelectionToPoint(point: { blockId: string; offset: number }): void {
		this._collapseAndProject(point);
	}

	private _collapseAndProject(point: {
		blockId: string;
		offset: number;
	}): void {
		this.setTextSelection(point.blockId, point.offset, point.offset);

		if (!this._isEditing || this._focusBlockId !== point.blockId) {
			this.activate(point.blockId);
		}

		this._syncDomSelectionOnce();
	}

	delegate(blockSchema: BlockSchema): boolean {
		return hasFieldEditorSurface(blockSchema);
	}

	getPendingMarks(): Readonly<Record<string, unknown | null>> {
		return this._pendingMarks;
	}

	clearPendingMarks(): void {
		this._clearPendingMarks();
	}

	private _recordSelectAllScope(
		blockId: string,
		scope: "cell" | "block" | "document",
	): void {
		this._preserveSelectAllCycle = true;
		this._selectAllCycle = { blockId, scope };
	}

	resetSelectAllCycle(): void {
		this._preserveSelectAllCycle = false;
		this._selectAllCycle = null;
	}

	private _syncSelectionToDOM(): void {
		if (!this._isEditing) return;
		this._syncDomSelectionOnce();
	}

	private _resolveSelectAllBlockId(
		rootElement?: HTMLElement | null,
	): string | null {
		const selection = this._editor.selection;
		if (selection?.type === "text" && !selection.isMultiBlock) {
			return selection.focus.blockId;
		}
		if (
			this._selectAllBehavior === "block-first" &&
			selection?.type === "block" &&
			selection.blockIds.length === 1
		) {
			return selection.blockIds[0] ?? null;
		}
		if (selection?.type === "cell") {
			return selection.blockId;
		}

		if (this._focusBlockId) {
			return this._focusBlockId;
		}

		const root = rootElement ?? this._findEditorRoot();
		if (!root) {
			return null;
		}

		const domSelection = domSelectionToEditor(root);
		if (
			domSelection &&
			domSelection.anchor.blockId === domSelection.focus.blockId
		) {
			return domSelection.focus.blockId;
		}

		const activeElement = root.ownerDocument?.activeElement;
		if (activeElement instanceof HTMLElement) {
			return (
				activeElement
					.closest("[data-block-id]")
					?.getAttribute("data-block-id") ?? null
			);
		}

		return null;
	}

	private _selectionMatchesSelectAllCycle(
		selection: SelectionState | null,
	): boolean {
		const cycle = this._selectAllCycle;
		if (!cycle) {
			return false;
		}

		if (cycle.scope === "cell") {
			return (
				selection?.type === "cell" &&
				selection.blockId === cycle.blockId
			);
		}

		if (cycle.scope === "block") {
			const blockLength = getEditorBlockSelectionLength(
				this._editor,
				cycle.blockId,
			);
			const blockRole = getEditorBlockSelectionRole(
				this._editor,
				cycle.blockId,
			);
			if (blockRole && blockRole !== "editable-inline") {
				return (
					selection?.type === "block" &&
					selection.blockIds.length === 1 &&
					selection.blockIds[0] === cycle.blockId
				);
			}

			if (selection?.type !== "text") {
				return false;
			}
			return (
				!selection.isMultiBlock &&
				selection.anchor.blockId === cycle.blockId &&
				selection.focus.blockId === cycle.blockId &&
				Math.min(selection.anchor.offset, selection.focus.offset) ===
					0 &&
				Math.max(selection.anchor.offset, selection.focus.offset) ===
					blockLength
			);
		}

		const range = getFullDocumentTextRange(this._editor);
		if (!range) {
			return false;
		}

		if (selection?.type !== "text") {
			return false;
		}

		return (
			selection.isMultiBlock &&
			((pointsEqual(selection.anchor, range.start) &&
				pointsEqual(selection.focus, range.end)) ||
				(pointsEqual(selection.anchor, range.end) &&
					pointsEqual(selection.focus, range.start)))
		);
	}

	togglePendingMark(markType: string): boolean {
		if (!this._isEditing || this._inputMode !== "richtext") return false;

		const baseMarks = this._resolveBaseInsertMarks();
		const baseValue = baseMarks[markType];
		const effectiveMarks = this._applyPendingMarks(baseMarks);
		const nextValue = effectiveMarks[markType] != null ? null : true;
		const nextPendingMarks = { ...this._pendingMarks };

		if ((baseValue ?? null) === nextValue) {
			delete nextPendingMarks[markType];
		} else {
			nextPendingMarks[markType] = nextValue;
		}

		this._pendingMarks = nextPendingMarks;
		this._emitStateChange();
		return true;
	}

	resolveInsertMarks(
		ytext: FieldEditorTextLike,
		offset: number,
	): Record<string, unknown | null> | undefined {
		const baseMarks =
			resolveMarksAtPosition(ytext, offset, this._editor.schema) ?? {};
		const resolved = this._applyPendingMarks(baseMarks);
		const insertMarks: Record<string, unknown | null> = { ...resolved };

		for (const [markType, value] of Object.entries(this._pendingMarks)) {
			if (value == null && markType in baseMarks) {
				insertMarks[markType] = null;
			}
		}

		return Object.keys(insertMarks).length > 0 ? insertMarks : undefined;
	}

	// ── Cross-block expansion ────────────────────────────────

	expandTo(blockId: string): void {
		if (!this._isEditing || !this._focusBlockId) return;

		const selection = this._editor.selection;
		const anchor =
			selection?.type === "text" &&
			selection.blockRange.includes(this._focusBlockId)
				? selection.anchor
				: { blockId: this._focusBlockId, offset: 0 };
		const doc = this._editor.documentState;
		const activeIdx = doc.indexOf(this._focusBlockId);
		const targetIdx = doc.indexOf(blockId);
		if (activeIdx < 0 || targetIdx < 0) return;

		const targetOffset =
			targetIdx >= activeIdx
				? (this._editor.getBlock(blockId)?.length() ?? 0)
				: 0;

		this._editor.selectTextRange(anchor, {
			blockId,
			offset: targetOffset,
		});
	}

	contractToFocused(): void {
		if (!this._isEditing || !this._focusBlockId) return;

		const selection = this._editor.selection;
		if (selection?.type !== "text") return;

		this._editor.selectTextRange(selection.focus, selection.focus);
	}

	// ── Events ───────────────────────────────────────────────

	onActivate(cb: (blockIds: string[]) => void): Unsubscribe {
		this._activateListeners.add(cb);
		return () => this._activateListeners.delete(cb);
	}

	onDeactivate(cb: (blockIds: string[]) => void): Unsubscribe {
		this._deactivateListeners.add(cb);
		return () => this._deactivateListeners.delete(cb);
	}

	onSelectionChange(cb: (sel: SelectionState) => void): Unsubscribe {
		return this._editor.onSelectionChange(cb);
	}

	getSnapshot(): FieldEditorStoreSnapshot {
		return {
			focusBlockId: this._focusBlockId,
			activeBlockIds: this._activeBlockIds,
			isEditing: this._isEditing,
			isFocused: this._isFocused,
			isComposing: this._isComposing,
			domSyncVersion: this._domSyncVersion,
			inputMode: this._inputMode,
			mode: this._mode,
			activeCellCoord: this._activeCellCoord,
		};
	}

	notifyDomReconciled(_blockId?: string): void {
		this._domSyncVersion += 1;
		this._emitStateChange();
	}

	subscribe(callback: () => void): Unsubscribe {
		this._storeListeners.add(callback);
		return () => this._storeListeners.delete(callback);
	}

	destroy(): void {
		this._unsubscribeSelection?.();
		this._unsubscribeSelection = null;
		this._unsubscribeHistoryApplied?.();
		this._unsubscribeHistoryApplied = null;
		this._sessionReconciler.destroy();
		this._deactivate({ restoreFocus: false });
		this._pointerSelectionDepth = 0;
		this._activateListeners.clear();
		this._deactivateListeners.clear();
		this._storeListeners.clear();
	}

	// ── Internal ─────────────────────────────────────────────

	private createBackend(): InputBackend {
		return new (this._resolveBackendClass())(this._editor, this);
	}

	private _resolveBackendClass(): new (
		editor: Editor,
		fieldEditor: FieldEditorInputController,
	) => InputBackend {
		if (this._mode === "expanded") {
			return ExpandedContentEditableBackend as unknown as new (
				editor: Editor,
				fieldEditor: FieldEditorInputController,
			) => InputBackend;
		}
		if (this._activeCellCoord) {
			return ContentEditableBackend;
		}
		if (
			this._inputBackend === "edit-context" &&
			"EditContext" in globalThis &&
			typeof (globalThis as typeof globalThis & { EditContext?: unknown })
				.EditContext === "function"
		) {
			return EditContextBackend;
		}
		return ContentEditableBackend;
	}

	private _syncActiveElement(focus: boolean): void {
		if (!this._focusBlockId) return;
		const inlineEl = this._resolveInlineElement(this._focusBlockId);
		if (!inlineEl) return;

		this.attachElement(inlineEl);
		if (focus) {
			this.focus();
		}
	}

	private _restoreFocusAfterDeactivate(blockId: string | null): void {
		const root = this._findEditorRoot();
		if (!root) return;

		if (blockId) {
			const blockEl = queryBlockElement(root, blockId);
			if (blockEl) {
				blockEl.focus({ preventScroll: true });
				return;
			}
		}

		root.focus({ preventScroll: true });
	}

	private _emitStateChange(): void {
		for (const callback of this._storeListeners) {
			callback();
		}
	}

	private _consumeDomSelectionProjectionSuppression(): boolean {
		const shouldSuppress = this._suppressNextDomSelectionProjection;
		this._suppressNextDomSelectionProjection = false;
		return shouldSuppress;
	}

	private _resolveBaseInsertMarks(): Record<string, unknown> {
		const selection = this._editor.selection;
		if (!this._focusBlockId || selection?.type !== "text") {
			return {};
		}

		const blockId = selection.focus.blockId;
		const ytext = this._getYText(blockId);
		if (!ytext) return {};

		return (
			resolveMarksAtPosition(
				ytext,
				selection.focus.offset,
				this._editor.schema,
			) ?? {}
		);
	}

	private _applyPendingMarks(
		baseMarks: Record<string, unknown>,
	): Record<string, unknown> {
		const nextMarks = { ...baseMarks };
		for (const [markType, value] of Object.entries(this._pendingMarks)) {
			if (value == null) {
				delete nextMarks[markType];
			} else {
				nextMarks[markType] = value;
			}
		}
		return nextMarks;
	}

	private _clearPendingMarks(silent = false): void {
		if (Object.keys(this._pendingMarks).length === 0) return;
		this._pendingMarks = {};
		if (!silent) {
			this._emitStateChange();
		}
	}

	private _recomputeSurfaceFromSelection(options?: {
		syncSelectionToBackend?: boolean;
	}): void {
		const surface = classifySelectionSurface(
			this._editor,
			this._editor.selection,
			this._focusBlockId,
			this._isEditing,
		);
		this._updateSurfaceState(surface.mode, surface.blockIds);
		if (options?.syncSelectionToBackend ?? true) {
			this._backend?.updateSelection(null);
		}
	}

	private _updateSurfaceState(
		mode: "inactive" | "single" | "expanded" | "block",
		blockIds: string[],
	): void {
		const modeChanged = this._mode !== mode;
		const blockIdsChanged = !areBlockIdsEqual(
			this._activeBlockIds,
			blockIds,
		);
		if (!modeChanged && !blockIdsChanged) return;
		this._mode = mode;
		this._activeBlockIds = blockIds;
		this._syncBackendForSurfaceMode();

		if (this._isEditing && blockIdsChanged) {
			for (const cb of this._activateListeners) cb([...blockIds]);
		}

		this._emitStateChange();
	}

	private _syncBackendForSurfaceMode(): void {
		if (!this._isEditing || !this._focusBlockId) return;
		const NextBackendClass = this._resolveBackendClass();
		if (this._backend?.constructor === NextBackendClass) {
			return;
		}

		this._backend?.deactivate();
		this._backend = new NextBackendClass(this._editor, this);

		if (this._mode === "expanded") {
			const expandedHost = this._findExpandedHost();
			this._attachedElement = null;
			if (expandedHost) {
				this.attachElement(expandedHost);
			}
			return;
		}

		if (this._mode === "single") {
			const inlineEl = this._resolveInlineElement(this._focusBlockId);
			if (inlineEl) {
				this._attachedElement = null;
				this.attachElement(inlineEl);
				return;
			}
		}

		if (!this._attachedElement) return;

		const ytext = this._getYText(this._focusBlockId);
		if (!ytext) return;

		this._backend.activate(this._attachedElement, ytext);
	}

	private _startSession(
		blockId: string,
		options: {
			stopCapturing: boolean;
			syncSelectionToBackend: boolean;
			attachImmediately: boolean;
		},
	): boolean {
		if (this._isEditing) this._deactivate({ restoreFocus: false });

		const block = this._editor.getBlock(blockId);
		if (!block) return false;

		const schema = this._editor.schema.resolve(block.type);
		if (schema?.fieldEditor === "none") return false;

		this._focusBlockId = blockId;
		this._activeBlockIds = [blockId];
		this._isEditing = true;
		this._isComposing = false;
		this._mode = "single";
		this._pendingMarks = {};

		if (options.stopCapturing) {
			this._editor.undoManager.stopCapturing();
		}

		this._inputMode = resolveInputMode(schema);
		this._backend = this.createBackend();
		this._attachedElement = null;
		if (options.attachImmediately) {
			this._syncActiveElement(false);
		}
		this._recomputeSurfaceFromSelection({
			syncSelectionToBackend: options.syncSelectionToBackend,
		});

		for (const cb of this._activateListeners) cb([...this._activeBlockIds]);
		this._emitStateChange();
		return true;
	}

	private _handleHistoryApplied(event: HistoryAppliedEvent): void {
		const selection = event.selection;
		const nextFocusBlockId =
			event.focusBlockId ??
			(selection?.type === "text" ? selection.focus.blockId : null);
		if (selection?.type !== "text") {
			if (this._isEditing) {
				this._deactivate({ restoreFocus: false });
			}
			return;
		}

		if (!this._isEditing) {
			return;
		}

		if (nextFocusBlockId) {
			this._focusBlockId = nextFocusBlockId;
		}

		this._historySelectionCoordinator.beginDeferredProjection(
			event.requestId,
		);

		this._recomputeSurfaceFromSelection({
			syncSelectionToBackend: false,
		});
	}

	private _attachedElementOwnsFocus(): boolean {
		if (!this._attachedElement) {
			return false;
		}
		const activeElement =
			this._attachedElement.ownerDocument?.activeElement;
		return activeElement instanceof Node
			? this._attachedElement.contains(activeElement)
			: false;
	}

	private _shouldProjectSelectionAfterReconcile(): boolean {
		if (!this._attachedElement) {
			return false;
		}

		const ownerDocument = this._attachedElement.ownerDocument;
		const activeElement = ownerDocument?.activeElement;
		if (!(activeElement instanceof Node)) {
			return true;
		}
		if (activeElement === ownerDocument?.body) {
			return true;
		}

		const root = this._findEditorRoot();
		if (!root || !root.contains(activeElement)) {
			return true;
		}

		return this._attachedElement.contains(activeElement);
	}

	private _resolveInlineElement(blockId: string): HTMLElement | null {
		const root = this._findEditorRoot();
		if (!root) return null;
		const activeCell = this._activeCellCoord;
		if (activeCell?.blockId === blockId) {
			return this._resolveCellElement(
				activeCell.blockId,
				activeCell.row,
				activeCell.col,
				root,
			);
		}
		return queryInlineElement(root, blockId);
	}

	private _projectTextSelection(
		blockId: string,
		anchorOffset: number,
		focusOffset: number,
		options?: {
			syncBackendImmediately?: boolean;
		},
	): void {
		this.setTextSelection(blockId, anchorOffset, focusOffset);

		if (!this._isEditing || this._focusBlockId !== blockId) {
			this.activate(blockId);
		}

		if (options?.syncBackendImmediately) {
			this._backend?.updateSelection(null);
		}
		this._syncDomSelectionOnce();
	}

	private _syncDomSelectionOnce(
		remainingAttempts = 4,
		version?: number,
	): void {
		if (version === undefined) {
			version = ++this._syncDomVersion;
			this._pendingSelectionProjectionVersion = version;
		}
		const v = version;
		requestAnimationFrame(() => {
			if (!this._isEditing || this._syncDomVersion !== v) return;

			let projected = false;
			const pendingProjectionRequestId =
				this._historySelectionCoordinator.getPendingProjectionRequestId();

			if (this._mode === "expanded") {
				const expandedHost = this._findExpandedHost();
				if (expandedHost) {
					if (
						this._attachedElement !== expandedHost ||
						!this._attachedElement?.isConnected
					) {
						this.attachElement(expandedHost);
					}
					expandedHost.focus({ preventScroll: true });
					this._backend?.updateSelection(null);
					projected = true;
				}
			} else if (this._focusBlockId) {
				const inlineEl = this._resolveInlineElement(this._focusBlockId);
				if (inlineEl) {
					if (
						this._attachedElement !== inlineEl ||
						!this._attachedElement ||
						!this._attachedElement.isConnected
					) {
						this.attachElement(inlineEl);
					}
					inlineEl.focus({ preventScroll: true });
					this._backend?.updateSelection(null);
					projected = true;
				}
			}

			if (projected) {
				requestAnimationFrame(() => {
					if (this._syncDomVersion === v) {
						if (this._pendingSelectionProjectionVersion === v) {
							this._pendingSelectionProjectionVersion = null;
						}
						this._historySelectionCoordinator.completeDeferredProjection(
							pendingProjectionRequestId,
						);
					}
				});
			}

			if (!projected && remainingAttempts > 0) {
				this._syncDomSelectionOnce(remainingAttempts - 1, v);
			} else if (!projected) {
				if (this._pendingSelectionProjectionVersion === v) {
					this._pendingSelectionProjectionVersion = null;
				}
				this._historySelectionCoordinator.cancelDeferredProjection();
			}
		});
	}

	private _getActiveProgrammaticTextSelection(blockId: string | null): {
		blockId: string;
		anchorOffset: number;
		focusOffset: number;
	} | null {
		const programmaticSelection =
			this._programmaticTextSelection ??
			this._pendingProgrammaticTextSelection;
		if (!blockId || programmaticSelection?.blockId !== blockId) {
			return null;
		}
		return programmaticSelection;
	}

	private _shouldSuppressSelectionSync(): boolean {
		return (
			this._historySelectionCoordinator.shouldSuppressSelectionSync() ||
			this._pendingSelectionProjectionVersion !== null
		);
	}

	private _getYText(blockId: string): FieldEditorTextLike | null {
		return getResolvedYText(this._editor, blockId, this._activeCellCoord);
	}

	private _getYTextForCell(
		blockId: string,
		row: number,
		col: number,
	): FieldEditorTextLike | null {
		return getCellYText(this._editor, blockId, row, col);
	}

	private _resolveCellElement(
		blockId: string,
		row: number,
		col: number,
		root?: HTMLElement | null,
	): HTMLElement | null {
		return resolveCellInlineElement(
			blockId,
			row,
			col,
			root ?? this._findEditorRoot(),
		);
	}

	private _resolveActiveCellElement(
		rootElement?: HTMLElement | null,
	): HTMLElement | null {
		const coord = this._activeCellCoord;
		if (!coord) return null;
		return this._resolveCellElement(
			coord.blockId,
			coord.row,
			coord.col,
			rootElement ?? undefined,
		);
	}
}

function resolveInputMode(
	schema?: BlockSchema | null,
): "richtext" | "code" | "table" | "none" {
	return resolveFieldEditorInputMode(schema);
}

function selectElementContents(element: HTMLElement): void {
	element.focus({ preventScroll: true });
	const selection = element.ownerDocument?.getSelection();
	if (!selection) return;

	const range = element.ownerDocument.createRange();
	range.selectNodeContents(element);
	selection.removeAllRanges();
	selection.addRange(range);
}

function isDomSelectionCoveringElementContents(element: HTMLElement): boolean {
	const selection = element.ownerDocument?.getSelection();
	if (!selection || selection.rangeCount === 0) {
		return false;
	}

	const range = selection.getRangeAt(0);
	if (
		!element.contains(range.startContainer) ||
		!element.contains(range.endContainer)
	) {
		return false;
	}

	const fullRange = element.ownerDocument.createRange();
	fullRange.selectNodeContents(element);
	return (
		range.compareBoundaryPoints(Range.START_TO_START, fullRange) === 0 &&
		range.compareBoundaryPoints(Range.END_TO_END, fullRange) === 0
	);
}

function areBlockIdsEqual(
	left: readonly string[],
	right: readonly string[],
): boolean {
	if (left.length !== right.length) return false;
	for (let i = 0; i < left.length; i++) {
		if (left[i] !== right[i]) return false;
	}
	return true;
}

function getFullDocumentTextRange(editor: Editor): {
	start: { blockId: string; offset: number };
	end: { blockId: string; offset: number };
	focusBlockId: string;
} | null {
	const blockOrder = editor.documentState.blockOrder;
	const firstBlockId = blockOrder[0];
	const lastBlockId = blockOrder[blockOrder.length - 1];
	if (!firstBlockId || !lastBlockId) {
		return null;
	}

	const focusBlockId =
		blockOrder.find((blockId) => {
			const block = editor.getBlock(blockId);
			if (!block) return false;
			const schema = editor.schema.resolve(block.type);
			return usesInlineTextSelection(schema);
		}) ?? firstBlockId;

	return {
		start: { blockId: firstBlockId, offset: 0 },
		end: {
			blockId: lastBlockId,
			offset: getEditorBlockSelectionLength(editor, lastBlockId),
		},
		focusBlockId,
	};
}

function pointsEqual(
	left: { blockId: string; offset: number },
	right: { blockId: string; offset: number },
): boolean {
	return left.blockId === right.blockId && left.offset === right.offset;
}
