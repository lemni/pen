// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import { createEditor as createCoreEditor } from "@pen/core";
import type { AssetProvider } from "@pen/types";
import { defaultPreset } from "@pen/preset-default";
import {
	handleClipboardPaste,
	handleCopy,
} from "../field-editor/clipboard";
import type { FieldEditorImpl } from "../field-editor/fieldEditorImpl";
import type { PasteImporters } from "../context/editorContext";

function createEditor(
	options: Parameters<typeof createCoreEditor>[0] = {},
	config: {
		undo?: boolean;
	} = {},
) {
	return createCoreEditor({
		...options,
		preset: defaultPreset({
			documentOps: false,
			deltaStream: false,
			undo: config.undo ?? false,
		}),
	});
}

function createFileList(files: File[]): FileList {
	return Object.assign([...files], {
		item(index: number) {
			return files[index] ?? null;
		},
	}) as unknown as FileList;
}

function createClipboardData(files: File[] = []): DataTransfer {
	const data = new Map<string, string>();
	const types: string[] = files.length > 0 ? ["Files"] : [];

	return {
		files: createFileList(files),
		types,
		getData(type: string) {
			return data.get(type) ?? "";
		},
		setData(type: string, value: string) {
			data.set(type, value);
		},
	} as unknown as DataTransfer;
}

function createFieldEditorStub(): FieldEditorImpl {
	return {
		activateTextSelection: vi.fn(),
	} as unknown as FieldEditorImpl;
}

function getClipboardPenBlocks(
	clipboardData: DataTransfer,
): Array<{ type?: string; content?: string }> {
	return JSON.parse(
		clipboardData.getData("application/x-pen-blocks"),
	) as Array<{ type?: string; content?: string }>;
}

function seedTable(
	editor: ReturnType<typeof createEditor>,
	tableId: string,
): void {
	editor.apply([
		{
			type: "insert-block",
			blockId: tableId,
			blockType: "table",
			props: {},
			position: "last",
		},
		{
			type: "insert-table-cell-text",
			blockId: tableId,
			row: 0,
			col: 0,
			offset: 0,
			text: "Alpha",
		},
		{
			type: "insert-table-cell-text",
			blockId: tableId,
			row: 0,
			col: 1,
			offset: 0,
			text: "Bravo",
		},
	]);
}

function seedDatabase(
	editor: ReturnType<typeof createEditor>,
	blockId: string,
): void {
	editor.apply([
		{
			type: "insert-block",
			blockId,
			blockType: "database",
			props: {},
			position: "last",
		},
	]);
}

