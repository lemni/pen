import { defaultSchema } from "@pen/schema-default";
import type { ApplyOptions, DocumentOp, Editor } from "@pen/types";
import { describe, expect, it, vi } from "vitest";
import { ToolContextImpl } from "../toolContext";
import { ToolRuntimeImpl } from "../toolServer";
import { getContextTool } from "../tools/getContext";
import { getCursorContextTool } from "../tools/getCursorContext";
import { inspectTargetTool } from "../tools/inspectTarget";
import { insertBlockTool } from "../tools/insertBlock";
import { listBlockTypesTool } from "../tools/listBlockTypes";
import { listValidOperationsTool } from "../tools/listValidOperations";
import { readDocumentTool } from "../tools/readDocument";
import { searchDocumentTool } from "../tools/searchDocument";
import { retrieveDocumentSpansTool } from "../tools/retrieveDocumentSpans";
import { deleteBlockTool } from "../tools/deleteBlock";
import { moveBlockTool } from "../tools/moveBlock";
import { updateBlockTool } from "../tools/updateBlock";
import { writeDocumentTool } from "../tools/writeDocument";

function createFakeEditor(documentProfile: Editor["documentProfile"]): Editor {
	return {
		documentProfile,
		schema: defaultSchema,
		apply: vi.fn<(ops: DocumentOp[], options?: ApplyOptions) => void>(),
		internals: {
			emit: vi.fn(),
		},
	} as unknown as Editor;
}

function createDatabaseMarkdown(): string {
	return [
		"<!-- pen-database:%7B%22title%22%3A%22Roadmap%22%2C%22dataSource%22%3A%22local%22%2C%22columns%22%3A%5B%7B%22id%22%3A%22name%22%2C%22title%22%3A%22Name%22%2C%22type%22%3A%22text%22%7D%5D%2C%22rows%22%3A%5B%7B%22id%22%3A%22roadmap-1%22%2C%22values%22%3A%7B%22name%22%3A%22Ship%20importer%22%7D%7D%5D%2C%22primaryViewId%22%3Anull%7D -->",
		"",
		"| Name |",
		"| --- |",
		"| Ship importer |",
	].join("\n");
}

function createMockBlockHandle(input: {
	id: string;
	type: string;
	props?: Record<string, unknown>;
	children?: unknown[];
	textContent: (options?: { resolved?: boolean }) => string;
	textDeltas: () => Array<{ insert: string; attributes?: Record<string, unknown> }>;
	prev?: unknown;
	next?: unknown;
}): {
	id: string;
	type: string;
	props: Record<string, unknown>;
	children: unknown[];
	textContent: (options?: { resolved?: boolean }) => string;
	textDeltas: () => Array<{ insert: string; attributes?: Record<string, unknown> }>;
	tableRowCount: () => number;
	tableColumnCount: () => number;
	tableCell: () => null;
	tableRow: () => null;
	tableColumns: () => never[];
	databaseViews: () => never[];
	databasePrimaryViewId: () => null;
	databaseActiveView: () => null;
	prev?: unknown;
	next?: unknown;
} {
	return {
		props: {},
		children: [],
		prev: null,
		next: null,
		...input,
		tableRowCount: () => 0,
		tableColumnCount: () => 0,
		tableCell: () => null,
		tableRow: () => null,
		tableColumns: () => [],
		databaseViews: () => [],
		databasePrimaryViewId: () => null,
		databaseActiveView: () => null,
	};
}

