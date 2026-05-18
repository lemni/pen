import { describe, expect, it } from "vitest";
import { createEditor, getNumberedListItemValue } from "@pen/core";
import {
	FIELD_EDITOR_SLOT_KEY as CORE_FIELD_EDITOR_SLOT_KEY,
	INPUT_RULES_ENGINE_SLOT_KEY,
} from "@pen/types";
import { defaultPreset } from "@pen/preset-default";
import {
	applyDeleteBehavior,
	applyListInputRule,
	applyBackspaceBehavior,
	applyEnterBehavior,
	applyListTabBehavior,
	getLogicalInlineLength,
	moveCaretAcrossBlocks,
	normalizeInlineOffset,
	resolveBackspaceAction,
	resolveEnterAction,
	splitBlockAtOffset,
	toggleInlineMark,
} from "../field-editor/commands";
import { FieldEditorImpl } from "../field-editor/fieldEditorImpl";
import { FIELD_EDITOR_SLOT_KEY } from "../constants/fieldEditor";
import type { FieldEditorTextLike } from "../field-editor/crdt";

type BlocksMapLike = {
	get(key: string): { get(field: string): unknown } | undefined;
};

type RawDocLike = {
	getMap(name: string): BlocksMapLike;
};

function visibleText(text: string): string {
	return text.replace(/\u200B/g, "");
}

function getYText(
	editor: ReturnType<typeof createEditor>,
	blockId: string,
): FieldEditorTextLike {
	const adapter = editor.internals.adapter;
	const doc = editor.internals.crdtDoc;
	const ydoc = adapter.raw<RawDocLike>(doc);
	const ytext = ydoc
		.getMap("blocks")
		.get(blockId)
		?.get("content") as FieldEditorTextLike | null;
	if (!ytext) {
		throw new Error(`Missing test Y.Text for block ${blockId}`);
	}
	return ytext;
}

function editorOpts() {
	return {
		preset: defaultPreset({
			documentOps: false,
			deltaStream: false,
			undo: false,
		}),
	};
}

