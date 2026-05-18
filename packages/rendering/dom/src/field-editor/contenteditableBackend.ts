import type {
	DocumentOp,
	Editor,
	InlineDecoration,
	InputBackend,
} from "@pen/types";
import type { FieldEditorInputController } from "./controller";
import { fullReconcileToDOM, applyDeltaToDOM } from "./reconciler";
import {
	computeTextDiff,
	domPointToOffset,
	domSelectionToEditor,
	editorSelectionToDOM,
	extractTextFromDOM,
	getSelectionOffsets,
} from "./selectionBridge";
import { normalizeSelectionFormation } from "../utils/selectionFormation";
import type { PasteImporters } from "../types/paste";
import { handlePaste, handleCopy, handleCut } from "./clipboard";
import {
	applyListInputRule,
	applyDeleteBehavior,
	applyEnterBehavior,
	toggleInlineMark,
} from "./commands";
import { handleFieldEditorKeyDown } from "./keyHandling";
import { isHistoryTransactionOrigin } from "./historyOrigin";
import type {
	FieldEditorDelta,
	FieldEditorObserver,
	FieldEditorTextChangeEvent,
	FieldEditorTextLike,
} from "./crdt";

export class ContentEditableBackend implements InputBackend {
	private element: HTMLElement | null = null;
	private ytext: FieldEditorTextLike | null = null;
	private observer: FieldEditorObserver | null = null;
	private mutationObserver: MutationObserver | null = null;
	private isApplyingSelection = 0;
	private isComposing = false;
	private compositionStartTimestamp = 0;
	private compositionStartText: string | null = null;
	private deferredRemoteDeltas: Array<{ delta: FieldEditorDelta[] }> = [];
	private pendingDomSyncFrame: number | null = null;
	private pendingSelectionOverride: {
		blockId: string;
		anchorOffset: number;
		focusOffset: number;
		cell?: { row: number; col: number };
	} | null = null;
	private activeCellSelection: { start: number; end: number } | null = null;
	private editor: Editor;
	private fieldEditor: FieldEditorInputController;

	constructor(editor: Editor, fieldEditor: FieldEditorInputController) {
		this.editor = editor;
		this.fieldEditor = fieldEditor;
	}

	activate(element: HTMLElement, ytext: unknown): void {
		this.element = element;
		this.ytext = ytext as FieldEditorTextLike;

		element.contentEditable = "true";
		this.isApplyingSelection++;
		this.isComposing = false;
		this.compositionStartText = null;
		this.activeCellSelection = null;
		this.fieldEditor.setComposing(false);

		element.addEventListener("beforeinput", this.handleBeforeInput);
		element.addEventListener(
			"compositionstart",
			this.handleCompositionStart,
		);
		element.addEventListener("compositionend", this.handleCompositionEnd);
		element.addEventListener("keydown", this.handleKeyDown);
		element.addEventListener("copy", this.handleCopyEvent);
		element.addEventListener("cut", this.handleCutEvent);
		element.addEventListener("dragstart", this.handleDragStart);
		element.addEventListener("drop", this.handleDrop);
		element.ownerDocument?.addEventListener(
			"selectionchange",
			this.handleSelectionChange,
		);

		this.mutationObserver = new MutationObserver(this.handleMutations);
		this.mutationObserver.observe(element, {
			childList: true,
			subtree: true,
			characterData: true,
			characterDataOldValue: true,
		});

		this.observer = (event) => this.handleYTextChange(event);
		this.ytext.observe(this.observer);

		fullReconcileToDOM(this.ytext, element, this.editor.schema, {
			inlineDecorations: this.getInlineDecorationsForBlock(),
		});
		this.fieldEditor.notifyDomReconciled(
			this.fieldEditor.focusBlockId ?? undefined,
		);
		this.restoreDOMSelectionFromEditor();
		requestAnimationFrame(() => {
			this.isApplyingSelection--;
		});
	}

