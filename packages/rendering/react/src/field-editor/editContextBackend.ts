import { INPUT_RULES_ENGINE_SLOT_KEY } from "@pen/types";
import type { DocumentOp, Editor, InlineDecoration, InputBackend } from "@pen/types";
import { supportsInlineInputRules } from "@pen/types";
import type { FieldEditorInputController } from "./controller";
import { fullReconcileToDOM, applyDeltaToDOM } from "./reconciler";
import {
	domSelectionToEditor,
	editorSelectionToDOM,
	getDirectionalSelectionOffsets,
} from "./selectionBridge";
import { normalizeSelectionFormation } from "../utils/selectionFormation";
import { handleFieldEditorKeyDown } from "./keyHandling";
import { isHistoryTransactionOrigin } from "./historyOrigin";
import { handleCopy, handleCut, handleClipboardPaste } from "./clipboard";
import type { PasteImporters } from "../context/editorContext";
import { applyListInputRule } from "./commands";
import type {
	FieldEditorObserver,
	FieldEditorTextChangeEvent,
	FieldEditorTextLike,
	InlineInputRuleEngine,
} from "./crdt";
import { matchInlineInputRule } from "../utils/inlineInputRule";

type EditContextTextUpdateEvent = Event & {
	updateRangeStart: number;
	updateRangeEnd: number;
	text: string;
	selectionStart?: number;
	selectionEnd?: number;
};

type EditContextTextFormat = {
	rangeStart: number;
	rangeEnd: number;
	underlineStyle?: string;
	underlineThickness?: string;
};

type EditContextTextFormatUpdateEvent = Event & {
	getTextFormats?(): EditContextTextFormat[];
};

type EditContextCharacterBoundsUpdateEvent = Event & {
	rangeStart: number;
	rangeEnd: number;
};

declare class EditContext {
	constructor(options?: {
		text?: string;
		selectionStart?: number;
		selectionEnd?: number;
	});
	updateText(start: number, end: number, text: string): void;
	updateSelection(start: number, end: number): void;
	updateCharacterBounds(start: number, rects: DOMRect[]): void;
	addEventListener(type: string, handler: (event: Event) => void): void;
	removeEventListener(type: string, handler: (event: Event) => void): void;
	readonly text: string;
	readonly selectionStart: number;
	readonly selectionEnd: number;
}

type EditContextConstructor = typeof EditContext;
type EditContextGlobal = typeof globalThis & {
	EditContext?: EditContextConstructor;
};

export class EditContextBackend implements InputBackend {
	private editContext: EditContext | null = null;
	private element: HTMLElement | null = null;
	private ytext: FieldEditorTextLike | null = null;
	private observer: FieldEditorObserver | null = null;
	private isApplyingSelection = 0;
	private pendingSelectionOverride: {
		blockId: string;
		anchorOffset: number;
		focusOffset: number;
	} | null = null;
	private editor: Editor;
	private fieldEditor: FieldEditorInputController;

	constructor(editor: Editor, fieldEditor: FieldEditorInputController) {
		this.editor = editor;
		this.fieldEditor = fieldEditor;
	}

	activate(element: HTMLElement, ytext: unknown): void {
		this.element = element;
		this.ytext = ytext as FieldEditorTextLike;
		this.fieldEditor.setComposing(false);

		const editContextConstructor = (globalThis as EditContextGlobal).EditContext;
		if (!editContextConstructor) {
			throw new Error("EditContext is not available in this environment.");
		}

		this.editContext = new editContextConstructor({
			text: this.ytext.toString(),
			selectionStart: 0,
			selectionEnd: 0,
		});

		const ec = this.editContext!;

		(
			element as HTMLElement & { editContext: EditContext | null }
		).editContext = ec;

		element.addEventListener("keydown", this.handleKeyDown);
		element.addEventListener("copy", this.handleCopyEvent);
		element.addEventListener("cut", this.handleCutEvent);
		element.addEventListener("paste", this.handlePasteEvent);
		element.addEventListener("dragstart", this.handleDragStart);
		element.addEventListener("drop", this.handleDrop);
		ec.addEventListener("textupdate", this.handleTextUpdate);
		ec.addEventListener("textformatupdate", this.handleTextFormatUpdate);
		ec.addEventListener(
			"characterboundsupdate",
			this.handleCharacterBoundsUpdate,
		);
		element.ownerDocument?.addEventListener(
			"selectionchange",
			this.handleSelectionChange,
		);

		this.observer = (event) => this.handleYTextChange(event);
		this.ytext.observe(this.observer);

		fullReconcileToDOM(this.ytext, element, this.editor.schema, {
			inlineDecorations: this.getInlineDecorationsForBlock(),
		});
		this.isApplyingSelection++;
		this.updateSelection(null);
		element.focus({ preventScroll: true });
		requestAnimationFrame(() => {
			this.isApplyingSelection--;
		});
	}