describe("@pen/react field-editor commands", () => {
	it("toggles an inline mark across a single-block text selection", () => {
		const editor = createEditor(editorOpts());
		const blockId = editor.firstBlock()!.id;

		editor.apply([
			{ type: "insert-text", blockId, offset: 0, text: "Hello" },
		]);
		editor.selectText(blockId, 0, 5);

		expect(toggleInlineMark(editor, "bold")).toBe(true);
		expect(editor.getBlock(blockId)!.textDeltas()).toEqual([
			{
				insert: "Hello",
				attributes: { bold: true },
			},
		]);

		editor.destroy();
	});

	it("toggles an inline mark across a multi-block selection", () => {
		const editor = createEditor(editorOpts());
		const firstBlockId = editor.firstBlock()!.id;
		const secondBlockId = crypto.randomUUID();

		editor.apply([
			{
				type: "insert-text",
				blockId: firstBlockId,
				offset: 0,
				text: "Hello",
			},
			{
				type: "insert-block",
				blockId: secondBlockId,
				blockType: "paragraph",
				props: {},
				position: { after: firstBlockId },
			},
			{
				type: "insert-text",
				blockId: secondBlockId,
				offset: 0,
				text: "World",
			},
		]);

		editor.selectTextRange(
			{ blockId: firstBlockId, offset: 1 },
			{ blockId: secondBlockId, offset: 2 },
		);

		expect(toggleInlineMark(editor, "italic")).toBe(true);
		expect(editor.getBlock(firstBlockId)!.textDeltas()).toEqual([
			{ insert: "H" },
			{
				insert: "ello",
				attributes: { italic: true },
			},
		]);
		expect(editor.getBlock(secondBlockId)!.textDeltas()).toEqual([
			{
				insert: "Wo",
				attributes: { italic: true },
			},
			{ insert: "rld" },
		]);

		editor.destroy();
	});

	it("uses pending marks for collapsed rich-text selections", () => {
		const editor = createEditor(editorOpts());
		const blockId = editor.firstBlock()!.id;
		const fieldEditor = new FieldEditorImpl(editor);
		const ytext = getYText(editor, blockId);

		editor.internals.setSlot(FIELD_EDITOR_SLOT_KEY, fieldEditor);
		editor.internals.setSlot(CORE_FIELD_EDITOR_SLOT_KEY, fieldEditor);
		fieldEditor.activate(blockId);
		fieldEditor.setTextSelection(blockId, 0, 0);

		expect(toggleInlineMark(editor, "bold")).toBe(true);
		expect(fieldEditor.getPendingMarks()).toEqual({ bold: true });
		expect(fieldEditor.resolveInsertMarks(ytext, 0)).toEqual({
			bold: true,
		});

		expect(toggleInlineMark(editor, "bold")).toBe(true);
		expect(fieldEditor.getPendingMarks()).toEqual({});
		expect(fieldEditor.resolveInsertMarks(ytext, 0)).toBeUndefined();

		fieldEditor.destroy();
		editor.destroy();
	});

	it("returns explicit null marks when pending marks disable boundary formatting", () => {
		const editor = createEditor(editorOpts());
		const blockId = editor.firstBlock()!.id;
		const fieldEditor = new FieldEditorImpl(editor);
		const ytext = getYText(editor, blockId);

		editor.internals.setSlot(FIELD_EDITOR_SLOT_KEY, fieldEditor);
		editor.internals.setSlot(CORE_FIELD_EDITOR_SLOT_KEY, fieldEditor);
		editor.apply([
			{
				type: "insert-text",
				blockId,
				offset: 0,
				text: "Hello",
				marks: { bold: true, italic: true },
			},
		]);
		fieldEditor.activate(blockId);
		fieldEditor.setTextSelection(blockId, 5, 5);

		expect(toggleInlineMark(editor, "bold")).toBe(true);
		expect(fieldEditor.getPendingMarks()).toEqual({ bold: null });
		expect(fieldEditor.resolveInsertMarks(ytext, 5)).toEqual({
			bold: null,
			italic: true,
		});

		fieldEditor.destroy();
		editor.destroy();
	});

	it("resets pointer-selection suppression on deactivate and destroy", () => {
		const editor = createEditor(editorOpts());
		const blockId = editor.firstBlock()!.id;
		const fieldEditor = new FieldEditorImpl(editor);

		fieldEditor.activate(blockId);
		fieldEditor.beginPointerSelection();
		expect(fieldEditor.shouldHandleDomSelectionChange(0)).toBe(false);

		fieldEditor.deactivate();
		expect(fieldEditor.shouldHandleDomSelectionChange(0)).toBe(true);

		fieldEditor.beginPointerSelection();
		expect(fieldEditor.shouldHandleDomSelectionChange(0)).toBe(false);

		fieldEditor.destroy();
		expect((fieldEditor as any)._pointerSelectionDepth).toBe(0);

		editor.destroy();
	});

	it("splits a block and returns the next selection target", () => {
		const editor = createEditor(editorOpts());
		const blockId = editor.firstBlock()!.id;

		editor.apply([
			{ type: "insert-text", blockId, offset: 0, text: "HelloWorld" },
		]);

		const target = splitBlockAtOffset(editor, { blockId, offset: 5 });

		expect(editor.blockCount()).toBe(2);
		expect(visibleText(editor.getBlock(blockId)!.textContent())).toBe(
			"Hello",
		);
		expect(
			visibleText(editor.getBlock(target.blockId)!.textContent()),
		).toBe("World");
		expect(target.anchorOffset).toBe(0);
		expect(target.focusOffset).toBe(0);

		editor.destroy();
	});

	it("uses newline insertion for code input mode", () => {
		const editor = createEditor(editorOpts());
		const blockId = editor.firstBlock()!.id;

		editor.apply([
			{ type: "convert-block", blockId, newType: "codeBlock" },
			{ type: "insert-text", blockId, offset: 0, text: "abcd" },
		]);

		const target = applyEnterBehavior(editor, {
			blockId,
			inputMode: "code",
			ytext: getYText(editor, blockId),
			range: { start: 2, end: 2 },
		});

		expect(editor.blockCount()).toBe(1);
		expect(visibleText(editor.getBlock(blockId)!.textContent())).toBe(
			"ab\ncd",
		);
		expect(target).toEqual({ blockId, anchorOffset: 3, focusOffset: 3 });

		editor.destroy();
	});

	it("does not toggle inline marks inside code blocks", () => {
		const editor = createEditor(editorOpts());
		const blockId = editor.firstBlock()!.id;

		editor.apply([
			{ type: "convert-block", blockId, newType: "codeBlock" },
			{ type: "insert-text", blockId, offset: 0, text: "code" },
		]);
		editor.selectText(blockId, 0, 4);

		expect(toggleInlineMark(editor, "bold")).toBe(false);
		expect(editor.getBlock(blockId)!.textDeltas()).toEqual([
			{ insert: "code" },
		]);

		editor.destroy();
	});

	it("converts '- ' into a bullet list item only for empty paragraphs", () => {
		const editor = createEditor(editorOpts());
		const blockId = editor.firstBlock()!.id;

		const target = applyListInputRule(editor, {
			blockId,
			range: { start: 0, end: 0 },
			text: "- ",
		});

		expect(target).toEqual({ blockId, anchorOffset: 0, focusOffset: 0 });
		expect(editor.getBlock(blockId)?.type).toBe("bulletListItem");
		expect(visibleText(editor.getBlock(blockId)!.textContent())).toBe("");

		editor.destroy();
	});

	it("converts '[ ] ' into a check list item", () => {
		const editor = createEditor(editorOpts());
		const blockId = editor.firstBlock()!.id;

		const target = applyListInputRule(editor, {
			blockId,
			range: { start: 0, end: 0 },
			text: "[ ] ",
		});

		expect(target).toEqual({ blockId, anchorOffset: 0, focusOffset: 0 });
		expect(editor.getBlock(blockId)?.type).toBe("checkListItem");
		expect(visibleText(editor.getBlock(blockId)!.textContent())).toBe("");

		editor.destroy();
	});

	it("uses the headless input-rules engine when present", () => {
		const editor = createEditor(editorOpts());
		const blockId = editor.firstBlock()!.id;
		let receivedEditor: unknown = null;
		let receivedOffset: number | undefined;

		editor.internals.setSlot(INPUT_RULES_ENGINE_SLOT_KEY, {
			tryMatch(
				nextEditor: typeof editor,
				nextBlockId: string,
				insertedText: string,
				options?: { offset?: number },
			) {
				receivedEditor = nextEditor;
				receivedOffset = options?.offset;
				if (insertedText !== "# ") return null;
				return [
					{
						type: "delete-text" as const,
						blockId: nextBlockId,
						offset: 0,
						length: 2,
					},
					{
						type: "convert-block" as const,
						blockId: nextBlockId,
						newType: "heading",
						newProps: { level: 1 },
					},
				];
			},
		});

		const target = applyListInputRule(editor, {
			blockId,
			range: { start: 0, end: 0 },
			text: "# ",
		});

		expect(receivedEditor).toBe(editor);
		expect(receivedOffset).toBe(0);
		expect(target).toEqual({ blockId, anchorOffset: 0, focusOffset: 0 });
		expect(editor.getBlock(blockId)?.type).toBe("heading");
		expect(editor.getBlock(blockId)?.props.level).toBe(1);

		editor.destroy();
	});

	it("does not convert non-paragraph blocks with list triggers", () => {
		const editor = createEditor(editorOpts());
		const blockId = editor.firstBlock()!.id;

		editor.apply([{ type: "convert-block", blockId, newType: "heading" }]);

		const target = applyListInputRule(editor, {
			blockId,
			range: { start: 0, end: 0 },
			text: "- ",
		});

		expect(target).toBeNull();
		expect(editor.getBlock(blockId)?.type).toBe("heading");
		expect(visibleText(editor.getBlock(blockId)!.textContent())).toBe("");

		editor.destroy();
	});

	it("does not convert paragraphs that already contain text", () => {
		const editor = createEditor(editorOpts());
		const blockId = editor.firstBlock()!.id;

		editor.apply([{ type: "insert-text", blockId, offset: 0, text: "Hi" }]);

		const target = applyListInputRule(editor, {
			blockId,
			range: { start: 2, end: 2 },
			text: " ",
		});

		expect(target).toBeNull();
		expect(editor.getBlock(blockId)?.type).toBe("paragraph");
		expect(visibleText(editor.getBlock(blockId)!.textContent())).toBe("Hi");

		editor.destroy();
	});

	it("treats placeholder-only blocks as logically empty", () => {
		const editor = createEditor(editorOpts());
		const blockId = editor.firstBlock()!.id;
		const ytext = getYText(editor, blockId);

		expect(getLogicalInlineLength(ytext)).toBe(0);
		expect(normalizeInlineOffset(ytext, 1)).toBe(0);

		editor.destroy();
	});

	it("merges backward from an empty paragraph without carrying the placeholder", () => {
		const editor = createEditor(editorOpts());
		const firstBlockId = editor.firstBlock()!.id;
		const secondBlockId = crypto.randomUUID();

		editor.apply([
			{
				type: "insert-text",
				blockId: firstBlockId,
				offset: 0,
				text: "Hello",
			},
			{
				type: "insert-block",
				blockId: secondBlockId,
				blockType: "paragraph",
				props: {},
				position: { after: firstBlockId },
			},
		]);

		const secondYText = getYText(editor, secondBlockId);
		const target = applyBackspaceBehavior(editor, {
			blockId: secondBlockId,
			ytext: secondYText,
			range: { start: 1, end: 1 },
		});

		expect(target).toEqual({
			blockId: firstBlockId,
			anchorOffset: 5,
			focusOffset: 5,
		});
		expect(editor.blockCount()).toBe(1);
		expect(editor.getBlock(firstBlockId)!.textContent()).toBe("Hello");

		editor.destroy();
	});

	it("moves to the previous block at the logical start", () => {
		const editor = createEditor(editorOpts());
		const firstBlockId = editor.firstBlock()!.id;
		const secondBlockId = crypto.randomUUID();

		editor.apply([
			{
				type: "insert-text",
				blockId: firstBlockId,
				offset: 0,
				text: "Hello",
			},
			{
				type: "insert-block",
				blockId: secondBlockId,
				blockType: "paragraph",
				props: {},
				position: { after: firstBlockId },
			},
		]);

		const secondYText = getYText(editor, secondBlockId);
		const target = moveCaretAcrossBlocks(editor, {
			blockId: secondBlockId,
			ytext: secondYText,
			range: { start: 1, end: 1 },
			direction: "previous",
		});

		expect(target).toEqual({
			blockId: firstBlockId,
			anchorOffset: 5,
			focusOffset: 5,
		});

		editor.destroy();
	});

	it("moves to the next block at the logical end", () => {
		const editor = createEditor(editorOpts());
		const firstBlockId = editor.firstBlock()!.id;
		const secondBlockId = crypto.randomUUID();

		editor.apply([
			{
				type: "insert-text",
				blockId: firstBlockId,
				offset: 0,
				text: "Hello",
			},
			{
				type: "insert-block",
				blockId: secondBlockId,
				blockType: "paragraph",
				props: {},
				position: { after: firstBlockId },
			},
		]);

		const firstYText = getYText(editor, firstBlockId);
		const target = moveCaretAcrossBlocks(editor, {
			blockId: firstBlockId,
			ytext: firstYText,
			range: { start: 5, end: 5 },
			direction: "next",
		});

		expect(target).toEqual({
			blockId: secondBlockId,
			anchorOffset: 0,
			focusOffset: 0,
		});

		editor.destroy();
	});

	it("skips hidden toggle children when moving through visible blocks", () => {
		const editor = createEditor(editorOpts());
		const toggleBlockId = editor.firstBlock()!.id;
		const childBlockId = crypto.randomUUID();
		const afterBlockId = crypto.randomUUID();

		editor.apply([
			{
				type: "convert-block",
				blockId: toggleBlockId,
				newType: "toggle",
				newProps: { open: false },
			},
			{
				type: "insert-text",
				blockId: toggleBlockId,
				offset: 0,
				text: "Toggle",
			},
			{
				type: "insert-block",
				blockId: childBlockId,
				blockType: "paragraph",
				props: {},
				position: { after: toggleBlockId },
			},
			{
				type: "insert-text",
				blockId: childBlockId,
				offset: 0,
				text: "Hidden child",
			},
			{
				type: "update-block",
				blockId: childBlockId,
				props: { parentId: toggleBlockId },
			},
			{
				type: "insert-block",
				blockId: afterBlockId,
				blockType: "paragraph",
				props: {},
				position: { after: childBlockId },
			},
			{
				type: "insert-text",
				blockId: afterBlockId,
				offset: 0,
				text: "After toggle",
			},
		]);

		const toggleYText = getYText(editor, toggleBlockId);
		const target = moveCaretAcrossBlocks(editor, {
			blockId: toggleBlockId,
			ytext: toggleYText,
			range: { start: 6, end: 6 },
			direction: "next",
		});

		expect(target).toEqual({
			blockId: afterBlockId,
			anchorOffset: 0,
			focusOffset: 0,
		});

		editor.destroy();
	});
});