function createReadDocumentEditor(): Editor {
	const blocks = [
		createMockBlockHandle({
			id: "block-1",
			type: "paragraph",
			props: {},
			children: [],
			textContent: (options?: { resolved?: boolean }) =>
				options?.resolved ? "First accepted" : "First accepted",
			textDeltas: () => [{ insert: "First accepted" }],
		}),
		createMockBlockHandle({
			id: "block-2",
			type: "paragraph",
			props: {},
			children: [],
			textContent: (options?: { resolved?: boolean }) =>
				options?.resolved ? "Second" : "Second draft",
			textDeltas: () => [
				{ insert: "Second" },
				{ insert: " draft", attributes: { suggestion: { action: "delete" } } },
			],
		}),
		createMockBlockHandle({
			id: "block-3",
			type: "heading",
			props: {},
			children: [],
			textContent: (options?: { resolved?: boolean }) =>
				options?.resolved ? "Third" : "Third",
			textDeltas: () => [{ insert: "Third" }],
		}),
	] as const;
	for (const block of blocks) {
		delete (block as { prev?: unknown }).prev;
		delete (block as { next?: unknown }).next;
	}

	return {
		documentProfile: "structured",
		schema: defaultSchema,
		blockCount: () => 3,
		blocks: () => blocks,
		getBlock: (blockId: string) => blocks.find((block) => block.id === blockId) ?? null,
		getSelection: () => ({
			type: "text",
			anchor: { blockId: "block-2", offset: 0 },
			focus: { blockId: "block-2", offset: 6 },
			isCollapsed: false,
			toRange: () => ({
				start: { blockId: "block-2", offset: 0 },
				end: { blockId: "block-2", offset: 6 },
				blockRange: ["block-2"],
			}),
		}),
		getSelectedText: () => "Second",
	} as unknown as Editor;
}

function createStructuredTargetEditor(
	activeBlockId: string,
	documentProfile: Editor["documentProfile"] = "structured",
): Editor {
	const views = [
		{
			id: "view-1",
			type: "table" as const,
			title: "Default view",
		},
	];
	const blocks = [
		{
			id: "paragraph-1",
			type: "paragraph",
			props: {},
			children: [],
			textContent: () => "Paragraph",
			textDeltas: () => [{ insert: "Paragraph" }],
			tableRowCount: () => 0,
			tableColumnCount: () => 0,
			tableColumns: () => [],
			databaseViews: () => [],
			databasePrimaryViewId: () => null,
			databaseActiveView: () => null,
		},
		{
			id: "table-1",
			type: "table",
			props: { hasHeaderRow: true },
			children: [],
			textContent: () => "",
			textDeltas: () => [],
			tableRowCount: () => 3,
			tableColumnCount: () => 2,
			tableColumns: () => [
				{ id: "col-1", title: "Name", type: "text" as const },
				{ id: "col-2", title: "Status", type: "text" as const },
			],
			databaseViews: () => [],
			databasePrimaryViewId: () => null,
			databaseActiveView: () => null,
		},
		{
			id: "database-1",
			type: "database",
			props: { title: "Roadmap" },
			children: [],
			textContent: () => "",
			textDeltas: () => [],
			tableRowCount: () => 2,
			tableColumnCount: () => 2,
			tableColumns: () => [
				{ id: "name", title: "Name", type: "text" as const },
				{ id: "owner", title: "Owner", type: "text" as const },
			],
			databaseViews: () => views,
			databasePrimaryViewId: () => "view-1",
			databaseActiveView: () => views[0],
		},
		{
			id: "subdocument-1",
			type: "subdocument",
			props: {},
			children: [],
			textContent: () => "",
			textDeltas: () => [],
			tableRowCount: () => 0,
			tableColumnCount: () => 0,
			tableColumns: () => [],
			databaseViews: () => [],
			databasePrimaryViewId: () => null,
			databaseActiveView: () => null,
		},
	];

	return {
		documentProfile,
		schema: defaultSchema,
		apply: vi.fn<(ops: DocumentOp[], options?: ApplyOptions) => void>(),
		blocks: () => blocks,
		getBlock: (blockId: string) => blocks.find((block) => block.id === blockId) ?? null,
		getSelection: () => ({
			type: "block",
			blockIds: [activeBlockId],
		}),
		getSelectedText: () => "",
	} as unknown as Editor;
}

