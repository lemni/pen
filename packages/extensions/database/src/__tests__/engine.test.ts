import { describe, expect, it, vi } from "vitest";
import { DatabaseEngine } from "../engine";
import type { Editor } from "@pen/types";
import {
	isContentEditableColumnType,
	DEFAULT_COLUMNS,
	type DatabaseRow,
	type DatabaseDataProvider,
} from "../types";

type DatabaseEngineTestBlock = {
	id: string;
	type: string;
	props: { title: string; dataSource: string };
	tableRowCount(): number;
	tableColumnCount(): number;
	tableColumns(): Array<{
		id: string;
		title: string;
		type: string;
		width: number;
	}>;
	tableCell(r: number, c: number): {
		id: string;
		textContent(): string;
	};
};

type DatabaseEngineTestEditor = {
	getBlock(id: string): DatabaseEngineTestBlock | null;
	selection: null;
	apply(): void;
	selectCell(): void;
	selectCellRange(): void;
};

function createMockEditor(rowCount = 3, colCount = 3) {
	const columns = [
		{ id: "col-0", title: "Name", type: "text", width: 150 },
		{ id: "col-1", title: "Age", type: "number", width: 100 },
		{ id: "col-2", title: "Done", type: "checkbox", width: 80 },
	];

	const cells: Record<string, string> = {
		"0-0": "Alice",
		"0-1": "30",
		"0-2": "true",
		"1-0": "Bob",
		"1-1": "25",
		"1-2": "false",
		"2-0": "Charlie",
		"2-1": "35",
		"2-2": "true",
	};

	const block = {
		id: "block-1",
		type: "database",
		props: { title: "Test DB", dataSource: "local" },
		tableRowCount: () => rowCount,
		tableColumnCount: () => colCount,
		tableColumns: () => columns.slice(0, colCount),
		tableCell: (r: number, c: number) => {
			const key = `${r}-${c}`;
			const text = cells[key] ?? "";
			return {
				id: key,
				textContent: () => text,
			};
		},
	} satisfies DatabaseEngineTestBlock;

	const editor = {
		getBlock: (id: string) => (id === "block-1" ? block : null),
		selection: null,
		apply: () => { },
		selectCell: () => { },
		selectCellRange: () => { },
	} satisfies DatabaseEngineTestEditor;

	return {
		editor: editor as unknown as Editor,
		block,
	};
}

describe("DatabaseEngine", () => {
	it("derives column schema from block", () => {
		const { editor } = createMockEditor();
		const engine = new DatabaseEngine(editor, "block-1");
		const schema = engine.deriveColumnSchema();

		expect(schema).toHaveLength(3);
		expect(schema[0]).toEqual(
			expect.objectContaining({ id: "col-0", title: "Name", type: "text" }),
		);
		expect(schema[1]).toEqual(
			expect.objectContaining({ id: "col-1", title: "Age", type: "number" }),
		);
		expect(schema[2]).toEqual(
			expect.objectContaining({ id: "col-2", title: "Done", type: "checkbox" }),
		);
	});

	it("returns empty schema for missing block", () => {
		const { editor } = createMockEditor();
		const engine = new DatabaseEngine(editor, "nonexistent");
		expect(engine.deriveColumnSchema()).toEqual([]);
	});

	it("derives row data with crdtRowIndex", () => {
		const { editor } = createMockEditor();
		const engine = new DatabaseEngine(editor, "block-1");
		const rows = engine.deriveRowData();

		expect(rows).toHaveLength(3);
		expect(rows[0].id).toBe("row-0");
		expect(rows[0].crdtRowIndex).toBe(0);
		expect(rows[0].cells["col-0"]).toBe("Alice");
		expect(rows[1].crdtRowIndex).toBe(1);
		expect(rows[2].crdtRowIndex).toBe(2);
	});

	it("getRowId returns row.id", () => {
		const { editor } = createMockEditor();
		const engine = new DatabaseEngine(editor, "block-1");
		const row: DatabaseRow = { id: "row-42", crdtRowIndex: 42, cells: {} };
		expect(engine.getRowId(row)).toBe("row-42");
	});
});

