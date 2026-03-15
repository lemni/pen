import { describe, expect, it } from "vitest";
import { createEditor } from "../index";
import type { DocumentOp } from "@pen/types";

const noDefaultExtensionsPreset = {
	resolve() {
		return { extensions: [] };
	},
};

type RawDatabaseBlockMap = {
	get(key: string): unknown;
};

type LengthLike = {
	length: number;
};

function databaseEditor() {
	const editor = createEditor({
		preset: noDefaultExtensionsPreset,
	});
	editor.apply([
		{
			type: "insert-block",
			blockId: "d1",
			blockType: "database",
			props: {},
			position: "last",
		},
	]);
	return editor;
}

describe("database core operations", () => {
	it("insert-block with database type seeds shared grid structures", () => {
		const editor = databaseEditor();
		const block = editor.getBlock("d1")!;
		expect(block.type).toBe("database");
		expect(block.tableRowCount()).toBe(0);

		const columns = block.tableColumns();
		expect(columns).toHaveLength(3);
		expect(columns.map((column) => column.title)).toEqual(["Name", "Tags", "Done"]);
		expect(columns.map((column) => column.type)).toEqual(["text", "select", "checkbox"]);

		const blockMap = editor.internals.doc.blocks.get("d1") as
			| RawDatabaseBlockMap
			| undefined;
		if (!blockMap) {
			throw new Error("Expected database block to exist");
		}
		expect(blockMap.get("collectionContent")).toBeUndefined();
		expect((blockMap.get("tableContent") as LengthLike).length).toBe(0);
		expect((blockMap.get("tableColumns") as LengthLike).length).toBe(3);
		expect((blockMap.get("databaseViews") as LengthLike).length).toBe(1);
		expect(typeof blockMap.get("databasePrimaryViewId")).toBe("string");
		editor.destroy();
	});

	it("convert-block from table to database derives columns titles and stable row ids", () => {
		const editor = createEditor({
			preset: noDefaultExtensionsPreset,
		});

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
				text: "Name",
			},
			{
				type: "insert-table-cell-text",
				blockId: "t1",
				row: 0,
				col: 1,
				offset: 0,
				text: "Status",
			},
			{
				type: "insert-table-cell-text",
				blockId: "t1",
				row: 1,
				col: 0,
				offset: 0,
				text: "Alpha",
			},
			{
				type: "insert-table-cell-text",
				blockId: "t1",
				row: 1,
				col: 1,
				offset: 0,
				text: "Open",
			},
		]);

		editor.apply([{ type: "convert-block", blockId: "t1", newType: "database" }]);

		const block = editor.getBlock("t1")!;
		expect(block.type).toBe("database");
		expect(block.tableColumns().map((column) => column.title)).toEqual([
			"Name",
			"Status",
		]);
		expect(block.tableColumns().map((column) => column.type)).toEqual([
			"text",
			"text",
		]);
		expect(block.tableRowCount()).toBe(1);
		expect(block.tableCell(0, 0)?.textContent()).toBe("Alpha");
		expect(block.tableCell(0, 1)?.textContent()).toBe("Open");
		expect(block.tableRow(0)?.id).toEqual(expect.any(String));

		editor.destroy();
	});

	it("update-table-columns stores structured column metadata", () => {
		const editor = databaseEditor();

		editor.apply([
			{
				type: "update-table-columns",
				blockId: "d1",
				columns: [
					{
						id: "name",
						title: "Name",
						type: "text",
						width: 240,
						hidden: false,
						options: [],
					},
					{
						id: "status",
						title: "Status",
						type: "select",
						pinned: "left",
						options: [{ id: "todo", value: "Todo", color: "gray" }],
						format: { style: "plain" },
					},
				],
			},
		]);

		const block = editor.getBlock("d1")!;
		expect(block.tableColumns()).toEqual([
			{
				id: "name",
				title: "Name",
				type: "text",
				width: 240,
				hidden: false,
				pinned: undefined,
				options: [],
				format: undefined,
				readonly: undefined,
			},
			{
				id: "status",
				title: "Status",
				type: "select",
				width: undefined,
				hidden: undefined,
				pinned: "left",
				options: [{ id: "todo", value: "Todo", color: "gray" }],
				format: { style: "plain" },
				readonly: undefined,
			},
		]);

		const blockMap = editor.internals.doc.blocks.get("d1") as
			| RawDatabaseBlockMap
			| undefined;
		if (!blockMap) {
			throw new Error("Expected database block to exist");
		}
		expect(typeof blockMap.get("tableColumns")).not.toBe("string");
		expect((blockMap.get("tableColumns") as LengthLike).length).toBe(2);
		expect(block.databaseActiveView()).toEqual(
			expect.objectContaining({
				columnOrder: ["name", "status"],
				visibleColumnIds: ["name", "status"],
			}),
		);
		editor.destroy();
	});

	it("rejects structural table ops against database blocks", () => {
		const editor = databaseEditor();
		const diagnostics: unknown[] = [];

		editor.on("diagnostic", (event) => {
			diagnostics.push(event);
		});

		editor.apply([
			{
				type: "database-insert-row",
				blockId: "d1",
				rowId: "row-alpha",
				values: {
					name: "Alpha",
					tags: "todo",
					status: "true",
				},
			},
		]);

		editor.apply([
			{ type: "insert-table-column", blockId: "d1", index: 1 },
			{ type: "delete-table-row", blockId: "d1", index: 0 },
		]);

		const block = editor.getBlock("d1")!;
		expect(block.tableColumns().map((column) => column.id)).toEqual([
			"name",
			"tags",
			"status",
		]);
		expect(block.tableRowCount()).toBe(1);
		expect(block.tableRow(0)?.id).toBe("row-alpha");
		expect(diagnostics).toContainEqual(
			expect.objectContaining({
				code: "PEN_APPLY_006",
				level: "warn",
				source: "apply",
			}),
		);

		editor.destroy();
	});

	it("database ops manage schema rows and cells through stable ids", () => {
		const editor = databaseEditor();
		const block = editor.getBlock("d1")!;
		const firstViewId = block.databasePrimaryViewId()!;

		editor.apply([
			{
				type: "database-add-column",
				blockId: "d1",
				index: 1,
				viewId: firstViewId,
				column: {
					id: "priority",
					title: "Priority",
					type: "text",
				},
			},
			{
				type: "database-insert-row",
				blockId: "d1",
				rowId: "row-alpha",
				values: {
					name: "Spec review",
					priority: "high",
					status: "true",
				},
			},
			{
				type: "database-update-cell",
				blockId: "d1",
				rowId: "row-alpha",
				columnId: "priority",
				value: "urgent",
			},
			{
				type: "database-update-column",
				blockId: "d1",
				columnId: "priority",
				patch: {
					title: "Urgency",
					width: 220,
				},
			},
			{
				type: "database-convert-column",
				blockId: "d1",
				columnId: "status",
				toType: "select",
			},
		]);

		const updatedBlock = editor.getBlock("d1")!;
		expect(updatedBlock.tableColumns().map((column) => column.id)).toEqual([
			"name",
			"priority",
			"tags",
			"status",
		]);
		expect(updatedBlock.tableColumns()[1]).toEqual(
			expect.objectContaining({
				id: "priority",
				title: "Urgency",
				type: "text",
				width: 220,
			}),
		);
		expect(updatedBlock.tableRowCount()).toBe(1);
		expect(updatedBlock.tableRow(0)?.id).toBe("row-alpha");
		expect(updatedBlock.tableCell(0, 1)?.textContent()).toBe("urgent");
		expect(updatedBlock.tableColumns()[3]?.type).toBe("select");
		expect(updatedBlock.tableCell(0, 3)?.textContent()).toBe("true");
		expect(updatedBlock.databaseActiveView()).toEqual(
			expect.objectContaining({
				columnOrder: ["name", "priority", "tags", "status"],
				visibleColumnIds: ["name", "priority", "tags", "status"],
			}),
		);
		editor.destroy();
	});

	it("database view ops add switch update and remove views", () => {
		const editor = databaseEditor();
		const block = editor.getBlock("d1")!;
		const primaryViewId = block.databasePrimaryViewId()!;
		const columnIds = block.tableColumns().map((column) => column.id);

		editor.apply([
			{
				type: "database-add-view",
				blockId: "d1",
				view: {
					id: "view-list",
					title: "List view",
					type: "list",
					visibleColumnIds: columnIds,
					columnOrder: columnIds,
					sort: [],
					filter: null,
					groupBy: null,
					pageIndex: 0,
					pageSize: 50,
				},
			},
			{
				type: "database-set-active-view",
				blockId: "d1",
				viewId: "view-list",
			},
			{
				type: "database-update-view",
				blockId: "d1",
				viewId: "view-list",
				patch: {
					groupBy: "tags",
				},
			},
		]);

		const updatedBlock = editor.getBlock("d1")!;
		expect(updatedBlock.databasePrimaryViewId()).toBe("view-list");
		expect(updatedBlock.databaseActiveView()).toEqual(
			expect.objectContaining({
				id: "view-list",
				type: "list",
				groupBy: "tags",
			}),
		);
		expect(updatedBlock.databaseViews()).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					id: primaryViewId,
					type: "table",
				}),
				expect.objectContaining({
					id: "view-list",
					title: "List view",
					type: "list",
				}),
			]),
		);

		editor.apply([
			{
				type: "database-remove-view",
				blockId: "d1",
				viewId: "view-list",
			},
		]);

		const nextBlock = editor.getBlock("d1")!;
		expect(nextBlock.databasePrimaryViewId()).toBe(primaryViewId);
		expect(nextBlock.databaseViews()).toHaveLength(1);
		expect(nextBlock.databaseActiveView()).toEqual(
			expect.objectContaining({
				id: primaryViewId,
				type: "table",
			}),
		);
		editor.destroy();
	});

	it("normalizes invalid database view references on write", () => {
		const editor = databaseEditor();

		editor.apply([
			{
				type: "database-insert-row",
				blockId: "d1",
				rowId: "row-a",
				values: {
					name: "Alpha",
					tags: "todo",
					status: "true",
				},
			},
			{
				type: "database-update-view",
				blockId: "d1",
				patch: {
					visibleColumnIds: ["name", "missing", "name"],
					columnOrder: ["missing", "tags", "name", "tags"],
					sort: [
						{ columnId: "missing", direction: "asc" },
						{ columnId: "tags", direction: "asc" },
						{ columnId: "tags", direction: "desc" },
					],
					filter: {
						operator: "and",
						conditions: [
							{ columnId: "missing", operator: "is", value: "x" },
							{ columnId: "tags", operator: "is", value: "todo" },
						],
					},
					groupBy: "missing",
					rowPinning: {
						top: ["missing-row", "row-a", "row-a"],
						bottom: ["row-a", "missing-row"],
					},
				},
			},
		]);

		const view = editor.getBlock("d1")?.databaseActiveView();
		expect(view?.visibleColumnIds).toEqual(["name"]);
		expect(view?.columnOrder).toEqual(["tags", "name"]);
		expect(view?.sort).toEqual([{ columnId: "tags", direction: "asc" }]);
		expect(view?.filter).toEqual({
			operator: "and",
			conditions: [{ columnId: "tags", operator: "is", value: "todo" }],
		});
		expect(view?.groupBy).toBeUndefined();
		expect(view?.rowPinning).toEqual({
			top: ["row-a"],
			bottom: undefined,
		});

		editor.destroy();
	});

	it("database row and select option ops clean up dependent data", () => {
		const editor = databaseEditor();
		editor.apply([
			{
				type: "database-update-view",
				blockId: "d1",
				patch: {
					rowPinning: {
						top: ["row-a"],
						bottom: ["row-b"],
					},
				},
			},
			{
				type: "database-update-column",
				blockId: "d1",
				columnId: "tags",
				patch: {
					options: [
						{ id: "bug", value: "Bug", color: "red" },
						{ id: "chore", value: "Chore", color: "gray" },
					],
				},
			},
			{
				type: "database-convert-column",
				blockId: "d1",
				columnId: "tags",
				toType: "multiSelect",
			},
			{
				type: "database-insert-row",
				blockId: "d1",
				rowId: "row-a",
				values: {
					name: "A",
					tags: JSON.stringify(["bug", "chore"]),
				},
			},
			{
				type: "database-insert-row",
				blockId: "d1",
				rowId: "row-b",
				values: {
					name: "B",
					tags: JSON.stringify(["bug"]),
				},
			},
			{
				type: "database-update-select-options",
				blockId: "d1",
				columnId: "tags",
				action: "remove",
				optionId: "bug",
			},
			{
				type: "database-duplicate-row",
				blockId: "d1",
				rowId: "row-a",
				newRowId: "row-c",
			},
			{
				type: "database-delete-rows",
				blockId: "d1",
				rowIds: ["row-b"],
			},
			{
				type: "database-move-row",
				blockId: "d1",
				rowId: "row-c",
				index: 0,
			},
		]);

		const block = editor.getBlock("d1")!;
		expect(block.tableRowCount()).toBe(2);
		expect(block.tableRow(0)?.id).toBe("row-a");
		expect(block.tableRow(1)?.id).toBe("row-c");
		expect(block.tableCell(0, 1)?.textContent()).toBe(JSON.stringify(["chore"]));
		expect(block.tableCell(1, 1)?.textContent()).toBe(JSON.stringify(["chore"]));
		expect(block.tableColumns()[1]?.options).toEqual([
			{ id: "chore", value: "Chore", color: "gray" },
		]);

		editor.apply([
			{
				type: "database-remove-column",
				blockId: "d1",
				columnId: "tags",
			},
		]);

		const nextBlock = editor.getBlock("d1")!;
		expect(nextBlock.tableColumns().map((column) => column.id)).toEqual([
			"name",
			"status",
		]);
		expect(nextBlock.databaseActiveView()?.columnOrder).toEqual([
			"name",
			"status",
		]);
		expect(nextBlock.databaseActiveView()?.visibleColumnIds).toEqual([
			"name",
			"status",
		]);
		expect(nextBlock.databaseActiveView()?.rowPinning).toBeUndefined();
		editor.destroy();
	});

	it("renaming a select option preserves stored option ids", () => {
		const editor = databaseEditor();
		editor.apply([
			{
				type: "database-update-column",
				blockId: "d1",
				columnId: "tags",
				patch: {
					options: [{ id: "todo", value: "Todo", color: "gray" }],
				},
			},
			{
				type: "database-insert-row",
				blockId: "d1",
				rowId: "row-1",
				values: {
					name: "Write docs",
					tags: "todo",
				},
			},
			{
				type: "database-update-select-options",
				blockId: "d1",
				columnId: "tags",
				action: "rename",
				optionId: "todo",
				value: "Ready",
			},
		]);

		const block = editor.getBlock("d1")!;
		expect(block.tableCell(0, 1)?.textContent()).toBe("todo");
		expect(block.tableColumns()[1]?.options).toEqual([
			{ id: "todo", value: "Ready", color: "gray" },
		]);
		editor.destroy();
	});

	it("rejects column type changes through database-update-column", () => {
		const editor = databaseEditor();
		editor.apply([{
			type: "database-update-column",
			blockId: "d1",
			columnId: "name",
			patch: {
				type: "number",
				title: "Name field",
			},
		} as DocumentOp]);

		const block = editor.getBlock("d1")!;
		expect(block.tableColumns()[0]).toEqual(
			expect.objectContaining({
				id: "name",
				title: "Name field",
				type: "text",
			}),
		);
		editor.destroy();
	});

	it("normalizes typed database row writes and rejects invalid updates", () => {
		const editor = databaseEditor();
		editor.apply([{
			type: "update-table-columns",
			blockId: "d1",
			columns: [
				{ id: "score", title: "Score", type: "number" },
				{ id: "done", title: "Done", type: "checkbox" },
				{
					id: "status",
					title: "Status",
					type: "select",
					options: [{ id: "todo", value: "Todo" }],
				},
				{
					id: "labels",
					title: "Labels",
					type: "multiSelect",
					options: [{ id: "todo", value: "Todo" }],
				},
			],
		}]);

		editor.apply([{
			type: "database-insert-row",
			blockId: "d1",
			rowId: "row-typed",
			values: {
				score: "not-a-number",
				done: "yes",
				status: "Todo",
				labels: JSON.stringify(["Todo"]),
			},
		}]);

		const block = editor.getBlock("d1")!;
		expect(block.tableCell(0, 0)?.textContent()).toBe("");
		expect(block.tableCell(0, 1)?.textContent()).toBe("true");
		expect(block.tableCell(0, 2)?.textContent()).toBe("todo");
		expect(block.tableCell(0, 3)?.textContent()).toBe(JSON.stringify(["todo"]));

		editor.apply([{
			type: "database-update-cell",
			blockId: "d1",
			rowId: "row-typed",
			columnId: "score",
			value: "42",
		}]);
		expect(block.tableCell(0, 0)?.textContent()).toBe("42");

		editor.apply([{
			type: "database-update-cell",
			blockId: "d1",
			rowId: "row-typed",
			columnId: "score",
			value: "still-not-a-number",
		}]);
		expect(block.tableCell(0, 0)?.textContent()).toBe("42");

		editor.destroy();
	});

});