	deactivate(): void {
		if (this.element) {
			this.element.contentEditable = "false";
			this.element.removeEventListener(
				"beforeinput",
				this.handleBeforeInput,
			);
			this.element.removeEventListener(
				"compositionstart",
				this.handleCompositionStart,
			);
			this.element.removeEventListener(
				"compositionend",
				this.handleCompositionEnd,
			);
			this.element.removeEventListener("keydown", this.handleKeyDown);
			this.element.removeEventListener("copy", this.handleCopyEvent);
			this.element.removeEventListener("cut", this.handleCutEvent);
			this.element.removeEventListener("dragstart", this.handleDragStart);
			this.element.removeEventListener("drop", this.handleDrop);
			this.element.ownerDocument?.removeEventListener(
				"selectionchange",
				this.handleSelectionChange,
			);
		}
		if (this.mutationObserver) {
			this.mutationObserver.disconnect();
			this.mutationObserver = null;
		}
		if (this.pendingDomSyncFrame != null) {
			cancelAnimationFrame(this.pendingDomSyncFrame);
			this.pendingDomSyncFrame = null;
		}
		if (this.observer && this.ytext) {
			this.ytext.unobserve(this.observer);
		}
		this.element = null;
		this.ytext = null;
		this.observer = null;
		this.deferredRemoteDeltas = [];
		this.isApplyingSelection = 0;
		this.isComposing = false;
		this.compositionStartText = null;
		this.activeCellSelection = null;
		this.fieldEditor.setComposing(false);
	}

	updateSelection(_relPos: unknown): void {
		this.restoreDOMSelectionFromEditor();
	}

	private _getActiveCellCoord(blockId: string): {
		blockId: string;
		row: number;
		col: number;
	} | null {
		const coord = this.fieldEditor.activeCellCoord;
		if (!coord || coord.blockId !== blockId) {
			return null;
		}
		return coord;
	}

	applyInlineTextEdit(options: {
		blockId: string;
		range: { start: number; end: number };
		text: string;
		marks?: Record<string, unknown>;
	}): void {
		const { blockId, range, text, marks } = options;
		const cellCoord = this._getActiveCellCoord(blockId);
		const ops: DocumentOp[] = [];
		const nextOffset = range.start + text.length;
		this.pendingSelectionOverride = {
			blockId,
			anchorOffset: nextOffset,
			focusOffset: nextOffset,
			cell: cellCoord
				? { row: cellCoord.row, col: cellCoord.col }
				: undefined,
		};

		if (range.end > range.start) {
			if (cellCoord) {
				ops.push({
					type: "delete-table-cell-text",
					blockId,
					row: cellCoord.row,
					col: cellCoord.col,
					offset: range.start,
					length: range.end - range.start,
				});
			} else {
				ops.push({
					type: "delete-text",
					blockId,
					offset: range.start,
					length: range.end - range.start,
				});
			}
		}

		if (text.length > 0) {
			if (cellCoord) {
				ops.push({
					type: "insert-table-cell-text",
					blockId,
					row: cellCoord.row,
					col: cellCoord.col,
					offset: range.start,
					text,
				});
			} else {
				ops.push({
					type: "insert-text",
					blockId,
					offset: range.start,
					text,
					marks,
				});
			}
		}

		if (ops.length > 0) {
			this.editor.apply(ops, { origin: "user" });
		}

		if (cellCoord) {
			this.activeCellSelection = {
				start: nextOffset,
				end: nextOffset,
			};
		} else {
			this.fieldEditor.syncTextSelection(blockId, nextOffset, nextOffset);
		}
		this.ensureActiveDOMMatchesYText();
		this.restoreDOMSelectionFromEditor();
		this.scheduleActiveDOMMatchCheck();
		this.pendingSelectionOverride = null;
	}

	applyListInputRule(options: {
		blockId: string;
		range: { start: number; end: number };
		text: string;
	}): boolean {
		const target = applyListInputRule(this.editor, options);
		if (!target) return false;

		this.pendingSelectionOverride = {
			blockId: target.blockId,
			anchorOffset: target.anchorOffset,
			focusOffset: target.focusOffset,
		};

		this.fieldEditor.syncTextSelection(
			target.blockId,
			target.anchorOffset,
			target.focusOffset,
		);
		this.restoreDOMSelectionFromEditor();
		this.pendingSelectionOverride = null;
		return true;
	}