describe("@pen/react clipboard", () => {
	it("preserves inline formatting for internal copy/paste round-trips", () => {
		const editor = createEditor();
		const blockId = editor.firstBlock()!.id;
		const clipboardData = createClipboardData();
		const fieldEditor = createFieldEditorStub();

		editor.apply([
			{ type: "insert-text", blockId, offset: 0, text: "Hi there" },
			{
				type: "format-text",
				blockId,
				offset: 0,
				length: 2,
				marks: { bold: true },
			},
		]);

		editor.selectText(blockId, 0, 2);
		handleCopy(editor, { clipboardData } as ClipboardEvent);

		editor.selectText(blockId, 8, 8);
		handleClipboardPaste(
			{ clipboardData } as ClipboardEvent,
			editor,
			fieldEditor,
		);

		expect(editor.getBlock(blockId)?.textDeltas()).toEqual([
			{ insert: "Hi", attributes: { bold: true } },
			{ insert: " there" },
			{ insert: "Hi", attributes: { bold: true } },
		]);

		editor.destroy();
	});

	it("supports unicode round-trips through embedded HTML payloads", () => {
		const editor = createEditor();
		const blockId = editor.firstBlock()!.id;
		const clipboardData = createClipboardData();
		const fieldEditor = createFieldEditorStub();

		editor.apply([{ type: "insert-text", blockId, offset: 0, text: "a 文🦄 z" }]);

		editor.selectText(blockId, 2, 5);
		handleCopy(editor, { clipboardData } as ClipboardEvent);

		clipboardData.setData("application/x-pen-blocks", "");
		editor.selectText(blockId, 7, 7);

		handleClipboardPaste(
			{ clipboardData } as ClipboardEvent,
			editor,
			fieldEditor,
		);

		expect(editor.getBlock(blockId)?.textContent()).toBe("a 文🦄 z文🦄");

		editor.destroy();
	});

	it("undoes paste-over-selection as a single history entry", async () => {
		const editor = createEditor({}, { undo: true });
		const blockId = editor.firstBlock()!.id;
		const clipboardData = createClipboardData();
		const fieldEditor = createFieldEditorStub();

		editor.apply([{ type: "insert-text", blockId, offset: 0, text: "Hello" }]);
		clipboardData.setData("text/plain", "X");

		editor.selectText(blockId, 1, 4);
		handleClipboardPaste(
			{ clipboardData } as ClipboardEvent,
			editor,
			fieldEditor,
		);
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(editor.getBlock(blockId)?.textContent()).toBe("HXo");
		expect(editor.undoManager.undo()).toBe(true);
		expect(editor.getBlock(blockId)?.textContent()).toBe("Hello");

		editor.destroy();
	});

	it("does not delete the current selection when image upload fails", async () => {
		const editor = createEditor();
		const blockId = editor.firstBlock()!.id;
		const fieldEditor = createFieldEditorStub();
		const clipboardData = createClipboardData([
			new File(["image"], "test.png", { type: "image/png" }),
		]);
		const assetProvider: AssetProvider = {
			upload: vi.fn().mockRejectedValue(new Error("upload failed")),
			resolve(ref) {
				return ref.url;
			},
			async delete() { },
		};

		editor.apply([
			{ type: "insert-text", blockId, offset: 0, text: "Hello" },
		]);
		editor.selectText(blockId, 0, 5);
		editor.internals.setSlot("paste:assetProvider", assetProvider);

		handleClipboardPaste(
			{ clipboardData } as ClipboardEvent,
			editor,
			fieldEditor,
		);
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(assetProvider.upload).toHaveBeenCalledTimes(1);
		expect(editor.getBlock(blockId)?.textContent()).toBe("Hello");

		editor.destroy();
	});

	it("pastes uploaded images through the transfer pipeline", async () => {
		const editor = createEditor();
		const blockId = editor.firstBlock()!.id;
		const fieldEditor = createFieldEditorStub();
		const clipboardData = createClipboardData([
			new File(["image"], "test.png", { type: "image/png" }),
		]);
		const assetProvider: AssetProvider = {
			upload: vi.fn().mockResolvedValue({
				url: "memory://test.png",
				mimeType: "image/png",
			}),
			resolve(ref) {
				return ref.url;
			},
			async delete() { },
		};

		editor.apply([
			{ type: "insert-text", blockId, offset: 0, text: "Hello" },
		]);
		editor.selectText(blockId, 5, 5);
		editor.internals.setSlot("paste:assetProvider", assetProvider);

		handleClipboardPaste(
			{ clipboardData } as ClipboardEvent,
			editor,
			fieldEditor,
		);
		await new Promise((resolve) => setTimeout(resolve, 0));

		const blockOrder = editor.documentState.blockOrder;
		const insertedImageId = blockOrder[1];
		const insertedImage = insertedImageId
			? editor.getBlock(insertedImageId)
			: null;

		expect(assetProvider.upload).toHaveBeenCalledTimes(1);
		expect(blockOrder).toHaveLength(2);
		expect(insertedImage?.type).toBe("image");
		expect(insertedImage?.props).toMatchObject({
			src: "memory://test.png",
			alt: "test",
		});

		editor.destroy();
	});

	it("replaces an empty block when pasting blocks into it", () => {
		const editor = createEditor();
		const emptyBlockId = editor.firstBlock()!.id;
		const clipboardData = createClipboardData();
		const fieldEditor = createFieldEditorStub();

		const penBlocks = JSON.stringify([
			{ type: "heading", props: { level: 1 }, content: "Title", deltas: [{ insert: "Title" }] },
		]);
		clipboardData.setData("application/x-pen-blocks", penBlocks);

		editor.selectText(emptyBlockId, 0, 0);
		handleClipboardPaste(
			{ clipboardData } as ClipboardEvent,
			editor,
			fieldEditor,
		);

		const blockOrder = editor.documentState.blockOrder;
		expect(blockOrder).toHaveLength(1);
		const block = editor.getBlock(blockOrder[0])!;
		expect(block.type).toBe("heading");
		expect(block.textContent()).toBe("Title");

		editor.destroy();
	});

	it("does not replace a non-empty block when pasting blocks", () => {
		const editor = createEditor();
		const blockId = editor.firstBlock()!.id;
		const clipboardData = createClipboardData();
		const fieldEditor = createFieldEditorStub();

		editor.apply([
			{ type: "insert-text", blockId, offset: 0, text: "existing" },
		]);

		const penBlocks = JSON.stringify([
			{ type: "heading", props: { level: 1 }, content: "Title", deltas: [{ insert: "Title" }] },
		]);
		clipboardData.setData("application/x-pen-blocks", penBlocks);

		editor.selectText(blockId, 8, 8);
		handleClipboardPaste(
			{ clipboardData } as ClipboardEvent,
			editor,
			fieldEditor,
		);

		const blockOrder = editor.documentState.blockOrder;
		expect(blockOrder).toHaveLength(2);
		expect(editor.getBlock(blockOrder[0])!.textContent()).toBe("existing");
		expect(editor.getBlock(blockOrder[1])!.type).toBe("heading");

		editor.destroy();
	});

	it("replaces an empty block through importer parse output", async () => {
		const editor = createEditor();
		const emptyBlockId = editor.firstBlock()!.id;
		const clipboardData = createClipboardData();
		const fieldEditor = createFieldEditorStub();
		const importers: PasteImporters = {
			html: {
				parse: vi.fn().mockReturnValue([
					{ type: "heading", props: { level: 2 }, content: "Parsed title" },
				]),
				import: vi.fn(),
				name: "html",
				mimeType: "text/html",
			},
		};

		clipboardData.setData("text/html", "<h2>Parsed title</h2>");
		editor.selectText(emptyBlockId, 0, 0);

		handleClipboardPaste(
			{ clipboardData } as ClipboardEvent,
			editor,
			fieldEditor,
			importers,
		);
		await new Promise((resolve) => setTimeout(resolve, 0));

		const blockOrder = editor.documentState.blockOrder;
		expect(blockOrder).toHaveLength(1);
		expect(blockOrder[0]).not.toBe(emptyBlockId);
		expect(editor.getBlock(blockOrder[0])?.type).toBe("heading");
		expect(editor.getBlock(blockOrder[0])?.textContent()).toBe("Parsed title");
		expect(importers.html?.import).not.toHaveBeenCalled();
		expect(fieldEditor.activateTextSelection).toHaveBeenCalledWith(
			blockOrder[0],
			12,
			12,
		);

		editor.destroy();
	});

	it("keeps an empty block when importer parse yields no blocks", async () => {
		const editor = createEditor();
		const emptyBlockId = editor.firstBlock()!.id;
		const clipboardData = createClipboardData();
		const fieldEditor = createFieldEditorStub();
		const importers: PasteImporters = {
			html: {
				parse: vi.fn().mockReturnValue([]),
				import: vi.fn(),
				name: "html",
				mimeType: "text/html",
			},
		};

		clipboardData.setData("text/html", "<script>alert('xss')</script>");
		editor.selectText(emptyBlockId, 0, 0);

		handleClipboardPaste(
			{ clipboardData } as ClipboardEvent,
			editor,
			fieldEditor,
			importers,
		);
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(editor.documentState.blockOrder).toEqual([emptyBlockId]);
		expect(editor.getBlock(emptyBlockId)?.type).toBe("paragraph");
		expect(importers.html?.import).toHaveBeenCalledTimes(1);

		editor.destroy();
	});

	it("filters flow-disallowed importer parse blocks before applying parsed paste", async () => {
		const editor = createEditor({
			documentProfile: "flow",
		});
		const emptyBlockId = editor.firstBlock()!.id;
		const clipboardData = createClipboardData();
		const fieldEditor = createFieldEditorStub();
		const importers: PasteImporters = {
			html: {
				parse: vi.fn().mockReturnValue([
					{
						type: "database",
						props: {},
						database: {
							columns: [],
							rows: [],
						},
					},
					{ type: "heading", props: { level: 2 }, content: "Allowed title" },
				]),
				import: vi.fn(),
				name: "html",
				mimeType: "text/html",
			},
		};

		clipboardData.setData("text/html", "<div>mixed</div>");
		editor.selectText(emptyBlockId, 0, 0);

		handleClipboardPaste(
			{ clipboardData } as ClipboardEvent,
			editor,
			fieldEditor,
			importers,
		);
		await new Promise((resolve) => setTimeout(resolve, 0));

		const blockOrder = editor.documentState.blockOrder;
		expect(blockOrder).toHaveLength(1);
		expect(blockOrder[0]).not.toBe(emptyBlockId);
		expect(editor.getBlock(blockOrder[0])?.type).toBe("heading");
		expect(
			blockOrder.some((blockId) => editor.getBlock(blockId)?.type === "database"),
		).toBe(false);
		expect(importers.html?.import).not.toHaveBeenCalled();
		expect(fieldEditor.activateTextSelection).toHaveBeenCalledWith(
			blockOrder[0],
			13,
			13,
		);

		editor.destroy();
	});

	it("preserves the current selection when parsed paste normalizes to zero blocks", async () => {
		const editor = createEditor({
			documentProfile: "flow",
		});
		const blockId = editor.firstBlock()!.id;
		const clipboardData = createClipboardData();
		const fieldEditor = createFieldEditorStub();
		const importers: PasteImporters = {
			html: {
				parse: vi.fn().mockReturnValue([
					{
						type: "database",
						props: {},
						database: {
							columns: [],
							rows: [],
						},
					},
				]),
				import: vi.fn(),
				name: "html",
				mimeType: "text/html",
			},
		};

		editor.apply([
			{
				type: "insert-text",
				blockId,
				offset: 0,
				text: "Keep me",
			},
		]);
		editor.selectText(blockId, 0, 7);
		clipboardData.setData("text/html", "<div>db only</div>");

		handleClipboardPaste(
			{ clipboardData } as ClipboardEvent,
			editor,
			fieldEditor,
			importers,
		);
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(editor.documentState.blockOrder).toEqual([blockId]);
		expect(editor.getBlock(blockId)?.textContent()).toBe("Keep me");
		expect(importers.html?.import).not.toHaveBeenCalled();

		editor.destroy();
	});

	it("filters unknown importer parse blocks before applying parsed paste", async () => {
		const editor = createEditor();
		const emptyBlockId = editor.firstBlock()!.id;
		const clipboardData = createClipboardData();
		const fieldEditor = createFieldEditorStub();
		const importers: PasteImporters = {
			html: {
				parse: vi.fn().mockReturnValue([
					{ type: "customWidget", props: {}, content: "Ignored" },
					{ type: "heading", props: { level: 2 }, content: "Allowed title" },
				]),
				import: vi.fn(),
				name: "html",
				mimeType: "text/html",
			},
		};

		clipboardData.setData("text/html", "<div>mixed</div>");
		editor.selectText(emptyBlockId, 0, 0);

		handleClipboardPaste(
			{ clipboardData } as ClipboardEvent,
			editor,
			fieldEditor,
			importers,
		);
		await new Promise((resolve) => setTimeout(resolve, 0));

		const blockOrder = editor.documentState.blockOrder;
		expect(blockOrder).toHaveLength(1);
		expect(blockOrder[0]).not.toBe(emptyBlockId);
		expect(editor.getBlock(blockOrder[0])?.type).toBe("heading");
		expect(importers.html?.import).not.toHaveBeenCalled();
		expect(fieldEditor.activateTextSelection).toHaveBeenCalledWith(
			blockOrder[0],
			13,
			13,
		);

		editor.destroy();
	});

	it("round-trips a structured table block selection as a table block payload", () => {
		const sourceEditor = createEditor();
		const clipboardData = createClipboardData();
		const fieldEditor = createFieldEditorStub();

		seedTable(sourceEditor, "table-structured");
		sourceEditor.selectBlock("table-structured");
		handleCopy(sourceEditor, { clipboardData } as ClipboardEvent);

		expect(getClipboardPenBlocks(clipboardData).map((block) => block.type)).toEqual([
			"table",
		]);

		const targetEditor = createEditor();
		const emptyBlockId = targetEditor.firstBlock()!.id;
		targetEditor.selectText(emptyBlockId, 0, 0);

		handleClipboardPaste(
			{ clipboardData } as ClipboardEvent,
			targetEditor,
			fieldEditor,
		);

		const blockOrder = targetEditor.documentState.blockOrder;
		expect(blockOrder).toHaveLength(1);
		expect(targetEditor.getBlock(blockOrder[0])?.type).toBe("table");
		expect(targetEditor.getBlock(blockOrder[0])?.tableCell(0, 0)?.textContent()).toBe(
			"Alpha",
		);
		expect(targetEditor.getBlock(blockOrder[0])?.tableCell(0, 1)?.textContent()).toBe(
			"Bravo",
		);

		sourceEditor.destroy();
		targetEditor.destroy();
	});

	it("round-trips a flow-promoted table selection as document blocks", () => {
		const sourceEditor = createEditor({
			documentProfile: "flow",
		});
		const firstBlockId = sourceEditor.firstBlock()!.id;
		const paragraphId = crypto.randomUUID();
		const clipboardData = createClipboardData();
		const fieldEditor = createFieldEditorStub();

		sourceEditor.apply([
			{ type: "insert-text", blockId: firstBlockId, offset: 0, text: "Intro" },
		]);
		seedTable(sourceEditor, "table-flow");
		sourceEditor.apply([
			{
				type: "insert-block",
				blockId: paragraphId,
				blockType: "paragraph",
				props: {},
				position: "last",
			},
			{
				type: "insert-text",
				blockId: paragraphId,
				offset: 0,
				text: "After",
			},
		]);

		sourceEditor.selectTextRange(
			{ blockId: firstBlockId, offset: 0 },
			{ blockId: paragraphId, offset: 5 },
		);
		handleCopy(sourceEditor, { clipboardData } as ClipboardEvent);

		expect(getClipboardPenBlocks(clipboardData).map((block) => block.type)).toEqual([
			"paragraph",
			"table",
			"paragraph",
		]);

		const targetEditor = createEditor();
		const emptyBlockId = targetEditor.firstBlock()!.id;
		targetEditor.selectText(emptyBlockId, 0, 0);

		handleClipboardPaste(
			{ clipboardData } as ClipboardEvent,
			targetEditor,
			fieldEditor,
		);

		const blockOrder = targetEditor.documentState.blockOrder;
		expect(blockOrder).toHaveLength(3);
		expect(targetEditor.getBlock(blockOrder[0])?.textContent()).toBe("Intro");
		expect(targetEditor.getBlock(blockOrder[1])?.type).toBe("table");
		expect(targetEditor.getBlock(blockOrder[1])?.tableCell(0, 0)?.textContent()).toBe(
			"Alpha",
		);
		expect(targetEditor.getBlock(blockOrder[2])?.textContent()).toBe("After");

		sourceEditor.destroy();
		targetEditor.destroy();
	});

	it("round-trips a structured database block selection as a database block payload", () => {
		const sourceEditor = createEditor();
		const clipboardData = createClipboardData();
		const fieldEditor = createFieldEditorStub();

		seedDatabase(sourceEditor, "database-structured");
		sourceEditor.selectBlock("database-structured");
		handleCopy(sourceEditor, { clipboardData } as ClipboardEvent);

		expect(getClipboardPenBlocks(clipboardData).map((block) => block.type)).toEqual([
			"database",
		]);

		const targetEditor = createEditor();
		const emptyBlockId = targetEditor.firstBlock()!.id;
		targetEditor.selectText(emptyBlockId, 0, 0);

		handleClipboardPaste(
			{ clipboardData } as ClipboardEvent,
			targetEditor,
			fieldEditor,
		);

		const blockOrder = targetEditor.documentState.blockOrder;
		expect(blockOrder).toHaveLength(1);
		expect(targetEditor.getBlock(blockOrder[0])?.type).toBe("database");

		sourceEditor.destroy();
		targetEditor.destroy();
	});

	it("round-trips a flow-promoted database selection as document blocks", () => {
		const seedEditor = createEditor();
		const firstBlockId = seedEditor.firstBlock()!.id;
		const paragraphId = crypto.randomUUID();
		const clipboardData = createClipboardData();
		const fieldEditor = createFieldEditorStub();

		seedEditor.apply([
			{ type: "insert-text", blockId: firstBlockId, offset: 0, text: "Intro" },
		]);
		seedDatabase(seedEditor, "database-flow");
		seedEditor.apply([
			{
				type: "insert-block",
				blockId: paragraphId,
				blockType: "paragraph",
				props: {},
				position: "last",
			},
			{
				type: "insert-text",
				blockId: paragraphId,
				offset: 0,
				text: "After",
			},
		]);

		const document = seedEditor.internals.crdtDoc;
		seedEditor.internals.adapter.setDocumentProfile?.(document, "flow");

		const sourceEditor = createEditor({
			document,
		});
		seedEditor.destroy();

		sourceEditor.selectTextRange(
			{ blockId: firstBlockId, offset: 0 },
			{ blockId: paragraphId, offset: 5 },
		);
		handleCopy(sourceEditor, { clipboardData } as ClipboardEvent);

		expect(getClipboardPenBlocks(clipboardData).map((block) => block.type)).toEqual([
			"paragraph",
			"database",
			"paragraph",
		]);

		const targetEditor = createEditor();
		const emptyBlockId = targetEditor.firstBlock()!.id;
		targetEditor.selectText(emptyBlockId, 0, 0);

		handleClipboardPaste(
			{ clipboardData } as ClipboardEvent,
			targetEditor,
			fieldEditor,
		);

		const blockOrder = targetEditor.documentState.blockOrder;
		expect(blockOrder).toHaveLength(3);
		expect(targetEditor.getBlock(blockOrder[0])?.textContent()).toBe("Intro");
		expect(targetEditor.getBlock(blockOrder[1])?.type).toBe("database");
		expect(targetEditor.getBlock(blockOrder[2])?.textContent()).toBe("After");

		sourceEditor.destroy();
		targetEditor.destroy();
	});

	it("avoids direct database block paste in flow documents", () => {
		const sourceEditor = createEditor({
			documentProfile: "flow",
		});
		const firstBlockId = sourceEditor.firstBlock()!.id;
		const paragraphId = crypto.randomUUID();
		const clipboardData = createClipboardData();
		const fieldEditor = createFieldEditorStub();

		sourceEditor.apply([
			{ type: "insert-text", blockId: firstBlockId, offset: 0, text: "Intro" },
		]);
		seedDatabase(sourceEditor, "database-flow-paste");
		sourceEditor.apply([
			{
				type: "insert-block",
				blockId: paragraphId,
				blockType: "paragraph",
				props: {},
				position: "last",
			},
			{
				type: "insert-text",
				blockId: paragraphId,
				offset: 0,
				text: "After",
			},
		]);

		sourceEditor.selectTextRange(
			{ blockId: firstBlockId, offset: 0 },
			{ blockId: paragraphId, offset: 5 },
		);
		handleCopy(sourceEditor, { clipboardData } as ClipboardEvent);

		const targetEditor = createEditor({
			documentProfile: "flow",
		});
		const emptyBlockId = targetEditor.firstBlock()!.id;
		targetEditor.selectText(emptyBlockId, 0, 0);

		handleClipboardPaste(
			{ clipboardData } as ClipboardEvent,
			targetEditor,
			fieldEditor,
		);

		const blockOrder = targetEditor.documentState.blockOrder;
		expect(
			blockOrder.some((blockId) => targetEditor.getBlock(blockId)?.type === "database"),
		).toBe(false);

		sourceEditor.destroy();
		targetEditor.destroy();
	});

	it("does not direct-paste unknown pen block payloads in flow documents", () => {
		const targetEditor = createEditor({
			documentProfile: "flow",
		});
		const emptyBlockId = targetEditor.firstBlock()!.id;
		const clipboardData = createClipboardData();
		const fieldEditor = createFieldEditorStub();

		targetEditor.apply([
			{ type: "insert-text", blockId: emptyBlockId, offset: 0, text: "Hello" },
		]);
		targetEditor.selectText(emptyBlockId, 0, 5);
		clipboardData.setData(
			"application/x-pen-blocks",
			JSON.stringify([
				{ type: "customWidget", props: {}, content: "Ignored" },
			]),
		);

		handleClipboardPaste(
			{ clipboardData } as ClipboardEvent,
			targetEditor,
			fieldEditor,
		);

		expect(targetEditor.documentState.blockOrder).toHaveLength(1);
		expect(targetEditor.getBlock(emptyBlockId)?.textContent()).toBe("Hello");

		targetEditor.destroy();
	});
});
