import { getInlineCompletionController } from "@pen/core";
import type { Editor, KeyBindingContext } from "@pen/types";
import {
	COLLECT_KEY_BINDINGS_SLOT_KEY,
	usesInlineTextSelection,
} from "@pen/types";
import type { FieldEditorKeyboardController } from "./controller";
import {
	applyDeleteBehavior,
	applyEnterBehavior,
	applyListTabBehavior,
	moveCaretAcrossBlocks,
	normalizeInlineRange,
	type SelectionRange,
} from "./commands";
import { getEditorBlockSelectionLength } from "../utils/blockSelectionSemantics";
import { getAutocompleteController } from "../utils/autocompleteController";

export function handleFieldEditorKeyDown(options: {
	event: KeyboardEvent;
	editor: Editor;
	fieldEditor: FieldEditorKeyboardController;
	ytext: {
		length: number;
		toString(): string;
		toDelta(): Array<{ insert?: string | Record<string, unknown> }>;
		insert(offset: number, text: string): void;
		delete(offset: number, length: number): void;
	};
	range: SelectionRange | null;
}): boolean {
	const { event, editor, fieldEditor, ytext, range } = options;
	const blockId = fieldEditor.focusBlockId;
	if (!blockId) return false;
	const autocomplete = getAutocompleteController(editor);

	if (shouldDismissAutocompleteOnKeyDown(event, autocomplete)) {
		autocomplete?.dismiss("typing");
	}

	if (!event.defaultPrevented && handleHistoryShortcut(editor, event)) {
		return true;
	}

	if (
		!event.defaultPrevented &&
		handleSelectAllShortcut(editor, event, fieldEditor)
	) {
		return true;
	}

	if (fieldEditor.activeCellCoord) {
		if (
			event.key === "Tab" &&
			!event.metaKey &&
			!event.ctrlKey &&
			!event.altKey
		) {
			event.preventDefault();
			const coord = fieldEditor.activeCellCoord;
			if (!coord) return true;
			const block = editor.getBlock(coord.blockId);
			if (block) {
				const rowCount = block.tableRowCount();
				const colCount = block.tableColumnCount();
				let nextRow = coord.row;
				let nextCol = coord.col;

				if (event.shiftKey) {
					nextCol--;
					if (nextCol < 0) {
						nextRow--;
						nextCol = colCount - 1;
					}
					if (nextRow < 0) {
						nextRow = 0;
						nextCol = 0;
					}
				} else {
					nextCol++;
					if (nextCol >= colCount) {
						nextRow++;
						nextCol = 0;
					}
					if (nextRow >= rowCount) {
						nextRow = rowCount - 1;
						nextCol = colCount - 1;
					}
				}

				fieldEditor.activateCell(coord.blockId, nextRow, nextCol);
			}
			return true;
		}

		if (
			event.key === "Enter" &&
			!event.shiftKey &&
			!event.metaKey &&
			!event.ctrlKey &&
			!event.altKey
		) {
			event.preventDefault();
			const coord = fieldEditor.activeCellCoord;
			if (!coord) return true;
			const block = editor.getBlock(coord.blockId);
			if (block) {
				const rowCount = block.tableRowCount();
				const nextRow = Math.min(coord.row + 1, rowCount - 1);
				fieldEditor.activateCell(coord.blockId, nextRow, coord.col);
			}
			return true;
		}

		if (
			event.key === "ArrowLeft" ||
			event.key === "ArrowRight" ||
			event.key === "ArrowUp" ||
			event.key === "ArrowDown"
		) {
			return false;
		}
	}

	if (
		event.key === "Tab" &&
		!event.metaKey &&
		!event.ctrlKey &&
		!event.altKey
	) {
		const target = applyListTabBehavior(editor, {
			blockId,
			ytext,
			range,
			shiftKey: event.shiftKey,
		});
		if (target) {
			fieldEditor.activateTextSelection(
				target.blockId,
				target.anchorOffset,
				target.focusOffset,
			);
			return true;
		}

		const inlineCompletion = getInlineCompletionController(editor);
		if (inlineCompletion?.hasVisibleSuggestion()) {
			event.preventDefault();
			if (autocomplete?.hasVisibleSuggestion()) {
				return autocomplete.acceptVisibleSuggestion();
			}
			const accepted = inlineCompletion.acceptSuggestion();
			if (accepted) {
				syncAcceptedInlineCompletionSelection(editor, fieldEditor);
			}
			return accepted;
		}

		if (!event.shiftKey) {
			if (autocomplete?.request({ explicit: true })) {
				event.preventDefault();
				return true;
			}
		}
	}

	if (
		(event.key === "Backspace" || event.key === "Delete") &&
		!event.shiftKey &&
		!event.metaKey &&
		!event.ctrlKey &&
		!event.altKey
	) {
		const target = applyDeleteBehavior(editor, {
			blockId,
			ytext,
			range,
			direction: event.key === "Backspace" ? "backward" : "forward",
		});
		if (target) {
			if (target.selectBlock) {
				fieldEditor.deactivate();
				editor.selectBlock(target.blockId);
			} else {
				fieldEditor.activateTextSelection(
					target.blockId,
					target.anchorOffset,
					target.focusOffset,
				);
			}
			return true;
		}
	}

	if (event.key === "Enter" && !event.shiftKey) {
		const target = applyEnterBehavior(editor, {
			blockId,
			inputMode: fieldEditor.inputMode,
			ytext,
			range,
		});
		if (!target) return false;

		fieldEditor.activateTextSelection(
			target.blockId,
			target.anchorOffset,
			target.focusOffset,
		);
		return true;
	}

	if (
		(event.key === "ArrowLeft" || event.key === "ArrowUp") &&
		!event.shiftKey &&
		!event.metaKey &&
		!event.ctrlKey &&
		!event.altKey
	) {
		if (
			event.key === "ArrowLeft" &&
			selectInlineAtomWithArrowKey({
				blockId,
				event,
				fieldEditor,
				range,
				ytext,
			})
		) {
			return true;
		}

		const target = moveCaretAcrossBlocks(editor, {
			blockId,
			ytext,
			range,
			direction: "previous",
		});
		if (target) {
			if (target.selectBlock) {
				fieldEditor.deactivate();
				editor.selectBlock(target.blockId);
			} else {
				fieldEditor.activateTextSelection(
					target.blockId,
					target.anchorOffset,
					target.focusOffset,
				);
			}
			return true;
		}
	}

	if (
		(event.key === "ArrowRight" || event.key === "ArrowDown") &&
		!event.shiftKey &&
		!event.metaKey &&
		!event.ctrlKey &&
		!event.altKey
	) {
		if (
			event.key === "ArrowRight" &&
			selectInlineAtomWithArrowKey({
				blockId,
				event,
				fieldEditor,
				range,
				ytext,
			})
		) {
			return true;
		}

		const target = moveCaretAcrossBlocks(editor, {
			blockId,
			ytext,
			range,
			direction: "next",
		});
		if (target) {
			if (target.selectBlock) {
				fieldEditor.deactivate();
				editor.selectBlock(target.blockId);
			} else {
				fieldEditor.activateTextSelection(
					target.blockId,
					target.anchorOffset,
					target.focusOffset,
				);
			}
			return true;
		}
	}

	return handleEditorKeyBindings(editor, event, { includeSelectAll: false });
}