	deactivate(): void {
		if (this.editContext) {
			this.editContext.removeEventListener(
				"textupdate",
				this.handleTextUpdate,
			);
			this.editContext.removeEventListener(
				"textformatupdate",
				this.handleTextFormatUpdate,
			);
			this.editContext.removeEventListener(
				"characterboundsupdate",
				this.handleCharacterBoundsUpdate,
			);
		}
		if (this.observer && this.ytext) {
			this.ytext.unobserve(this.observer);
		}
		if (this.element) {
			this.element.removeEventListener("keydown", this.handleKeyDown);
			this.element.removeEventListener("copy", this.handleCopyEvent);
			this.element.removeEventListener("cut", this.handleCutEvent);
			this.element.removeEventListener("paste", this.handlePasteEvent);
			this.element.removeEventListener("dragstart", this.handleDragStart);
			this.element.removeEventListener("drop", this.handleDrop);
			this.element.ownerDocument?.removeEventListener(
				"selectionchange",
				this.handleSelectionChange,
			);
			(
				this.element as HTMLElement & {
					editContext: EditContext | null;
				}
			).editContext = null;
		}
		this.editContext = null;
		this.element = null;
		this.ytext = null;
		this.observer = null;
		this.pendingSelectionOverride = null;
		this.fieldEditor.setComposing(false);
	}

	updateSelection(_relPos: unknown): void {
		if (!this.editContext || !this.ytext) return;

		const selection = this.fieldEditor.selection;
		const blockId = this.fieldEditor.focusBlockId;
		if (
			selection?.type === "text" &&
			blockId &&
			selection.anchor.blockId === blockId &&
			selection.focus.blockId === blockId
		) {
			this.editContext.updateSelection(
				selection.anchor.offset,
				selection.focus.offset,
			);
			this.isApplyingSelection++;
			this.projectDOMSelection(
				blockId,
				selection.anchor.offset,
				selection.focus.offset,
			);
			requestAnimationFrame(() => {
				this.isApplyingSelection--;
			});
			return;
		}

		const len = this.ytext.length;
		this.editContext.updateSelection(len, len);
	}

	private projectDOMSelection(
		blockId: string,
		anchorOffset: number,
		focusOffset: number,
	): void {
		if (!this.element) return;
		const root = this.element.closest(
			"[data-pen-editor-root]",
		) as HTMLElement | null;
		if (!root) return;
		editorSelectionToDOM(
			root,
			{ blockId, offset: anchorOffset },
			{ blockId, offset: focusOffset },
		);
	}

	private handleTextUpdate = (event: Event): void => {
		if (!this.ytext) return;
		const {
			updateRangeStart,
			updateRangeEnd,
			text,
			selectionStart,
			selectionEnd,
		} = event as EditContextTextUpdateEvent;
		const blockId = this.fieldEditor.focusBlockId;
		if (!blockId) return;

		const block = this.editor.getBlock(blockId);
		if (!block) {
			this.fieldEditor.deactivate();
			return;
		}

		const range = {
			start: updateRangeStart,
			end: updateRangeEnd,
		};
		const listInputRuleTarget = applyListInputRule(this.editor, {
			blockId,
			range,
			text,
		});
		if (listInputRuleTarget) {
			this.pendingSelectionOverride = {
				blockId: listInputRuleTarget.blockId,
				anchorOffset: listInputRuleTarget.anchorOffset,
				focusOffset: listInputRuleTarget.focusOffset,
			};
			this.fieldEditor.syncTextSelection(
				listInputRuleTarget.blockId,
				listInputRuleTarget.anchorOffset,
				listInputRuleTarget.focusOffset,
			);
			this.restoreDOMCaret();
			this.pendingSelectionOverride = null;
			return;
		}

		const inlineInputRuleTarget = this.applyInlineInputRule(
			blockId,
			range.start,
			text,
		);
		if (inlineInputRuleTarget) {
			this.pendingSelectionOverride = inlineInputRuleTarget;
			this.fieldEditor.syncTextSelection(
				inlineInputRuleTarget.blockId,
				inlineInputRuleTarget.anchorOffset,
				inlineInputRuleTarget.focusOffset,
			);
			this.restoreDOMCaret();
			this.pendingSelectionOverride = null;
			return;
		}

		this.pendingSelectionOverride =
			typeof selectionStart === "number" &&
			typeof selectionEnd === "number"
				? {
						blockId,
						anchorOffset: selectionStart,
						focusOffset: selectionEnd,
					}
				: null;

		const ops: DocumentOp[] = [];
		if (updateRangeEnd > updateRangeStart) {
			ops.push({
				type: "delete-text" as const,
				blockId,
				offset: range.start,
				length: range.end - range.start,
			});
		}
		if (text.length > 0) {
			ops.push({
				type: "insert-text" as const,
				blockId,
				offset: range.start,
				text,
				marks: this.fieldEditor.resolveInsertMarks(this.ytext, range.start),
			});
		}
		if (ops.length > 0) {
			this.editor.apply(ops, { origin: "user" });
		}

		if (
			typeof selectionStart === "number" &&
			typeof selectionEnd === "number"
		) {
			this.fieldEditor.syncTextSelection(
				blockId,
				selectionStart,
				selectionEnd,
			);
			this.restoreDOMCaret();
		}

		this.pendingSelectionOverride = null;
	};