	restoreDOMSelectionFromEditor(): void {
		if (!this.element) return;

		const blockId = this.fieldEditor.focusBlockId;
		if (!blockId) return;
		const selection = this.editor.selection;

		const pendingSelection =
			this.pendingSelectionOverride?.blockId === blockId
				? this.pendingSelectionOverride
				: null;
		const activeCell = this._getActiveCellCoord(blockId);
		if (
			activeCell &&
			(!pendingSelection ||
				(pendingSelection.cell?.row === activeCell.row &&
					pendingSelection.cell?.col === activeCell.col))
		) {
			const activeSelection =
				pendingSelection ??
				(this.activeCellSelection
					? {
							anchorOffset: this.activeCellSelection.start,
							focusOffset: this.activeCellSelection.end,
						}
					: null) ??
				(selection?.type === "text" &&
				selection.anchor.blockId === blockId &&
				selection.focus.blockId === blockId
					? {
							anchorOffset: selection.anchor.offset,
							focusOffset: selection.focus.offset,
						}
					: null);
			if (!activeSelection) return;
			const start = activeSelection.anchorOffset;
			const end = activeSelection.focusOffset;
			this.isApplyingSelection++;
			setSelectionOffsets(this.element, start, end);
			requestAnimationFrame(() => {
				this.isApplyingSelection--;
			});
			return;
		}
		const anchor =
			pendingSelection != null
				? {
						blockId: pendingSelection.blockId,
						offset: pendingSelection.anchorOffset,
					}
				: selection?.type === "text"
					? selection.anchor
					: null;
		const focus =
			pendingSelection != null
				? {
						blockId: pendingSelection.blockId,
						offset: pendingSelection.focusOffset,
					}
				: selection?.type === "text"
					? selection.focus
					: null;

		if (!anchor || !focus) return;
		if (anchor.blockId !== blockId || focus.blockId !== blockId) {
			return;
		}

		const root = this.element.closest(
			"[data-pen-editor-root]",
		) as HTMLElement | null;
		if (!root) return;

		this.isApplyingSelection++;
		editorSelectionToDOM(root, anchor, focus);
		requestAnimationFrame(() => {
			this.isApplyingSelection--;
		});
	}

	// ── Direct input handling ─────────────────────────────────

	private handleBeforeInput = (event: InputEvent): void => {
		if (this.isComposing) return;
		if (!this.ytext || !this.element) return;

		const blockId = this.fieldEditor.focusBlockId;
		if (!blockId || !this.editor.getBlock(blockId)) {
			this.fieldEditor.deactivate();
			return;
		}

		const handler = DIRECT_HANDLERS[event.inputType];
		if (handler) {
			if (
				requiresResolvedInputRange(event.inputType) &&
				!this.ensureResolvableInputRange(event)
			) {
				return;
			}

			event.preventDefault();
			handler(
				event,
				this.editor,
				this.ytext,
				this.fieldEditor,
				this.element,
				this,
			);
			return;
		}

		// Let the mutation observer reconcile input types we do not handle directly.
	};

	private ensureResolvableInputRange(event: InputEvent): boolean {
		if (!this.element) {
			return false;
		}
		if (canResolveInputRange(event, this.element)) {
			return true;
		}

		this.restoreDOMSelectionFromEditor();

		return canResolveInputRange(event, this.element);
	}

	// ── Composition handling ──────────────────────────────────

	private handleCompositionStart = (): void => {
		this.isComposing = true;
		this.compositionStartTimestamp = Date.now();
		this.compositionStartText = this.ytext?.toString() ?? "";
		this.deferredRemoteDeltas = [];
		this.fieldEditor.setComposing(true);
	};

	private handleCompositionEnd = (): void => {
		this.isComposing = false;
		this.fieldEditor.setComposing(false);

		const elapsed = Date.now() - this.compositionStartTimestamp;

		// GBoard rapid composition optimization: skip full diff for single-char
		// compositions under 50ms — treat as direct insert.
		if (elapsed < 50 && this.element) {
			const domText = extractTextFromDOM(this.element);
			const crdtText = this.ytext?.toString() ?? "";
			if (Math.abs(domText.length - crdtText.length) <= 1) {
				this.reconcileAfterComposition();
				return;
			}
		}

		// Safari may fire compositionend before the final DOM mutation.
		requestAnimationFrame(() => {
			if (this.isComposing) return;
			this.reconcileAfterComposition();
		});
	};

	private reconcileAfterComposition(): void {
		if (!this.element || !this.ytext) return;
		const blockId = this.fieldEditor.focusBlockId;
		if (!blockId) return;

		const domText = extractTextFromDOM(this.element);
		const baseText = this.compositionStartText ?? this.ytext.toString();

		if (domText !== baseText) {
			const diff = rebaseTextDiffOps(
				computeTextDiff(baseText, domText),
				this.deferredRemoteDeltas,
			);
			this.applyTextDiffAsOps(blockId, diff);
		}

		if (this.deferredRemoteDeltas.length > 0) {
			this.deferredRemoteDeltas = [];
			fullReconcileToDOM(this.ytext, this.element!, this.editor.schema, {
				inlineDecorations: this.getInlineDecorationsForBlock(),
			});
			this.fieldEditor.notifyDomReconciled(
				this.fieldEditor.focusBlockId ?? undefined,
			);
		}

		this.compositionStartText = null;
		this.restoreDOMSelectionFromEditor();
	}