describe("resolveBackspaceAction – schema-aware Backspace", () => {
	it("converts an empty heading to paragraph", () => {
		const editor = createEditor(editorOpts());
		const blockId = editor.firstBlock()!.id;

		editor.apply([{ type: "convert-block", blockId, newType: "heading" }]);

		const action = resolveBackspaceAction(editor, {
			blockId,
			ytext: getYText(editor, blockId),
			range: { start: 0, end: 0 },
		});

		expect(action).toEqual({ action: "convert", newType: "paragraph" });

		editor.destroy();
	});

	it("converts an empty bullet list item to paragraph", () => {
		const editor = createEditor(editorOpts());
		const blockId = editor.firstBlock()!.id;

		editor.apply([
			{ type: "convert-block", blockId, newType: "bulletListItem" },
		]);

		const action = resolveBackspaceAction(editor, {
			blockId,
			ytext: getYText(editor, blockId),
			range: { start: 0, end: 0 },
		});

		expect(action).toEqual({ action: "convert", newType: "paragraph" });

		editor.destroy();
	});

	it("converts an empty blockquote to paragraph even without a previous block", () => {
		const editor = createEditor(editorOpts());
		const blockId = editor.firstBlock()!.id;

		editor.apply([
			{ type: "convert-block", blockId, newType: "blockquote" },
		]);

		const action = resolveBackspaceAction(editor, {
			blockId,
			ytext: getYText(editor, blockId),
			range: { start: 0, end: 0 },
		});

		expect(action).toEqual({ action: "convert", newType: "paragraph" });

		editor.destroy();
	});

	it("keeps paragraph backspace at start as a merge action", () => {
		const editor = createEditor(editorOpts());
		const firstBlockId = editor.firstBlock()!.id;
		const secondBlockId = crypto.randomUUID();

		editor.apply([
			{
				type: "insert-text",
				blockId: firstBlockId,
				offset: 0,
				text: "Hello",
			},
			{
				type: "insert-block",
				blockId: secondBlockId,
				blockType: "paragraph",
				props: {},
				position: { after: firstBlockId },
			},
		]);

		const action = resolveBackspaceAction(editor, {
			blockId: secondBlockId,
			ytext: getYText(editor, secondBlockId),
			range: { start: 0, end: 0 },
		});

		expect(action).toEqual({
			action: "merge",
			targetBlockId: firstBlockId,
		});

		editor.destroy();
	});

	it("deletes an empty childless toggle when there is a previous block", () => {
		const editor = createEditor(editorOpts());
		const firstBlockId = editor.firstBlock()!.id;
		const toggleBlockId = crypto.randomUUID();

		editor.apply([
			{
				type: "insert-text",
				blockId: firstBlockId,
				offset: 0,
				text: "Hello",
			},
			{
				type: "insert-block",
				blockId: toggleBlockId,
				blockType: "toggle",
				props: {},
				position: { after: firstBlockId },
			},
		]);

		const action = resolveBackspaceAction(editor, {
			blockId: toggleBlockId,
			ytext: getYText(editor, toggleBlockId),
			range: { start: 0, end: 0 },
		});

		expect(action).toEqual({
			action: "delete",
			targetBlockId: firstBlockId,
		});

		editor.destroy();
	});

	it("does not delete a toggle with nested children on backspace", () => {
		const editor = createEditor(editorOpts());
		const firstBlockId = editor.firstBlock()!.id;
		const toggleBlockId = crypto.randomUUID();
		const childBlockId = crypto.randomUUID();

		editor.apply([
			{
				type: "insert-text",
				blockId: firstBlockId,
				offset: 0,
				text: "Hello",
			},
			{
				type: "insert-block",
				blockId: toggleBlockId,
				blockType: "toggle",
				props: {},
				position: { after: firstBlockId },
			},
			{
				type: "insert-block",
				blockId: childBlockId,
				blockType: "paragraph",
				props: {},
				position: { after: toggleBlockId },
			},
			{
				type: "update-block",
				blockId: childBlockId,
				props: { parentId: toggleBlockId },
			},
		]);

		const action = resolveBackspaceAction(editor, {
			blockId: toggleBlockId,
			ytext: getYText(editor, toggleBlockId),
			range: { start: 0, end: 0 },
		});

		expect(action).toEqual({
			action: "merge",
			targetBlockId: firstBlockId,
		});

		editor.destroy();
	});
});