	private applyInlineInputRule(
		blockId: string,
		offset: number,
		text: string,
	):
		| {
				blockId: string;
				anchorOffset: number;
				focusOffset: number;
		  }
		| null {
		if (text.length !== 1) {
			return null;
		}

		const block = this.editor.getBlock(blockId);
		if (!block) {
			return null;
		}

		const blockSchema = this.editor.schema.resolve(block.type);
		if (!supportsInlineInputRules(blockSchema)) {
			return null;
		}

		const inputRuleEngine =
			this.editor.internals.getSlot<InlineInputRuleEngine>(
				INPUT_RULES_ENGINE_SLOT_KEY,
			) ?? null;
		const ops =
			inputRuleEngine?.tryMatchInline(this.editor, blockId, text, {
				offset,
			}) ?? this.resolveFallbackInlineInputRule(blockId, block.textContent(), offset, text);
		if (!ops) {
			return null;
		}

		const selectionTarget = resolveInlineSelectionTarget(blockId, ops);
		if (!selectionTarget) {
			return null;
		}

		this.editor.apply(ops, { origin: "input-rule" });
		return selectionTarget;
	}

	private resolveFallbackInlineInputRule(
		blockId: string,
		blockText: string,
		offset: number,
		text: string,
	): DocumentOp[] | null {
		const match = matchInlineInputRule(blockText, offset, text);
		if (!match) {
			return null;
		}

		const markType = Object.keys(match.marks)[0];
		if (!markType || !this.editor.schema.resolveInline(markType)) {
			return null;
		}

		return [
			{
				type: "delete-text",
				blockId,
				offset: match.deleteRange.start,
				length: match.deleteRange.end - match.deleteRange.start,
			},
			{
				type: "insert-text",
				blockId,
				offset: match.deleteRange.start,
				text: match.text,
				marks: match.marks,
			},
		];
	}

	private handleTextFormatUpdate = (event: Event): void => {
		// IME composition underline rendering.
		// The textformatupdate event provides ranges with underline styles
		// for visual feedback during IME composition. These are rendered
		// as ephemeral decorations (not CRDT marks) and cleared when
		// textupdate confirms the final text.
		if (!this.element) return;

		const ranges =
			(event as EditContextTextFormatUpdateEvent).getTextFormats?.() ?? [];
		for (const fmt of ranges) {
			const { rangeStart, rangeEnd, underlineStyle, underlineThickness } =
				fmt;
			if (!underlineStyle) continue;

			// Apply inline decoration-style attributes via mark wrappers.
			// This is a visual-only effect that doesn't modify the CRDT.
			const inlineEls = this.element.querySelectorAll(
				"[data-pen-inline-content]",
			);
			for (const el of inlineEls) {
				const walker = document.createTreeWalker(
					el,
					NodeFilter.SHOW_TEXT,
					null,
				);
				let offset = 0;
				let textNode: Text | null;
				while ((textNode = walker.nextNode() as Text | null)) {
					const len = textNode.textContent?.length ?? 0;
					const segStart = offset;
					const segEnd = offset + len;
					if (segEnd > rangeStart && segStart < rangeEnd) {
						const parentEl = textNode.parentElement;
						if (parentEl) {
							parentEl.style.textDecoration = underlineStyle;
							if (underlineThickness) {
								parentEl.style.textDecorationThickness =
									underlineThickness;
							}
						}
					}
					offset += len;
				}
			}
		}
	};