describe("DatabaseEngine value parsing", () => {
	const { editor } = createMockEditor();
	const engine = new DatabaseEngine(editor, "block-1");

	it("parses numbers", () => {
		expect(engine.parseCellValue("42", "number")).toBe(42);
		expect(engine.parseCellValue("", "number")).toBeNull();
		expect(engine.parseCellValue("abc", "number")).toBeNull();
	});

	it("parses checkboxes", () => {
		expect(engine.parseCellValue("true", "checkbox")).toBe(true);
		expect(engine.parseCellValue("false", "checkbox")).toBe(false);
		expect(engine.parseCellValue("TRUE", "checkbox")).toBe(true);
	});

	it("parses dates", () => {
		const result = engine.parseCellValue("2024-01-15", "date");
		expect(result).toBeInstanceOf(Date);
		expect(engine.parseCellValue("", "date")).toBeNull();
		expect(engine.parseCellValue("invalid", "date")).toBeNull();
	});

	it("parses multiSelect", () => {
		expect(engine.parseCellValue('["a","b"]', "multiSelect")).toEqual(["a", "b"]);
		expect(engine.parseCellValue("", "multiSelect")).toEqual([]);
		expect(engine.parseCellValue("invalid json", "multiSelect")).toEqual(["invalid json"]);
	});

	it("passes through text types", () => {
		expect(engine.parseCellValue("hello", "text")).toBe("hello");
		expect(engine.parseCellValue("test@test.com", "email")).toBe("test@test.com");
		expect(engine.parseCellValue("https://x.com", "url")).toBe("https://x.com");
		expect(engine.parseCellValue("row-12", "relation")).toBe("row-12");
		expect(engine.parseCellValue("2 + 2", "formula")).toBe("2 + 2");
	});
});

describe("DatabaseEngine value serialization", () => {
	const { editor } = createMockEditor();
	const engine = new DatabaseEngine(editor, "block-1");

	it("serializes numbers", () => {
		expect(engine.serializeCellValue(42, "number")).toBe("42");
		expect(engine.serializeCellValue(null, "number")).toBe("");
	});

	it("serializes checkboxes", () => {
		expect(engine.serializeCellValue(true, "checkbox")).toBe("true");
		expect(engine.serializeCellValue(false, "checkbox")).toBe("false");
	});

	it("serializes dates", () => {
		const d = new Date("2024-01-15T00:00:00.000Z");
		expect(engine.serializeCellValue(d, "date")).toBe(d.toISOString());
	});

	it("serializes multiSelect", () => {
		expect(engine.serializeCellValue(["a", "b"], "multiSelect")).toBe('["a","b"]');
		expect(engine.serializeCellValue(null, "multiSelect")).toBe("");
	});
});

describe("DatabaseEngine validation", () => {
	const { editor } = createMockEditor();
	const engine = new DatabaseEngine(editor, "block-1");

	it("validates numbers", () => {
		expect(engine.validateCellValue("42", "number")).toBeNull();
		expect(engine.validateCellValue("abc", "number")).toBe("Invalid number");
		expect(engine.validateCellValue("", "number")).toBeNull();
	});

	it("validates dates", () => {
		expect(engine.validateCellValue("2024-01-15", "date")).toBeNull();
		expect(engine.validateCellValue("invalid", "date")).toBe("Invalid date");
	});

	it("validates emails", () => {
		expect(engine.validateCellValue("test@test.com", "email")).toBeNull();
		expect(engine.validateCellValue("notanemail", "email")).toBe("Invalid email");
	});

	it("validates URLs", () => {
		expect(engine.validateCellValue("https://example.com", "url")).toBeNull();
		expect(engine.validateCellValue("not a url", "url")).toBe("Invalid URL");
	});
});

describe("DatabaseEngine cell display formatting", () => {
	const { editor } = createMockEditor();
	const engine = new DatabaseEngine(editor, "block-1");

	it("formats numbers with decimals", () => {
		expect(engine.formatCellDisplay("42.5", "number", { style: "plain", decimals: 2 })).toBe("42.50");
	});

	it("formats currency", () => {
		const result = engine.formatCellDisplay("1000", "number", { style: "currency", currency: "USD", decimals: 2 });
		expect(result).toContain("1,000.00");
	});

	it("formats checkboxes", () => {
		expect(engine.formatCellDisplay("true", "checkbox")).toBe("✓");
		expect(engine.formatCellDisplay("false", "checkbox")).toBe("");
	});

	it("formats select ids using option labels", () => {
		expect(
			engine.formatCellDisplay("todo", "select", undefined, [
				{ id: "todo", value: "Todo" },
			]),
		).toBe("Todo");
	});

	it("formats multiSelect ids using option labels", () => {
		expect(
			engine.formatCellDisplay('["todo","done"]', "multiSelect", undefined, [
				{ id: "todo", value: "Todo" },
				{ id: "done", value: "Done" },
			]),
		).toBe("Todo, Done");
	});

	it("returns empty for empty values", () => {
		expect(engine.formatCellDisplay("", "number")).toBe("");
		expect(engine.formatCellDisplay("", "date")).toBe("");
	});
});