describe("applyDeleteBehavior", () => {
	it("deletes selected text before falling back to character deletion", () => {
		const editor = createEditor(editorOpts());
		const blockId = editor.firstBlock()!.id;

		editor.apply([
			{ type: "insert-text", blockId, offset: 0, text: "Hello" },
		]);

		const target = applyDeleteBehavior(editor, {
			blockId,
			ytext: getYText(editor, blockId),
			range: { start: 1, end: 4 },
			direction: "backward",
		});

		expect(visibleText(editor.getBlock(blockId)!.textContent())).toBe("Ho");
		expect(target).toEqual({
			blockId,
			anchorOffset: 1,
			focusOffset: 1,
		});
		expect(editor.selection).toMatchObject({
			type: "text",
			anchor: { blockId, offset: 1 },
			focus: { blockId, offset: 1 },
			isCollapsed: true,
		});

		editor.destroy();
	});

	it("selects the previous inline node before deleting it with Backspace", () => {
		const editor = createEditor(editorOpts());
		const blockId = editor.firstBlock()!.id;

		editor.apply([
			{ type: "insert-text", blockId, offset: 0, text: "A" },
			{
				type: "insert-inline-node",
				blockId,
				offset: 1,
				nodeType: "mention",
				props: { id: "user-1", label: "Ada" },
			},
			{ type: "insert-text", blockId, offset: 2, text: "B" },
		]);

		const target = applyDeleteBehavior(editor, {
			blockId,
			ytext: getYText(editor, blockId),
			range: { start: 2, end: 2 },
			direction: "backward",
		});

		expect(target).toEqual({
			blockId,
			anchorOffset: 1,
			focusOffset: 2,
		});
		expect(editor.getBlock(blockId)?.inlineDeltas()).toEqual([
			{ insert: "A" },
			{
				insert: {
					type: "mention",
					props: { id: "user-1", label: "Ada" },
				},
			},
			{ insert: "B" },
		]);

		editor.destroy();
	});

	it("selects the next inline node before deleting it with Delete", () => {
		const editor = createEditor(editorOpts());
		const blockId = editor.firstBlock()!.id;

		editor.apply([
			{ type: "insert-text", blockId, offset: 0, text: "A" },
			{
				type: "insert-inline-node",
				blockId,
				offset: 1,
				nodeType: "mention",
				props: { id: "user-1", label: "Ada" },
			},
			{ type: "insert-text", blockId, offset: 2, text: "B" },
		]);

		const target = applyDeleteBehavior(editor, {
			blockId,
			ytext: getYText(editor, blockId),
			range: { start: 1, end: 1 },
			direction: "forward",
		});

		expect(target).toEqual({
			blockId,
			anchorOffset: 1,
			focusOffset: 2,
		});

		editor.destroy();
	});

	it("deletes a selected inline node range", () => {
		const editor = createEditor(editorOpts());
		const blockId = editor.firstBlock()!.id;

		editor.apply([
			{ type: "insert-text", blockId, offset: 0, text: "A" },
			{
				type: "insert-inline-node",
				blockId,
				offset: 1,
				nodeType: "mention",
				props: { id: "user-1", label: "Ada" },
			},
			{ type: "insert-text", blockId, offset: 2, text: "B" },
		]);

		const target = applyDeleteBehavior(editor, {
			blockId,
			ytext: getYText(editor, blockId),
			range: { start: 1, end: 2 },
			direction: "backward",
		});

		expect(target).toEqual({
			blockId,
			anchorOffset: 1,
			focusOffset: 1,
		});
		expect(editor.getBlock(blockId)?.inlineDeltas()).toEqual([
			{ insert: "AB" },
		]);

		editor.destroy();
	});
});