	private handleCharacterBoundsUpdate = (event: Event): void => {
		if (!this.element || !this.editContext) return;

		const { rangeStart, rangeEnd } =
			event as EditContextCharacterBoundsUpdateEvent;
		const rects: DOMRect[] = [];

		for (let i = rangeStart; i < rangeEnd; i++) {
			const rect = getCharacterRect(this.element, i);
			rects.push(rect);
		}

		this.editContext.updateCharacterBounds(rangeStart, rects);
	};

	private handleSelectionChange = (): void => {
		if (!this.element || !this.editContext) return;
		if (!this.fieldEditor.shouldHandleDomSelectionChange(this.isApplyingSelection)) {
			return;
		}

		const root = this.element.closest(
			"[data-pen-editor-root]",
		) as HTMLElement | null;
		if (!root) return;

		const mappedSelection = domSelectionToEditor(root);
		if (!mappedSelection) return;
		const normalizedSelection = normalizeSelectionFormation(
			this.editor,
			mappedSelection,
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
			normalizedSelection.anchor.blockId !== normalizedSelection.focus.blockId
		) {
			this.fieldEditor.applyDocumentTextSelection(
				normalizedSelection.anchor,
				normalizedSelection.focus,
			);
			return;
		}

		if (
			normalizedSelection.anchor.blockId !== this.fieldEditor.focusBlockId
		) {
			this.fieldEditor.activateTextSelection(
				normalizedSelection.anchor.blockId,
				normalizedSelection.anchor.offset,
				normalizedSelection.focus.offset,
			);
			return;
		}

		const selection = this.element.ownerDocument?.getSelection();
		if (!selection?.rangeCount) return;
		if (!this.element.contains(selection.anchorNode)) return;
		if (!this.element.contains(selection.focusNode)) return;

		const offsets = getDirectionalSelectionOffsets(this.element);
		if (!offsets) return;

		this.editContext.updateSelection(offsets.start, offsets.end);
		this.fieldEditor.syncTextSelection(
			normalizedSelection.anchor.blockId,
			offsets.anchor,
			offsets.focus,
		);
	};

	private handleYTextChange = (event: FieldEditorTextChangeEvent): void => {
		if (!this.editContext || !this.element || !this.ytext) return;
		const isHistory = isHistoryTransactionOrigin(event.transaction?.origin);
		if (isHistory) {
			const nextText = this.ytext?.toString?.() ?? "";
			this.editContext.updateText(0, this.editContext.text.length, nextText);
			const clampedSelectionStart = Math.min(
				this.editContext.selectionStart,
				nextText.length,
			);
			const clampedSelectionEnd = Math.min(
				this.editContext.selectionEnd,
				nextText.length,
			);
			this.editContext.updateSelection(
				clampedSelectionStart,
				clampedSelectionEnd,
			);
			return;
		}

		const delta = event.delta;
		let offset = 0;
		for (const entry of delta) {
			if (entry.retain != null) {
				offset += entry.retain;
			} else if (typeof entry.insert === "string") {
				this.editContext.updateText(offset, offset, entry.insert);
				offset += entry.insert.length;
			} else if (entry.delete != null) {
				this.editContext.updateText(offset, offset + entry.delete, "");
			}
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
		}

		this.restoreDOMCaret();
	};