describe("DatabaseEngine type coercion", () => {
	const { editor } = createMockEditor();
	const engine = new DatabaseEngine(editor, "block-1");

	it("coerces text to number", () => {
		expect(engine.coerceValue("42", "text", "number")).toBe("42");
		expect(engine.coerceValue("abc", "text", "number")).toBe("");
	});

	it("coerces text to checkbox", () => {
		expect(engine.coerceValue("true", "text", "checkbox")).toBe("true");
		expect(engine.coerceValue("nope", "text", "checkbox")).toBe("false");
	});

	it("coerces number to checkbox", () => {
		expect(engine.coerceValue("1", "number", "checkbox")).toBe("true");
		expect(engine.coerceValue("0", "number", "checkbox")).toBe("false");
	});

	it("coerces select to multiSelect", () => {
		expect(engine.coerceValue("tag1", "select", "multiSelect")).toBe('["tag1"]');
	});

	it("coerces text to select using option ids", () => {
		expect(
			engine.coerceValue("Todo", "text", "select", [{ id: "todo", value: "Todo" }]),
		).toBe("todo");
		expect(
			engine.coerceValue("Missing", "text", "select", [{ id: "todo", value: "Todo" }]),
		).toBe("");
	});

	it("coerces multiSelect to select", () => {
		expect(engine.coerceValue('["tag1","tag2"]', "multiSelect", "select")).toBe("tag1");
		expect(engine.coerceValue("[]", "multiSelect", "select")).toBe("");
	});

	it("coerces multiSelect to relation", () => {
		expect(engine.coerceValue('["row-1","row-2"]', "multiSelect", "relation")).toBe("row-1");
		expect(engine.coerceValue("[]", "multiSelect", "relation")).toBe("");
	});

	it("coerces select to checkbox", () => {
		expect(engine.coerceValue("some-id", "select", "checkbox")).toBe("true");
		expect(engine.coerceValue("", "select", "checkbox")).toBe("");
	});

	it("coerces date to checkbox", () => {
		expect(engine.coerceValue("2024-01-15", "date", "checkbox")).toBe("true");
		expect(engine.coerceValue("", "date", "checkbox")).toBe("");
	});

	it("coerces multiSelect to checkbox", () => {
		expect(engine.coerceValue('["a"]', "multiSelect", "checkbox")).toBe("true");
		expect(engine.coerceValue("", "multiSelect", "checkbox")).toBe("");
	});

	it("preserves value for same type", () => {
		expect(engine.coerceValue("hello", "text", "text")).toBe("hello");
	});

	it("returns empty for empty input", () => {
		expect(engine.coerceValue("", "text", "number")).toBe("");
	});
});

describe("DatabaseEngine sorting", () => {
	const { editor } = createMockEditor();
	const engine = new DatabaseEngine(editor, "block-1");

	it("sorts rows numerically", () => {
		const rows: DatabaseRow[] = [
			{ id: "a", crdtRowIndex: 0, cells: { score: "10" } },
			{ id: "b", crdtRowIndex: 1, cells: { score: "2" } },
		];
		const sorted = engine.sortRows(rows, [{ columnId: "score", direction: "asc" }], [
			{ id: "score", title: "Score", type: "number", columnIndex: 0 },
		]);
		expect(sorted.map((row) => row.id)).toEqual(["b", "a"]);
	});

	it("sorts select rows by option label", () => {
		const rows: DatabaseRow[] = [
			{ id: "a", crdtRowIndex: 0, cells: { status: "done" } },
			{ id: "b", crdtRowIndex: 1, cells: { status: "todo" } },
		];
		const sorted = engine.sortRows(rows, [{ columnId: "status", direction: "asc" }], [
			{
				id: "status",
				title: "Status",
				type: "select",
				columnIndex: 0,
				options: [
					{ id: "todo", value: "Todo" },
					{ id: "done", value: "Done" },
				],
			},
		]);
		expect(sorted.map((row) => row.id)).toEqual(["a", "b"]);
	});
});

