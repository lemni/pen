import { useRef, useSyncExternalStore } from "react";
import type { Editor } from "@pen/core";
import {
	EMPTY_TOOLBAR_STATE,
	type ToolbarState,
} from "../context/toolbarContext";
import {
	getAttachedFieldEditor,
	getAttachedFieldEditorStore,
} from "../utils/fieldEditor";
import type { FieldEditor } from "@pen/core";
import { getDefaultToolbarBlockTypeOptions } from "../utils/toolbarOptions";

export function useToolbar(editor: Editor): ToolbarState {
	const cacheRef = useRef<ToolbarState>(EMPTY_TOOLBAR_STATE);

	return useSyncExternalStore(
		(callback) => {
			const unsubs = [
				editor.on("selectionChange", callback),
				editor.onDocumentCommit(callback),
			];
			const fieldEditorStore = getAttachedFieldEditorStore(editor);
			if (fieldEditorStore) {
				unsubs.push(fieldEditorStore.subscribe(callback));
			}
			return () => unsubs.forEach((u) => u());
		},
		() => {
			const fieldEditor = getAttachedFieldEditor(editor);
			const next = computeToolbarState(editor, fieldEditor);
			if (toolbarStateEqual(cacheRef.current, next)) {
				return cacheRef.current;
			}
			cacheRef.current = next;
			return next;
		},
		() => EMPTY_TOOLBAR_STATE,
	);
}

function computeToolbarState(
	editor: Editor,
	fieldEditor: FieldEditor | null,
): ToolbarState {
	const blockTypeOptions = getDefaultToolbarBlockTypeOptions(editor);
	const selection = editor.selection;
	if (!selection || selection.type !== "text") {
		return {
			...EMPTY_TOOLBAR_STATE,
			blockTypeOptions,
		};
	}

	const block = editor.getBlock(selection.anchor.blockId);
	const blockType = block?.type ?? null;

	const activeMarks = resolveActiveMarks(editor, selection, fieldEditor);

	const registry = editor.schema;
	const canMark = (type: string) => !!registry.resolveInline(type);

	return {
		activeMarks,
		blockType,
		blockTypeOptions,
		canBold: canMark("bold"),
		canItalic: canMark("italic"),
		canUnderline: canMark("underline"),
		canStrikethrough: canMark("strikethrough"),
		canCode: canMark("code"),
		canLink: canMark("link"),
	};
}

/**
 * Resolve active marks at the current selection by inspecting
 * the Y.Text deltas at the selection range.
 */
function resolveActiveMarks(
	editor: Editor,
	selection: {
		type: "text";
		anchor: { blockId: string; offset: number };
		focus: { blockId: string; offset: number };
	},
	fieldEditor: FieldEditor | null,
): Record<string, unknown> {
	const blockId = selection.anchor.blockId;
	const block = editor.getBlock(blockId);
	if (!block) return {};

	const deltas = block.textDeltas();
	if (deltas.length === 0) return {};

	const from = Math.min(selection.anchor.offset, selection.focus.offset);
	const to = Math.max(selection.anchor.offset, selection.focus.offset);

	// Collapsed cursor — read marks at cursor position
	if (from === to) {
		const activeMarks = resolveCollapsedMarks(editor, deltas, from);
		return mergePendingMarks(activeMarks, fieldEditor);
	}

	// Range selection — intersect marks present across the entire range
	let offset = 0;
	let firstSegment = true;
	let intersected: Record<string, unknown> = {};

	for (const d of deltas) {
		const len = d.insert.length;
		const segStart = offset;
		const segEnd = offset + len;
		offset += len;

		if (segEnd <= from || segStart >= to) continue;

		const attrs = d.attributes ?? {};
		if (firstSegment) {
			intersected = { ...attrs };
			firstSegment = false;
		} else {
			for (const key of Object.keys(intersected)) {
				if (!(key in attrs)) {
					delete intersected[key];
				}
			}
		}
	}

	return intersected;
}

function resolveCollapsedMarks(
	editor: Editor,
	deltas: Array<{ insert: string; attributes?: Record<string, unknown> }>,
	offset: number,
): Record<string, unknown> {
	let currentOffset = 0;

	for (const delta of deltas) {
		const len = delta.insert.length;
		if (offset < currentOffset || offset > currentOffset + len) {
			currentOffset += len;
			continue;
		}

		const attributes = delta.attributes ?? {};
		if (offset === currentOffset + len) {
			return filterBoundaryMarks(editor, attributes, "after");
		}
		if (offset === currentOffset) {
			return filterBoundaryMarks(editor, attributes, "before");
		}
		return attributes;
	}

	return {};
}

function filterBoundaryMarks(
	editor: Editor,
	attributes: Record<string, unknown>,
	boundary: "before" | "after",
): Record<string, unknown> {
	const filtered: Record<string, unknown> = {};
	for (const [markType, value] of Object.entries(attributes)) {
		const schema = editor.schema.resolveInline(markType);
		if (!schema) {
			filtered[markType] = value;
			continue;
		}
		const expand = schema.expand ?? "after";
		if (boundary === "after") {
			if (expand === "after" || expand === "both") {
				filtered[markType] = value;
			}
			continue;
		}
		if (expand === "before" || expand === "both" || expand === "after") {
			filtered[markType] = value;
		}
	}
	return filtered;
}

function mergePendingMarks(
	activeMarks: Record<string, unknown>,
	fieldEditor: FieldEditor | null,
): Record<string, unknown> {
	if (!fieldEditor) return activeMarks;

	const pendingMarks = fieldEditor.getPendingMarks?.() ?? {};
	if (Object.keys(pendingMarks).length === 0) return activeMarks;

	const merged = { ...activeMarks };
	for (const [markType, value] of Object.entries(pendingMarks)) {
		if (value == null) {
			delete merged[markType];
		} else {
			merged[markType] = value;
		}
	}

	return merged;
}

function shallowEqual(
	a: Record<string, unknown>,
	b: Record<string, unknown>,
): boolean {
	const keysA = Object.keys(a);
	const keysB = Object.keys(b);
	if (keysA.length !== keysB.length) return false;
	for (const key of keysA) {
		if (a[key] !== b[key]) return false;
	}
	return true;
}

function toolbarStateEqual(a: ToolbarState, b: ToolbarState): boolean {
	return (
		a.blockType === b.blockType &&
		blockTypeOptionsEqual(a.blockTypeOptions, b.blockTypeOptions) &&
		a.canBold === b.canBold &&
		a.canItalic === b.canItalic &&
		a.canUnderline === b.canUnderline &&
		a.canStrikethrough === b.canStrikethrough &&
		a.canCode === b.canCode &&
		a.canLink === b.canLink &&
		shallowEqual(a.activeMarks, b.activeMarks)
	);
}

function blockTypeOptionsEqual(
	a: ToolbarState["blockTypeOptions"],
	b: ToolbarState["blockTypeOptions"],
): boolean {
	if (a.length !== b.length) {
		return false;
	}
	for (let i = 0; i < a.length; i++) {
		if (a[i]?.value !== b[i]?.value || a[i]?.label !== b[i]?.label) {
			return false;
		}
	}
	return true;
}