describe("resolveEnterAction – schema-aware Enter", () => {
	it("returns split with paragraph type for heading blocks", () => {
		const editor = createEditor(editorOpts());
		const blockId = editor.firstBlock()!.id;

		editor.apply([
			{
				type: "convert-block",
				blockId,
				newType: "heading",
				newProps: { level: 1 },
			},
			{ type: "insert-text", blockId, offset: 0, text: "Title" },
		]);

		const action = resolveEnterAction(
			editor,
			blockId,
			"richtext",
			getYText(editor, blockId),
		);
		expect(action).toEqual({ action: "split", newBlockType: "paragraph" });

		editor.destroy();
	});

	it("converts empty bullet list item to paragraph", () => {
		const editor = createEditor(editorOpts());
		const blockId = editor.firstBlock()!.id;

		editor.apply([
			{ type: "convert-block", blockId, newType: "bulletListItem" },
		]);

		const action = resolveEnterAction(
			editor,
			blockId,
			"richtext",
			getYText(editor, blockId),
		);
		expect(action).toEqual({ action: "convert", newType: "paragraph" });

		editor.destroy();
	});

	it("splits non-empty bullet list item (keeps type)", () => {
		const editor = createEditor(editorOpts());
		const blockId = editor.firstBlock()!.id;

		editor.apply([
			{ type: "convert-block", blockId, newType: "bulletListItem" },
			{ type: "insert-text", blockId, offset: 0, text: "item" },
		]);

		const action = resolveEnterAction(
			editor,
			blockId,
			"richtext",
			getYText(editor, blockId),
		);
		expect(action).toEqual({ action: "split", newBlockType: undefined });

		editor.destroy();
	});

	it("converts empty numbered list item to paragraph", () => {
		const editor = createEditor(editorOpts());
		const blockId = editor.firstBlock()!.id;

		editor.apply([
			{ type: "convert-block", blockId, newType: "numberedListItem" },
		]);

		const action = resolveEnterAction(
			editor,
			blockId,
			"richtext",
			getYText(editor, blockId),
		);
		expect(action).toEqual({ action: "convert", newType: "paragraph" });

		editor.destroy();
	});

	it("continues a numbered list with the next visible value on enter", () => {
		const editor = createEditor(editorOpts());
		const blockId = editor.firstBlock()!.id;

		editor.apply([
			{
				type: "convert-block",
				blockId,
				newType: "numberedListItem",
				newProps: { start: 3 },
			},
			{ type: "insert-text", blockId, offset: 0, text: "third" },
		]);

		const target = applyEnterBehavior(editor, {
			blockId,
			inputMode: "richtext",
			ytext: getYText(editor, blockId),
			range: { start: 5, end: 5 },
		});
		const newBlockId = editor.documentState.blockOrder[1];

		expect(target).toEqual({
			blockId: newBlockId,
			anchorOffset: 0,
			focusOffset: 0,
		});
		expect(editor.getBlock(newBlockId)?.type).toBe("numberedListItem");
		expect(getNumberedListItemValue(editor.getBlock(blockId))).toBe(3);
		expect(getNumberedListItemValue(editor.getBlock(newBlockId))).toBe(4);

		editor.destroy();
	});

	it("converts empty check list item to paragraph", () => {
		const editor = createEditor(editorOpts());
		const blockId = editor.firstBlock()!.id;

		editor.apply([
			{ type: "convert-block", blockId, newType: "checkListItem" },
		]);

		const action = resolveEnterAction(
			editor,
			blockId,
			"richtext",
			getYText(editor, blockId),
		);
		expect(action).toEqual({ action: "convert", newType: "paragraph" });

		editor.destroy();
	});

	it("converts empty blockquote to paragraph", () => {
		const editor = createEditor(editorOpts());
		const blockId = editor.firstBlock()!.id;

		editor.apply([
			{ type: "convert-block", blockId, newType: "blockquote" },
		]);

		const action = resolveEnterAction(
			editor,
			blockId,
			"richtext",
			getYText(editor, blockId),
		);
		expect(action).toEqual({ action: "convert", newType: "paragraph" });

		editor.destroy();
	});

	it("splits non-empty blockquote (keeps type)", () => {
		const editor = createEditor(editorOpts());
		const blockId = editor.firstBlock()!.id;

		editor.apply([
			{ type: "convert-block", blockId, newType: "blockquote" },
			{ type: "insert-text", blockId, offset: 0, text: "quote" },
		]);

		const action = resolveEnterAction(
			editor,
			blockId,
			"richtext",
			getYText(editor, blockId),
		);
		expect(action).toEqual({ action: "split", newBlockType: undefined });

		editor.destroy();
	});

	it("converts empty callout to paragraph", () => {
		const editor = createEditor(editorOpts());
		const blockId = editor.firstBlock()!.id;

		editor.apply([{ type: "convert-block", blockId, newType: "callout" }]);

		const action = resolveEnterAction(
			editor,
			blockId,
			"richtext",
			getYText(editor, blockId),
		);
		expect(action).toEqual({ action: "convert", newType: "paragraph" });

		editor.destroy();
	});

	it("returns insert-text for code blocks", () => {
		const editor = createEditor(editorOpts());
		const blockId = editor.firstBlock()!.id;

		editor.apply([
			{ type: "convert-block", blockId, newType: "codeBlock" },
		]);

		const action = resolveEnterAction(
			editor,
			blockId,
			"code",
			getYText(editor, blockId),
		);
		expect(action).toEqual({ action: "insert-text", text: "\n" });

		editor.destroy();
	});

	it("returns null for table mode", () => {
		const editor = createEditor(editorOpts());
		const action = resolveEnterAction(editor, "x", "table", {
			length: 0,
			toString: () => "",
		});
		expect(action).toBeNull();
		editor.destroy();
	});

	it("returns null for none mode", () => {
		const editor = createEditor(editorOpts());
		const action = resolveEnterAction(editor, "x", "none", {
			length: 0,
			toString: () => "",
		});
		expect(action).toBeNull();
		editor.destroy();
	});

	it("splits paragraph with no newBlockType override", () => {
		const editor = createEditor(editorOpts());
		const blockId = editor.firstBlock()!.id;

		editor.apply([
			{ type: "insert-text", blockId, offset: 0, text: "hello" },
		]);

		const action = resolveEnterAction(
			editor,
			blockId,
			"richtext",
			getYText(editor, blockId),
		);
		expect(action).toEqual({ action: "split", newBlockType: undefined });

		editor.destroy();
	});

	it("lifts an empty paragraph out of a toggle container", () => {
		const editor = createEditor(editorOpts());
		const toggleBlockId = editor.firstBlock()!.id;
		const childBlockId = crypto.randomUUID();

		editor.apply([
			{
				type: "convert-block",
				blockId: toggleBlockId,
				newType: "toggle",
			},
			{
				type: "insert-block",
				blockId: childBlockId,
				blockType: "paragraph",
				props: {},
				position: { after: toggleBlockId },
			},
			{
				type: "update-block",
				blockId: childBlockId,
				props: { parentId: toggleBlockId },
			},
		]);

		const action = resolveEnterAction(
			editor,
			childBlockId,
			"richtext",
			getYText(editor, childBlockId),
		);
		expect(action).toEqual({ action: "lift" });

		editor.destroy();
	});
});