function createNestedDocumentEditor(): Editor {
	const topLevelBlocks = [
		createMockBlockHandle({
			id: "heading-1",
			type: "heading",
			props: { level: 1 },
			children: [],
			textContent: () => "Architecture",
			textDeltas: () => [{ insert: "Architecture" }],
		}),
		createMockBlockHandle({
			id: "layout-1",
			type: "columns",
			props: {},
			children: [],
			textContent: () => "",
			textDeltas: () => [],
		}),
	];
	const nestedBlocks = [
		topLevelBlocks[0],
		topLevelBlocks[1],
		createMockBlockHandle({
			id: "paragraph-1",
			type: "paragraph",
			props: {},
			children: [],
			textContent: () => "Fast apply preserves stable block identity.",
			textDeltas: () => [{ insert: "Fast apply preserves stable block identity." }],
		}),
	];

	return {
		documentProfile: "structured",
		schema: defaultSchema,
		blocks: () => topLevelBlocks,
		documentState: {
			allBlocks: () => nestedBlocks,
		},
		getBlock: (blockId: string) =>
			nestedBlocks.find((block) => block.id === blockId) ?? null,
		getSelection: () => ({
			type: "text",
			anchor: { blockId: "paragraph-1", offset: 0 },
			focus: { blockId: "paragraph-1", offset: 4 },
			isCollapsed: false,
			toRange: () => ({
				start: { blockId: "paragraph-1", offset: 0 },
				end: { blockId: "paragraph-1", offset: 4 },
				blockRange: ["paragraph-1"],
			}),
		}),
		getSelectedText: () => "Fast",
	} as unknown as Editor;
}