	// ── Mutation observation fallback ─────────────────────────

	private handleMutations = (_mutations: MutationRecord[]): void => {
		if (this.isComposing) return;
		if (!this.element || !this.ytext) return;
		const blockId = this.fieldEditor.focusBlockId;
		if (!blockId) return;

		const domText = extractTextFromDOM(this.element);
		const crdtText = this.ytext.toString();

		if (domText !== crdtText) {
			const diff = computeTextDiff(crdtText, domText);
			this.applyTextDiffAsOps(blockId, diff);
		}
	};

	// ── CRDT→DOM reconciliation ───────────────────────────────

	private handleYTextChange = (event: FieldEditorTextChangeEvent): void => {
		if (this.isComposing) {
			if (
				event.transaction?.origin === "remote" ||
				event.transaction?.origin === "collaborator"
			) {
				this.deferredRemoteDeltas.push({ delta: event.delta });
			}
			return;
		}

		if (!this.element || !this.ytext) return;
		const isHistory = isHistoryTransactionOrigin(event.transaction?.origin);
		if (isHistory) {
			fullReconcileToDOM(this.ytext, this.element, this.editor.schema, {
				preserveSelection: true,
				inlineDecorations: this.getInlineDecorationsForBlock(),
			});
			this.fieldEditor.notifyDomReconciled(
				this.fieldEditor.focusBlockId ?? undefined,
			);
			this.restoreDOMSelectionFromEditor();
			return;
		}

		const blockId = this.fieldEditor.focusBlockId;
		const isActiveCell = blockId
			? !!this._getActiveCellCoord(blockId)
			: false;
		if (isActiveCell) {
			fullReconcileToDOM(this.ytext, this.element, this.editor.schema, {
				preserveSelection: true,
				inlineDecorations: this.getInlineDecorationsForBlock(),
			});
			this.fieldEditor.notifyDomReconciled(blockId ?? undefined);
			if (
				this.pendingSelectionOverride != null ||
				event.transaction?.origin === "remote" ||
				event.transaction?.origin === "collaborator"
			) {
				this.restoreDOMSelectionFromEditor();
			}
			return;
		}

		const applied = applyDeltaToDOM(
			event.delta,
			this.element,
			this.editor.schema,
		);
		if (!applied) {
			fullReconcileToDOM(this.ytext, this.element, this.editor.schema, {
				preserveSelection: true,
				inlineDecorations: this.getInlineDecorationsForBlock(),
			});
			this.fieldEditor.notifyDomReconciled(blockId ?? undefined);
		}

		if (
			this.pendingSelectionOverride != null ||
			event.transaction?.origin === "remote" ||
			event.transaction?.origin === "collaborator"
		) {
			this.restoreDOMSelectionFromEditor();
		}
	};

	private applyTextDiffAsOps(
		blockId: string,
		diff: Array<
			| { type: "insert"; offset: number; text: string }
			| { type: "delete"; offset: number; length: number }
		>,
	): void {
		if (diff.length === 0) return;
		const ytext = this.ytext;
		if (!ytext) return;

		const ops: DocumentOp[] = [];
		const cellCoord = this._getActiveCellCoord(blockId);
		for (const op of diff) {
			if (op.type === "delete") {
				if (cellCoord) {
					ops.push({
						type: "delete-table-cell-text",
						blockId,
						row: cellCoord.row,
						col: cellCoord.col,
						offset: op.offset,
						length: op.length,
					});
				} else {
					ops.push({
						type: "delete-text",
						blockId,
						offset: op.offset,
						length: op.length,
					});
				}
				continue;
			}

			if (cellCoord) {
				ops.push({
					type: "insert-table-cell-text",
					blockId,
					row: cellCoord.row,
					col: cellCoord.col,
					offset: op.offset,
					text: op.text,
				});
			} else {
				ops.push({
					type: "insert-text",
					blockId,
					offset: op.offset,
					text: op.text,
					marks: this.fieldEditor.resolveInsertMarks(
						ytext,
						op.offset,
					),
				});
			}
		}

		if (ops.length === 0) return;

		const range = this.element ? getSelectionOffsets(this.element) : null;
		if (range) {
			this.pendingSelectionOverride = {
				blockId,
				anchorOffset: range.start,
				focusOffset: range.end,
				cell: cellCoord
					? { row: cellCoord.row, col: cellCoord.col }
					: undefined,
			};
		}

		this.editor.apply(ops, { origin: "user" });

		if (range) {
			if (cellCoord) {
				this.activeCellSelection = range;
			} else {
				this.fieldEditor.syncTextSelection(
					blockId,
					range.start,
					range.end,
				);
			}
		}
		this.ensureActiveDOMMatchesYText();
		this.restoreDOMSelectionFromEditor();
		this.scheduleActiveDOMMatchCheck();
		this.pendingSelectionOverride = null;
	}