describe("DatabaseEngine filtering", () => {
	const { editor } = createMockEditor();
	const engine = new DatabaseEngine(editor, "block-1");

	it("filters text by contains", () => {
		const rows: DatabaseRow[] = [
			{ id: "a", crdtRowIndex: 0, cells: { title: "Hello World" } },
			{ id: "b", crdtRowIndex: 1, cells: { title: "Hello" } },
		];
		const filtered = engine.filterRows(
			rows,
			{
				operator: "and",
				conditions: [{ columnId: "title", operator: "contains", value: "world" }],
			},
			[{ id: "title", title: "Title", type: "text", columnIndex: 0 }],
		);
		expect(filtered.map((row) => row.id)).toEqual(["a"]);
	});

	it("filters checkbox by checked state", () => {
		const rows: DatabaseRow[] = [
			{ id: "a", crdtRowIndex: 0, cells: { done: "true" } },
			{ id: "b", crdtRowIndex: 1, cells: { done: "false" } },
		];
		const filtered = engine.filterRows(
			rows,
			{
				operator: "and",
				conditions: [{ columnId: "done", operator: "is_checked", value: null }],
			},
			[{ id: "done", title: "Done", type: "checkbox", columnIndex: 0 }],
		);
		expect(filtered.map((row) => row.id)).toEqual(["a"]);
	});

	it("filters select values by stored option ids", () => {
		const rows: DatabaseRow[] = [
			{ id: "a", crdtRowIndex: 0, cells: { status: "todo" } },
			{ id: "b", crdtRowIndex: 1, cells: { status: "done" } },
		];
		const filtered = engine.filterRows(
			rows,
			{
				operator: "and",
				conditions: [{ columnId: "status", operator: "is", value: "todo" }],
			},
			[
				{
					id: "status",
					title: "Status",
					type: "select",
					columnIndex: 0,
					options: [
						{ id: "todo", value: "Todo" },
						{ id: "done", value: "Done" },
					],
				},
			],
		);
		expect(filtered.map((row) => row.id)).toEqual(["a"]);
	});

	it("filters dates inclusively by between", () => {
		const rows: DatabaseRow[] = [
			{ id: "a", crdtRowIndex: 0, cells: { due: "2024-03-10T09:00:00.000Z" } },
			{ id: "b", crdtRowIndex: 1, cells: { due: "2024-03-15T09:00:00.000Z" } },
			{ id: "c", crdtRowIndex: 2, cells: { due: "2024-03-20T09:00:00.000Z" } },
		];
		const filtered = engine.filterRows(
			rows,
			{
				operator: "and",
				conditions: [{
					columnId: "due",
					operator: "is_between",
					value: ["2024-03-10", "2024-03-15"],
				}],
			},
			[{ id: "due", title: "Due", type: "date", columnIndex: 0 }],
		);
		expect(filtered.map((row) => row.id)).toEqual(["a", "b"]);
	});

	it("filters dates by relative presets", () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2024-03-15T12:00:00.000Z"));
		try {
			const rows: DatabaseRow[] = [
				{ id: "a", crdtRowIndex: 0, cells: { due: "2024-03-15T09:00:00.000Z" } },
				{ id: "b", crdtRowIndex: 1, cells: { due: "2024-03-11T09:00:00.000Z" } },
				{ id: "c", crdtRowIndex: 2, cells: { due: "2024-02-28T09:00:00.000Z" } },
			];
			const filtered = engine.filterRows(
				rows,
				{
					operator: "and",
					conditions: [{
						columnId: "due",
						operator: "is_relative",
						value: "last_7_days",
					}],
				},
				[{ id: "due", title: "Due", type: "date", columnIndex: 0 }],
			);
			expect(filtered.map((row) => row.id)).toEqual(["a", "b"]);
		} finally {
			vi.useRealTimers();
		}
	});

	it("does not match dates for unknown relative presets", () => {
		const rows: DatabaseRow[] = [
			{ id: "a", crdtRowIndex: 0, cells: { due: "2024-03-15T09:00:00.000Z" } },
		];
		const filtered = engine.filterRows(
			rows,
			{
				operator: "and",
				conditions: [{
					columnId: "due",
					operator: "is_relative",
					value: "not_a_real_preset",
				}],
			},
			[{ id: "due", title: "Due", type: "date", columnIndex: 0 }],
		);
		expect(filtered).toEqual([]);
	});
});