function selectInlineAtomWithArrowKey(options: {
	blockId: string;
	event: KeyboardEvent;
	fieldEditor: FieldEditorKeyboardController;
	range: SelectionRange | null;
	ytext: {
		length: number;
		toString(): string;
		toDelta(): Array<{ insert?: string | Record<string, unknown> }>;
	};
}): boolean {
	const { blockId, event, fieldEditor, ytext } = options;
	const range = normalizeInlineRange(ytext, options.range);
	if (!range) {
		return false;
	}

	const direction = event.key === "ArrowLeft" ? "previous" : "next";
	if (range.start !== range.end) {
		if (!isInlineAtomRange(ytext, range.start, range.end)) {
			return false;
		}
		const offset = direction === "previous" ? range.start : range.end;
		fieldEditor.activateTextSelection(blockId, offset, offset);
		return true;
	}

	const atomOffset = direction === "previous" ? range.start - 1 : range.start;
	const atomRange = getInlineAtomRangeAtOffset(ytext, atomOffset);
	if (!atomRange) {
		return false;
	}

	fieldEditor.activateTextSelection(blockId, atomRange.start, atomRange.end);
	return true;
}

function isInlineAtomRange(
	ytext: { toDelta(): Array<{ insert?: string | Record<string, unknown> }> },
	start: number,
	end: number,
): boolean {
	const atomRange = getInlineAtomRangeAtOffset(ytext, start);
	return atomRange?.end === end;
}