	private ensureActiveDOMMatchesYText(): boolean {
		if (!this.element || !this.ytext) return false;
		if (extractTextFromDOM(this.element) === this.ytext.toString()) {
			return false;
		}

		fullReconcileToDOM(this.ytext, this.element, this.editor.schema, {
			preserveSelection: true,
			inlineDecorations: this.getInlineDecorationsForBlock(),
		});
		this.fieldEditor.notifyDomReconciled(
			this.fieldEditor.focusBlockId ?? undefined,
		);
		return true;
	}

	private scheduleActiveDOMMatchCheck(): void {
		if (this.pendingDomSyncFrame != null) {
			cancelAnimationFrame(this.pendingDomSyncFrame);
		}

		this.pendingDomSyncFrame = requestAnimationFrame(() => {
			this.pendingDomSyncFrame = null;
			if (this.ensureActiveDOMMatchesYText()) {
				this.restoreDOMSelectionFromEditor();
			}
		});
	}

	private getInlineDecorationsForBlock(): readonly InlineDecoration[] {
		const blockId = this.fieldEditor.focusBlockId;
		if (!blockId) {
			return [];
		}
		return this.editor
			.getDecorations()
			.forBlock(blockId)
			.filter(
				(decoration): decoration is InlineDecoration =>
					decoration.type === "inline",
			);
	}

	// ── Keyboard shortcuts ────────────────────────────────────

	private handleKeyDown = (event: KeyboardEvent): void => {
		if (!this.ytext) return;

		const handled = handleFieldEditorKeyDown({
			event,
			editor: this.editor,
			fieldEditor: this.fieldEditor,
			ytext: this.ytext,
			range: this.element ? getSelectionOffsets(this.element) : null,
		});
		if (handled) {
			event.preventDefault();
			return;
		}
	};

	resolveCurrentInputRange(): {
		start: number;
		end: number;
	} | null {
		const liveRange = this.element
			? getSelectionOffsets(this.element)
			: null;
		return (
			this.fieldEditor.resolveProgrammaticInputRange(
				this.fieldEditor.focusBlockId,
				liveRange,
			) ?? liveRange
		);
	}

	private handleSelectionChange = (): void => {
		if (!this.element) return;
		if (
			!this.fieldEditor.shouldHandleDomSelectionChange(
				this.isApplyingSelection,
			)
		) {
			return;
		}

		const focusBlockId = this.fieldEditor.focusBlockId;
		const activeCell = focusBlockId
			? this._getActiveCellCoord(focusBlockId)
			: null;
		if (activeCell) {
			const range = getSelectionOffsets(this.element);
			if (!range) return;
			this.activeCellSelection = range;
			return;
		}

		const root = this.element.closest(
			"[data-pen-editor-root]",
		) as HTMLElement | null;
		if (!root) return;

		const selection = domSelectionToEditor(root);
		if (!selection) return;
		const normalizedSelection = normalizeSelectionFormation(
			this.editor,
			selection,
		);

		if (normalizedSelection.type === "block") {
			this.fieldEditor.deactivate();
			this.editor.setSelection({
				type: "block",
				blockIds: normalizedSelection.blockIds,
			});
			return;
		}

		if (
			this.fieldEditor.shouldIgnoreDomTextSelection(
				normalizedSelection.anchor,
				normalizedSelection.focus,
			)
		) {
			this.restoreDOMSelectionFromEditor();
			return;
		}

		this.fieldEditor.applyDomTextSelection(
			normalizedSelection.anchor,
			normalizedSelection.focus,
		);
	};

	// ── Clipboard events ──────────────────────────────────────

	private handleCopyEvent = (event: ClipboardEvent): void => {
		event.preventDefault();
		handleCopy(this.editor, event);
	};

	private handleCutEvent = (event: ClipboardEvent): void => {
		event.preventDefault();
		handleCut(this.editor, event);
	};

	private handleDragStart = (event: DragEvent): void => {
		event.preventDefault();
	};

	private handleDrop = (event: DragEvent): void => {
		event.preventDefault();
	};
}

// ── Direct input handlers ──────────────────────────────────