	private restoreDOMCaret(): void {
		if (!this.editContext || !this.element) return;

		const root = this.element.closest(
			"[data-pen-editor-root]",
		) as HTMLElement | null;
		const selection = this.fieldEditor.selection;
		const blockId = this.fieldEditor.focusBlockId;
		const pendingSelection =
			blockId != null &&
			this.pendingSelectionOverride?.blockId === blockId
				? this.pendingSelectionOverride
				: null;
		const anchorOffset =
			pendingSelection?.anchorOffset ??
			(selection?.type === "text" &&
			blockId &&
			selection.anchor.blockId === blockId &&
			selection.focus.blockId === blockId
				? selection.anchor.offset
				: null);
		const focusOffset =
			pendingSelection?.focusOffset ??
			(selection?.type === "text" &&
			blockId &&
			selection.anchor.blockId === blockId &&
			selection.focus.blockId === blockId
				? selection.focus.offset
				: null);
		if (root && blockId && anchorOffset != null && focusOffset != null) {
			editorSelectionToDOM(
				root,
				{ blockId, offset: anchorOffset },
				{ blockId, offset: focusOffset },
			);
			return;
		}

		const start = this.editContext.selectionStart;
		const end = this.editContext.selectionEnd;

		const anchorPoint = findTextPosition(this.element, start);
		const focusPoint =
			start === end ? anchorPoint : findTextPosition(this.element, end);
		if (!anchorPoint || !focusPoint) return;

		const sel = this.element.ownerDocument?.getSelection();
		if (!sel) return;

		sel.removeAllRanges();
		const range = document.createRange();
		range.setStart(anchorPoint.node, anchorPoint.offset);
		range.setEnd(focusPoint.node, focusPoint.offset);
		sel.addRange(range);
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
				(decoration): decoration is InlineDecoration => decoration.type === "inline",
			);
	}

	private handleKeyDown = (event: KeyboardEvent): void => {
		if (!this.editContext || !this.element || !this.ytext) return;

		const liveDomOffsets = getDirectionalSelectionOffsets(this.element);
		const range = liveDomOffsets
			? {
					start: liveDomOffsets.start,
					end: liveDomOffsets.end,
				}
			: {
					start: Math.min(
						this.editContext.selectionStart,
						this.editContext.selectionEnd,
					),
					end: Math.max(
						this.editContext.selectionStart,
						this.editContext.selectionEnd,
					),
				};
		if (liveDomOffsets) {
			this.editContext.updateSelection(range.start, range.end);
		}

		const handled = handleFieldEditorKeyDown({
			event,
			editor: this.editor,
			fieldEditor: this.fieldEditor,
			ytext: this.ytext,
			range,
		});
		if (handled) {
			event.preventDefault();
		}
	};

	private handleCopyEvent = (event: ClipboardEvent): void => {
		event.preventDefault();
		handleCopy(this.editor, event);
	};

	private handleCutEvent = (event: ClipboardEvent): void => {
		event.preventDefault();
		handleCut(this.editor, event);
	};

	private handlePasteEvent = (event: ClipboardEvent): void => {
		event.preventDefault();
		const importers =
			this.editor.internals.getSlot<PasteImporters>("paste:importers");
		handleClipboardPaste(
			event,
			this.editor,
			this.fieldEditor,
			importers ?? undefined,
		);
	};

	private handleDragStart = (event: DragEvent): void => {
		event.preventDefault();
	};

	private handleDrop = (event: DragEvent): void => {
		event.preventDefault();
	};
}

function resolveInlineSelectionTarget(
	blockId: string,
	ops: DocumentOp[],
):
	| {
			blockId: string;
			anchorOffset: number;
			focusOffset: number;
	  }
	| null {
	let nextOffset: number | null = null;
	for (const op of ops) {
		if (op.type === "insert-text" && op.blockId === blockId) {
			nextOffset = op.offset + op.text.length;
		}
	}

	if (nextOffset == null) {
		return null;
	}

	return {
		blockId,
		anchorOffset: nextOffset,
		focusOffset: nextOffset,
	};
}

/**
 * Get the DOMRect for a character at the given offset within the element.
 * Walks text nodes to locate the character, then uses Range.getBoundingClientRect().
 */
function getCharacterRect(element: HTMLElement, charOffset: number): DOMRect {
	const walker = document.createTreeWalker(
		element,
		NodeFilter.SHOW_TEXT,
		null,
	);
	let remaining = charOffset;
	let textNode: Text | null;

	while ((textNode = walker.nextNode() as Text | null)) {
		const len = textNode.textContent?.length ?? 0;
		if (remaining < len) {
			const range = document.createRange();
			range.setStart(textNode, remaining);
			range.setEnd(textNode, remaining + 1);
			return range.getBoundingClientRect();
		}
		remaining -= len;
	}

	// Fallback: return the element's bounding rect
	return element.getBoundingClientRect();
}

function findTextPosition(
	container: HTMLElement,
	charOffset: number,
): { node: Node; offset: number } | null {
	const walker = document.createTreeWalker(
		container,
		NodeFilter.SHOW_TEXT,
		null,
	);
	let remaining = charOffset;
	let textNode: Text | null;

	while ((textNode = walker.nextNode() as Text | null)) {
		const len = textNode.textContent?.length ?? 0;
		if (remaining <= len) {
			return { node: textNode, offset: remaining };
		}
		remaining -= len;
	}

	const last = container.lastChild;
	if (last) {
		return { node: last, offset: last.textContent?.length ?? 0 };
	}
	return { node: container, offset: 0 };
}