describe("applyBackspaceBehavior – integration", () => {
	it("empty bulletListItem Backspace converts to paragraph", () => {
		const editor = createEditor(editorOpts());
		const blockId = editor.firstBlock()!.id;

		editor.apply([
			{ type: "convert-block", blockId, newType: "bulletListItem" },
		]);

		const target = applyBackspaceBehavior(editor, {
			blockId,
			ytext: getYText(editor, blockId),
			range: { start: 0, end: 0 },
		});

		expect(target).not.toBeNull();
		expect(target!.blockId).toBe(blockId);
		expect(editor.getBlock(blockId)!.type).toBe("paragraph");

		editor.destroy();
	});

	it("empty blockquote Backspace converts to paragraph at document start", () => {
		const editor = createEditor(editorOpts());
		const blockId = editor.firstBlock()!.id;

		editor.apply([
			{ type: "convert-block", blockId, newType: "blockquote" },
		]);

		const target = applyBackspaceBehavior(editor, {
			blockId,
			ytext: getYText(editor, blockId),
			range: { start: 0, end: 0 },
		});

		expect(target).not.toBeNull();
		expect(target!.blockId).toBe(blockId);
		expect(editor.getBlock(blockId)!.type).toBe("paragraph");

		editor.destroy();
	});

	it("empty childless toggle Backspace deletes the block and moves to previous", () => {
		const editor = createEditor(editorOpts());
		const firstBlockId = editor.firstBlock()!.id;
		const toggleBlockId = crypto.randomUUID();

		editor.apply([
			{
				type: "insert-text",
				blockId: firstBlockId,
				offset: 0,
				text: "Hello",
			},
			{
				type: "insert-block",
				blockId: toggleBlockId,
				blockType: "toggle",
				props: {},
				position: { after: firstBlockId },
			},
		]);

		const target = applyBackspaceBehavior(editor, {
			blockId: toggleBlockId,
			ytext: getYText(editor, toggleBlockId),
			range: { start: 0, end: 0 },
		});

		expect(target).not.toBeNull();
		expect(target!.blockId).toBe(firstBlockId);
		expect(editor.getBlock(toggleBlockId)).toBeNull();
		expect(editor.blockCount()).toBe(1);

		editor.destroy();
	});
});