type DirectHandler = (
	event: InputEvent,
	editor: Editor,
	ytext: FieldEditorTextLike,
	fieldEditor: FieldEditorInputController,
	element: HTMLElement,
	backend: ContentEditableBackend,
) => void;

const DIRECT_HANDLERS: Record<string, DirectHandler> = {
	insertText: (event, editor, ytext, fe, element, backend) => {
		const text = event.data ?? "";
		if (!text) return;
		if (hasMultiBlockTextSelection(editor)) {
			editor.replaceSelection(text);
			return;
		}
		const blockId = fe.focusBlockId;
		if (!blockId) return;
		const range = backend.resolveCurrentInputRange();
		if (!range) return;
		if (backend.applyListInputRule({ blockId, range, text })) {
			return;
		}
		const marks = fe.resolveInsertMarks(ytext, range.start);
		backend.applyInlineTextEdit({
			blockId,
			range,
			text,
			marks,
		});
	},

	insertReplacementText: (event, editor, ytext, fe, element, backend) => {
		const text = event.data ?? "";
		if (!text) return;
		if (hasMultiBlockTextSelection(editor)) {
			editor.replaceSelection(text);
			return;
		}
		const blockId = fe.focusBlockId;
		if (!blockId) return;
		const targetRanges = event.getTargetRanges?.();
		const range = targetRanges?.length
			? staticRangeToOffsets(targetRanges[0], element)
			: backend.resolveCurrentInputRange();
		if (!range) return;
		if (backend.applyListInputRule({ blockId, range, text })) {
			return;
		}
		const marks = fe.resolveInsertMarks(ytext, range.start);
		backend.applyInlineTextEdit({
			blockId,
			range,
			text,
			marks,
		});
	},

	deleteContentBackward: (_event, editor, ytext, fe, element, backend) => {
		if (hasMultiBlockTextSelection(editor)) {
			editor.deleteSelection();
			return;
		}
		const range = backend.resolveCurrentInputRange();
		if (!range) return;

		const target = applyDeleteBehavior(editor, {
			blockId: fe.focusBlockId ?? "",
			ytext,
			range,
			direction: "backward",
		});
		if (target) {
			if (target.selectBlock) {
				fe.deactivate();
				editor.selectBlock(target.blockId);
			} else {
				fe.activateTextSelection(
					target.blockId,
					target.anchorOffset,
					target.focusOffset,
				);
			}
			return;
		}

		if (range.start !== range.end) {
			backend.applyInlineTextEdit({
				blockId: fe.focusBlockId ?? "",
				range,
				text: "",
			});
			return;
		}

		if (range.start > 0) {
			backend.applyInlineTextEdit({
				blockId: fe.focusBlockId ?? "",
				range: { start: range.start - 1, end: range.start },
				text: "",
			});
		}
	},

	deleteContentForward: (_event, editor, ytext, fe, element, backend) => {
		if (hasMultiBlockTextSelection(editor)) {
			editor.deleteSelection();
			return;
		}
		const range = backend.resolveCurrentInputRange();
		if (!range) return;

		const target = applyDeleteBehavior(editor, {
			blockId: fe.focusBlockId ?? "",
			ytext,
			range,
			direction: "forward",
		});
		if (target) {
			if (target.selectBlock) {
				fe.deactivate();
				editor.selectBlock(target.blockId);
			} else {
				fe.activateTextSelection(
					target.blockId,
					target.anchorOffset,
					target.focusOffset,
				);
			}
			return;
		}

		if (range.start < ytext.length) {
			backend.applyInlineTextEdit({
				blockId: fe.focusBlockId ?? "",
				range: { start: range.start, end: range.start + 1 },
				text: "",
			});
		}
	},

	deleteByCut: (_event, editor, _ytext, fe, element, backend) => {
		if (hasMultiBlockTextSelection(editor)) {
			editor.deleteSelection();
			return;
		}
		const range = backend.resolveCurrentInputRange();
		if (!range || range.start === range.end) return;

		backend.applyInlineTextEdit({
			blockId: fe.focusBlockId ?? "",
			range,
			text: "",
		});
	},

	deleteWordBackward: (_event, editor, ytext, fe, element, backend) => {
		const range = backend.resolveCurrentInputRange();
		if (!range) return;

		if (range.start !== range.end) {
			backend.applyInlineTextEdit({
				blockId: fe.focusBlockId ?? "",
				range,
				text: "",
			});
			return;
		}

		const text = ytext.toString();
		let pos = range.start;
		while (pos > 0 && /\s/.test(text[pos - 1])) pos--;
		while (pos > 0 && !/\s/.test(text[pos - 1])) pos--;
		if (pos < range.start) {
			backend.applyInlineTextEdit({
				blockId: fe.focusBlockId ?? "",
				range: { start: pos, end: range.start },
				text: "",
			});
		}
	},

	deleteWordForward: (_event, editor, ytext, fe, element, backend) => {
		const range = backend.resolveCurrentInputRange();
		if (!range) return;

		if (range.start !== range.end) {
			backend.applyInlineTextEdit({
				blockId: fe.focusBlockId ?? "",
				range,
				text: "",
			});
			return;
		}

		const text = ytext.toString();
		let pos = range.end;
		while (pos < text.length && /\s/.test(text[pos])) pos++;
		while (pos < text.length && !/\s/.test(text[pos])) pos++;
		if (pos > range.end) {
			backend.applyInlineTextEdit({
				blockId: fe.focusBlockId ?? "",
				range: { start: range.end, end: pos },
				text: "",
			});
		}
	},

	insertParagraph: (_event, editor, ytext, fe, element, backend) => {
		const blockId = fe.focusBlockId;
		if (!blockId) return;
		const target = applyEnterBehavior(editor, {
			blockId,
			inputMode: fe.inputMode,
			ytext,
			range: backend.resolveCurrentInputRange(),
		});
		if (!target) return;

		fe.activateTextSelection(
			target.blockId,
			target.anchorOffset,
			target.focusOffset,
		);
	},

	insertLineBreak: (_event, _editor, ytext, fe, element, backend) => {
		const range = backend.resolveCurrentInputRange();
		if (!range) return;
		const blockId = fe.focusBlockId;
		if (!blockId) return;
		backend.applyInlineTextEdit({
			blockId,
			range,
			text: "\n",
			marks: fe.resolveInsertMarks(ytext, range.start),
		});
	},

	historyUndo: (_event, editor) => {
		editor.undoManager.undo();
	},

	historyRedo: (_event, editor) => {
		editor.undoManager.redo();
	},

	insertFromPaste: (event, editor, _ytext, fe) => {
		const importers =
			editor.internals.getSlot<PasteImporters>("paste:importers");
		handlePaste(event, editor, fe, importers ?? undefined);
	},

	formatBold: (_event, editor) => {
		toggleInlineMark(editor, "bold");
	},

	formatItalic: (_event, editor) => {
		toggleInlineMark(editor, "italic");
	},

	formatUnderline: (_event, editor) => {
		toggleInlineMark(editor, "underline");
	},

	formatStrikeThrough: (_event, editor) => {
		toggleInlineMark(editor, "strikethrough");
	},
};