describe("@pen/document-ops tools", () => {
	it("filters hidden and flow-disallowed block types from list_block_types", async () => {
		const structuredEditor = createFakeEditor("structured");
		const flowEditor = createFakeEditor("flow");

		const structuredTypes = (await listBlockTypesTool(structuredEditor).handler(
			{},
			{} as never,
		)) as Array<{ type: string }>;
		const flowTypes = (await listBlockTypesTool(flowEditor).handler(
			{},
			{} as never,
		)) as Array<{ type: string }>;

		expect(structuredTypes.map((entry) => entry.type)).toContain("database");
		expect(structuredTypes.map((entry) => entry.type)).not.toContain("subdocument");
		expect(flowTypes.map((entry) => entry.type)).not.toContain("database");
		expect(flowTypes.map((entry) => entry.type)).not.toContain("subdocument");
		expect(structuredTypes.find((entry) => entry.type === "table")).toMatchObject({
			type: "table",
			content: "table",
			fieldEditor: "table",
			flowCapability: "flow-delegated",
			selectionRole: "delegated",
		});
	});

	it("rejects inserting flow-disallowed block types in flow documents", async () => {
		const editor = createFakeEditor("flow");

		await expect(
			insertBlockTool(editor).handler(
				{
					position: "last",
					blockType: "database",
				},
				{} as never,
			),
		).rejects.toThrow('Block type "database" is not available in flow documents.');

		expect(editor.apply).not.toHaveBeenCalled();
	});

	it("rejects hidden block types in structured documents before applying", async () => {
		const editor = createFakeEditor("structured");

		await expect(
			insertBlockTool(editor).handler(
				{
					position: "last",
					blockType: "subdocument",
				},
				{} as never,
			),
		).rejects.toThrow(
			'Block type "subdocument" is not available in structured documents.',
		);

		expect(editor.apply).not.toHaveBeenCalled();
	});

	it("rejects hidden and flow-disallowed block types in write_document", async () => {
		const flowEditor = createFakeEditor("flow");

		await expect(
			writeDocumentTool(flowEditor).handler(
				{
					blocks: [{ blockType: "database", content: "Rows" }],
				},
				{} as never,
			),
		).rejects.toThrow('Block type "database" is not available in flow documents.');

		expect(flowEditor.apply).not.toHaveBeenCalled();
	});

	it("validates all blocks before write_document mutates the document", async () => {
		const flowEditor = createFakeEditor("flow");

		await expect(
			writeDocumentTool(flowEditor).handler(
				{
					blocks: [
						{ blockType: "paragraph", content: "Allowed" },
						{ blockType: "database", content: "Blocked" },
					],
				},
				{} as never,
			),
		).rejects.toThrow('Block type "database" is not available in flow documents.');

		expect(flowEditor.apply).not.toHaveBeenCalled();
	});

	it("writes markdown content as structured blocks", async () => {
		const editor = createFakeEditor("structured");

		const result = await writeDocumentTool(editor).handler(
			{
				format: "markdown",
				content: "# Heading\n\n- Item",
				position: "last",
			},
			{} as never,
		) as {
			blockIds: string[];
		};
		const appliedOps = vi.mocked(editor.apply).mock.calls[0]?.[0] ?? [];

		expect(result.blockIds).toHaveLength(2);
		expect(appliedOps.filter((op) => op.type === "insert-block")).toHaveLength(2);
		expect(appliedOps[0]).toMatchObject({
			type: "insert-block",
			blockType: "heading",
			position: "last",
		});
		expect(appliedOps[1]).toMatchObject({
			type: "insert-text",
			text: "Heading",
		});
		expect(appliedOps[2]).toMatchObject({
			type: "insert-block",
			blockType: "bulletListItem",
		});
		expect(appliedOps[3]).toMatchObject({
			type: "insert-text",
			text: "Item",
		});
	});

	it("filters flow-disallowed markdown blocks before write_document mutates", async () => {
		const flowEditor = createFakeEditor("flow");
		const markdown = createDatabaseMarkdown();

		const result = await writeDocumentTool(flowEditor).handler(
			{
				format: "markdown",
				content: `${markdown}\n\n## Allowed`,
				position: "last",
			},
			{} as never,
		) as {
			blockIds: string[];
		};
		const appliedOps = vi.mocked(flowEditor.apply).mock.calls[0]?.[0] ?? [];

		expect(result.blockIds).toHaveLength(1);
		expect(appliedOps.filter((op) => op.type === "insert-block")).toHaveLength(1);
		expect(appliedOps[0]).toMatchObject({
			type: "insert-block",
			blockType: "heading",
		});
		expect(flowEditor.internals.emit).toHaveBeenCalled();
	});

	it("guards ToolContext block insertion with the same policy", () => {
		const editor = createFakeEditor("flow");
		const emit = vi.fn();
		const context = new ToolContextImpl(editor, "doc-1", emit);

		expect(() =>
			context.insertBlock("database", {}, "last"),
		).toThrow('Block type "database" is not available in flow documents.');

		expect(emit).not.toHaveBeenCalled();
		expect(editor.apply).not.toHaveBeenCalled();
	});

	it("allows ToolContext streaming without an undo manager", () => {
		const streaming = {
			beginStreaming: vi.fn(),
			appendDelta: vi.fn(),
			endStreaming: vi.fn(),
		};
		const editor = {
			...createFakeEditor("structured"),
			internals: {
				emit: vi.fn(),
				getSlot: vi.fn((key: string) =>
					key === "delta-stream:target" ? streaming : undefined
				),
			},
		} as unknown as Editor;
		const emit = vi.fn();
		const context = new ToolContextImpl(editor, "doc-1", emit);

		expect(() => {
			context.beginStreaming("zone-1", "block-1");
			context.appendDelta("Hello");
			context.endStreaming("complete");
		}).not.toThrow();

		expect(emit).toHaveBeenCalledWith({
			type: "gen-start",
			zoneId: "zone-1",
			blockId: "block-1",
		});
		expect(emit).toHaveBeenCalledWith({
			type: "gen-delta",
			zoneId: "zone-1",
			delta: "Hello",
		});
		expect(emit).toHaveBeenCalledWith({
			type: "gen-end",
			zoneId: "zone-1",
			status: "complete",
		});
		expect(streaming.beginStreaming).toHaveBeenCalledWith("zone-1", "block-1");
		expect(streaming.appendDelta).toHaveBeenCalledWith("Hello");
		expect(streaming.endStreaming).toHaveBeenCalledWith("complete");
	});

	it("defaults read_document to a compact summary", async () => {
		const editor = createReadDocumentEditor();

		const result = await readDocumentTool(editor).handler({}, {} as never) as {
			blockCount: number;
			preview: Array<{ id: string; type: string; content: string }>;
		};

		expect(result.blockCount).toBe(3);
		expect(result.preview).toEqual([
			{ id: "block-1", type: "paragraph", content: "First accepted" },
			{ id: "block-2", type: "paragraph", content: "Second" },
			{ id: "block-3", type: "heading", content: "Third" },
		]);
	});

	it("limits read_document to the requested block range", async () => {
		const editor = createReadDocumentEditor();

		const result = await readDocumentTool(editor).handler(
			{
				format: "markdown",
				range: {
					startBlockId: "block-2",
					endBlockId: "block-3",
				},
			},
			{} as never,
		) as string;

		expect(result).toBe("Second\n\n# Third");
	});

	it("returns summary context with selection details", async () => {
		const editor = createReadDocumentEditor();

		const result = await getContextTool(editor).handler(
			{
				format: "summary",
				includeSelection: true,
			},
			{} as never,
		) as {
			blockCount: number;
			activeBlockId: string;
			selectedText: string;
			blocks: Array<{ id: string; preview: string }>;
		};

		expect(result.blockCount).toBe(3);
		expect(result.activeBlockId).toBe("block-2");
		expect(result.selectedText).toBe("Second");
		expect(result.blocks.map((block) => block.id)).toEqual([
			"block-1",
			"block-2",
			"block-3",
		]);
	});

	it("returns cursor context without reading the full document", async () => {
		const editor = createReadDocumentEditor();

		const result = await getCursorContextTool(editor).handler({}, {} as never) as {
			activeBlockId: string | null;
			activeBlockType: string | null;
			selectedText: string | null;
			surroundingBlocks: Array<{ id: string }>;
			structuredTarget: { target: { kind: string }; validOperations: string[] } | null;
		};

		expect(result.activeBlockId).toBe("block-2");
		expect(result.activeBlockType).toBe("paragraph");
		expect(result.selectedText).toBe("Second");
		expect(result.surroundingBlocks.map((block) => block.id)).toEqual([
			"block-1",
			"block-2",
			"block-3",
		]);
		expect(result.structuredTarget?.target.kind).toBe("block");
		expect(result.structuredTarget?.validOperations).toContain("replace_text");
	});

	it("uses bounded neighbor traversal for cursor context when block links exist", async () => {
		const blocks: Array<{
			id: string;
			type: string;
			props: Record<string, unknown>;
			children: unknown[];
			textContent: () => string;
			textDeltas: () => Array<{ insert: string }>;
			tableRowCount: () => number;
			tableColumnCount: () => number;
			tableCell: () => null;
			tableRow: () => null;
			tableColumns: () => never[];
			databaseViews: () => never[];
			databasePrimaryViewId: () => null;
			databaseActiveView: () => null;
			prev?: unknown;
			next?: unknown;
		}> = [
				createMockBlockHandle({
					id: "block-1",
					type: "paragraph",
					props: {},
					children: [],
					textContent: () => "First",
					textDeltas: () => [{ insert: "First" }],
					prev: null,
					next: null,
				}),
				createMockBlockHandle({
					id: "block-2",
					type: "paragraph",
					props: {},
					children: [],
					textContent: () => "Second",
					textDeltas: () => [{ insert: "Second" }],
					prev: null,
					next: null,
				}),
				createMockBlockHandle({
					id: "block-3",
					type: "paragraph",
					props: {},
					children: [],
					textContent: () => "Third",
					textDeltas: () => [{ insert: "Third" }],
					prev: null,
					next: null,
				}),
			];
		blocks[0].next = blocks[1];
		blocks[1].prev = blocks[0];
		blocks[1].next = blocks[2];
		blocks[2].prev = blocks[1];

		const editor = {
			documentProfile: "structured",
			schema: defaultSchema,
			getSelection: () => ({
				type: "text",
				anchor: { blockId: "block-2", offset: 0 },
				focus: { blockId: "block-2", offset: 6 },
				isCollapsed: false,
				toRange: () => ({
					start: { blockId: "block-2", offset: 0 },
					end: { blockId: "block-2", offset: 6 },
					blockRange: ["block-2"],
				}),
			}),
			getSelectedText: () => "Second",
			getBlock: (blockId: string) => blocks.find((block) => block.id === blockId) ?? null,
			blocks: vi.fn(() => {
				throw new Error("Cursor context should not scan the full document.");
			}),
		} as unknown as Editor;

		const result = await getCursorContextTool(editor).handler({}, {} as never) as {
			surroundingBlocks: Array<{ id: string }>;
		};

		expect(result.surroundingBlocks.map((block) => block.id)).toEqual([
			"block-1",
			"block-2",
			"block-3",
		]);
	});

	it("inspects table targets with schema-aware details", async () => {
		const editor = createStructuredTargetEditor("table-1");

		const result = await inspectTargetTool(editor).handler({}, {} as never) as {
			target: {
				target: {
					kind: string;
					rowCount: number;
					columnCount: number;
				};
				validOperations: string[];
			} | null;
		};

		expect(result.target?.target).toMatchObject({
			kind: "table",
			rowCount: 3,
			columnCount: 2,
		});
		expect(result.target?.validOperations).toContain("insert_row");
		expect(result.target?.validOperations).toContain("set_cell_text");
	});

	it("inspects database targets with view metadata", async () => {
		const editor = createStructuredTargetEditor("database-1");

		const result = await inspectTargetTool(editor).handler({}, {} as never) as {
			target: {
				target: {
					kind: string;
					rowCount: number;
					activeViewId: string | null;
				};
				validOperations: string[];
			} | null;
		};

		expect(result.target?.target).toMatchObject({
			kind: "database",
			rowCount: 2,
			activeViewId: "view-1",
		});
		expect(result.target?.validOperations).toContain("add_column");
		expect(result.target?.validOperations).toContain("set_active_view");
	});

	it("returns no valid mutation operations for read-only targets", async () => {
		const editor = createStructuredTargetEditor("subdocument-1");

		const result = await listValidOperationsTool(editor).handler({}, {} as never) as {
			operations: string[];
		};

		expect(result.operations).toEqual([]);
	});

	it("rejects block mutations against read-only targets", async () => {
		const editor = createStructuredTargetEditor("subdocument-1");

		await expect(
			updateBlockTool(editor).handler(
				{
					blockId: "subdocument-1",
					props: { title: "Forbidden" },
				},
				{} as never,
			),
		).rejects.toThrow(
			'Block "subdocument-1" of type "subdocument" is not editable in structured documents.',
		);
		await expect(
			deleteBlockTool(editor).handler(
				{ blockId: "subdocument-1" },
				{} as never,
			),
		).rejects.toThrow(
			'Block "subdocument-1" of type "subdocument" is not editable in structured documents.',
		);
		await expect(
			moveBlockTool(editor).handler(
				{
					blockId: "subdocument-1",
					position: "last",
				},
				{} as never,
			),
		).rejects.toThrow(
			'Block "subdocument-1" of type "subdocument" is not editable in structured documents.',
		);

		expect(editor.apply).not.toHaveBeenCalled();
	});

	it("guards ToolContext block mutations with the same policy", () => {
		const editor = createStructuredTargetEditor("subdocument-1");
		const emit = vi.fn();
		const context = new ToolContextImpl(editor, "doc-1", emit);

		expect(() =>
			context.updateBlock("subdocument-1", { title: "Forbidden" }),
		).toThrow(
			'Block "subdocument-1" of type "subdocument" is not editable in structured documents.',
		);
		expect(() => context.deleteBlock("subdocument-1")).toThrow(
			'Block "subdocument-1" of type "subdocument" is not editable in structured documents.',
		);

		expect(emit).not.toHaveBeenCalled();
		expect(editor.apply).not.toHaveBeenCalled();
	});

	it("returns raw text when suggestions are included", async () => {
		const editor = createReadDocumentEditor();

		const result = await readDocumentTool(editor).handler(
			{
				format: "json",
				includeSuggestions: true,
			},
			{} as never,
		) as {
			viewMode: string;
			blocks: Array<{ id: string; content: string }>;
		};

		expect(result.viewMode).toBe("raw");
		expect(result.blocks.find((block) => block.id === "block-2")?.content).toBe(
			"Second draft",
		);
	});

	it("includes nested blocks when reading document ranges", async () => {
		const editor = createNestedDocumentEditor();

		const result = await readDocumentTool(editor).handler(
			{ format: "summary" },
			{} as never,
		) as {
			preview: Array<{ id: string }>;
		};

		expect(result.preview.map((block) => block.id)).toEqual([
			"heading-1",
			"layout-1",
			"paragraph-1",
		]);
	});

	it("searches nested blocks through the shared document traversal", async () => {
		const editor = createNestedDocumentEditor();

		const result = await searchDocumentTool(editor).handler(
			{ query: "stable block identity" },
			{} as never,
		) as Array<{ blockId: string }>;

		expect(result).toEqual([
			expect.objectContaining({ blockId: "paragraph-1" }),
		]);
	});

	it("retrieves ranked spans with nested-block and heading metadata", async () => {
		const editor = createNestedDocumentEditor();

		const result = await retrieveDocumentSpansTool(editor).handler(
			{
				query: "stable block identity architecture",
				activeBlockId: "paragraph-1",
				targetBlockId: "paragraph-1",
			},
			{} as never,
		) as {
			spans: Array<{
				id: string;
				blockIds: string[];
				headingPath: string[];
				score: number;
			}>;
		};

		expect(result.spans[0]).toMatchObject({
			id: "span:paragraph-1",
			blockIds: ["heading-1", "layout-1", "paragraph-1"],
			range: {
				startBlockId: "heading-1",
				endBlockId: "paragraph-1",
			},
			headingPath: ["Architecture"],
		});
		expect(result.spans[0]?.score).toBeGreaterThan(0);
	});

	it("rejects invalid tool inputs at the document-ops runtime boundary", async () => {
		const runtime = new ToolRuntimeImpl();
		const searchEditor = createReadDocumentEditor();
		const mutationEditor = createStructuredTargetEditor("paragraph-1");
		runtime.registerTool(searchDocumentTool(searchEditor));
		runtime.registerTool(retrieveDocumentSpansTool(searchEditor));
		runtime.registerTool(moveBlockTool(mutationEditor));
		runtime.registerTool(writeDocumentTool(mutationEditor));

		await expect(
			runtime.executeTool(
				"search_document",
				{
					query: "",
					maxResults: 0,
				},
				{} as never,
			),
		).rejects.toThrow('Invalid input for tool "search_document"');
		await expect(
			runtime.executeTool(
				"retrieve_document_spans",
				{
					query: "",
					maxResults: 99,
				},
				{} as never,
			),
		).rejects.toThrow('Invalid input for tool "retrieve_document_spans"');
		await expect(
			runtime.executeTool(
				"move_block",
				{
					blockId: "paragraph-1",
					position: {
						after: "",
					},
				},
				{} as never,
			),
		).rejects.toThrow('Invalid input for tool "move_block"');
		await expect(
			runtime.executeTool(
				"write_document",
				{
					content: "Hello",
					position: {
						parent: "paragraph-1",
						index: -1,
					},
				},
				{} as never,
			),
		).rejects.toThrow('Invalid input for tool "write_document"');
	});
});
