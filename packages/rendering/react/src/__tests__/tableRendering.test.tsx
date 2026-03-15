// @vitest-environment jsdom

import React, { act } from "react";
import { describe, expect, it } from "vitest";
import { createRoot } from "react-dom/client";
import { createEditor as createCoreEditor } from "@pen/core";
import { defaultPreset } from "@pen/preset-default";
import type { FieldEditorImpl } from "../field-editor/fieldEditorImpl";
import { handleCopy } from "../field-editor/clipboard";
import { FIELD_EDITOR_SLOT_KEY } from "../constants/fieldEditor";
import { Pen } from "../primitives/index";

type TableRowLike = {
	get(field: "cells"): { delete(index: number, length: number): void };
};

type TableContentLike = {
	get(index: number): TableRowLike;
};

type TableBlockMapLike = {
	get(field: "tableContent"): TableContentLike;
};

(
	globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function createEditor(
	options: Parameters<typeof createCoreEditor>[0] = {},
) {
	const { without: _without, ...restOptions } = options;
	return createCoreEditor({
		...restOptions,
		preset: defaultPreset({
			documentOps: false,
			deltaStream: false,
			undo: false,
		}),
	});
}

async function flushAnimationFrames(count = 1): Promise<void> {
	for (let i = 0; i < count; i++) {
		await new Promise<void>((resolve) => {
			requestAnimationFrame(() => resolve());
		});
	}
}

function createKeyEvent(
	key: string,
	options: KeyboardEventInit = {},
): KeyboardEvent {
	return new KeyboardEvent("keydown", {
		key,
		bubbles: true,
		cancelable: true,
		...options,
	});
}

function createSelectAllEvent(): KeyboardEvent {
	return createKeyEvent("a", {
		metaKey: true,
	});
}

function createClipboardData(): DataTransfer {
	const data = new Map<string, string>();

	return {
		files: [] as unknown as FileList,
		types: [],
		getData(type: string) {
			return data.get(type) ?? "";
		},
		setData(type: string, value: string) {
			data.set(type, value);
		},
	} as unknown as DataTransfer;
}

function createMouseEvent(
	type: string,
	options: MouseEventInit = {},
): MouseEvent {
	return new MouseEvent(type, {
		bubbles: true,
		cancelable: true,
		clientX: 20,
		clientY: 20,
		...options,
	});
}

function getFieldEditor(
	editor: ReturnType<typeof createEditor>,
): FieldEditorImpl {
	const fieldEditor = editor.internals.getSlot<FieldEditorImpl>(
		FIELD_EDITOR_SLOT_KEY,
	);
	if (!fieldEditor) {
		throw new Error("Missing attached field editor");
	}
	return fieldEditor;
}

describe("@pen/react table rendering", () => {
	it("renders a table block with cells from the canonical model", async () => {
		const editor = createEditor();

		editor.apply([
			{
				type: "insert-block",
				blockId: "t1",
				blockType: "table",
				props: { hasHeaderRow: true },
				position: "last",
			},
			{
				type: "insert-table-cell-text",
				blockId: "t1",
				row: 0,
				col: 0,
				offset: 0,
				text: "Alice",
			},
			{
				type: "insert-table-cell-text",
				blockId: "t1",
				row: 0,
				col: 1,
				offset: 0,
				text: "30",
			},
			{
				type: "insert-table-cell-text",
				blockId: "t1",
				row: 1,
				col: 0,
				offset: 0,
				text: "Bob",
			},
			{
				type: "insert-table-cell-text",
				blockId: "t1",
				row: 1,
				col: 1,
				offset: 0,
				text: "25",
			},
		]);

		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);

		await act(async () => {
			root.render(
				<Pen.Editor.Root editor={editor}>
					<Pen.Editor.Content />
				</Pen.Editor.Root>,
			);
		});

		const table = container.querySelector("table");
		expect(table).not.toBeNull();

		const thead = table!.querySelector("thead");
		expect(thead).not.toBeNull();

		const tbody = table!.querySelector("tbody");
		expect(tbody).not.toBeNull();

		const headerCells = thead!.querySelectorAll("th");
		expect(headerCells.length).toBeGreaterThanOrEqual(2);

		const bodyCells = tbody!.querySelectorAll("td[data-pen-table-cell]");
		expect(bodyCells.length).toBe(2);

		expect(bodyCells[0].getAttribute("data-cell-row")).toBe("1");
		expect(bodyCells[0].getAttribute("data-cell-col")).toBe("0");

		await act(async () => {
			root.unmount();
		});
		container.remove();
		editor.destroy();
	});

	it("renders cell text content through TableCellContent", async () => {
		const editor = createEditor();

		editor.apply([
			{
				type: "insert-block",
				blockId: "t2",
				blockType: "table",
				props: {},
				position: "last",
			},
			{
				type: "insert-table-cell-text",
				blockId: "t2",
				row: 0,
				col: 0,
				offset: 0,
				text: "Hello",
			},
		]);

		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);

		await act(async () => {
			root.render(
				<Pen.Editor.Root editor={editor}>
					<Pen.Editor.Content />
				</Pen.Editor.Root>,
			);
		});

		const cellInlineContent = container.querySelector(
			"[data-pen-inline-content][data-cell-row='0'][data-cell-col='0']",
		);
		expect(cellInlineContent).not.toBeNull();
		expect(
			cellInlineContent?.hasAttribute("data-pen-field-editor-surface"),
		).toBe(true);
		const text = (cellInlineContent?.textContent ?? "").replace(
			/\u200B/g,
			"",
		);
		expect(text).toBe("Hello");

		await act(async () => {
			root.unmount();
		});
		container.remove();
		editor.destroy();
	});

	it("updates cell content when table ops are applied after render", async () => {
		const editor = createEditor();

		editor.apply([
			{
				type: "insert-block",
				blockId: "t3",
				blockType: "table",
				props: { hasHeaderRow: false },
				position: "last",
			},
		]);

		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);

		await act(async () => {
			root.render(
				<Pen.Editor.Root editor={editor}>
					<Pen.Editor.Content />
				</Pen.Editor.Root>,
			);
		});

		let bodyCells = container.querySelectorAll("tbody td[data-pen-table-cell]");
		expect(bodyCells.length).toBe(4);

		await act(async () => {
			editor.apply([
				{
					type: "insert-table-row",
					blockId: "t3",
					index: 2,
				},
			]);
		});

		bodyCells = container.querySelectorAll("tbody td[data-pen-table-cell]");
		expect(bodyCells.length).toBe(6);

		await act(async () => {
			editor.apply([
				{
					type: "insert-table-column",
					blockId: "t3",
					index: 2,
				},
			]);
		});

		bodyCells = container.querySelectorAll("tbody td[data-pen-table-cell]");
		expect(bodyCells.length).toBe(9);

		await act(async () => {
			root.unmount();
		});
		container.remove();
		editor.destroy();
	});

	it("renders header row with placeholders when hasHeaderRow is set", async () => {
		const editor = createEditor();

		editor.apply([
			{
				type: "insert-block",
				blockId: "t4",
				blockType: "table",
				props: { hasHeaderRow: true },
				position: "last",
			},
		]);

		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);

		await act(async () => {
			root.render(
				<Pen.Editor.Root editor={editor}>
					<Pen.Editor.Content />
				</Pen.Editor.Root>,
			);
		});

		const thead = container.querySelector("thead");
		expect(thead).not.toBeNull();
		const headerCells = thead!.querySelectorAll("th");
		expect(headerCells.length).toBeGreaterThanOrEqual(2);

		expect(container.querySelector("[data-pen-table]")).not.toBeNull();
		expect(container.querySelector("[data-pen-table-frame]")).not.toBeNull();

		await act(async () => {
			root.unmount();
		});
		container.remove();
		editor.destroy();
	});

	it("renders a full row grid even when a legacy row is missing trailing cells", async () => {
		const editor = createEditor();

		editor.apply([
			{
				type: "insert-block",
				blockId: "t4-short-row",
				blockType: "table",
				props: { hasHeaderRow: false },
				position: "last",
			},
			{
				type: "insert-table-column",
				blockId: "t4-short-row",
				index: 2,
			},
		]);

		const blockMap = editor.internals.doc.blocks.get(
			"t4-short-row",
		) as TableBlockMapLike;
		const tableContent = blockMap.get("tableContent");
		const firstRow = tableContent.get(0);
		firstRow.get("cells").delete(2, 1);

		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);

		await act(async () => {
			root.render(
				<Pen.Editor.Root editor={editor}>
					<Pen.Editor.Content />
				</Pen.Editor.Root>,
			);
		});

		const firstRowCells = container.querySelectorAll(
			`[data-block-id="t4-short-row"] tbody tr[data-row="0"] td[data-pen-table-cell]`,
		);
		expect(firstRowCells).toHaveLength(3);

		await act(async () => {
			root.unmount();
		});
		container.remove();
		editor.destroy();
	});

	it("renders add row and column controls outside the table grid", async () => {
		const editor = createEditor();

		editor.apply([
			{
				type: "insert-block",
				blockId: "t4-controls",
				blockType: "table",
				props: { hasHeaderRow: true },
				position: "last",
			},
		]);

		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);

		await act(async () => {
			root.render(
				<Pen.Editor.Root editor={editor}>
					<Pen.Editor.Content />
				</Pen.Editor.Root>,
			);
		});

		const table = container.querySelector(
			`[data-block-id="t4-controls"] [data-pen-table]`,
		);
		const addColumnControl = container.querySelector(
			`[data-block-id="t4-controls"] button[aria-label="Add column"]`,
		);
		const addRowControl = container.querySelector(
			`[data-block-id="t4-controls"] button[aria-label="Add row"]`,
		);

		expect(table).not.toBeNull();
		expect(addColumnControl).not.toBeNull();
		expect(addRowControl).not.toBeNull();
		expect(table?.contains(addColumnControl)).toBe(false);
		expect(table?.contains(addRowControl)).toBe(false);

		await act(async () => {
			root.unmount();
		});
		container.remove();
		editor.destroy();
	});

	it("does not route printable keys through cell-selection shortcuts while editing a cell", async () => {
		const editor = createEditor();

		editor.apply([
			{
				type: "insert-block",
				blockId: "t5",
				blockType: "table",
				props: {},
				position: "last",
			},
			{
				type: "insert-table-cell-text",
				blockId: "t5",
				row: 0,
				col: 0,
				offset: 0,
				text: "Hello",
			},
		]);

		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);

		await act(async () => {
			root.render(
				<Pen.Editor.Root editor={editor}>
					<Pen.Editor.Content />
				</Pen.Editor.Root>,
			);
		});

		const fieldEditor = getFieldEditor(editor);
		const cellSurface = container.querySelector(
			`[data-block-id="t5"] [data-cell-row="0"][data-cell-col="0"] [data-pen-field-editor-surface]`,
		) as HTMLElement | null;

		expect(cellSurface).not.toBeNull();

		await act(async () => {
			editor.selectCell("t5", 0, 0);
			fieldEditor.activateCellFromElement?.("t5", 0, 0, cellSurface!);
			await flushAnimationFrames(2);
		});

		const event = new KeyboardEvent("keydown", {
			key: "b",
			bubbles: true,
			cancelable: true,
		});

		await act(async () => {
			cellSurface?.dispatchEvent(event);
		});

		expect(event.defaultPrevented).toBe(false);

		await act(async () => {
			root.unmount();
		});
		container.remove();
		editor.destroy();
	});

	it("promotes a repeated click on the same cell to block selection", async () => {
		const editor = createEditor();

		editor.apply([
			{
				type: "insert-block",
				blockId: "t6",
				blockType: "table",
				props: {},
				position: "last",
			},
		]);

		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);

		await act(async () => {
			root.render(
				<Pen.Editor.Root editor={editor}>
					<Pen.Editor.Content />
				</Pen.Editor.Root>,
			);
		});

		const firstCell = container.querySelector(
			`[data-block-id="t6"] [data-pen-table-cell][data-cell-row="0"][data-cell-col="0"]`,
		) as HTMLElement | null;
		expect(firstCell).not.toBeNull();

		await act(async () => {
			firstCell?.dispatchEvent(createMouseEvent("mousedown", { detail: 1 }));
			firstCell?.dispatchEvent(createMouseEvent("mouseup", { detail: 1 }));
			await flushAnimationFrames(2);
		});

		expect(editor.selection).toMatchObject({
			type: "cell",
			blockId: "t6",
			anchor: { row: 0, col: 0 },
			head: { row: 0, col: 0 },
		});

		await act(async () => {
			firstCell?.dispatchEvent(createMouseEvent("mousedown", { detail: 1 }));
			firstCell?.dispatchEvent(createMouseEvent("mouseup", { detail: 1 }));
			await flushAnimationFrames(2);
		});

		expect(editor.selection).toEqual({
			type: "block",
			blockIds: ["t6"],
		});

		await act(async () => {
			root.unmount();
		});
		container.remove();
		editor.destroy();
	});

	it("promotes backspace at the start of the next block to table block selection", async () => {
		const editor = createEditor();
		const paragraphId = crypto.randomUUID();

		editor.apply([
			{
				type: "insert-block",
				blockId: "t7",
				blockType: "table",
				props: {},
				position: "last",
			},
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

		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);

		await act(async () => {
			root.render(
				<Pen.Editor.Root editor={editor}>
					<Pen.Editor.Content />
				</Pen.Editor.Root>,
			);
		});

		const fieldEditor = getFieldEditor(editor);
		const paragraphInline = container.querySelector(
			`[data-block-id="${paragraphId}"] [data-pen-inline-content]`,
		) as HTMLElement | null;
		expect(paragraphInline).not.toBeNull();

		await act(async () => {
			fieldEditor.activateTextSelection(paragraphId, 0, 0);
			await flushAnimationFrames(2);
		});

		await act(async () => {
			paragraphInline?.dispatchEvent(createKeyEvent("Backspace"));
			await flushAnimationFrames(2);
		});

		expect(editor.selection).toEqual({
			type: "block",
			blockIds: ["t7"],
		});

		await act(async () => {
			root.unmount();
		});
		container.remove();
		editor.destroy();
	});

	it("promotes beforeinput backspace into a selected table that can be deleted", async () => {
		const editor = createEditor();
		const paragraphId = crypto.randomUUID();

		editor.apply([
			{
				type: "insert-block",
				blockId: "t7-beforeinput",
				blockType: "table",
				props: {},
				position: "last",
			},
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

		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);

		await act(async () => {
			root.render(
				<Pen.Editor.Root editor={editor}>
					<Pen.Editor.Content />
				</Pen.Editor.Root>,
			);
		});

		const fieldEditor = getFieldEditor(editor);
		const paragraphInline = container.querySelector(
			`[data-block-id="${paragraphId}"] [data-pen-inline-content]`,
		) as HTMLElement | null;
		const tableBlock = container.querySelector(
			`[data-block-id="t7-beforeinput"]`,
		) as HTMLElement | null;

		expect(paragraphInline).not.toBeNull();
		expect(tableBlock).not.toBeNull();

		await act(async () => {
			fieldEditor.activateTextSelection(paragraphId, 0, 0);
			await flushAnimationFrames(2);
		});

		await act(async () => {
			paragraphInline?.dispatchEvent(
				new InputEvent("beforeinput", {
					bubbles: true,
					cancelable: true,
					inputType: "deleteContentBackward",
				}),
			);
			await flushAnimationFrames(2);
		});

		expect(editor.selection).toEqual({
			type: "block",
			blockIds: ["t7-beforeinput"],
		});
		expect(tableBlock?.getAttribute("data-selected")).toBe("true");
		expect(
			tableBlock?.querySelector("[data-pen-table-frame]")?.getAttribute("data-selected"),
		).toBe("true");

		await act(async () => {
			document.dispatchEvent(createKeyEvent("Backspace"));
			await flushAnimationFrames(2);
		});

		expect(editor.getBlock("t7-beforeinput")).toBeNull();
		expect(editor.getBlock(paragraphId)).not.toBeNull();

		await act(async () => {
			root.unmount();
		});
		container.remove();
		editor.destroy();
	});

	it("maps cmd+a from a selected table directly to full-document selection in flow documents", async () => {
		const editor = createEditor({
			documentProfile: "flow",
		});
		const paragraphId = crypto.randomUUID();

		editor.apply([
			{
				type: "insert-block",
				blockId: "t8",
				blockType: "table",
				props: {},
				position: "last",
			},
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

		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);

		await act(async () => {
			root.render(
				<Pen.Editor.Root editor={editor}>
					<Pen.Editor.Content />
				</Pen.Editor.Root>,
			);
		});

		const tableBlock = container.querySelector(
			`[data-block-id="t8"]`,
		) as HTMLElement | null;
		expect(tableBlock).not.toBeNull();

		await act(async () => {
			editor.selectBlock("t8");
			tableBlock?.focus();
		});

		await act(async () => {
			document.dispatchEvent(createSelectAllEvent());
			await flushAnimationFrames(2);
		});

		expect(editor.selection).toMatchObject({
			type: "text",
			isMultiBlock: true,
		});
		expect(
			editor.selection?.type === "text" ? editor.selection.blockRange : [],
		).toEqual(expect.arrayContaining(["t8", paragraphId]));
		expect(
			[
				JSON.stringify(editor.selection?.type === "text" ? editor.selection.anchor : null),
				JSON.stringify(editor.selection?.type === "text" ? editor.selection.focus : null),
			],
		).toContain(JSON.stringify({ blockId: paragraphId, offset: 5 }));

		await act(async () => {
			root.unmount();
		});
		container.remove();
		editor.destroy();
	});

	it("keeps block-first cmd+a copy scoped to the selected table when block-first interaction is enabled", async () => {
		const editor = createEditor();
		const paragraphId = crypto.randomUUID();
		const clipboardData = createClipboardData();

		editor.apply([
			{
				type: "insert-block",
				blockId: "t8-copy-structured",
				blockType: "table",
				props: {},
				position: "last",
			},
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

		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);

		await act(async () => {
			root.render(
				<Pen.Editor.Root editor={editor} interactionModel="block-first">
					<Pen.Editor.Content />
				</Pen.Editor.Root>,
			);
		});

		const tableBlock = container.querySelector(
			`[data-block-id="t8-copy-structured"]`,
		) as HTMLElement | null;
		expect(tableBlock).not.toBeNull();

		await act(async () => {
			editor.selectBlock("t8-copy-structured");
			tableBlock?.focus();
		});

		await act(async () => {
			document.dispatchEvent(createSelectAllEvent());
			await flushAnimationFrames(2);
		});

		expect(editor.selection).toEqual({
			type: "block",
			blockIds: ["t8-copy-structured"],
		});

		handleCopy(editor, { clipboardData } as ClipboardEvent);

		const penBlocks = JSON.parse(
			clipboardData.getData("application/x-pen-blocks"),
		) as Array<{ type: string }>;

		expect(penBlocks.map((block) => block.type)).toEqual(["table"]);
		expect(clipboardData.getData("text/plain")).not.toContain("After");

		await act(async () => {
			root.unmount();
		});
		container.remove();
		editor.destroy();
	});

	it("promotes cmd+a copy from a selected table to the full document in flow documents", async () => {
		const editor = createEditor({
			documentProfile: "flow",
		});
		const paragraphId = crypto.randomUUID();
		const clipboardData = createClipboardData();

		editor.apply([
			{
				type: "insert-block",
				blockId: "t8-copy-flow",
				blockType: "table",
				props: {},
				position: "last",
			},
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

		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);

		await act(async () => {
			root.render(
				<Pen.Editor.Root editor={editor}>
					<Pen.Editor.Content />
				</Pen.Editor.Root>,
			);
		});

		const tableBlock = container.querySelector(
			`[data-block-id="t8-copy-flow"]`,
		) as HTMLElement | null;
		expect(tableBlock).not.toBeNull();

		await act(async () => {
			editor.selectBlock("t8-copy-flow");
			tableBlock?.focus();
		});

		await act(async () => {
			document.dispatchEvent(createSelectAllEvent());
			await flushAnimationFrames(2);
		});

		expect(editor.selection).toMatchObject({
			type: "text",
			isMultiBlock: true,
		});

		handleCopy(editor, { clipboardData } as ClipboardEvent);

		const penBlocks = JSON.parse(
			clipboardData.getData("application/x-pen-blocks"),
		) as Array<{ type: string }>;

		expect(penBlocks.map((block) => block.type)).toEqual([
			"paragraph",
			"table",
			"paragraph",
		]);
		expect(clipboardData.getData("text/plain")).toContain("After");

		await act(async () => {
			root.unmount();
		});
		container.remove();
		editor.destroy();
	});

	it("pressing enter on a block-selected table inserts a paragraph after it", async () => {
		const editor = createEditor();

		editor.apply([
			{
				type: "insert-block",
				blockId: "t-enter",
				blockType: "table",
				props: {},
				position: "last",
			},
		]);

		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);

		await act(async () => {
			root.render(
				<Pen.Editor.Root editor={editor}>
					<Pen.Editor.Content />
				</Pen.Editor.Root>,
			);
		});

		const tableBlock = container.querySelector(
			`[data-block-id="t-enter"]`,
		) as HTMLElement | null;
		expect(tableBlock).not.toBeNull();

		await act(async () => {
			editor.selectBlock("t-enter");
			tableBlock?.focus();
			document.dispatchEvent(createKeyEvent("Enter"));
			await flushAnimationFrames(2);
		});

		const paragraphAfterTable = editor.lastBlock();
		expect(paragraphAfterTable?.type).toBe("paragraph");
		expect(paragraphAfterTable?.id).not.toBe("t-enter");

		await act(async () => {
			root.unmount();
		});
		container.remove();
		editor.destroy();
	});

	it("keeps the first cmd+a cell-local before promoting to the document in flow documents", async () => {
		const editor = createEditor({
			documentProfile: "flow",
		});
		const paragraphId = crypto.randomUUID();

		editor.apply([
			{
				type: "insert-block",
				blockId: "t8-cell",
				blockType: "table",
				props: {},
				position: "last",
			},
			{
				type: "insert-table-cell-text",
				blockId: "t8-cell",
				row: 0,
				col: 0,
				offset: 0,
				text: "Alpha",
			},
			{
				type: "insert-table-cell-text",
				blockId: "t8-cell",
				row: 0,
				col: 1,
				offset: 0,
				text: "Bravo",
			},
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

		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);

		await act(async () => {
			root.render(
				<Pen.Editor.Root editor={editor}>
					<Pen.Editor.Content />
				</Pen.Editor.Root>,
			);
		});

		const fieldEditor = getFieldEditor(editor);
		const secondCellSurface = container.querySelector(
			`[data-block-id="t8-cell"] [data-cell-row="0"][data-cell-col="1"] [data-pen-field-editor-surface]`,
		) as HTMLElement | null;
		expect(secondCellSurface).not.toBeNull();

		await act(async () => {
			editor.selectCell("t8-cell", 0, 1);
			fieldEditor.activateCellFromElement?.("t8-cell", 0, 1, secondCellSurface!);
			await flushAnimationFrames(2);
		});

		await act(async () => {
			document.dispatchEvent(createSelectAllEvent());
			await flushAnimationFrames(2);
		});

		expect(document.getSelection()?.toString()).toBe("Bravo");
		expect(editor.selection).toMatchObject({
			type: "cell",
			blockId: "t8-cell",
			anchor: { row: 0, col: 1 },
			head: { row: 0, col: 1 },
		});

		await act(async () => {
			document.dispatchEvent(createSelectAllEvent());
			await flushAnimationFrames(2);
		});

		expect(editor.selection).toMatchObject({
			type: "text",
			focus: { blockId: paragraphId, offset: 5 },
			isMultiBlock: true,
		});
		expect(
			editor.selection?.type === "text" ? editor.selection.blockRange : [],
		).toEqual(expect.arrayContaining(["t8-cell", paragraphId]));

		await act(async () => {
			root.unmount();
		});
		container.remove();
		editor.destroy();
	});

	it("creates a canonical cross-block selection when dragging from a table into text in flow documents", async () => {
		const editor = createEditor({
			documentProfile: "flow",
		});
		const paragraphId = crypto.randomUUID();

		editor.apply([
			{
				type: "insert-block",
				blockId: "t9",
				blockType: "table",
				props: {},
				position: "last",
			},
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

		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);

		await act(async () => {
			root.render(
				<Pen.Editor.Root editor={editor}>
					<Pen.Editor.Content />
				</Pen.Editor.Root>,
			);
		});

		const firstCell = container.querySelector(
			`[data-block-id="t9"] [data-pen-table-cell][data-cell-row="0"][data-cell-col="0"]`,
		) as HTMLElement | null;
		const paragraphInline = container.querySelector(
			`[data-block-id="${paragraphId}"] [data-pen-inline-content]`,
		) as HTMLElement | null;
		expect(firstCell).not.toBeNull();
		expect(paragraphInline).not.toBeNull();

		const docWithCaretRange = document as Document & {
			caretRangeFromPoint?: (x: number, y: number) => Range | null;
		};
		const originalCaretRangeFromPoint = docWithCaretRange.caretRangeFromPoint;
		docWithCaretRange.caretRangeFromPoint = () => {
			const range = document.createRange();
			range.setStart(paragraphInline!.firstChild ?? paragraphInline!, 2);
			range.setEnd(paragraphInline!.firstChild ?? paragraphInline!, 2);
			return range;
		};

		await act(async () => {
			firstCell?.dispatchEvent(
				createMouseEvent("mousedown", {
					detail: 1,
					clientX: 10,
					clientY: 10,
				}),
			);
			paragraphInline?.dispatchEvent(
				createMouseEvent("mouseup", {
					detail: 1,
					clientX: 60,
					clientY: 40,
				}),
			);
			await flushAnimationFrames(2);
		});

		expect(editor.selection).toMatchObject({
			type: "text",
			isMultiBlock: true,
			anchor: { blockId: "t9", offset: 0 },
			focus: { blockId: paragraphId, offset: 2 },
		});

		docWithCaretRange.caretRangeFromPoint = originalCaretRangeFromPoint;

		await act(async () => {
			root.unmount();
		});
		container.remove();
		editor.destroy();
	});

	it("falls back to block selection when dragging from a table into text in structured documents", async () => {
		const editor = createEditor();
		const paragraphId = crypto.randomUUID();

		editor.apply([
			{
				type: "insert-block",
				blockId: "t9-structured",
				blockType: "table",
				props: {},
				position: "last",
			},
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

		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);

		await act(async () => {
			root.render(
				<Pen.Editor.Root editor={editor}>
					<Pen.Editor.Content />
				</Pen.Editor.Root>,
			);
		});

		const tableCell = container.querySelector(
			`[data-block-id="t9-structured"] [data-pen-table-cell][data-cell-row="0"][data-cell-col="0"]`,
		) as HTMLElement | null;
		const paragraphInline = container.querySelector(
			`[data-block-id="${paragraphId}"] [data-pen-inline-content]`,
		) as HTMLElement | null;
		expect(tableCell).not.toBeNull();
		expect(paragraphInline).not.toBeNull();

		const docWithCaretRange = document as Document & {
			caretRangeFromPoint?: (x: number, y: number) => Range | null;
		};
		const originalCaretRangeFromPoint = docWithCaretRange.caretRangeFromPoint;
		docWithCaretRange.caretRangeFromPoint = () => {
			const range = document.createRange();
			range.setStart(paragraphInline!.firstChild ?? paragraphInline!, 2);
			range.setEnd(paragraphInline!.firstChild ?? paragraphInline!, 2);
			return range;
		};

		await act(async () => {
			tableCell?.dispatchEvent(
				createMouseEvent("mousedown", {
					detail: 1,
					clientX: 10,
					clientY: 10,
				}),
			);
			paragraphInline?.dispatchEvent(
				createMouseEvent("mouseup", {
					detail: 1,
					clientX: 60,
					clientY: 40,
				}),
			);
			await flushAnimationFrames(2);
		});

		expect(editor.selection).toEqual({
			type: "block",
			blockIds: ["t9-structured", paragraphId],
		});

		docWithCaretRange.caretRangeFromPoint = originalCaretRangeFromPoint;

		await act(async () => {
			root.unmount();
		});
		container.remove();
		editor.destroy();
	});

	it("creates a canonical cross-block selection when shift-clicking from a table into text in flow documents", async () => {
		const editor = createEditor({
			documentProfile: "flow",
		});
		const paragraphId = crypto.randomUUID();

		editor.apply([
			{
				type: "insert-block",
				blockId: "t10-shift-flow",
				blockType: "table",
				props: {},
				position: "last",
			},
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

		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);

		await act(async () => {
			root.render(
				<Pen.Editor.Root editor={editor}>
					<Pen.Editor.Content />
				</Pen.Editor.Root>,
			);
		});

		const tableBlock = container.querySelector(
			`[data-block-id="t10-shift-flow"]`,
		) as HTMLElement | null;
		const paragraphInline = container.querySelector(
			`[data-block-id="${paragraphId}"] [data-pen-inline-content]`,
		) as HTMLElement | null;
		expect(tableBlock).not.toBeNull();
		expect(paragraphInline).not.toBeNull();

		await act(async () => {
			editor.selectBlock("t10-shift-flow");
			tableBlock?.focus();
			paragraphInline?.dispatchEvent(
				createMouseEvent("click", {
					detail: 1,
					shiftKey: true,
				}),
			);
			await flushAnimationFrames(2);
		});

		expect(editor.selection).toMatchObject({
			type: "text",
			isMultiBlock: true,
			anchor: { blockId: "t10-shift-flow", offset: 0 },
			focus: { blockId: paragraphId, offset: 5 },
		});

		await act(async () => {
			root.unmount();
		});
		container.remove();
		editor.destroy();
	});

	it("falls back to block selection when shift-clicking from a table into text in structured documents", async () => {
		const editor = createEditor();
		const paragraphId = crypto.randomUUID();

		editor.apply([
			{
				type: "insert-block",
				blockId: "t10-shift-structured",
				blockType: "table",
				props: {},
				position: "last",
			},
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

		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);

		await act(async () => {
			root.render(
				<Pen.Editor.Root editor={editor}>
					<Pen.Editor.Content />
				</Pen.Editor.Root>,
			);
		});

		const tableBlock = container.querySelector(
			`[data-block-id="t10-shift-structured"]`,
		) as HTMLElement | null;
		const paragraphInline = container.querySelector(
			`[data-block-id="${paragraphId}"] [data-pen-inline-content]`,
		) as HTMLElement | null;
		expect(tableBlock).not.toBeNull();
		expect(paragraphInline).not.toBeNull();

		await act(async () => {
			editor.selectBlock("t10-shift-structured");
			tableBlock?.focus();
			paragraphInline?.dispatchEvent(
				createMouseEvent("click", {
					detail: 1,
					shiftKey: true,
				}),
			);
			await flushAnimationFrames(2);
		});

		expect(editor.selection).toEqual({
			type: "block",
			blockIds: ["t10-shift-structured", paragraphId],
		});

		await act(async () => {
			root.unmount();
		});
		container.remove();
		editor.destroy();
	});
});
