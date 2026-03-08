import type {
	DocumentOp,
	Editor,
	FieldEditor,
	TextSelection,
} from "@pen/types";
import { FIELD_EDITOR_SLOT_KEY } from "@pen/types";

export function toggleInlineMark(editor: Editor, markType: string): boolean {
	const selection = editor.selection;
	if (!selection || selection.type !== "text") return false;
	if (!editor.schema.resolveInline(markType)) return false;

	const fieldEditor = getAttachedFieldEditor(editor);
	if (selection.isCollapsed) {
		if (
			!fieldEditor ||
			fieldEditor.inputMode !== "richtext" ||
			!fieldEditor.togglePendingMark
		) {
			return false;
		}
		return fieldEditor.togglePendingMark(markType);
	}

	const segments = getSelectionSegments(editor, selection);
	if (segments.length === 0) return false;

	fieldEditor?.clearPendingMarks?.();

	const hasMark = hasMarkAcrossSegments(editor, segments, markType);
	editor.apply(buildFormatTextOps(segments, markType, hasMark ? null : true));
	return true;
}

export function getAttachedFieldEditor(editor: Editor): FieldEditor | null {
	return editor.internals.getSlot<FieldEditor>(FIELD_EDITOR_SLOT_KEY) ?? null;
}

function isInlineMarkEditableBlock(editor: Editor, blockId: string): boolean {
	const block = editor.getBlock(blockId);
	if (!block) return false;

	const schema = editor.schema.resolve(block.type);
	if (!schema || schema.content !== "inline") return false;

	return !schema.fieldEditor || schema.fieldEditor === "richtext";
}

function getBlockTextLength(editor: Editor, blockId: string): number {
	return editor.getBlock(blockId)?.textContent().length ?? 0;
}

function getSelectionSegments(
	editor: Editor,
	selection: TextSelection,
): Array<{ blockId: string; start: number; end: number }> {
	const range = selection.toRange();
	const blockIds = range.blockRange;
	const segments: Array<{ blockId: string; start: number; end: number }> = [];

	for (let index = 0; index < blockIds.length; index++) {
		const blockId = blockIds[index]!;
		if (!isInlineMarkEditableBlock(editor, blockId)) continue;

		const blockLength = getBlockTextLength(editor, blockId);
		const start = index === 0 ? range.start.offset : 0;
		const end =
			index === blockIds.length - 1 ? range.end.offset : blockLength;
		if (end > start) {
			segments.push({ blockId, start, end });
		}
	}

	return segments;
}

function hasMarkAcrossSegments(
	editor: Editor,
	segments: Array<{ blockId: string; start: number; end: number }>,
	markType: string,
): boolean {
	if (segments.length === 0) return false;

	for (const segment of segments) {
		const block = editor.getBlock(segment.blockId);
		if (!block) return false;

		const deltas = block.textDeltas();
		let offset = 0;

		for (const delta of deltas) {
			const len = delta.insert.length;
			const segStart = offset;
			const segEnd = offset + len;
			offset = segEnd;

			if (segEnd <= segment.start || segStart >= segment.end) continue;
			if (!delta.attributes?.[markType]) {
				return false;
			}
		}
	}

	return true;
}

export function setInlineMark(
	editor: Editor,
	markType: string,
	value: Record<string, unknown> | null,
): boolean {
	const selection = editor.selection;
	if (!selection || selection.type !== "text") return false;
	if (!editor.schema.resolveInline(markType)) return false;

	const fieldEditor = getAttachedFieldEditor(editor);
	if (selection.isCollapsed) {
		return false;
	}

	const segments = getSelectionSegments(editor, selection);
	if (segments.length === 0) return false;

	fieldEditor?.clearPendingMarks?.();

	editor.apply(buildFormatTextOps(segments, markType, value));
	return true;
}

function buildFormatTextOps(
	segments: Array<{ blockId: string; start: number; end: number }>,
	markType: string,
	nextValue: Record<string, unknown> | true | null,
): DocumentOp[] {
	return segments.map((segment) => ({
		type: "format-text",
		blockId: segment.blockId,
		offset: segment.start,
		length: segment.end - segment.start,
		marks: { [markType]: nextValue },
	}));
}