describe("DatabaseEngine search", () => {
	const { editor } = createMockEditor();
	const engine = new DatabaseEngine(editor, "block-1");

	it("searches across visible columns using formatted display values", () => {
		const rows: DatabaseRow[] = [
			{ id: "a", crdtRowIndex: 0, cells: { status: "todo", hidden: "Needle" } },
			{ id: "b", crdtRowIndex: 1, cells: { status: "done", hidden: "" } },
		];
		const columns = [
			{
				id: "status",
				title: "Status",
				type: "select" as const,
				columnIndex: 0,
				options: [
					{ id: "todo", value: "Todo" },
					{ id: "done", value: "Done" },
				],
			},
		];

		expect(engine.searchRows(rows, "todo", columns).map((row) => row.id)).toEqual(["a"]);
		expect(engine.searchRows(rows, "needle", columns)).toEqual([]);
	});
});

describe("DatabaseEngine faceting", () => {
	const { editor } = createMockEditor();
	const engine = new DatabaseEngine(editor, "block-1");

	it("builds select facet buckets from stored option ids", () => {
		const rows: DatabaseRow[] = [
			{ id: "a", crdtRowIndex: 0, cells: { status: "todo" } },
			{ id: "b", crdtRowIndex: 1, cells: { status: "done" } },
			{ id: "c", crdtRowIndex: 2, cells: { status: "todo" } },
		];
		const columns = [
			{
				id: "status",
				title: "Status",
				type: "select" as const,
				columnIndex: 0,
				options: [
					{ id: "todo", value: "Todo" },
					{ id: "done", value: "Done" },
				],
			},
		];

		expect(engine.facetColumnValues(rows, "status", columns)).toEqual([
			{ value: "done", label: "Done", count: 1 },
			{ value: "todo", label: "Todo", count: 2 },
		]);
	});

	it("builds multiSelect facet buckets per selected option", () => {
		const rows: DatabaseRow[] = [
			{ id: "a", crdtRowIndex: 0, cells: { tags: '["bug","feat"]' } },
			{ id: "b", crdtRowIndex: 1, cells: { tags: '["bug"]' } },
		];
		const columns = [
			{
				id: "tags",
				title: "Tags",
				type: "multiSelect" as const,
				columnIndex: 0,
				options: [
					{ id: "bug", value: "Bug" },
					{ id: "feat", value: "Feature" },
				],
			},
		];

		expect(engine.facetColumnValues(rows, "tags", columns)).toEqual([
			{ value: "bug", label: "Bug", count: 2 },
			{ value: "feat", label: "Feature", count: 1 },
		]);
	});
});