function hasMultiBlockTextSelection(editor: Editor): boolean {
	const selection = editor.selection;
	return selection?.type === "text" && selection.isMultiBlock;
}

function requiresResolvedInputRange(inputType: string): boolean {
	return (
		inputType === "insertText" ||
		inputType === "insertReplacementText" ||
		inputType === "deleteContentBackward" ||
		inputType === "deleteContentForward" ||
		inputType === "deleteByCut" ||
		inputType === "deleteWordBackward" ||
		inputType === "deleteWordForward" ||
		inputType === "insertLineBreak"
	);
}

function canResolveInputRange(
	event: InputEvent,
	element: HTMLElement,
): boolean {
	if (event.inputType === "insertReplacementText") {
		const targetRanges = event.getTargetRanges?.();
		if (targetRanges?.length) {
			return staticRangeToOffsets(targetRanges[0], element) !== null;
		}
	}

	return getSelectionOffsets(element) !== null;
}

/**
 * Convert a StaticRange (from getTargetRanges) to character offsets
 * within the inline content element.
 */
function staticRangeToOffsets(
	staticRange: StaticRange,
	element: HTMLElement,
): { start: number; end: number } | null {
	if (
		(staticRange.startContainer !== element &&
			!element.contains(staticRange.startContainer)) ||
		(staticRange.endContainer !== element &&
			!element.contains(staticRange.endContainer))
	) {
		return null;
	}

	const startOffset = domPointToOffset(
		element,
		staticRange.startContainer,
		staticRange.startOffset,
	);
	const endOffset = domPointToOffset(
		element,
		staticRange.endContainer,
		staticRange.endOffset,
	);

	return {
		start: Math.min(startOffset, endOffset),
		end: Math.max(startOffset, endOffset),
	};
}

