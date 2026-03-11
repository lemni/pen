// @vitest-environment jsdom

import React, { act } from "react";
import { describe, expect, it, vi } from "vitest";
import { createRoot } from "react-dom/client";
import { createEditor } from "@pen/core";
import type { DatabaseViewState, TableColumnSchema } from "@pen/core";
import { Pen, getAttachedFieldEditor, handleCopy } from "@pen/react";
import { DatabaseRenderer } from "../renderer";
import { ColumnMenu } from "../rendererPanels";
import { useDatabaseController } from "../useDatabaseController";

(
	globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

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

function createSelectAllEvent(): KeyboardEvent {
	return new KeyboardEvent("keydown", {
		key: "a",
		metaKey: true,
		bubbles: true,
		cancelable: true,
	});
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

async function flushAnimationFrames(count = 1): Promise<void> {
	for (let i = 0; i < count; i++) {
		await new Promise<void>((resolve) => {
			requestAnimationFrame(() => resolve());
		});
	}
}

async function renderDatabase(
	editor: ReturnType<typeof createEditor>,
	options?: {
		children?: React.ReactNode;
		interactionModel?: "content-first" | "block-first";
	},
) {
	const container = document.createElement("div");
	document.body.appendChild(container);
	const root = createRoot(container);

	await act(async () => {
		root.render(
			<Pen.Editor.Root
				editor={editor}
				interactionModel={options?.interactionModel}
				renderers={{ database: DatabaseRenderer }}
			>
				<Pen.Editor.Content />
				{options?.children}
			</Pen.Editor.Root>,
		);
	});

	return { container, root };
}

async function unmountDatabase(
	root: ReturnType<typeof createRoot>,
	container: HTMLDivElement,
	editor: ReturnType<typeof createEditor>,
) {
	await act(async () => {
		root.unmount();
	});
	container.remove();
	editor.destroy();
}

function createFlowEditorFromSeededDocument(
	seed: (editor: ReturnType<typeof createEditor>) => void,
): ReturnType<typeof createEditor> {
	const bootstrapEditor = createEditor({
		without: ["document-ops", "delta-stream", "undo"],
	});
	const document = bootstrapEditor.internals.adapter.createDocument();
	bootstrapEditor.destroy();

	const seedEditor = createEditor({
		document,
		without: ["document-ops", "delta-stream", "undo"],
	});
	seed(seedEditor);
	seedEditor.internals.adapter.setDocumentProfile?.(document, "flow");
	seedEditor.destroy();

	return createEditor({
		document,
		without: ["document-ops", "delta-stream", "undo"],
	});
}

function seedDatabase(
	editor: ReturnType<typeof createEditor>,
	blockId: string,
	columns: TableColumnSchema[],
	rows: Array<string[]>,
) {
	editor.apply([
		{
			type: "insert-block",
			blockId,
			blockType: "database",
			props: {},
			position: "last",
		},
	]);
	editor.apply([{
		type: "update-table-columns",
		blockId,
		columns,
	}]);
	rows.forEach((values, rowIndex) => {
		editor.apply([{
			type: "database-insert-row",
			blockId,
			index: rowIndex,
			rowId: `${blockId}-row-${rowIndex}`,
			values: Object.fromEntries(
				columns.map((column, colIndex) => [column.id, values[colIndex] ?? ""]),
			),
		}]);
	});
}

function updatePrimaryView(
	editor: ReturnType<typeof createEditor>,
	blockId: string,
	patch: Partial<Omit<DatabaseViewState, "id">>,
) {
	const block = editor.getBlock(blockId);
	editor.apply([{
		type: "database-update-view",
		blockId,
		viewId: block?.databasePrimaryViewId() ?? undefined,
		patch,
	}], { origin: "user" });
}

function getButtonByText(container: HTMLElement, text: string): HTMLButtonElement | null {
	const buttons = Array.from(container.querySelectorAll("button"));
	return (buttons.find((button) => button.textContent?.trim() === text) as HTMLButtonElement | undefined) ?? null;
}

describe("@pen/database renderer", () => {
	it("promotes a repeated click on the same database cell to block selection", async () => {
		const editor = createEditor({
			without: ["document-ops", "delta-stream", "undo"],
		});

		seedDatabase(
			editor,
			"db1",
			[{ id: "name", title: "Name", type: "text", width: 140 }],
			[["Alpha"]],
		);

		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);

		await act(async () => {
			root.render(
				<Pen.Editor.Root
					editor={editor}
					renderers={{ database: DatabaseRenderer }}
				>
					<Pen.Editor.Content />
				</Pen.Editor.Root>,
			);
		});

		const firstCell = container.querySelector(
			`[data-block-id="db1"] tbody [data-pen-table-cell][data-cell-row="0"][data-cell-col="0"]`,
		) as HTMLElement | null;
		expect(firstCell).not.toBeNull();

		await act(async () => {
			firstCell?.dispatchEvent(createMouseEvent("mousedown", { detail: 1 }));
			firstCell?.dispatchEvent(createMouseEvent("mouseup", { detail: 1 }));
			await flushAnimationFrames(2);
		});

		expect(editor.selection).toMatchObject({
			type: "cell",
			blockId: "db1",
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
			blockIds: ["db1"],
		});

		await act(async () => {
			root.unmount();
		});
		container.remove();
		editor.destroy();
	});

	it("keeps column widths stable when adding a new column", async () => {
		const editor = createEditor({
			without: ["document-ops", "delta-stream", "undo"],
		});

		editor.apply([
			{
				type: "insert-block",
				blockId: "db-widths",
				blockType: "database",
				props: {},
				position: "last",
			},
			{
				type: "database-insert-row",
				blockId: "db-widths",
				rowId: "row-1",
				values: {
					name: "Task",
				},
			},
		]);

		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);

		await act(async () => {
			root.render(
				<Pen.Editor.Root
					editor={editor}
					renderers={{ database: DatabaseRenderer }}
				>
					<Pen.Editor.Content />
				</Pen.Editor.Root>,
			);
		});

		const addColumnButton = container.querySelector(
			".pen-table-add-column-control",
		) as HTMLButtonElement | null;
		expect(addColumnButton).not.toBeNull();

		await act(async () => {
			addColumnButton?.dispatchEvent(createMouseEvent("click"));
			await flushAnimationFrames(2);
		});

		const block = editor.getBlock("db-widths");
		expect(block?.tableColumns()).toHaveLength(4);

		const headerCells = container.querySelectorAll(
			`[data-block-id="db-widths"] thead th[data-pen-table-cell]`,
		);
		expect(headerCells).toHaveLength(4);
		expect(headerCells[3]?.textContent).toContain("New column");

		const bodyCells = container.querySelectorAll(
			`[data-block-id="db-widths"] tbody tr[data-row="0"] td[data-pen-table-cell]`,
		);
		expect(bodyCells).toHaveLength(4);

		const table = container.querySelector(
			`[data-block-id="db-widths"] table[data-pen-table]`,
		) as HTMLTableElement | null;
		expect(table).not.toBeNull();
		expect(table?.style.tableLayout).toBe("fixed");
		expect(table?.style.width).toBe("max-content");

		const addRowButton = container.querySelector(
			`[data-block-id="db-widths"] .pen-table-add-row-control`,
		) as HTMLButtonElement | null;
		expect(addRowButton).not.toBeNull();

		await act(async () => {
			root.unmount();
		});
		container.remove();
		editor.destroy();
	});

	it("keeps local database chrome editable for hybrid provider-backed views", async () => {
		const editor = createEditor({
			without: ["document-ops", "delta-stream", "undo"],
		});
		const fetch = vi.fn().mockResolvedValue({
			rows: [{ id: "remote-1", crdtRowIndex: 0, cells: { name: "Remote row" } }],
			totalRows: 1,
			pageIndex: 0,
			pageSize: 50,
		});

		editor.internals.setSlot("database:data-provider", {
			fetch,
		});
		editor.apply([
			{
				type: "insert-block",
				blockId: "db-hybrid",
				blockType: "database",
				props: { dataSource: "hybrid" },
				position: "last",
			},
		]);

		const { container, root } = await renderDatabase(editor);
		await flushAnimationFrames(2);

		expect(fetch).toHaveBeenCalled();
		expect(container.querySelector(`[data-block-id="db-hybrid"] .pen-db-toolbar`)).not.toBeNull();
		expect(container.querySelector(`[data-block-id="db-hybrid"] .pen-table-add-column-control`)).not.toBeNull();
		expect(container.querySelector(`[data-block-id="db-hybrid"] .pen-table-add-row-control`)).toBeNull();
		expect(container.querySelector(`[data-block-id="db-hybrid"] .pen-db-add-view-btn`)).not.toBeNull();
		expect(container.textContent).toContain("Remote row");

		await unmountDatabase(root, container, editor);
	});

	it("does not move the grid selection while a widget trigger has focus", async () => {
		const editor = createEditor({
			without: ["document-ops", "delta-stream", "undo"],
		});

		seedDatabase(
			editor,
			"db-widget-nav",
			[
				{
					id: "status",
					title: "Status",
					type: "select",
					options: [
						{ id: "todo", value: "Todo" },
						{ id: "done", value: "Done" },
					],
				},
			],
			[["todo"], ["done"]],
		);
		editor.selectCell("db-widget-nav", 0, 0);

		const { container, root } = await renderDatabase(editor);
		await flushAnimationFrames(2);

		const trigger = container.querySelector(
			`[data-block-id="db-widget-nav"] .pen-db-select-trigger`,
		) as HTMLElement | null;
		expect(trigger).not.toBeNull();

		await act(async () => {
			trigger?.focus();
			trigger?.dispatchEvent(createMouseEvent("click"));
			await flushAnimationFrames(1);
		});

		expect(container.querySelector(`[data-block-id="db-widget-nav"] .pen-db-select-dropdown`)).not.toBeNull();

		await act(async () => {
			trigger?.dispatchEvent(createKeyEvent("ArrowDown"));
			await flushAnimationFrames(1);
		});

		expect(editor.selection).toMatchObject({
			type: "cell",
			blockId: "db-widget-nav",
			anchor: { row: 0, col: 0 },
			head: { row: 0, col: 0 },
		});

		await unmountDatabase(root, container, editor);
	});

	it("uses the block default column width for implicit and newly added columns", async () => {
		const editor = createEditor({
			without: ["document-ops", "delta-stream", "undo"],
		});

		editor.apply([
			{
				type: "insert-block",
				blockId: "db-custom-width",
				blockType: "database",
				props: { defaultColumnWidth: 220 },
				position: "last",
			},
			{
				type: "database-insert-row",
				blockId: "db-custom-width",
				rowId: "row-1",
				values: {
					name: "Task",
				},
			},
		]);

		const { container, root } = await renderDatabase(editor);

		const headerCellsBeforeInsert = container.querySelectorAll(
			`[data-block-id="db-custom-width"] thead th[data-pen-table-cell]`,
		);
		expect((headerCellsBeforeInsert[0] as HTMLTableCellElement).style.minWidth).toBe("220px");
		expect((headerCellsBeforeInsert[0] as HTMLTableCellElement).style.maxWidth).toBe("220px");

		const addColumnButton = container.querySelector(
			".pen-table-add-column-control",
		) as HTMLButtonElement | null;
		expect(addColumnButton).not.toBeNull();

		await act(async () => {
			addColumnButton?.dispatchEvent(createMouseEvent("click"));
			await flushAnimationFrames(2);
		});

		const headerCellsAfterInsert = container.querySelectorAll(
			`[data-block-id="db-custom-width"] thead th[data-pen-table-cell]`,
		);
		expect(headerCellsAfterInsert).toHaveLength(4);
		expect((headerCellsAfterInsert[3] as HTMLTableCellElement).style.minWidth).toBe("220px");
		expect((headerCellsAfterInsert[3] as HTMLTableCellElement).style.maxWidth).toBe("220px");

		await unmountDatabase(root, container, editor);
	});

	it("deletes selected rows when delete is pressed from a row checkbox", async () => {
		const editor = createEditor({
			without: ["document-ops", "delta-stream", "undo"],
		});
		editor.apply([
			{
				type: "insert-block",
				blockId: "db-delete-rows",
				blockType: "database",
				props: {},
				position: "last",
			},
			{
				type: "update-table-columns",
				blockId: "db-delete-rows",
				columns: [
					{ id: "name", title: "Name", type: "text" },
					{ id: "status", title: "Status", type: "checkbox" },
				],
			},
			{
				type: "database-insert-row",
				blockId: "db-delete-rows",
				rowId: "row-alpha",
				values: { name: "Alpha", status: "true" },
			},
			{
				type: "database-insert-row",
				blockId: "db-delete-rows",
				rowId: "row-beta",
				values: { name: "Beta", status: "false" },
			},
		]);

		const { container, root } = await renderDatabase(editor);
		const tableRows = Array.from(
			container.querySelectorAll(`[data-block-id="db-delete-rows"] tbody tr[data-row]`),
		) as HTMLTableRowElement[];
		const alphaRow = tableRows.find((row) => row.textContent?.includes("Alpha")) ?? null;
		const rowCheckbox = alphaRow?.querySelector(
			`input[type="checkbox"]`,
		) as HTMLInputElement | null;
		expect(alphaRow).not.toBeNull();
		expect(rowCheckbox).not.toBeNull();

		await act(async () => {
			rowCheckbox?.focus();
			rowCheckbox?.click();
			await flushAnimationFrames(2);
		});

		const liveAlphaRow = Array.from(
			container.querySelectorAll(`[data-block-id="db-delete-rows"] tbody tr[data-row]`),
		).find((row) => row.textContent?.includes("Alpha")) as HTMLTableRowElement | undefined;
		const liveRowCheckbox = liveAlphaRow?.querySelector(
			`input[type="checkbox"]`,
		) as HTMLInputElement | null;
		expect(liveRowCheckbox?.checked).toBe(true);
		const blockBeforeDelete = editor.getBlock("db-delete-rows");
		const rowCountBeforeDelete = blockBeforeDelete?.tableRowCount() ?? 0;
		expect(rowCountBeforeDelete).toBeGreaterThan(1);

		await act(async () => {
			liveRowCheckbox?.focus();
			await flushAnimationFrames(1);
		});
		expect(document.activeElement).toBe(liveRowCheckbox);

		await act(async () => {
			liveRowCheckbox?.dispatchEvent(createKeyEvent("Delete"));
			await flushAnimationFrames(2);
		});

		const block = editor.getBlock("db-delete-rows");
		expect(block?.tableRowCount()).toBe(rowCountBeforeDelete - 1);
		const renderedRowsAfterDelete = Array.from(
			container.querySelectorAll(`[data-block-id="db-delete-rows"] tbody tr[data-row]`),
		).map((row) => row.textContent ?? "");
		expect(renderedRowsAfterDelete.some((text) => text.includes("Alpha"))).toBe(false);
		expect(renderedRowsAfterDelete.some((text) => text.includes("Beta"))).toBe(true);

		await unmountDatabase(root, container, editor);
	});

	it("navigates visible sorted rows instead of storage order", async () => {
		const editor = createEditor({
			without: ["document-ops", "delta-stream", "undo"],
		});
		seedDatabase(
			editor,
			"db-nav-visible-rows",
			[
				{ id: "name", title: "Name", type: "text" },
				{ id: "score", title: "Score", type: "number" },
				{ id: "status", title: "Status", type: "text" },
			],
			[
				["Alpha", "2", "keep"],
				["Beta", "1", "skip"],
				["Gamma", "3", "keep"],
			],
		);
		updatePrimaryView(editor, "db-nav-visible-rows", {
			sort: [{ columnId: "score", direction: "desc" }],
		});

		const { container, root } = await renderDatabase(editor);
		const databaseBlock = container.querySelector(
			`[data-block-id="db-nav-visible-rows"]`,
		) as HTMLElement | null;
		const bodyCells = Array.from(
			container.querySelectorAll(
				`[data-block-id="db-nav-visible-rows"] tbody td[data-pen-table-cell]`,
			),
		) as HTMLTableCellElement[];
		const firstBodyCell = bodyCells[0] ?? null;
		expect(firstBodyCell?.textContent).toContain("Gamma");

		await act(async () => {
			firstBodyCell?.dispatchEvent(createMouseEvent("mousedown"));
			firstBodyCell?.dispatchEvent(createMouseEvent("mouseup"));
			databaseBlock?.focus();
			await flushAnimationFrames(2);
		});

		await act(async () => {
			document.dispatchEvent(createKeyEvent("ArrowDown"));
			await flushAnimationFrames(2);
		});

		expect(editor.selection).toMatchObject({
			type: "cell",
			blockId: "db-nav-visible-rows",
			head: { row: 1, col: 0 },
			rowIds: [
				"db-nav-visible-rows-row-2",
				"db-nav-visible-rows-row-0",
				"db-nav-visible-rows-row-1",
			],
		});

		await unmountDatabase(root, container, editor);
	});

	it("skips hidden columns and respects pinned column order when tabbing", async () => {
		const editor = createEditor({
			without: ["document-ops", "delta-stream", "undo"],
		});
		seedDatabase(
			editor,
			"db-nav-columns",
			[
				{ id: "name", title: "Name", type: "text" },
				{ id: "hidden", title: "Hidden", type: "text" },
				{ id: "pinned", title: "Pinned", type: "text", pinned: "left" },
			],
			[["Alpha", "secret", "Lead"]],
		);
		updatePrimaryView(editor, "db-nav-columns", {
			visibleColumnIds: ["name", "pinned"],
		});

		const { container, root } = await renderDatabase(editor);
		const databaseBlock = container.querySelector(
			`[data-block-id="db-nav-columns"]`,
		) as HTMLElement | null;
		const firstRowCells = Array.from(
			container.querySelectorAll(
				`[data-block-id="db-nav-columns"] tbody tr[data-row] td[data-pen-table-cell]`,
			),
		) as HTMLTableCellElement[];
		const firstVisibleCell = firstRowCells[0] ?? null;
		expect(firstVisibleCell?.textContent).toContain("Lead");

		await act(async () => {
			firstVisibleCell?.dispatchEvent(createMouseEvent("mousedown"));
			firstVisibleCell?.dispatchEvent(createMouseEvent("mouseup"));
			databaseBlock?.focus();
			await flushAnimationFrames(2);
		});

		await act(async () => {
			document.dispatchEvent(createKeyEvent("Tab"));
			await flushAnimationFrames(2);
		});

		expect(editor.selection).toMatchObject({
			type: "cell",
			blockId: "db-nav-columns",
			head: { row: 0, col: 1 },
			columnIds: ["pinned", "name"],
		});

		await unmountDatabase(root, container, editor);
	});

	it("moves through pinned and grouped rows in rendered order", async () => {
		const editor = createEditor({
			without: ["document-ops", "delta-stream", "undo"],
		});
		seedDatabase(
			editor,
			"db-nav-grouped",
			[
				{ id: "name", title: "Name", type: "text" },
				{ id: "status", title: "Status", type: "text" },
			],
			[
				["Pinned", "todo"],
				["Alpha", "done"],
				["Beta", "todo"],
			],
		);
		updatePrimaryView(editor, "db-nav-grouped", {
			groupBy: "status",
			rowPinning: {
				top: ["db-nav-grouped-row-0"],
				bottom: [],
			},
		});

		const { container, root } = await renderDatabase(editor);
		const databaseBlock = container.querySelector(
			`[data-block-id="db-nav-grouped"]`,
		) as HTMLElement | null;
		const groupedCells = Array.from(
			container.querySelectorAll(
				`[data-block-id="db-nav-grouped"] tbody td[data-pen-table-cell]`,
			),
		) as HTMLTableCellElement[];
		const firstGroupedCell = groupedCells[0] ?? null;
		expect(firstGroupedCell?.textContent).toContain("Pinned");

		await act(async () => {
			firstGroupedCell?.dispatchEvent(createMouseEvent("mousedown"));
			firstGroupedCell?.dispatchEvent(createMouseEvent("mouseup"));
			databaseBlock?.focus();
			await flushAnimationFrames(2);
		});

		await act(async () => {
			document.dispatchEvent(createKeyEvent("ArrowDown"));
			await flushAnimationFrames(2);
		});

		expect(editor.selection).toMatchObject({
			type: "cell",
			blockId: "db-nav-grouped",
			head: { row: 1, col: 0 },
			rowIds: [
				"db-nav-grouped-row-0",
				"db-nav-grouped-row-1",
				"db-nav-grouped-row-2",
			],
		});

		await unmountDatabase(root, container, editor);
	});

	it("re-normalizes cell selection to the current page", async () => {
		const editor = createEditor({
			without: ["document-ops", "delta-stream", "undo"],
		});
		seedDatabase(
			editor,
			"db-nav-page",
			[
				{ id: "name", title: "Name", type: "text" },
			],
			[
				["Alpha"],
				["Beta"],
			],
		);
		updatePrimaryView(editor, "db-nav-page", {
			pageSize: 1,
			pageIndex: 1,
		});

		const { container, root } = await renderDatabase(editor);
		const previousPageButton = Array.from(
			container.querySelectorAll(
				`[data-block-id="db-nav-page"] .pen-db-pagination button`,
			),
		)[0] as HTMLButtonElement | undefined;
		const pageCells = Array.from(
			container.querySelectorAll(
				`[data-block-id="db-nav-page"] tbody td[data-pen-table-cell]`,
			),
		) as HTMLTableCellElement[];
		const secondPageCell = pageCells[0] ?? null;
		expect(secondPageCell?.textContent).toContain("Beta");

		await act(async () => {
			secondPageCell?.dispatchEvent(createMouseEvent("mousedown"));
			secondPageCell?.dispatchEvent(createMouseEvent("mouseup"));
			await flushAnimationFrames(2);
		});
		await act(async () => {
			previousPageButton?.dispatchEvent(createMouseEvent("click"));
			await flushAnimationFrames(2);
		});

		expect(editor.selection).toMatchObject({
			type: "cell",
			blockId: "db-nav-page",
			head: { row: 0, col: 0 },
			rowIds: ["db-nav-page-row-0"],
		});

		await unmountDatabase(root, container, editor);
	});

	it("keeps cmd+a block-scoped for selected databases in flow documents", async () => {
		const paragraphId = crypto.randomUUID();
		const editor = createFlowEditorFromSeededDocument((seedEditor) => {
			seedEditor.apply([
				{
					type: "insert-block",
					blockId: "db2",
					blockType: "database",
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
		});

		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);

		await act(async () => {
			root.render(
				<Pen.Editor.Root
					editor={editor}
					renderers={{ database: DatabaseRenderer }}
				>
					<Pen.Editor.Content />
				</Pen.Editor.Root>,
			);
		});

		const databaseBlock = container.querySelector(
			`[data-block-id="db2"]`,
		) as HTMLElement | null;
		expect(databaseBlock).not.toBeNull();

		await act(async () => {
			editor.selectBlock("db2");
			databaseBlock?.focus();
		});

		await act(async () => {
			document.dispatchEvent(createSelectAllEvent());
			await flushAnimationFrames(2);
		});

		expect(editor.selection).toEqual({
			type: "block",
			blockIds: ["db2"],
		});

		await act(async () => {
			root.unmount();
		});
		container.remove();
		editor.destroy();
	});

	it("falls back to block selection when dragging from a database into text in flow documents", async () => {
		const paragraphId = crypto.randomUUID();
		const editor = createFlowEditorFromSeededDocument((seedEditor) => {
			seedEditor.apply([
				{
					type: "insert-block",
					blockId: "db-drag-flow",
					blockType: "database",
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
		});

		const { container, root } = await renderDatabase(editor);
		const databaseBlock = container.querySelector(
			`[data-block-id="db-drag-flow"]`,
		) as HTMLElement | null;
		const paragraphInline = container.querySelector(
			`[data-block-id="${paragraphId}"] [data-pen-inline-content]`,
		) as HTMLElement | null;

		expect(databaseBlock).not.toBeNull();
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
			databaseBlock?.dispatchEvent(
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
			blockIds: ["db-drag-flow", paragraphId],
		});

		docWithCaretRange.caretRangeFromPoint = originalCaretRangeFromPoint;

		await unmountDatabase(root, container, editor);
	});

	it("falls back to block selection when dragging from a database into text in structured documents", async () => {
		const editor = createEditor({
			without: ["document-ops", "delta-stream", "undo"],
		});
		const paragraphId = crypto.randomUUID();

		editor.apply([
			{
				type: "insert-block",
				blockId: "db-drag-structured",
				blockType: "database",
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

		const { container, root } = await renderDatabase(editor);
		const databaseBlock = container.querySelector(
			`[data-block-id="db-drag-structured"]`,
		) as HTMLElement | null;
		const paragraphInline = container.querySelector(
			`[data-block-id="${paragraphId}"] [data-pen-inline-content]`,
		) as HTMLElement | null;

		expect(databaseBlock).not.toBeNull();
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
			databaseBlock?.dispatchEvent(
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
			blockIds: ["db-drag-structured", paragraphId],
		});

		docWithCaretRange.caretRangeFromPoint = originalCaretRangeFromPoint;

		await unmountDatabase(root, container, editor);
	});

	it("falls back to block selection when shift-clicking from a database into text in flow documents", async () => {
		const paragraphId = crypto.randomUUID();
		const editor = createFlowEditorFromSeededDocument((seedEditor) => {
			seedEditor.apply([
				{
					type: "insert-block",
					blockId: "db-shift-flow",
					blockType: "database",
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
		});

		const { container, root } = await renderDatabase(editor);
		const databaseBlock = container.querySelector(
			`[data-block-id="db-shift-flow"]`,
		) as HTMLElement | null;
		const paragraphInline = container.querySelector(
			`[data-block-id="${paragraphId}"] [data-pen-inline-content]`,
		) as HTMLElement | null;
		expect(databaseBlock).not.toBeNull();
		expect(paragraphInline).not.toBeNull();

		await act(async () => {
			editor.selectBlock("db-shift-flow");
			databaseBlock?.focus();
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
			blockIds: ["db-shift-flow", paragraphId],
		});

		await unmountDatabase(root, container, editor);
	});

	it("falls back to block selection when shift-clicking from a database into text in structured documents", async () => {
		const editor = createEditor({
			without: ["document-ops", "delta-stream", "undo"],
		});
		const paragraphId = crypto.randomUUID();

		editor.apply([
			{
				type: "insert-block",
				blockId: "db-shift-structured",
				blockType: "database",
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

		const { container, root } = await renderDatabase(editor);
		const databaseBlock = container.querySelector(
			`[data-block-id="db-shift-structured"]`,
		) as HTMLElement | null;
		const paragraphInline = container.querySelector(
			`[data-block-id="${paragraphId}"] [data-pen-inline-content]`,
		) as HTMLElement | null;
		expect(databaseBlock).not.toBeNull();
		expect(paragraphInline).not.toBeNull();

		await act(async () => {
			editor.selectBlock("db-shift-structured");
			databaseBlock?.focus();
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
			blockIds: ["db-shift-structured", paragraphId],
		});

		await unmountDatabase(root, container, editor);
	});

	it("keeps block-first cmd+a copy scoped to the selected database when block-first interaction is enabled", async () => {
		const editor = createEditor({
			without: ["document-ops", "delta-stream", "undo"],
		});
		const paragraphId = crypto.randomUUID();
		const clipboardData = createClipboardData();

		editor.apply([
			{
				type: "insert-block",
				blockId: "db-copy-structured",
				blockType: "database",
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

		const { container, root } = await renderDatabase(editor, {
			interactionModel: "block-first",
		});
		const databaseBlock = container.querySelector(
			`[data-block-id="db-copy-structured"]`,
		) as HTMLElement | null;
		expect(databaseBlock).not.toBeNull();

		await act(async () => {
			editor.selectBlock("db-copy-structured");
			databaseBlock?.focus();
		});

		await act(async () => {
			document.dispatchEvent(createSelectAllEvent());
			await flushAnimationFrames(2);
		});

		expect(editor.selection).toEqual({
			type: "block",
			blockIds: ["db-copy-structured"],
		});

		handleCopy(editor, { clipboardData } as ClipboardEvent);

		const penBlocks = JSON.parse(
			clipboardData.getData("application/x-pen-blocks"),
		) as Array<{ type: string }>;

		expect(penBlocks.map((block) => block.type)).toEqual(["database"]);
		expect(clipboardData.getData("text/plain")).not.toContain("After");

		await unmountDatabase(root, container, editor);
	});

	it("keeps cmd+a copy scoped to the selected database in flow documents", async () => {
		const paragraphId = crypto.randomUUID();
		const clipboardData = createClipboardData();
		const editor = createFlowEditorFromSeededDocument((seedEditor) => {
			seedEditor.apply([
				{
					type: "insert-block",
					blockId: "db-copy-flow",
					blockType: "database",
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
		});

		const { container, root } = await renderDatabase(editor);
		const databaseBlock = container.querySelector(
			`[data-block-id="db-copy-flow"]`,
		) as HTMLElement | null;
		expect(databaseBlock).not.toBeNull();

		await act(async () => {
			editor.selectBlock("db-copy-flow");
			databaseBlock?.focus();
		});

		await act(async () => {
			document.dispatchEvent(createSelectAllEvent());
			await flushAnimationFrames(2);
		});

		expect(editor.selection).toEqual({
			type: "block",
			blockIds: ["db-copy-flow"],
		});

		handleCopy(editor, { clipboardData } as ClipboardEvent);

		const penBlocks = JSON.parse(
			clipboardData.getData("application/x-pen-blocks"),
		) as Array<{ type: string }>;

		expect(penBlocks.map((block) => block.type)).toEqual(["database"]);
		expect(clipboardData.getData("text/plain")).not.toContain("After");

		await unmountDatabase(root, container, editor);
	});

	it("promotes beforeinput backspace into a selected database that can be deleted", async () => {
		const editor = createEditor({
			without: ["document-ops", "delta-stream", "undo"],
		});
		const paragraphId = crypto.randomUUID();

		editor.apply([
			{
				type: "insert-block",
				blockId: "db-backspace",
				blockType: "database",
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

		const { container, root } = await renderDatabase(editor);
		const fieldEditor = getAttachedFieldEditor(editor);
		const paragraphInline = container.querySelector(
			`[data-block-id="${paragraphId}"] [data-pen-inline-content]`,
		) as HTMLElement | null;
		const databaseBlock = container.querySelector(
			`[data-block-id="db-backspace"]`,
		) as HTMLElement | null;

		expect(fieldEditor).not.toBeNull();
		expect(paragraphInline).not.toBeNull();
		expect(databaseBlock).not.toBeNull();

		await act(async () => {
			fieldEditor?.activateTextSelection?.(paragraphId, 0, 0);
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
			blockIds: ["db-backspace"],
		});
		expect(databaseBlock?.getAttribute("data-selected")).toBe("true");
		expect(
			databaseBlock
				?.querySelector("[data-pen-table-frame]")
				?.getAttribute("data-selected"),
		).toBe("true");

		await act(async () => {
			document.dispatchEvent(createKeyEvent("Backspace"));
			await flushAnimationFrames(2);
		});

		expect(editor.getBlock("db-backspace")).toBeNull();
		expect(editor.getBlock(paragraphId)).not.toBeNull();

		await unmountDatabase(root, container, editor);
	});

	it("supports multi-sort via shift-click on column headers", async () => {
		const editor = createEditor({
			without: ["document-ops", "delta-stream", "undo"],
		});
		seedDatabase(
			editor,
			"db-sort",
			[
				{ id: "name", title: "Name", type: "text", width: 140 },
				{ id: "tags", title: "Priority", type: "number", width: 120 },
			],
			[["A", "2"], ["B", "1"]],
		);
		const { container, root } = await renderDatabase(editor);

		const nameHeader = container.querySelector(
			`[data-block-id="db-sort"] [data-cell-row="0"][data-cell-col="0"]`,
		) as HTMLElement | null;
		const priorityHeader = container.querySelector(
			`[data-block-id="db-sort"] [data-cell-row="0"][data-cell-col="1"]`,
		) as HTMLElement | null;
		expect(nameHeader).not.toBeNull();
		expect(priorityHeader).not.toBeNull();

		await act(async () => {
			nameHeader?.dispatchEvent(createMouseEvent("click"));
			await flushAnimationFrames(1);
		});
		expect(editor.getBlock("db-sort")?.databaseActiveView()?.sort).toEqual([
			{ columnId: "name", direction: "asc" },
		]);

		await act(async () => {
			priorityHeader?.dispatchEvent(createMouseEvent("click", { shiftKey: true }));
			await flushAnimationFrames(1);
		});
		expect(editor.getBlock("db-sort")?.databaseActiveView()?.sort).toEqual([
			{ columnId: "name", direction: "asc" },
			{ columnId: "tags", direction: "asc" },
		]);

		await act(async () => {
			nameHeader?.dispatchEvent(createMouseEvent("click", { shiftKey: true }));
			await flushAnimationFrames(1);
		});
		expect(editor.getBlock("db-sort")?.databaseActiveView()?.sort).toEqual([
			{ columnId: "name", direction: "desc" },
			{ columnId: "tags", direction: "asc" },
		]);

		await act(async () => {
			nameHeader?.dispatchEvent(createMouseEvent("click", { shiftKey: true }));
			await flushAnimationFrames(1);
		});
		expect(editor.getBlock("db-sort")?.databaseActiveView()?.sort).toEqual([
			{ columnId: "tags", direction: "asc" },
		]);

		await unmountDatabase(root, container, editor);
	});

	it("keeps column header controls out of editor selection gestures", async () => {
		const editor = createEditor({
			without: ["document-ops", "delta-stream", "undo"],
		});
		seedDatabase(
			editor,
			"db-header-controls",
			[
				{ id: "name", title: "Name", type: "text", width: 140 },
				{ id: "tags", title: "Priority", type: "number", width: 120 },
			],
			[["A", "2"], ["B", "1"]],
		);
		const { container, root } = await renderDatabase(editor);

		const nameHeader = container.querySelector(
			`[data-block-id="db-header-controls"] [data-cell-row="0"][data-cell-col="0"]`,
		) as HTMLElement | null;
		const menuButton = container.querySelector(
			`[data-block-id="db-header-controls"] .pen-db-col-menu-btn`,
		) as HTMLButtonElement | null;
		expect(nameHeader).not.toBeNull();
		expect(menuButton).not.toBeNull();
		expect(editor.selection).toBeNull();

		await act(async () => {
			nameHeader?.dispatchEvent(createMouseEvent("mousedown"));
			nameHeader?.dispatchEvent(createMouseEvent("mouseup"));
			nameHeader?.dispatchEvent(createMouseEvent("click"));
			await flushAnimationFrames(1);
		});

		expect(editor.getBlock("db-header-controls")?.databaseActiveView()?.sort).toEqual([
			{ columnId: "name", direction: "asc" },
		]);
		expect(editor.selection).toBeNull();

		await act(async () => {
			menuButton?.dispatchEvent(createMouseEvent("mousedown"));
			menuButton?.dispatchEvent(createMouseEvent("mouseup"));
			menuButton?.dispatchEvent(createMouseEvent("click"));
			await flushAnimationFrames(1);
		});

		const renameInput = container.querySelector(
			`[data-block-id="db-header-controls"] .pen-db-col-rename-input`,
		) as HTMLInputElement | null;
		expect(renameInput).not.toBeNull();

		await act(async () => {
			renameInput?.dispatchEvent(createMouseEvent("mousedown"));
			renameInput?.dispatchEvent(createMouseEvent("mouseup"));
			renameInput?.dispatchEvent(createMouseEvent("click"));
			await flushAnimationFrames(1);
		});

		expect(editor.selection).toBeNull();

		await unmountDatabase(root, container, editor);
	});

	it("applies sticky left and right pin styles to pinned columns", async () => {
		const editor = createEditor({
			without: ["document-ops", "delta-stream", "undo"],
		});
		seedDatabase(
			editor,
			"db-pins",
			[
				{ id: "name", title: "Name", type: "text", width: 120, pinned: "left" },
				{ id: "tags", title: "Status", type: "text", width: 120 },
				{ id: "status", title: "Due", type: "text", width: 140, pinned: "right" },
			],
			[["A", "Open", "Soon"]],
		);
		const { container, root } = await renderDatabase(editor);

		const leftHeader = container.querySelector(
			`[data-block-id="db-pins"] th[data-cell-col="0"]`,
		) as HTMLTableCellElement | null;
		const rightHeader = container.querySelector(
			`[data-block-id="db-pins"] th[data-cell-col="2"]`,
		) as HTMLTableCellElement | null;
		const leftCell = container.querySelector(
			`[data-block-id="db-pins"] td[data-cell-row="0"][data-cell-col="0"]`,
		) as HTMLTableCellElement | null;
		const rightCell = container.querySelector(
			`[data-block-id="db-pins"] td[data-cell-row="0"][data-cell-col="2"]`,
		) as HTMLTableCellElement | null;

		expect(leftHeader?.style.position).toBe("sticky");
		expect(leftHeader?.style.left).toBe("44px");
		expect(rightHeader?.style.position).toBe("sticky");
		expect(rightHeader?.style.right).toBe("0px");
		expect(leftCell?.style.left).toBe("44px");
		expect(rightCell?.style.right).toBe("0px");

		await unmountDatabase(root, container, editor);
	});

	it("shows facet-backed autocomplete options in the filter panel", async () => {
		const editor = createEditor({
			without: ["document-ops", "delta-stream", "undo"],
		});
		seedDatabase(
			editor,
			"db-filter",
			[
				{
					id: "status",
					title: "Status",
					type: "select",
					options: [
						{ id: "todo", value: "Todo" },
						{ id: "done", value: "Done" },
					],
				},
			],
			[["todo"], ["done"], ["todo"]],
		);
		const { container, root } = await renderDatabase(editor);

		const filterButton = getButtonByText(container, "Filter");
		expect(filterButton).not.toBeNull();

		await act(async () => {
			filterButton?.dispatchEvent(createMouseEvent("click"));
			await flushAnimationFrames(1);
		});

		const addFilterButton = container.querySelector(".pen-db-filter-add") as HTMLButtonElement | null;
		expect(addFilterButton).not.toBeNull();

		await act(async () => {
			addFilterButton?.dispatchEvent(createMouseEvent("click"));
			await flushAnimationFrames(1);
		});

		const datalist = container.querySelector('datalist[id="pen-db-filter-values-0"]');
		const todoOption = datalist?.querySelector('option[value="todo"]') as HTMLOptionElement | null;
		const doneOption = datalist?.querySelector('option[value="done"]') as HTMLOptionElement | null;
		expect(todoOption?.label).toBe("Todo (2)");
		expect(doneOption?.label).toBe("Done (1)");

		await unmountDatabase(root, container, editor);
	});

	it("manages the multi-sort stack from the sort panel", async () => {
		const editor = createEditor({
			without: ["document-ops", "delta-stream", "undo"],
		});
		seedDatabase(
			editor,
			"db-sort-panel",
			[
				{ id: "name", title: "Name", type: "text", width: 140 },
				{ id: "tags", title: "Priority", type: "number", width: 120 },
				{ id: "status", title: "Status", type: "text", width: 120 },
			],
			[["A", "2", "Open"], ["B", "1", "Done"]],
		);
		const { container, root } = await renderDatabase(editor);

		const sortButton = getButtonByText(container, "Sort");
		expect(sortButton).not.toBeNull();

		await act(async () => {
			sortButton?.dispatchEvent(createMouseEvent("click"));
			await flushAnimationFrames(1);
		});

		const addSortButton = container.querySelector(".pen-db-sort-add") as HTMLButtonElement | null;
		expect(addSortButton).not.toBeNull();

		await act(async () => {
			addSortButton?.dispatchEvent(createMouseEvent("click"));
			await flushAnimationFrames(1);
		});

		const refreshedAddSortButton = container.querySelector(".pen-db-sort-add") as HTMLButtonElement | null;
		expect(refreshedAddSortButton).not.toBeNull();

		await act(async () => {
			refreshedAddSortButton?.dispatchEvent(createMouseEvent("click"));
			await flushAnimationFrames(1);
		});

		const secondColumnSelect = container.querySelector('[data-sort-column="1"]') as HTMLSelectElement | null;
		expect(secondColumnSelect).not.toBeNull();

		await act(async () => {
			if (secondColumnSelect) {
				secondColumnSelect.value = "tags";
				secondColumnSelect.dispatchEvent(new Event("change", { bubbles: true }));
			}
			await flushAnimationFrames(1);
		});

		const refreshedSecondDirectionSelect = container.querySelector(
			'[data-sort-direction="1"]',
		) as HTMLSelectElement | null;
		expect(refreshedSecondDirectionSelect).not.toBeNull();

		await act(async () => {
			if (refreshedSecondDirectionSelect) {
				refreshedSecondDirectionSelect.value = "desc";
				refreshedSecondDirectionSelect.dispatchEvent(new Event("change", { bubbles: true }));
			}
			await flushAnimationFrames(1);
		});

		const moveUpButton = container.querySelector('[data-sort-move-up="1"]') as HTMLButtonElement | null;
		expect(moveUpButton).not.toBeNull();

		await act(async () => {
			moveUpButton?.dispatchEvent(createMouseEvent("click"));
			await flushAnimationFrames(1);
		});

		expect(editor.getBlock("db-sort-panel")?.databaseActiveView()?.sort).toEqual([
			{ columnId: "tags", direction: "desc" },
			{ columnId: "name", direction: "asc" },
		]);

		await unmountDatabase(root, container, editor);
	});

	it("supports nested filter groups from the filter panel", async () => {
		const editor = createEditor({
			without: ["document-ops", "delta-stream", "undo"],
		});
		seedDatabase(
			editor,
			"db-filter-groups",
			[
				{ id: "name", title: "Name", type: "text", width: 140 },
				{ id: "status", title: "Status", type: "text", width: 120 },
			],
			[["Alpha", "Open"], ["Beta", "Done"]],
		);
		const { container, root } = await renderDatabase(editor);

		const filterButton = getButtonByText(container, "Filter");
		expect(filterButton).not.toBeNull();

		await act(async () => {
			filterButton?.dispatchEvent(createMouseEvent("click"));
			await flushAnimationFrames(1);
		});

		const addGroupButton = container.querySelector('[data-filter-add-group="root"]') as HTMLButtonElement | null;
		expect(addGroupButton).not.toBeNull();

		await act(async () => {
			addGroupButton?.dispatchEvent(createMouseEvent("click"));
			await flushAnimationFrames(1);
		});

		const nestedValueInput = container.querySelector('[data-filter-value="0-0"]') as HTMLInputElement | null;
		expect(nestedValueInput).not.toBeNull();

		await act(async () => {
			if (nestedValueInput) {
				const valueSetter = Object.getOwnPropertyDescriptor(
					window.HTMLInputElement.prototype,
					"value",
				)?.set;
				valueSetter?.call(nestedValueInput, "Alpha");
				nestedValueInput.dispatchEvent(new InputEvent("input", { bubbles: true, data: "Alpha" }));
			}
			await flushAnimationFrames(1);
		});

		expect(editor.getBlock("db-filter-groups")?.databaseActiveView()?.filter).toEqual({
			operator: "and",
			conditions: [
				{
					operator: "and",
					conditions: [
						{ columnId: "name", operator: "contains", value: "Alpha" },
					],
				},
			],
		});

		const renderedRows = Array.from(
			container.querySelectorAll(`[data-block-id="db-filter-groups"] tbody tr[data-row]`),
		) as HTMLTableRowElement[];
		expect(renderedRows).toHaveLength(1);
		expect(renderedRows[0]?.textContent).toContain("Alpha");

		await unmountDatabase(root, container, editor);
	});

	it("filters dates with relative presets from the filter panel", async () => {
		const now = new Date();
		const recentDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 2, 9, 0, 0);
		const oldDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 12, 9, 0, 0);
		const editor = createEditor({
			without: ["document-ops", "delta-stream", "undo"],
		});
		editor.apply([
			{
				type: "insert-block",
				blockId: "db-date-filter",
				blockType: "database",
				props: {},
				position: "last",
			},
			{
				type: "database-update-column",
				blockId: "db-date-filter",
				columnId: "tags",
				patch: {
					title: "Due",
				},
			},
			{
				type: "database-convert-column",
				blockId: "db-date-filter",
				columnId: "tags",
				toType: "date",
			},
			{
				type: "database-insert-row",
				blockId: "db-date-filter",
				rowId: "row-a",
				values: { name: "Alpha", tags: recentDate.toISOString() },
			},
			{
				type: "database-insert-row",
				blockId: "db-date-filter",
				rowId: "row-b",
				values: { name: "Beta", tags: oldDate.toISOString() },
			},
		]);
		const { container, root } = await renderDatabase(editor);

		const filterButton = getButtonByText(container, "Filter");
		expect(filterButton).not.toBeNull();

		await act(async () => {
			filterButton?.dispatchEvent(createMouseEvent("click"));
			await flushAnimationFrames(1);
		});

		const addFilterButton = container.querySelector(".pen-db-filter-add") as HTMLButtonElement | null;
		expect(addFilterButton).not.toBeNull();

		await act(async () => {
			addFilterButton?.dispatchEvent(createMouseEvent("click"));
			await flushAnimationFrames(1);
		});

		const columnSelect = container.querySelector('[data-filter-column="0"]') as HTMLSelectElement | null;
		expect(columnSelect).not.toBeNull();

		await act(async () => {
			if (columnSelect) {
				columnSelect.value = "tags";
				columnSelect.dispatchEvent(new Event("change", { bubbles: true }));
			}
			await flushAnimationFrames(2);
		});

		const operatorSelect = container.querySelector('[data-filter-operator="0"]') as HTMLSelectElement | null;
		expect(operatorSelect).not.toBeNull();
		expect(
			Array.from(operatorSelect?.options ?? []).some(
				(option) => option.value === "is_relative",
			),
		).toBe(true);

		updatePrimaryView(editor, "db-date-filter", {
			filter: {
				operator: "and",
				conditions: [{
					columnId: "tags",
					operator: "is_relative",
					value: "last_7_days",
				}],
			},
		});

		await act(async () => {
			await flushAnimationFrames(2);
		});

		expect(editor.getBlock("db-date-filter")?.databaseActiveView()?.filter).toEqual({
			operator: "and",
			conditions: [{
				columnId: "tags",
				operator: "is_relative",
				value: "last_7_days",
			}],
		});

		await unmountDatabase(root, container, editor);
	});

	it("pins selected rows to the top and bottom through the toolbar", async () => {
		const editor = createEditor({
			without: ["document-ops", "delta-stream", "undo"],
		});
		editor.apply([
			{
				type: "insert-block",
				blockId: "db-row-pins",
				blockType: "database",
				props: {},
				position: "last",
			},
			{
				type: "database-insert-row",
				blockId: "db-row-pins",
				rowId: "row-a",
				values: { name: "Alpha" },
			},
			{
				type: "database-insert-row",
				blockId: "db-row-pins",
				rowId: "row-b",
				values: { name: "Beta" },
			},
			{
				type: "database-insert-row",
				blockId: "db-row-pins",
				rowId: "row-c",
				values: { name: "Gamma" },
			},
		]);
		const { container, root } = await renderDatabase(editor);

		const rowCheckboxes = Array.from(
			container.querySelectorAll(
				`[data-block-id="db-row-pins"] tbody tr[data-row] .pen-db-row-select-cell input`,
			),
		) as HTMLInputElement[];
		expect(rowCheckboxes).toHaveLength(3);

		await act(async () => {
			rowCheckboxes[1]?.click();
			await flushAnimationFrames(1);
		});

		const pinTopButton = getButtonByText(container, "Pin top");
		expect(pinTopButton).not.toBeNull();

		await act(async () => {
			pinTopButton?.dispatchEvent(createMouseEvent("click"));
			await flushAnimationFrames(1);
		});

		expect(editor.getBlock("db-row-pins")?.databaseActiveView()?.rowPinning).toEqual({
			top: ["row-b"],
		});

		let renderedRows = Array.from(
			container.querySelectorAll(`[data-block-id="db-row-pins"] tbody tr[data-row]`),
		) as HTMLTableRowElement[];
		expect(renderedRows[0]?.getAttribute("data-row-section")).toBe("top");
		expect(renderedRows[0]?.textContent).toContain("Beta");

		const refreshedRowCheckboxes = Array.from(
			container.querySelectorAll(
				`[data-block-id="db-row-pins"] tbody tr[data-row] .pen-db-row-select-cell input`,
			),
		) as HTMLInputElement[];

		await act(async () => {
			refreshedRowCheckboxes[0]?.click();
			await flushAnimationFrames(1);
		});

		await act(async () => {
			refreshedRowCheckboxes[2]?.click();
			await flushAnimationFrames(1);
		});

		const pinBottomButton = getButtonByText(container, "Pin bottom");
		expect(pinBottomButton).not.toBeNull();

		await act(async () => {
			pinBottomButton?.dispatchEvent(createMouseEvent("click"));
			await flushAnimationFrames(1);
		});

		expect(editor.getBlock("db-row-pins")?.databaseActiveView()?.rowPinning).toEqual({
			top: ["row-b"],
			bottom: ["row-c"],
		});

		renderedRows = Array.from(
			container.querySelectorAll(`[data-block-id="db-row-pins"] tbody tr[data-row]`),
		) as HTMLTableRowElement[];
		expect(renderedRows.at(-1)?.getAttribute("data-row-section")).toBe("bottom");
		expect(renderedRows.at(-1)?.textContent).toContain("Gamma");

		await unmountDatabase(root, container, editor);
	});

	it("refreshes the open column menu after adding a select option", async () => {
		const editor = createEditor({
			without: ["document-ops", "delta-stream", "undo"],
		});

		function OptionMutationHarness() {
			const db = useDatabaseController({ blockId: "db-option-menu" });
			const statusColumn = db.columnSchema.find((entry) => entry.id === "status");
			return (
				<>
					<button onClick={() => db.addOption("status", "Blocked", "gray")}>
						Add test option
					</button>
					<ColumnMenu
						column={statusColumn}
						onClose={() => { }}
						onRename={(nextTitle) => db.renameColumn("status", nextTitle)}
						onChangeType={(nextType) => db.changeColumnType("status", nextType)}
						onDelete={() => db.deleteColumn("status")}
						onToggleVisibility={() => db.toggleColumnVisibility("status")}
						onChangePin={(nextPinned) => db.changeColumnPin("status", nextPinned)}
						onAddOption={(value, color) => db.addOption("status", value, color)}
						onRenameOption={(optionId, value) => db.renameOption("status", optionId, value)}
						onRecolorOption={(optionId, color) => db.recolorOption("status", optionId, color)}
						onRemoveOption={(optionId) => db.removeOption("status", optionId)}
						onMoveOption={(optionId, direction) => db.moveOption("status", optionId, direction)}
					/>
				</>
			);
		}

		seedDatabase(
			editor,
			"db-option-menu",
			[
				{ id: "name", title: "Name", type: "text", width: 140 },
				{ id: "status", title: "Status", type: "select", width: 140, options: [] },
			],
			[["Alpha", ""]],
		);
		const { container, root } = await renderDatabase(
			editor,
			{ children: <OptionMutationHarness /> },
		);

		let optionRows = Array.from(
			container.querySelectorAll(`.pen-db-col-option-row input`),
		) as HTMLInputElement[];
		expect(optionRows).toHaveLength(0);

		const addOptionButton = getButtonByText(container, "Add test option");
		expect(addOptionButton).not.toBeNull();

		await act(async () => {
			addOptionButton?.dispatchEvent(createMouseEvent("click"));
			await flushAnimationFrames(2);
		});

		expect(editor.getBlock("db-option-menu")?.tableColumns()[1]?.options).toEqual([
			expect.objectContaining({
				value: "Blocked",
				color: "gray",
			}),
		]);

		optionRows = Array.from(
			container.querySelectorAll(`.pen-db-col-option-row input`),
		) as HTMLInputElement[];
		expect(optionRows).toHaveLength(1);
		expect(optionRows[0]?.value).toBe("Blocked");

		await unmountDatabase(root, container, editor);
	});

	it("renders grouped sections from the group panel", async () => {
		const editor = createEditor({
			without: ["document-ops", "delta-stream", "undo"],
		});
		editor.apply([
			{
				type: "insert-block",
				blockId: "db-group",
				blockType: "database",
				props: {},
				position: "last",
			},
			{
				type: "database-update-column",
				blockId: "db-group",
				columnId: "tags",
				patch: {
					title: "Status",
					options: [
						{ id: "todo", value: "Todo" },
						{ id: "done", value: "Done" },
					],
				},
			},
			{
				type: "database-insert-row",
				blockId: "db-group",
				rowId: "row-a",
				values: { name: "Alpha", tags: "todo" },
			},
			{
				type: "database-insert-row",
				blockId: "db-group",
				rowId: "row-b",
				values: { name: "Beta", tags: "done" },
			},
			{
				type: "database-insert-row",
				blockId: "db-group",
				rowId: "row-c",
				values: { name: "Gamma", tags: "todo" },
			},
		]);
		const { container, root } = await renderDatabase(editor);

		const groupButton = getButtonByText(container, "Group");
		expect(groupButton).not.toBeNull();

		await act(async () => {
			groupButton?.dispatchEvent(createMouseEvent("click"));
			await flushAnimationFrames(1);
		});

		const groupSelect = container.querySelector(".pen-db-col-vis-panel select") as HTMLSelectElement | null;
		expect(groupSelect).not.toBeNull();

		await act(async () => {
			if (groupSelect) {
				groupSelect.value = "tags";
				groupSelect.dispatchEvent(new Event("change", { bubbles: true }));
			}
			await flushAnimationFrames(1);
		});

		expect(editor.getBlock("db-group")?.databaseActiveView()?.groupBy).toBe("tags");

		const groupRows = Array.from(
			container.querySelectorAll(`[data-block-id="db-group"] .pen-db-group-row`),
		) as HTMLTableRowElement[];
		expect(groupRows).toHaveLength(2);
		expect(groupRows[0]?.textContent).toContain("Todo (2)");
		expect(groupRows[1]?.textContent).toContain("Done (1)");

		await unmountDatabase(root, container, editor);
	});

	it("adds switches and removes database views from the title bar", async () => {
		const editor = createEditor({
			without: ["document-ops", "delta-stream", "undo"],
		});
		seedDatabase(
			editor,
			"db-views",
			[
				{ id: "name", title: "Name", type: "text", width: 140 },
				{ id: "status", title: "Status", type: "text", width: 120 },
			],
			[["Alpha", "Open"], ["Beta", "Done"]],
		);
		const primaryViewId = editor.getBlock("db-views")?.databasePrimaryViewId() ?? "";
		const { container, root } = await renderDatabase(editor);

		const addViewButton = getButtonByText(container, "+ View");
		expect(addViewButton).not.toBeNull();

		await act(async () => {
			addViewButton?.dispatchEvent(createMouseEvent("click"));
			await flushAnimationFrames(1);
		});

		const addListViewButton = getButtonByText(container, "New list view");
		const addBoardViewButton = getButtonByText(container, "New board view");
		const addCalendarViewButton = getButtonByText(container, "New calendar view");
		const addGalleryViewButton = getButtonByText(container, "New gallery view");
		expect(addListViewButton).not.toBeNull();
		expect(addBoardViewButton).not.toBeNull();
		expect(addCalendarViewButton).not.toBeNull();
		expect(addGalleryViewButton).not.toBeNull();

		await act(async () => {
			addListViewButton?.dispatchEvent(createMouseEvent("click"));
			await flushAnimationFrames(1);
		});

		const blockAfterAdd = editor.getBlock("db-views");
		const listView = blockAfterAdd?.databaseViews().find((view) => view.type === "list");
		expect(listView).toBeDefined();
		expect(blockAfterAdd?.databaseViews()).toHaveLength(2);
		expect(blockAfterAdd?.databaseActiveView()?.id).toBe(listView?.id);
		expect(container.querySelector(`[data-block-id="db-views"] .pen-db-list-view`)).not.toBeNull();

		const tableTab = container.querySelector(
			`[data-block-id="db-views"] [data-view-id="${primaryViewId}"]`,
		) as HTMLButtonElement | null;
		expect(tableTab).not.toBeNull();

		await act(async () => {
			tableTab?.dispatchEvent(createMouseEvent("click"));
			await flushAnimationFrames(2);
		});

		expect(editor.getBlock("db-views")?.databaseActiveView()?.id).toBe(primaryViewId);
		expect(container.querySelector(`[data-block-id="db-views"] table[data-pen-table]`)).not.toBeNull();

		const removeListViewButton = container.querySelector(
			`[data-block-id="db-views"] [data-remove-view-id="${listView?.id ?? ""}"]`,
		) as HTMLButtonElement | null;
		expect(removeListViewButton).not.toBeNull();

		await act(async () => {
			removeListViewButton?.dispatchEvent(createMouseEvent("click"));
			await flushAnimationFrames(1);
		});

		expect(editor.getBlock("db-views")?.databaseViews()).toHaveLength(1);
		expect(editor.getBlock("db-views")?.databasePrimaryViewId()).toBe(primaryViewId);

		await unmountDatabase(root, container, editor);
	});

	it("renders list views as stacked row cards", async () => {
		const editor = createEditor({
			without: ["document-ops", "delta-stream", "undo"],
		});
		editor.apply([
			{
				type: "insert-block",
				blockId: "db-list",
				blockType: "database",
				props: {},
				position: "last",
			},
			{
				type: "database-add-view",
				blockId: "db-list",
				view: {
					id: "view-list",
					title: "List view",
					type: "list",
					visibleColumnIds: ["name", "tags", "status"],
					columnOrder: ["name", "tags", "status"],
					sort: [],
					filter: null,
					groupBy: null,
					pageIndex: 0,
					pageSize: 50,
				},
			},
			{
				type: "database-set-active-view",
				blockId: "db-list",
				viewId: "view-list",
			},
			{
				type: "database-insert-row",
				blockId: "db-list",
				rowId: "row-a",
				values: { name: "Alpha", tags: "Todo", status: "true" },
			},
		]);
		const { container, root } = await renderDatabase(editor);

		const listView = container.querySelector(
			`[data-block-id="db-list"] .pen-db-list-view`,
		) as HTMLDivElement | null;
		expect(listView).not.toBeNull();
		expect(container.querySelector(`[data-block-id="db-list"] table[data-pen-table]`)).toBeNull();

		const listRow = container.querySelector(
			`[data-block-id="db-list"] .pen-db-list-row[data-row="0"]`,
		) as HTMLDivElement | null;
		expect(listRow).not.toBeNull();
		expect(listRow?.textContent).toContain("Name");
		expect(listRow?.textContent).toContain("Tags");
		expect(listRow?.textContent).toContain("Done");
		expect(listRow?.textContent).toContain("Alpha");

		await unmountDatabase(root, container, editor);
	});

	it("renders board views as grouped kanban lanes", async () => {
		const editor = createEditor({
			without: ["document-ops", "delta-stream", "undo"],
		});
		editor.apply([
			{
				type: "insert-block",
				blockId: "db-board",
				blockType: "database",
				props: {},
				position: "last",
			},
			{
				type: "database-update-column",
				blockId: "db-board",
				columnId: "tags",
				patch: {
					title: "Status",
					options: [
						{ id: "todo", value: "Todo" },
						{ id: "done", value: "Done" },
					],
				},
			},
			{
				type: "database-add-view",
				blockId: "db-board",
				view: {
					id: "view-board",
					title: "Board view",
					type: "board",
					visibleColumnIds: ["name", "tags", "status"],
					columnOrder: ["name", "tags", "status"],
					sort: [],
					filter: null,
					groupBy: "tags",
					pageIndex: 0,
					pageSize: 50,
				},
			},
			{
				type: "database-set-active-view",
				blockId: "db-board",
				viewId: "view-board",
			},
			{
				type: "database-insert-row",
				blockId: "db-board",
				rowId: "row-a",
				values: { name: "Alpha", tags: "todo", status: "true" },
			},
			{
				type: "database-insert-row",
				blockId: "db-board",
				rowId: "row-b",
				values: { name: "Beta", tags: "done", status: "false" },
			},
		]);
		const { container, root } = await renderDatabase(editor);

		const boardView = container.querySelector(
			`[data-block-id="db-board"] .pen-db-board-view`,
		) as HTMLDivElement | null;
		expect(boardView).not.toBeNull();

		const laneHeaders = Array.from(
			container.querySelectorAll(`[data-block-id="db-board"] .pen-db-board-lane-header`),
		) as HTMLDivElement[];
		expect(laneHeaders).toHaveLength(2);
		expect(laneHeaders[0]?.textContent).toContain("Todo (1)");
		expect(laneHeaders[1]?.textContent).toContain("Done (1)");

		const boardCard = container.querySelector(
			`[data-block-id="db-board"] .pen-db-board-card[data-row="0"]`,
		) as HTMLDivElement | null;
		expect(boardCard).not.toBeNull();
		expect(boardCard?.textContent).toContain("Alpha");
		expect(boardCard?.textContent).toContain("Status");

		await unmountDatabase(root, container, editor);
	});

	it("renders gallery views as row cards", async () => {
		const editor = createEditor({
			without: ["document-ops", "delta-stream", "undo"],
		});
		editor.apply([
			{
				type: "insert-block",
				blockId: "db-gallery",
				blockType: "database",
				props: {},
				position: "last",
			},
			{
				type: "database-add-view",
				blockId: "db-gallery",
				view: {
					id: "view-gallery",
					title: "Gallery view",
					type: "gallery",
					visibleColumnIds: ["name", "tags", "status"],
					columnOrder: ["name", "tags", "status"],
					sort: [],
					filter: null,
					groupBy: null,
					pageIndex: 0,
					pageSize: 50,
				},
			},
			{
				type: "database-set-active-view",
				blockId: "db-gallery",
				viewId: "view-gallery",
			},
			{
				type: "database-insert-row",
				blockId: "db-gallery",
				rowId: "row-a",
				values: { name: "Alpha", tags: "Todo", status: "true" },
			},
		]);
		const { container, root } = await renderDatabase(editor);

		const galleryView = container.querySelector(
			`[data-block-id="db-gallery"] .pen-db-gallery-view`,
		) as HTMLDivElement | null;
		expect(galleryView).not.toBeNull();

		const galleryCard = container.querySelector(
			`[data-block-id="db-gallery"] .pen-db-gallery-card[data-row="0"]`,
		) as HTMLDivElement | null;
		expect(galleryCard).not.toBeNull();
		expect(galleryCard?.textContent).toContain("Name");
		expect(galleryCard?.textContent).toContain("Alpha");
		expect(galleryCard?.textContent).toContain("Tags");

		await unmountDatabase(root, container, editor);
	});

	it("renders calendar views from the first date column", async () => {
		const editor = createEditor({
			without: ["document-ops", "delta-stream", "undo"],
		});
		editor.apply([
			{
				type: "insert-block",
				blockId: "db-calendar",
				blockType: "database",
				props: {},
				position: "last",
			},
			{
				type: "database-update-column",
				blockId: "db-calendar",
				columnId: "tags",
				patch: {
					title: "Due",
				},
			},
			{
				type: "database-convert-column",
				blockId: "db-calendar",
				columnId: "tags",
				toType: "date",
			},
			{
				type: "database-add-view",
				blockId: "db-calendar",
				view: {
					id: "view-calendar",
					title: "Calendar view",
					type: "calendar",
					visibleColumnIds: ["name", "tags", "status"],
					columnOrder: ["name", "tags", "status"],
					sort: [],
					filter: null,
					groupBy: null,
					pageIndex: 0,
					pageSize: 50,
				},
			},
			{
				type: "database-set-active-view",
				blockId: "db-calendar",
				viewId: "view-calendar",
			},
			{
				type: "database-insert-row",
				blockId: "db-calendar",
				rowId: "row-a",
				values: { name: "Alpha", tags: "2024-03-10T09:00:00.000Z", status: "true" },
			},
			{
				type: "database-insert-row",
				blockId: "db-calendar",
				rowId: "row-b",
				values: { name: "Beta", tags: "", status: "false" },
			},
		]);
		const { container, root } = await renderDatabase(editor);

		await act(async () => {
			await flushAnimationFrames(2);
		});

		const calendarView = container.querySelector(
			`[data-block-id="db-calendar"] .pen-db-calendar-view`,
		) as HTMLDivElement | null;
		expect(calendarView).not.toBeNull();

		const calendarCards = Array.from(
			container.querySelectorAll(
				`[data-block-id="db-calendar"] .pen-db-calendar-view .pen-db-calendar-card`,
			),
		) as HTMLDivElement[];
		expect(
			calendarCards.some((card) => card.textContent?.includes("Alpha")),
		).toBe(true);

		const unscheduledSection = container.querySelector(
			`[data-block-id="db-calendar"] .pen-db-calendar-unscheduled`,
		) as HTMLDivElement | null;
		expect(unscheduledSection).not.toBeNull();
		expect(unscheduledSection?.textContent).toContain("Beta");

		await unmountDatabase(root, container, editor);
	});
});