describe("DatabaseEngine view model helpers", () => {
	const { editor } = createMockEditor();
	const engine = new DatabaseEngine(editor, "block-1");

	it("includes groupBy in remote queries", () => {
		expect(
			engine.createQuery({
				view: {
					id: "view-1",
					type: "table",
					groupBy: "status",
					sort: [{ columnId: "name", direction: "asc" }],
					pageIndex: 2,
					pageSize: 25,
				},
			}),
		).toEqual({
			groupBy: "status",
			sort: [{ columnId: "name", direction: "asc" }],
			filter: undefined,
			pageIndex: 2,
			pageSize: 25,
		});
	});

	it("splits pinned rows out of the paginated middle rows", () => {
		const rows: DatabaseRow[] = [
			{ id: "row-a", crdtRowIndex: 0, cells: { name: "A" } },
			{ id: "row-b", crdtRowIndex: 1, cells: { name: "B" } },
			{ id: "row-c", crdtRowIndex: 2, cells: { name: "C" } },
			{ id: "row-d", crdtRowIndex: 3, cells: { name: "D" } },
		];

		expect(
			engine.splitPinnedRows(rows, {
				top: ["row-c"],
				bottom: ["row-a"],
			}),
		).toEqual({
			top: [{ id: "row-c", crdtRowIndex: 2, cells: { name: "C" } }],
			rows: [
				{ id: "row-b", crdtRowIndex: 1, cells: { name: "B" } },
				{ id: "row-d", crdtRowIndex: 3, cells: { name: "D" } },
			],
			bottom: [{ id: "row-a", crdtRowIndex: 0, cells: { name: "A" } }],
		});
	});

	it("groups rows by formatted display label", () => {
		const rows: DatabaseRow[] = [
			{ id: "row-a", crdtRowIndex: 0, cells: { status: "todo" } },
			{ id: "row-b", crdtRowIndex: 1, cells: { status: "done" } },
			{ id: "row-c", crdtRowIndex: 2, cells: { status: "todo" } },
			{ id: "row-d", crdtRowIndex: 3, cells: { status: "" } },
		];
		const columns = [
			{
				id: "status",
				title: "Status",
				type: "select" as const,
				columnIndex: 0,
				options: [
					{ id: "todo", value: "Todo" },
					{ id: "done", value: "Done" },
				],
			},
		];

		expect(engine.groupRows(rows, "status", columns)).toEqual([
			{
				key: "status:Todo",
				label: "Todo",
				rows: [
					{ id: "row-a", crdtRowIndex: 0, cells: { status: "todo" } },
					{ id: "row-c", crdtRowIndex: 2, cells: { status: "todo" } },
				],
			},
			{
				key: "status:Done",
				label: "Done",
				rows: [{ id: "row-b", crdtRowIndex: 1, cells: { status: "done" } }],
			},
			{
				key: "status:(empty)",
				label: "(empty)",
				rows: [{ id: "row-d", crdtRowIndex: 3, cells: { status: "" } }],
			},
		]);
	});
});

describe("isContentEditableColumnType", () => {
	it("returns true for text-like types", () => {
		expect(isContentEditableColumnType("text")).toBe(true);
		expect(isContentEditableColumnType("number")).toBe(true);
		expect(isContentEditableColumnType("url")).toBe(true);
		expect(isContentEditableColumnType("email")).toBe(true);
	});

	it("returns false for widget types", () => {
		expect(isContentEditableColumnType("checkbox")).toBe(false);
		expect(isContentEditableColumnType("select")).toBe(false);
		expect(isContentEditableColumnType("multiSelect")).toBe(false);
		expect(isContentEditableColumnType("date")).toBe(false);
		expect(isContentEditableColumnType("relation")).toBe(false);
		expect(isContentEditableColumnType("formula")).toBe(false);
	});

	it("returns true for undefined/null", () => {
		expect(isContentEditableColumnType(undefined)).toBe(true);
		expect(isContentEditableColumnType("")).toBe(true);
	});
});

describe("DEFAULT_COLUMNS", () => {
	it("has 3 columns with unique IDs", () => {
		expect(DEFAULT_COLUMNS).toHaveLength(3);
		const ids = DEFAULT_COLUMNS.map((c) => c.id);
		expect(new Set(ids).size).toBe(3);
	});

	it("includes Name (text), Tags (select), Done (checkbox)", () => {
		expect(DEFAULT_COLUMNS[0].title).toBe("Name");
		expect(DEFAULT_COLUMNS[0].type).toBe("text");
		expect(DEFAULT_COLUMNS[1].title).toBe("Tags");
		expect(DEFAULT_COLUMNS[1].type).toBe("select");
		expect(DEFAULT_COLUMNS[2].title).toBe("Done");
		expect(DEFAULT_COLUMNS[2].type).toBe("checkbox");
	});
});

describe("DatabaseEngine data provider", () => {
	it("stores and retrieves data provider", () => {
		const { editor } = createMockEditor();
		const engine = new DatabaseEngine(editor, "block-1");
		expect(engine.dataProvider).toBeNull();

		const provider: DatabaseDataProvider = {
			fetch: async () => ({ rows: [], totalRows: 0, pageIndex: 0, pageSize: 50 }),
		};
		engine.setDataProvider(provider);
		expect(engine.dataProvider).toBe(provider);
	});

	it("detects remote mode from block props", () => {
		const { editor, block } = createMockEditor();
		const engine = new DatabaseEngine(editor, "block-1");

		expect(engine.isRemote).toBe(false);
		block.props.dataSource = "remote";
		expect(engine.isRemote).toBe(true);
		block.props.dataSource = "hybrid";
		expect(engine.isRemote).toBe(true);
	});
});