describe("applyListTabBehavior", () => {
	it("Tab indents a list item when the previous sibling can own the nesting", () => {
		const editor = createEditor(editorOpts());
		const firstBlockId = editor.firstBlock()!.id;
		const secondBlockId = crypto.randomUUID();

		editor.apply([
			{
				type: "convert-block",
				blockId: firstBlockId,
				newType: "bulletListItem",
			},
			{
				type: "insert-block",
				blockId: secondBlockId,
				blockType: "bulletListItem",
				props: { indent: 0 },
				position: { after: firstBlockId },
			},
			{
				type: "insert-text",
				blockId: secondBlockId,
				offset: 0,
				text: "child",
			},
		]);

		const target = applyListTabBehavior(editor, {
			blockId: secondBlockId,
			ytext: getYText(editor, secondBlockId),
			range: { start: 2, end: 2 },
			shiftKey: false,
		});

		expect(target).toEqual({
			blockId: secondBlockId,
			anchorOffset: 2,
			focusOffset: 2,
		});
		expect(editor.getBlock(secondBlockId)?.props.indent).toBe(1);

		editor.destroy();
	});

	it("Tab returns null for a top-level list item without a parent candidate", () => {
		const editor = createEditor(editorOpts());
		const blockId = editor.firstBlock()!.id;

		editor.apply([
			{ type: "convert-block", blockId, newType: "bulletListItem" },
			{ type: "insert-text", blockId, offset: 0, text: "root" },
		]);

		const target = applyListTabBehavior(editor, {
			blockId,
			ytext: getYText(editor, blockId),
			range: { start: 4, end: 4 },
			shiftKey: false,
		});

		expect(target).toBeNull();
		expect(editor.getBlock(blockId)?.props.indent).toBe(0);

		editor.destroy();
	});

	it("Shift-Tab returns null for an already top-level list item", () => {
		const editor = createEditor(editorOpts());
		const blockId = editor.firstBlock()!.id;

		editor.apply([
			{ type: "convert-block", blockId, newType: "bulletListItem" },
			{ type: "insert-text", blockId, offset: 0, text: "root" },
		]);

		const target = applyListTabBehavior(editor, {
			blockId,
			ytext: getYText(editor, blockId),
			range: { start: 1, end: 3 },
			shiftKey: true,
		});

		expect(target).toBeNull();
		expect(editor.getBlock(blockId)?.props.indent).toBe(0);

		editor.destroy();
	});

	it("Shift-Tab outdents a nested list item", () => {
		const editor = createEditor(editorOpts());
		const firstBlockId = editor.firstBlock()!.id;
		const secondBlockId = crypto.randomUUID();

		editor.apply([
			{
				type: "convert-block",
				blockId: firstBlockId,
				newType: "bulletListItem",
			},
			{
				type: "insert-block",
				blockId: secondBlockId,
				blockType: "bulletListItem",
				props: { indent: 1 },
				position: { after: firstBlockId },
			},
			{
				type: "insert-text",
				blockId: secondBlockId,
				offset: 0,
				text: "child",
			},
		]);

		const target = applyListTabBehavior(editor, {
			blockId: secondBlockId,
			ytext: getYText(editor, secondBlockId),
			range: { start: 1, end: 3 },
			shiftKey: true,
		});

		expect(target).toEqual({
			blockId: secondBlockId,
			anchorOffset: 1,
			focusOffset: 3,
		});
		expect(editor.getBlock(secondBlockId)?.props.indent).toBe(0);

		editor.destroy();
	});
});

