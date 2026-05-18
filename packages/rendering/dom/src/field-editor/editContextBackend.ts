import { INPUT_RULES_ENGINE_SLOT_KEY } from "@pen/types";
import type {
	DocumentOp,
	Editor,
	InlineDecoration,
	InputBackend,
} from "@pen/types";
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
import type { PasteImporters } from "../types/paste";
import { applyListInputRule } from "./commands";
import { isFieldEditorTextEditingKey } from "../utils/textEntryTarget";
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

type EditContextSelection = {
	blockId: string;
	anchorOffset: number;
	focusOffset: number;
};

type EditContextSelectionOptions = {
	source?: "text-update";
};

type EditContextRange = {
	start: number;
	end: number;
};

type DirectionalSelectionOffsets = NonNullable<
	ReturnType<typeof getDirectionalSelectionOffsets>
>;

type KeyDownRangeResolution = {
	range: EditContextRange;
	nextSelection: EditContextSelection | null;
	shouldSyncEditContextSelection: boolean;
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

const ZERO_WIDTH_SPACE = "\u200B";

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
	private editContextSelection: EditContextSelection | null = null;
	// A textupdate carries the freshest post-input caret. Keep it authoritative
	// until a real user selection gesture or navigation key moves the caret.
	private authoritativeTextInputSelection: EditContextSelection | null = null;
	private pendingSelectionOverride: EditContextSelection | null = null;
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

		const editContextConstructor = (globalThis as EditContextGlobal)
			.EditContext;
		if (!editContextConstructor) {
			throw new Error(
				"EditContext is not available in this environment.",
			);
		}

		const initialText = this.ytext.toString();
		const initialEditContextText = toEditContextText(initialText);
		const initialSelectionOffset = isLogicallyEmptyText(initialText)
			? 0
			: initialEditContextText.length;
		this.editContext = new editContextConstructor({
			text: initialEditContextText,
			selectionStart: initialSelectionOffset,
			selectionEnd: initialSelectionOffset,
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
		element.addEventListener("pointerdown", this.handlePointerDown);
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
		this.fieldEditor.notifyDomReconciled(
			this.fieldEditor.focusBlockId ?? undefined,
		);
		this.isApplyingSelection++;
		this.updateSelection();
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
			this.element.removeEventListener(
				"pointerdown",
				this.handlePointerDown,
			);
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
		this.editContextSelection = null;
		this.authoritativeTextInputSelection = null;
		this.pendingSelectionOverride = null;
		this.fieldEditor.setComposing(false);
	}

	updateSelection(): void {
		if (!this.editContext || !this.ytext) return;

		const selection = this.fieldEditor.selection;
		const blockId = this.fieldEditor.focusBlockId;
		if (
			selection?.type === "text" &&
			blockId &&
			selection.anchor.blockId === blockId &&
			selection.focus.blockId === blockId
		) {
			const anchorOffset = this.resolveEditContextOffset(
				selection.anchor.offset,
			);
			const focusOffset = this.resolveEditContextOffset(
				selection.focus.offset,
			);
			this.setEditContextSelection({
				blockId,
				anchorOffset,
				focusOffset,
			});
			this.isApplyingSelection++;
			this.projectDOMSelection(blockId, anchorOffset, focusOffset);
			requestAnimationFrame(() => {
				this.isApplyingSelection--;
			});
			return;
		}

		const len = isLogicallyEmptyText(this.ytext.toString())
			? 0
			: this.ytext.length;
		this.editContext.updateSelection(len, len);
		this.editContextSelection = blockId
			? {
					blockId,
					anchorOffset: len,
					focusOffset: len,
				}
			: null;
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

		const resolvedTextUpdate = this.resolveTextUpdateRange({
			blockId,
			updateRangeStart,
			updateRangeEnd,
			text,
			selectionStart,
			selectionEnd,
		});
		const { range } = resolvedTextUpdate;
		const listInputRuleTarget = applyListInputRule(this.editor, {
			blockId,
			range,
			text,
		});
		if (listInputRuleTarget) {
			const nextSelection = {
				blockId: listInputRuleTarget.blockId,
				anchorOffset: listInputRuleTarget.anchorOffset,
				focusOffset: listInputRuleTarget.focusOffset,
			};
			this.pendingSelectionOverride = nextSelection;
			this.setEditContextSelection(nextSelection, {
				source: "text-update",
			});
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
			this.setEditContextSelection(inlineInputRuleTarget, {
				source: "text-update",
			});
			this.fieldEditor.syncTextSelection(
				inlineInputRuleTarget.blockId,
				inlineInputRuleTarget.anchorOffset,
				inlineInputRuleTarget.focusOffset,
			);
			this.restoreDOMCaret();
			this.pendingSelectionOverride = null;
			return;
		}

		this.pendingSelectionOverride = resolvedTextUpdate.selection;

		const ops: DocumentOp[] = [];
		if (range.end > range.start) {
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
				marks: this.fieldEditor.resolveInsertMarks(
					this.ytext,
					range.start,
				),
			});
		}
		if (ops.length > 0) {
			this.editor.apply(ops, { origin: "user" });
		}

		if (resolvedTextUpdate.selection) {
			this.setEditContextSelection(resolvedTextUpdate.selection, {
				source: "text-update",
			});
			this.fieldEditor.syncTextSelection(
				blockId,
				resolvedTextUpdate.selection.anchorOffset,
				resolvedTextUpdate.selection.focusOffset,
			);
			this.restoreDOMCaret();
		}

		this.pendingSelectionOverride = null;
	};

	private resolveTextUpdateRange(input: {
		blockId: string;
		updateRangeStart: number;
		updateRangeEnd: number;
		text: string;
		selectionStart?: number;
		selectionEnd?: number;
	}): {
		range: { start: number; end: number };
		selection: EditContextSelection | null;
	} {
		const selection = this.fieldEditor.selection;
		const isLogicallyEmpty = isLogicallyEmptyText(
			this.ytext?.toString() ?? "",
		);
		const editorSelectionRange = this.resolveEditorSelectionRange(
			input.blockId,
		);
		const isCollapsedInsert =
			input.text.length > 0 &&
			input.updateRangeStart === input.updateRangeEnd;
		const programmaticInputRange =
			this.fieldEditor.resolveProgrammaticInputRange(input.blockId, {
				start: input.updateRangeStart,
				end: input.updateRangeEnd,
			});
		const editContextCaret = collapsedSelectionOffset(
			this.editContextSelection,
			input.blockId,
		);
		const authoritativeInputCaret = collapsedSelectionOffset(
			this.authoritativeTextInputSelection,
			input.blockId,
		);
		const editorCaret =
			selection?.type === "text" &&
			selection.isCollapsed &&
			selection.focus.blockId === input.blockId
				? selection.focus.offset
				: null;
		const trustedCaret =
			authoritativeInputCaret ??
			(isLogicallyEmpty ? 0 : (editContextCaret ?? editorCaret));
		const shouldUseTrustedCaret =
			isCollapsedInsert &&
			trustedCaret != null &&
			trustedCaret !== input.updateRangeStart;
		const shouldUseEditorSelectionRange =
			editorSelectionRange != null &&
			input.updateRangeStart === input.updateRangeEnd &&
			(input.updateRangeStart !== editorSelectionRange.start ||
				input.updateRangeEnd !== editorSelectionRange.end);
		const shouldClampEmptyRange =
			isLogicallyEmpty && authoritativeInputCaret == null;
		const rangeStart = programmaticInputRange
			? programmaticInputRange.start
			: shouldUseEditorSelectionRange
				? editorSelectionRange.start
				: shouldClampEmptyRange
					? 0
					: shouldUseTrustedCaret
						? trustedCaret
						: input.updateRangeStart;
		const rangeEnd = programmaticInputRange
			? programmaticInputRange.end
			: shouldUseEditorSelectionRange
				? editorSelectionRange.end
				: shouldClampEmptyRange
					? 0
					: shouldUseTrustedCaret
						? trustedCaret
						: input.updateRangeEnd;
		const hasCollapsedEventSelection =
			typeof input.selectionStart !== "number" ||
			typeof input.selectionEnd !== "number" ||
			input.selectionStart === input.selectionEnd;
		const nextSelectionOffset =
			input.text.length > 0 && hasCollapsedEventSelection
				? rangeStart + input.text.length
				: null;
		const anchorOffset =
			nextSelectionOffset ??
			(typeof input.selectionStart === "number"
				? input.selectionStart
				: null);
		const focusOffset =
			nextSelectionOffset ??
			(typeof input.selectionEnd === "number"
				? input.selectionEnd
				: null);

		return {
			range: {
				start: rangeStart,
				end: rangeEnd,
			},
			selection:
				anchorOffset != null && focusOffset != null
					? {
							blockId: input.blockId,
							anchorOffset,
							focusOffset,
						}
					: null,
		};
	}

	private setEditContextSelection(
		selection: EditContextSelection,
		options?: EditContextSelectionOptions,
	): void {
		const resolvedSelection = {
			blockId: selection.blockId,
			anchorOffset: this.resolveEditContextOffset(
				selection.anchorOffset,
				options,
			),
			focusOffset: this.resolveEditContextOffset(
				selection.focusOffset,
				options,
			),
		};
		this.editContextSelection = resolvedSelection;
		if (options?.source === "text-update") {
			this.authoritativeTextInputSelection = resolvedSelection;
		} else {
			// Programmatic/editor selections supersede stale EditContext text-update carets.
			this.authoritativeTextInputSelection = null;
		}
		this.editContext?.updateSelection(
			resolvedSelection.anchorOffset,
			resolvedSelection.focusOffset,
		);
	}

	private resolveEditContextOffset(
		offset: number,
		options?: EditContextSelectionOptions,
	): number {
		return options?.source !== "text-update" &&
			isLogicallyEmptyText(this.ytext?.toString() ?? "")
			? 0
			: offset;
	}

	private resolveEditorSelectionRange(
		blockId: string,
	): EditContextRange | null {
		const selection = this.fieldEditor.selection;
		if (
			selection?.type !== "text" ||
			selection.isCollapsed ||
			selection.anchor.blockId !== blockId ||
			selection.focus.blockId !== blockId
		) {
			return null;
		}

		return {
			start: Math.min(selection.anchor.offset, selection.focus.offset),
			end: Math.max(selection.anchor.offset, selection.focus.offset),
		};
	}

	private shouldIgnoreStaleCollapsedDomSelection(
		selection: ReturnType<typeof normalizeSelectionFormation>,
	): boolean {
		if (selection.type === "block") {
			return false;
		}
		if (
			selection.anchor.blockId !== selection.focus.blockId ||
			selection.anchor.offset !== selection.focus.offset
		) {
			return false;
		}

		const editorSelectionRange = this.resolveEditorSelectionRange(
			selection.anchor.blockId,
		);
		if (!editorSelectionRange) {
			return false;
		}

		return (
			selection.anchor.offset !== editorSelectionRange.start ||
			selection.focus.offset !== editorSelectionRange.end
		);
	}

	private applyInlineInputRule(
		blockId: string,
		offset: number,
		text: string,
	): {
		blockId: string;
		anchorOffset: number;
		focusOffset: number;
	} | null {
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
			}) ??
			this.resolveFallbackInlineInputRule(
				blockId,
				block.textContent(),
				offset,
				text,
			);
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
			(event as EditContextTextFormatUpdateEvent).getTextFormats?.() ??
			[];
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
		if (
			!this.fieldEditor.shouldHandleDomSelectionChange(
				this.isApplyingSelection,
			)
		) {
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

		if (this.shouldIgnoreStaleCollapsedDomSelection(normalizedSelection)) {
			this.restoreDOMCaret();
			return;
		}

		if (normalizedSelection.type === "block") {
			this.fieldEditor.deactivate();
			this.editor.setSelection({
				type: "block",
				blockIds: normalizedSelection.blockIds,
			});
			return;
		}

		if (
			normalizedSelection.anchor.blockId !==
			normalizedSelection.focus.blockId
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
		const editorSelectionRange = this.resolveEditorSelectionRange(
			normalizedSelection.anchor.blockId,
		);
		if (
			editorSelectionRange &&
			offsets.anchor === offsets.focus &&
			(offsets.start !== editorSelectionRange.start ||
				offsets.end !== editorSelectionRange.end)
		) {
			this.setEditContextSelection({
				blockId: normalizedSelection.anchor.blockId,
				anchorOffset: editorSelectionRange.start,
				focusOffset: editorSelectionRange.end,
			});
			this.restoreDOMCaret();
			return;
		}
		const authoritativeSelection = this.getAuthoritativeTextInputSelection(
			normalizedSelection.anchor.blockId,
		);
		if (
			authoritativeSelection &&
			offsets.anchor === offsets.focus &&
			(offsets.anchor !== authoritativeSelection.anchorOffset ||
				offsets.focus !== authoritativeSelection.focusOffset)
		) {
			this.setEditContextSelection(authoritativeSelection, {
				source: "text-update",
			});
			this.restoreDOMCaret();
			return;
		}

		this.editContext.updateSelection(offsets.start, offsets.end);
		const nextSelection = {
			blockId: normalizedSelection.anchor.blockId,
			anchorOffset: offsets.anchor,
			focusOffset: offsets.focus,
		};
		this.editContextSelection = nextSelection;
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
			const nextText = toEditContextText(this.ytext?.toString?.() ?? "");
			this.editContext.updateText(
				0,
				this.editContext.text.length,
				nextText,
			);
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
			const blockId = this.fieldEditor.focusBlockId;
			this.editContextSelection = blockId
				? {
						blockId,
						anchorOffset: clampedSelectionStart,
						focusOffset: clampedSelectionEnd,
					}
				: null;
			fullReconcileToDOM(this.ytext, this.element, this.editor.schema, {
				preserveSelection: true,
				inlineDecorations: this.getInlineDecorationsForBlock(),
			});
			this.fieldEditor.notifyDomReconciled(blockId ?? undefined);
			this.restoreDOMCaret();
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
			this.fieldEditor.notifyDomReconciled(
				this.fieldEditor.focusBlockId ?? undefined,
			);
		}

		if (
			shouldReplaceEditContextText(
				event.delta,
				this.editContext.text.length,
			)
		) {
			const nextText = toEditContextText(this.ytext.toString());
			this.editContext.updateText(
				0,
				this.editContext.text.length,
				nextText,
			);
		} else {
			const delta = event.delta;
			let offset = 0;
			for (const entry of delta) {
				if (entry.retain != null) {
					offset += entry.retain;
				} else if (typeof entry.insert === "string") {
					this.editContext.updateText(offset, offset, entry.insert);
					offset += entry.insert.length;
				} else if (entry.delete != null) {
					this.editContext.updateText(
						offset,
						offset + entry.delete,
						"",
					);
				}
			}
		}

		if (this.pendingSelectionOverride) {
			this.setEditContextSelection(this.pendingSelectionOverride, {
				source: "text-update",
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
		const authoritativeInputSelection =
			blockId != null &&
			this.authoritativeTextInputSelection?.blockId === blockId
				? this.authoritativeTextInputSelection
				: null;
		const editContextSelection =
			blockId != null && this.editContextSelection?.blockId === blockId
				? this.editContextSelection
				: null;
		const editorSelection =
			selection?.type === "text" &&
			blockId &&
			selection.anchor.blockId === blockId &&
			selection.focus.blockId === blockId
				? selection
				: null;
		const anchorOffset =
			pendingSelection?.anchorOffset ??
			authoritativeInputSelection?.anchorOffset ??
			editorSelection?.anchor.offset ??
			editContextSelection?.anchorOffset ??
			null;
		const focusOffset =
			pendingSelection?.focusOffset ??
			authoritativeInputSelection?.focusOffset ??
			editorSelection?.focus.offset ??
			editContextSelection?.focusOffset ??
			null;
		if (root && blockId && anchorOffset != null && focusOffset != null) {
			this.isApplyingSelection++;
			editorSelectionToDOM(
				root,
				{ blockId, offset: anchorOffset },
				{ blockId, offset: focusOffset },
			);
			requestAnimationFrame(() => {
				this.isApplyingSelection--;
			});
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

		this.isApplyingSelection++;
		sel.removeAllRanges();
		const range = document.createRange();
		range.setStart(anchorPoint.node, anchorPoint.offset);
		range.setEnd(focusPoint.node, focusPoint.offset);
		sel.addRange(range);
		requestAnimationFrame(() => {
			this.isApplyingSelection--;
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

	private handleKeyDown = (event: KeyboardEvent): void => {
		if (!this.editContext || !this.element || !this.ytext) return;
		if (isNavigationSelectionKey(event)) {
			this.authoritativeTextInputSelection = null;
		}

		const blockId = this.fieldEditor.focusBlockId;
		const liveDomOffsets = getDirectionalSelectionOffsets(this.element);
		const { range, nextSelection, shouldSyncEditContextSelection } =
			this.resolveKeyDownRange(blockId, event, liveDomOffsets);

		if (shouldSyncEditContextSelection) {
			this.editContext.updateSelection(range.start, range.end);
			this.editContextSelection = nextSelection;
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

	private resolveKeyDownRange(
		blockId: string | null,
		event: KeyboardEvent,
		liveDomOffsets: DirectionalSelectionOffsets | null,
	): KeyDownRangeResolution {
		if (!blockId) {
			return {
				range: liveDomOffsets
					? directionalSelectionToRange(liveDomOffsets)
					: this.resolveEditContextSelectionRange(),
				nextSelection: null,
				shouldSyncEditContextSelection: false,
			};
		}

		const editorSelectionRange = this.resolveEditorSelectionRange(blockId);
		const liveRange = liveDomOffsets
			? directionalSelectionToRange(liveDomOffsets)
			: null;
		const programmaticInputRange = isFieldEditorTextEditingKey(event)
			? this.fieldEditor.resolveProgrammaticInputRange(blockId, liveRange)
			: null;
		if (programmaticInputRange) {
			return {
				range: programmaticInputRange,
				nextSelection: rangeToSelection(
					blockId,
					programmaticInputRange,
				),
				shouldSyncEditContextSelection: true,
			};
		}

		const trustedKeyRange = this.resolveTrustedKeyDownRange(
			blockId,
			event,
			editorSelectionRange,
		);
		if (trustedKeyRange) {
			return {
				range: trustedKeyRange,
				nextSelection: rangeToSelection(blockId, trustedKeyRange),
				shouldSyncEditContextSelection: true,
			};
		}

		if (
			editorSelectionRange &&
			(!liveDomOffsets ||
				(liveDomOffsets.start === liveDomOffsets.end &&
					!rangesEqual(liveDomOffsets, editorSelectionRange)))
		) {
			return {
				range: editorSelectionRange,
				nextSelection: rangeToSelection(blockId, editorSelectionRange),
				shouldSyncEditContextSelection: true,
			};
		}

		if (
			liveDomOffsets &&
			this.shouldUseLiveDomSelection(blockId, liveDomOffsets)
		) {
			return {
				range: directionalSelectionToRange(liveDomOffsets),
				nextSelection: {
					blockId,
					anchorOffset: liveDomOffsets.anchor,
					focusOffset: liveDomOffsets.focus,
				},
				shouldSyncEditContextSelection: true,
			};
		}

		return {
			range: liveDomOffsets
				? directionalSelectionToRange(liveDomOffsets)
				: this.resolveEditContextSelectionRange(),
			nextSelection: null,
			shouldSyncEditContextSelection: false,
		};
	}

	private shouldUseLiveDomSelection(
		blockId: string,
		liveDomOffsets: DirectionalSelectionOffsets,
	): boolean {
		const authoritativeSelection =
			this.getAuthoritativeTextInputSelection(blockId);
		return !(
			authoritativeSelection &&
			liveDomOffsets.anchor === liveDomOffsets.focus &&
			(liveDomOffsets.anchor !== authoritativeSelection.anchorOffset ||
				liveDomOffsets.focus !== authoritativeSelection.focusOffset)
		);
	}

	private resolveEditContextSelectionRange(): EditContextRange {
		if (!this.editContext) {
			return { start: 0, end: 0 };
		}

		return {
			start: Math.min(
				this.editContext.selectionStart,
				this.editContext.selectionEnd,
			),
			end: Math.max(
				this.editContext.selectionStart,
				this.editContext.selectionEnd,
			),
		};
	}

	private resolveTrustedKeyDownRange(
		blockId: string,
		event: KeyboardEvent,
		editorSelectionRange: EditContextRange | null,
	): EditContextRange | null {
		if (!isFieldEditorTextEditingKey(event)) {
			return null;
		}

		if (editorSelectionRange) {
			return editorSelectionRange;
		}

		const authoritativeSelection =
			this.getAuthoritativeTextInputSelection(blockId);
		if (authoritativeSelection) {
			return selectionToRange(authoritativeSelection);
		}

		const collapsedEditorSelection =
			this.resolveCollapsedEditorSelectionRange(blockId);
		if (collapsedEditorSelection) {
			return collapsedEditorSelection;
		}

		const projectedSelection = this.getProjectedTextSelection(blockId);
		if (projectedSelection) {
			return selectionToRange(projectedSelection);
		}

		const synchronizedEditContextRange =
			this.resolveSynchronizedEditContextRange(blockId);
		if (synchronizedEditContextRange) {
			return synchronizedEditContextRange;
		}

		return null;
	}

	private getProjectedTextSelection(
		blockId: string,
	): EditContextSelection | null {
		return this.editContextSelection?.blockId === blockId
			? this.editContextSelection
			: null;
	}

	private resolveCollapsedEditorSelectionRange(
		blockId: string,
	): EditContextRange | null {
		const selection = this.fieldEditor.selection;
		if (
			selection?.type === "text" &&
			selection.isCollapsed &&
			selection.focus.blockId === blockId
		) {
			return {
				start: selection.focus.offset,
				end: selection.focus.offset,
			};
		}

		return null;
	}

	private resolveSynchronizedEditContextRange(
		blockId: string,
	): EditContextRange | null {
		if (!this.editContext) {
			return null;
		}

		const editContextRange = {
			start: Math.min(
				this.editContext.selectionStart,
				this.editContext.selectionEnd,
			),
			end: Math.max(
				this.editContext.selectionStart,
				this.editContext.selectionEnd,
			),
		};
		const editorRange =
			this.resolveEditorSelectionRange(blockId) ??
			this.resolveCollapsedEditorSelectionRange(blockId);

		if (editorRange && rangesEqual(editContextRange, editorRange)) {
			return editContextRange;
		}

		return null;
	}

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

	private handlePointerDown = (): void => {
		this.authoritativeTextInputSelection = null;
	};

	private getAuthoritativeTextInputSelection(
		blockId: string,
	): EditContextSelection | null {
		const selection =
			this.authoritativeTextInputSelection?.blockId === blockId
				? this.authoritativeTextInputSelection
				: null;
		if (!selection || selection.anchorOffset !== selection.focusOffset) {
			return null;
		}
		return selection;
	}
}

function resolveInlineSelectionTarget(
	blockId: string,
	ops: DocumentOp[],
): {
	blockId: string;
	anchorOffset: number;
	focusOffset: number;
} | null {
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

function isLogicallyEmptyText(text: string): boolean {
	return text.length === 0 || text === ZERO_WIDTH_SPACE;
}

function toEditContextText(text: string): string {
	return text === ZERO_WIDTH_SPACE ? "" : text;
}

function shouldReplaceEditContextText(
	delta: FieldEditorTextChangeEvent["delta"],
	editContextTextLength: number,
): boolean {
	let offset = 0;
	for (const entry of delta) {
		if (entry.retain != null) {
			offset += entry.retain;
			if (offset > editContextTextLength) return true;
		} else if (typeof entry.insert === "string") {
			if (entry.insert === ZERO_WIDTH_SPACE) return true;
			if (offset > editContextTextLength) return true;
			offset += entry.insert.length;
		} else if (entry.delete != null) {
			if (offset + entry.delete > editContextTextLength) return true;
		}
	}
	return false;
}

function collapsedSelectionOffset(
	selection: EditContextSelection | null,
	blockId: string,
): number | null {
	if (
		selection?.blockId !== blockId ||
		selection.anchorOffset !== selection.focusOffset
	) {
		return null;
	}
	return selection.focusOffset;
}

function selectionToRange(selection: EditContextSelection): EditContextRange {
	return {
		start: Math.min(selection.anchorOffset, selection.focusOffset),
		end: Math.max(selection.anchorOffset, selection.focusOffset),
	};
}

function directionalSelectionToRange(
	selection: DirectionalSelectionOffsets,
): EditContextRange {
	return {
		start: selection.start,
		end: selection.end,
	};
}

function rangeToSelection(
	blockId: string,
	range: EditContextRange,
): EditContextSelection {
	return {
		blockId,
		anchorOffset: range.start,
		focusOffset: range.end,
	};
}

function rangesEqual(left: EditContextRange, right: EditContextRange): boolean {
	return left.start === right.start && left.end === right.end;
}

function isNavigationSelectionKey(event: KeyboardEvent): boolean {
	return (
		event.key === "ArrowLeft" ||
		event.key === "ArrowRight" ||
		event.key === "ArrowUp" ||
		event.key === "ArrowDown" ||
		event.key === "Home" ||
		event.key === "End" ||
		event.key === "PageUp" ||
		event.key === "PageDown"
	);
}