function setSelectionOffsets(
	element: HTMLElement,
	startOffset: number,
	endOffset: number,
): void {
	const selection = element.ownerDocument?.getSelection();
	if (!selection) return;

	const startPoint = resolveDomPointForOffset(element, startOffset);
	const endPoint = resolveDomPointForOffset(element, endOffset);
	if (!startPoint || !endPoint) return;

	selection.removeAllRanges();

	const setBaseAndExtent = (
		selection as Selection & {
			setBaseAndExtent?: (
				anchorNode: Node,
				anchorOffset: number,
				focusNode: Node,
				focusOffset: number,
			) => void;
		}
	).setBaseAndExtent;
	if (typeof setBaseAndExtent === "function") {
		try {
			setBaseAndExtent.call(
				selection,
				startPoint.node,
				startPoint.offset,
				endPoint.node,
				endPoint.offset,
			);
			return;
		} catch {
			// Fall back to the range-based path in non-browser test environments.
		}
	}

	const collapseRange = element.ownerDocument.createRange();
	collapseRange.setStart(startPoint.node, startPoint.offset);
	collapseRange.collapse(true);
	selection.addRange(collapseRange);

	if (
		(startPoint.node !== endPoint.node ||
			startPoint.offset !== endPoint.offset) &&
		typeof selection.extend === "function"
	) {
		selection.extend(endPoint.node, endPoint.offset);
		return;
	}

	selection.removeAllRanges();
	const range = element.ownerDocument.createRange();
	range.setStart(startPoint.node, startPoint.offset);
	range.setEnd(endPoint.node, endPoint.offset);
	selection.addRange(range);
}

function resolveDomPointForOffset(
	element: HTMLElement,
	targetOffset: number,
): { node: Node; offset: number } | null {
	const walker = element.ownerDocument.createTreeWalker(
		element,
		NodeFilter.SHOW_TEXT,
		null,
	);
	let remaining = Math.max(0, targetOffset);
	let textNode = walker.nextNode() as Text | null;

	while (textNode) {
		const length = textNode.textContent?.length ?? 0;
		if (remaining <= length) {
			return { node: textNode, offset: remaining };
		}
		remaining -= length;
		textNode = walker.nextNode() as Text | null;
	}

	if (element.lastChild) {
		if (element.lastChild.nodeType === Node.TEXT_NODE) {
			const textLength = element.lastChild.textContent?.length ?? 0;
			return {
				node: element.lastChild,
				offset: textLength,
			};
		}
		const childCount = element.lastChild.childNodes.length;
		return { node: element.lastChild, offset: childCount };
	}

	return { node: element, offset: 0 };
}

function rebaseTextDiffOps(
	ops: Array<
		| { type: "insert"; offset: number; text: string }
		| { type: "delete"; offset: number; length: number }
	>,
	deferredRemoteDeltas: Array<{ delta: FieldEditorDelta[] }>,
): Array<
	| { type: "insert"; offset: number; text: string }
	| { type: "delete"; offset: number; length: number }
> {
	if (deferredRemoteDeltas.length === 0 || ops.length === 0) {
		return ops;
	}

	return ops
		.map((op) => {
			if (op.type === "insert") {
				return {
					type: "insert" as const,
					offset: mapOffsetThroughRemoteDeltas(
						op.offset,
						deferredRemoteDeltas,
					),
					text: op.text,
				};
			}

			const start = mapOffsetThroughRemoteDeltas(
				op.offset,
				deferredRemoteDeltas,
			);
			const end = mapOffsetThroughRemoteDeltas(
				op.offset + op.length,
				deferredRemoteDeltas,
			);
			return {
				type: "delete" as const,
				offset: start,
				length: Math.max(0, end - start),
			};
		})
		.filter((op) => {
			if (op.type === "insert") {
				return true;
			}
			return op.length > 0;
		});
}

function mapOffsetThroughRemoteDeltas(
	originalOffset: number,
	deferredRemoteDeltas: Array<{ delta: FieldEditorDelta[] }>,
): number {
	let mappedOffset = originalOffset;

	for (const { delta } of deferredRemoteDeltas) {
		let cursor = 0;
		for (const part of delta) {
			if (part.retain != null) {
				cursor += part.retain;
				continue;
			}

			if (part.delete != null) {
				if (cursor < mappedOffset) {
					const deletedBeforeOffset = Math.min(
						part.delete,
						mappedOffset - cursor,
					);
					mappedOffset -= deletedBeforeOffset;
				}
				continue;
			}

			if (part.insert != null) {
				const insertedLength =
					typeof part.insert === "string" ? part.insert.length : 1;
				if (cursor <= mappedOffset) {
					mappedOffset += insertedLength;
				}
				cursor += insertedLength;
			}
		}
	}

	return mappedOffset;
}