function getInlineAtomRangeAtOffset(
	ytext: { toDelta(): Array<{ insert?: string | Record<string, unknown> }> },
	targetOffset: number,
): SelectionRange | null {
	if (targetOffset < 0) {
		return null;
	}

	let offset = 0;
	for (const delta of ytext.toDelta()) {
		if (delta.insert == null) {
			continue;
		}

		if (typeof delta.insert === "string") {
			offset += delta.insert.length;
			continue;
		}

		if (offset === targetOffset) {
			return { start: offset, end: offset + 1 };
		}
		offset += 1;
	}

	return null;
}

function syncAcceptedInlineCompletionSelection(
	editor: Editor,
	fieldEditor: FieldEditorKeyboardController,
): void {
	const selection = editor.selection;
	if (
		selection?.type !== "text" ||
		!selection.isCollapsed ||
		selection.isMultiBlock
	) {
		return;
	}

	const blockId = selection.focus.blockId;
	const offset = selection.focus.offset;
	if (typeof fieldEditor.commitProgrammaticTextSelection === "function") {
		fieldEditor.commitProgrammaticTextSelection(blockId, offset, offset);
		return;
	}

	fieldEditor.activateTextSelection(blockId, offset, offset);
}

function shouldDismissAutocompleteOnKeyDown(
	event: KeyboardEvent,
	autocomplete: ReturnType<typeof getAutocompleteController>,
): boolean {
	if (!autocomplete?.hasVisibleSuggestion()) {
		return false;
	}
	if (event.metaKey || event.ctrlKey || event.altKey) {
		return false;
	}
	return (
		event.key.length === 1 ||
		event.key === "Backspace" ||
		event.key === "Delete" ||
		event.key === "Enter"
	);
}

export function handleEditorKeyBindings(
	editor: Editor,
	event: KeyboardEvent,
	options?: { includeSelectAll?: boolean },
): boolean {
	if (event.defaultPrevented) {
		return false;
	}

	const includeSelectAll = options?.includeSelectAll ?? true;
	if (handleHistoryShortcut(editor, event)) {
		return true;
	}

	if (includeSelectAll && handleSelectAllShortcut(editor, event)) {
		return true;
	}

	const bindings = collectKeyBindings(editor);
	for (const binding of bindings) {
		if (
			matchesBindingContext(editor, binding.context) &&
			matchesKey(binding.key, event) &&
			binding.handler(editor, event)
		) {
			return true;
		}
	}

	return false;
}

export function handleSelectAllShortcut(
	editor: Editor,
	event: KeyboardEvent,
	fieldEditor?: FieldEditorKeyboardController,
	options?: { rootElement?: HTMLElement | null },
): boolean {
	if (!isSelectAllShortcut(event)) {
		return false;
	}

	if (fieldEditor) {
		return fieldEditor.selectAll(options?.rootElement);
	}

	const range = getDocumentTextRange(editor);
	if (!range) {
		return true;
	}
	editor.selectTextRange(range.start, range.end);
	return true;
}

export function handleHistoryShortcut(
	editor: Editor,
	event: KeyboardEvent,
): boolean {
	if (tryHandleHistoryOverrideBinding(editor, event)) {
		return true;
	}

	if (isUndoShortcut(event)) {
		editor.undoManager.undo();
		return true;
	}

	if (isRedoShortcut(event)) {
		editor.undoManager.redo();
		return true;
	}

	return false;
}

function tryHandleHistoryOverrideBinding(
	editor: Editor,
	event: KeyboardEvent,
): boolean {
	if (!isUndoShortcut(event) && !isRedoShortcut(event)) {
		return false;
	}

	const bindings = collectKeyBindings(editor);
	for (const binding of bindings) {
		if (
			matchesBindingContext(editor, binding.context) &&
			matchesKey(binding.key, event) &&
			binding.handler(editor, event)
		) {
			return true;
		}
	}

	return false;
}