describe("applyEnterBehavior – integration", () => {
	it("heading Enter produces a paragraph block", () => {
		const editor = createEditor(editorOpts());
		const blockId = editor.firstBlock()!.id;

		editor.apply([
			{
				type: "convert-block",
				blockId,
				newType: "heading",
				newProps: { level: 2 },
			},
			{ type: "insert-text", blockId, offset: 0, text: "Section" },
		]);

		const target = applyEnterBehavior(editor, {
			blockId,
			inputMode: "richtext",
			ytext: getYText(editor, blockId),
			range: { start: 7, end: 7 },
		});

		expect(target).not.toBeNull();
		expect(editor.blockCount()).toBe(2);
		expect(editor.getBlock(blockId)!.type).toBe("heading");
		expect(editor.getBlock(target!.blockId)!.type).toBe("paragraph");

		editor.destroy();
	});

	it("empty bulletListItem Enter converts to paragraph (no new block)", () => {
		const editor = createEditor(editorOpts());
		const blockId = editor.firstBlock()!.id;

		editor.apply([
			{ type: "convert-block", blockId, newType: "bulletListItem" },
		]);

		const target = applyEnterBehavior(editor, {
			blockId,
			inputMode: "richtext",
			ytext: getYText(editor, blockId),
			range: { start: 0, end: 0 },
		});

		expect(target).not.toBeNull();
		expect(editor.blockCount()).toBe(1);
		expect(target!.blockId).toBe(blockId);
		expect(editor.getBlock(blockId)!.type).toBe("paragraph");

		editor.destroy();
	});

	it("non-empty bulletListItem Enter splits (keeps list type)", () => {
		const editor = createEditor(editorOpts());
		const blockId = editor.firstBlock()!.id;

		editor.apply([
			{ type: "convert-block", blockId, newType: "bulletListItem" },
			{ type: "insert-text", blockId, offset: 0, text: "task" },
		]);

		const target = applyEnterBehavior(editor, {
			blockId,
			inputMode: "richtext",
			ytext: getYText(editor, blockId),
			range: { start: 4, end: 4 },
		});

		expect(target).not.toBeNull();
		expect(editor.blockCount()).toBe(2);
		expect(editor.getBlock(blockId)!.type).toBe("bulletListItem");
		expect(editor.getBlock(target!.blockId)!.type).toBe("bulletListItem");

		editor.destroy();
	});

	it("empty paragraph child Enter exits the toggle by clearing parentId", () => {
		const editor = createEditor(editorOpts());
		const toggleBlockId = editor.firstBlock()!.id;
		const childBlockId = crypto.randomUUID();

		editor.apply([
			{
				type: "convert-block",
				blockId: toggleBlockId,
				newType: "toggle",
				newProps: { open: true },
			},
			{
				type: "insert-block",
				blockId: childBlockId,
				blockType: "paragraph",
				props: {},
				position: { after: toggleBlockId },
			},
			{
				type: "update-block",
				blockId: childBlockId,
				props: { parentId: toggleBlockId },
			},
		]);

		const target = applyEnterBehavior(editor, {
			blockId: childBlockId,
			inputMode: "richtext",
			ytext: getYText(editor, childBlockId),
			range: { start: 0, end: 0 },
		});

		expect(target).not.toBeNull();
		expect(target!.blockId).toBe(childBlockId);
		expect(editor.documentState.parentOf(childBlockId)).toBeNull();
		expect(editor.getBlock(childBlockId)?.type).toBe("paragraph");

		editor.destroy();
	});

	it("double enter exits a toggle after first exiting an empty list child", () => {
		const editor = createEditor(editorOpts());
		const toggleBlockId = editor.firstBlock()!.id;
		const childBlockId = crypto.randomUUID();

		editor.apply([
			{
				type: "convert-block",
				blockId: toggleBlockId,
				newType: "toggle",
				newProps: { open: true },
			},
			{
				type: "insert-block",
				blockId: childBlockId,
				blockType: "bulletListItem",
				props: {},
				position: { after: toggleBlockId },
			},
			{
				type: "update-block",
				blockId: childBlockId,
				props: { parentId: toggleBlockId },
			},
		]);

		const firstTarget = applyEnterBehavior(editor, {
			blockId: childBlockId,
			inputMode: "richtext",
			ytext: getYText(editor, childBlockId),
			range: { start: 0, end: 0 },
		});

		expect(firstTarget?.blockId).toBe(childBlockId);
		expect(editor.getBlock(childBlockId)?.type).toBe("paragraph");
		expect(editor.documentState.parentOf(childBlockId)).toBe(toggleBlockId);

		const secondTarget = applyEnterBehavior(editor, {
			blockId: childBlockId,
			inputMode: "richtext",
			ytext: getYText(editor, childBlockId),
			range: { start: 0, end: 0 },
		});

		expect(secondTarget?.blockId).toBe(childBlockId);
		expect(editor.documentState.parentOf(childBlockId)).toBeNull();

		editor.destroy();
	});
});
