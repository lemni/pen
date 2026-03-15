import { describe, expect, it } from "vitest";
import { createEditor } from "@pen/core";
import { defaultPreset } from "@pen/preset-default";
import {
	expandFieldEditorRange,
	contractFieldEditorRange,
	shouldUseBlockSelection,
	getExpandedBlockRole,
	computeTextDiff,
} from "../field-editor/index";
import { ContentEditableBackend } from "../field-editor/contenteditableBackend";
import { EditContextBackend } from "../field-editor/editContextBackend";
import { ExpandedContentEditableBackend } from "../field-editor/expandedContentEditableBackend";
import { FieldEditorImpl } from "../field-editor/fieldEditorImpl";
import {
	EditorRegionSelector,
	Pen,
	richTextShortcutsExtension,
} from "../index";

function createFieldEditorExportsEditor() {
	return createEditor({
		preset: defaultPreset({
			documentOps: false,
			deltaStream: false,
			undo: false,
		}),
	});
}

describe("@pen/react field-editor exports", () => {
	it("loads the field-editor helper barrel on all platforms", () => {
		expect(typeof expandFieldEditorRange).toBe("function");
		expect(typeof contractFieldEditorRange).toBe("function");
		expect(typeof shouldUseBlockSelection).toBe("function");
		expect(typeof getExpandedBlockRole).toBe("function");
	});

	it("keeps concrete field-editor runtime pieces internal to source imports", () => {
		expect(typeof FieldEditorImpl).toBe("function");
		expect(typeof EditContextBackend).toBe("function");
		expect(typeof ContentEditableBackend).toBe("function");
		expect(typeof ExpandedContentEditableBackend).toBe("function");
	});

	it("computes a minimal text diff", () => {
		expect(computeTextDiff("Hello", "Hello world")).toEqual([
			{ type: "insert", offset: 5, text: " world" },
		]);
	});

	it("exports the rich-text shortcuts extension", () => {
		const extension = richTextShortcutsExtension();
		expect(extension.name).toBe("rich-text-shortcuts");
		expect(extension.keyBindings?.map((binding) => binding.key)).toEqual([
			"Mod-b",
			"Mod-i",
			"Mod-u",
		]);
	});

	it("exports the optional region selector primitive", () => {
		expect(typeof EditorRegionSelector).toBe("function");
		expect(Pen.Editor.RegionSelector).toBe(EditorRegionSelector);
	});

	it("exposes a stable field-editor snapshot store", () => {
		const editor = createFieldEditorExportsEditor();
		const fieldEditor = new FieldEditorImpl(editor);
		const blockId = editor.firstBlock()!.id;
		const snapshots = [fieldEditor.getSnapshot()];
		const unsubscribe = fieldEditor.subscribe(() => {
			snapshots.push(fieldEditor.getSnapshot());
		});

		fieldEditor.activate(blockId);
		fieldEditor.setFocused(true);
		fieldEditor.setTextSelection(blockId, 0, 0);
		fieldEditor.deactivate();

		expect(snapshots[0]).toEqual({
			focusBlockId: null,
			activeBlockIds: [],
			isEditing: false,
			isFocused: false,
			isComposing: false,
			inputMode: "none",
			mode: "inactive",
			activeCellCoord: null,
		});
		expect(snapshots).toContainEqual({
			focusBlockId: blockId,
			activeBlockIds: [blockId],
			isEditing: true,
			isFocused: false,
			isComposing: false,
			inputMode: "richtext",
			mode: "single",
			activeCellCoord: null,
		});
		expect(snapshots).toContainEqual({
			focusBlockId: blockId,
			activeBlockIds: [blockId],
			isEditing: true,
			isFocused: true,
			isComposing: false,
			inputMode: "richtext",
			mode: "single",
			activeCellCoord: null,
		});
		expect(editor.selection).toMatchObject({
			type: "text",
			anchor: { blockId, offset: 0 },
			focus: { blockId, offset: 0 },
		});
		expect(fieldEditor.getSnapshot()).toEqual({
			focusBlockId: null,
			activeBlockIds: [],
			isEditing: false,
			isFocused: true,
			isComposing: false,
			inputMode: "none",
			mode: "inactive",
			activeCellCoord: null,
		});

		unsubscribe();
		fieldEditor.destroy();
		editor.destroy();
	});

	it("derives expanded surface state from canonical multi-block selection", () => {
		const editor = createFieldEditorExportsEditor();
		const firstBlockId = editor.firstBlock()!.id;
		const secondBlockId = crypto.randomUUID();

		editor.apply([
			{
				type: "insert-block",
				blockId: secondBlockId,
				blockType: "paragraph",
				props: {},
				position: { after: firstBlockId },
			},
			{
				type: "insert-text",
				blockId: firstBlockId,
				offset: 0,
				text: "Hello",
			},
			{
				type: "insert-text",
				blockId: secondBlockId,
				offset: 0,
				text: "World",
			},
		]);

		const fieldEditor = new FieldEditorImpl(editor);
		fieldEditor.activate(firstBlockId);
		fieldEditor.expandTo(secondBlockId);

		expect(fieldEditor.getSnapshot()).toMatchObject({
			focusBlockId: firstBlockId,
			activeBlockIds: [firstBlockId, secondBlockId],
			isEditing: true,
			mode: "expanded",
		});
		expect(getExpandedBlockRole(editor, firstBlockId)).toBe(
			"editable-inline",
		);

		fieldEditor.destroy();
		editor.destroy();
	});

	it("switches large cross-block selections to block mode after 50 blocks", () => {
		const editor = createFieldEditorExportsEditor();
		const firstBlockId = editor.firstBlock()!.id;
		const additionalBlockIds = Array.from({ length: 50 }, () =>
			crypto.randomUUID(),
		);
		const insertOps = additionalBlockIds.flatMap((blockId) => [
			{
				type: "insert-block" as const,
				blockId,
				blockType: "paragraph" as const,
				props: {},
				position: "last" as const,
			},
			{
				type: "insert-text" as const,
				blockId,
				offset: 0,
				text: blockId,
			},
		]);

		editor.apply([
			{
				type: "insert-text",
				blockId: firstBlockId,
				offset: 0,
				text: "first",
			},
			...insertOps,
		]);

		const fieldEditor = new FieldEditorImpl(editor);
		const lastBlockId = additionalBlockIds[additionalBlockIds.length - 1]!;
		fieldEditor.activate(firstBlockId);
		fieldEditor.expandTo(lastBlockId);

		expect(shouldUseBlockSelection(editor, 51)).toBe(true);
		expect(fieldEditor.getSnapshot()).toMatchObject({
			focusBlockId: firstBlockId,
			isEditing: true,
			mode: "block",
		});
		expect(fieldEditor.getSnapshot().activeBlockIds).toHaveLength(51);

		fieldEditor.destroy();
		editor.destroy();
	});
});