function getDocumentTextRange(editor: Editor): {
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

function collectKeyBindings(editor: Editor): ReadonlyArray<{
	key: string;
	context?: KeyBindingContext;
	handler: (editor: Editor, event: KeyboardEvent) => boolean;
}> {
	const collect =
		editor.internals.getSlot<
			(registry: Editor["schema"]) => ReadonlyArray<{
				key: string;
				context?: KeyBindingContext;
				handler: (editor: Editor, event: KeyboardEvent) => boolean;
			}>
		>(COLLECT_KEY_BINDINGS_SLOT_KEY) ?? null;
	return collect?.(editor.schema) ?? [];
}

function matchesBindingContext(
	editor: Editor,
	context: KeyBindingContext | undefined,
): boolean {
	if (!context) return true;

	const selection = editor.selection;
	const activeBlock = getActiveBlock(editor);

	if (
		context.blockType &&
		(!activeBlock || !context.blockType.includes(activeBlock.type))
	) {
		return false;
	}

	if (context.hasSelection !== undefined) {
		const hasSelection =
			selection?.type === "text"
				? !selection.isCollapsed
				: selection !== null;
		if (hasSelection !== context.hasSelection) {
			return false;
		}
	}

	if (context.collapsed !== undefined) {
		const isCollapsed = selection?.type === "text" && selection.isCollapsed;
		if (isCollapsed !== context.collapsed) {
			return false;
		}
	}

	if (
		context.withinLayout &&
		(!activeBlock || !isWithinLayout(activeBlock, context.withinLayout))
	) {
		return false;
	}

	return true;
}

function getActiveBlock(editor: Editor) {
	const selection = editor.selection;
	if (!selection) return null;

	if (selection.type === "text") {
		return editor.getBlock(selection.anchor.blockId);
	}

	if (selection.type === "block") {
		const blockId = selection.blockIds[0];
		return blockId ? editor.getBlock(blockId) : null;
	}

	if (selection.type === "cell") {
		return editor.getBlock(selection.blockId);
	}

	return null;
}

function isWithinLayout(
	block: NonNullable<ReturnType<typeof getActiveBlock>>,
	allowedLayoutTypes: readonly string[],
): boolean {
	let parent = block.layoutParent();
	while (parent) {
		if (allowedLayoutTypes.includes(parent.type)) {
			return true;
		}
		parent = parent.layoutParent();
	}

	return false;
}

function matchesKey(pattern: string, event: KeyboardEvent): boolean {
	const parts = pattern.split("-").map((part) => part.toLowerCase());
	const key = parts.pop()?.toLowerCase() ?? "";

	const needsCtrl = parts.includes("ctrl");
	const needsMeta = parts.includes("meta");
	const needsMod = parts.includes("mod");
	const needsShift = parts.includes("shift");
	const needsAlt = parts.includes("alt");

	const isMac =
		typeof navigator !== "undefined" &&
		/Mac|iPhone|iPad/.test(navigator.platform ?? "");

	const allowCtrl = needsCtrl || (needsMod && !isMac);
	const allowMeta = needsMeta || (needsMod && isMac);

	const modMatch = needsMod ? (isMac ? event.metaKey : event.ctrlKey) : true;
	const ctrlMatch = allowCtrl ? event.ctrlKey : !event.ctrlKey;
	const metaMatch = allowMeta ? event.metaKey : !event.metaKey;
	const shiftMatch = needsShift ? event.shiftKey : !event.shiftKey;
	const altMatch = needsAlt ? event.altKey : !event.altKey;

	return (
		modMatch &&
		ctrlMatch &&
		metaMatch &&
		shiftMatch &&
		altMatch &&
		event.key.toLowerCase() === key
	);
}

function isSelectAllShortcut(event: KeyboardEvent): boolean {
	return (
		event.key.toLowerCase() === "a" &&
		!event.shiftKey &&
		!event.altKey &&
		(event.metaKey || event.ctrlKey)
	);
}

function isUndoShortcut(event: KeyboardEvent): boolean {
	return (
		event.key.toLowerCase() === "z" &&
		!event.shiftKey &&
		!event.altKey &&
		(event.metaKey || event.ctrlKey)
	);
}

function isRedoShortcut(event: KeyboardEvent): boolean {
	const key = event.key.toLowerCase();
	const usesMod = event.metaKey || event.ctrlKey;
	return (
		usesMod &&
		!event.altKey &&
		((key === "z" && event.shiftKey) || (key === "y" && !event.shiftKey))
	);
}
