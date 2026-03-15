import { describe, it, expect } from "vitest";
import { blocksToOps, createEditor } from "@pen/core";
import type { SchemaRegistry } from "@pen/types";
import { markdownExporter } from "@pen/export-markdown";
import { createDefaultSchema } from "@pen/schema-default";
import { markdownImporter, parseMarkdownToBlocks } from "../importer";

const noDefaultExtensionsPreset = {
	resolve() {
		return { extensions: [] };
	},
};

const stubRegistry: SchemaRegistry = {
	resolve: () => null,
	resolveInline: () => null,
	resolveApp: () => null,
	resolveLayout: () => null,
	allBlocks: () => [],
	allInlines: () => [],
	allApps: () => [],
	allBlockDisplays: () => [],
};

const defaultRegistry = createDefaultSchema();

function convert(md: string, registry: SchemaRegistry = stubRegistry) {
	return parseMarkdownToBlocks(md, {
		schema: registry,
	} as never);
}

function databaseEditor() {
	const editor = createEditor({
		schema: defaultRegistry,
		preset: noDefaultExtensionsPreset,
	});
	editor.apply([{
		type: "insert-block",
		blockId: "d1",
		blockType: "database",
		props: { title: "Roadmap", dataSource: "local" },
		position: "last",
	}]);
	editor.apply([{
		type: "update-table-columns",
		blockId: "d1",
		columns: [
			{ id: "name", title: "Name", type: "text" },
			{
				id: "tags",
				title: "Tags",
				type: "multiSelect",
				options: [
					{ id: "bug", value: "Bug", color: "red" },
					{ id: "feature", value: "Feature", color: "blue" },
				],
			},
			{ id: "done", title: "Done", type: "checkbox" },
		],
	}]);
	editor.apply([{
		type: "database-insert-row",
		blockId: "d1",
		rowId: "roadmap-1",
		values: {
			name: "Ship importer",
			tags: JSON.stringify(["Feature"]),
			done: "false",
		},
	}]);
	editor.apply([{
		type: "database-update-view",
		blockId: "d1",
		patch: {
			title: "Main",
			type: "table",
			visibleColumnIds: ["name", "tags"],
			columnOrder: ["name", "tags", "done"],
			sort: [{ columnId: "name", direction: "asc" }],
		},
	}]);
	return editor;
}

describe("@pen/import-markdown", () => {
	it("heading + paragraph (AC 16)", () => {
		const blocks = convert("# Hello\n\nWorld");

		expect(blocks).toHaveLength(2);
		expect(blocks[0].type).toBe("heading");
		expect(blocks[0].props.level).toBe(1);
		expect(blocks[0].content).toBe("Hello");
		expect(blocks[1].type).toBe("paragraph");
		expect(blocks[1].content).toBe("World");
	});

	it("bullet list items with nesting (AC 17)", () => {
		const blocks = convert("- item 1\n- item 2\n  - nested");

		expect(blocks).toHaveLength(3);
		expect(blocks[0]).toMatchObject({
			type: "bulletListItem",
			content: "item 1",
			props: { indent: 0 },
		});
		expect(blocks[1]).toMatchObject({
			type: "bulletListItem",
			content: "item 2",
			props: { indent: 0 },
		});
		expect(blocks[2]).toMatchObject({
			type: "bulletListItem",
			content: "nested",
			props: { indent: 1 },
		});
	});

	it("bold and italic marks (AC 18)", () => {
		const blocks = convert("**bold** and *italic*");

		expect(blocks).toHaveLength(1);
		expect(blocks[0].type).toBe("paragraph");
		expect(blocks[0].content).toBe("bold and italic");

		const marks = blocks[0].marks!;
		const boldMark = marks.find((m) => m.type === "bold");
		const italicMark = marks.find((m) => m.type === "italic");

		expect(boldMark).toBeDefined();
		expect(boldMark!.start).toBe(0);
		expect(boldMark!.end).toBe(4);

		expect(italicMark).toBeDefined();
		expect(italicMark!.start).toBe(9);
		expect(italicMark!.end).toBe(15);
	});

	it("link mark with href (AC 19)", () => {
		const blocks = convert("[link](https://example.com)");

		expect(blocks).toHaveLength(1);
		expect(blocks[0].content).toBe("link");

		const linkMark = blocks[0].marks!.find((m) => m.type === "link");
		expect(linkMark).toBeDefined();
		expect(linkMark!.props!.href).toBe("https://example.com");
		expect(linkMark!.start).toBe(0);
		expect(linkMark!.end).toBe(4);
	});

	it("inline code mark (AC 20)", () => {
		const blocks = convert("`code`");

		expect(blocks).toHaveLength(1);
		expect(blocks[0].content).toBe("code");

		const codeMark = blocks[0].marks!.find((m) => m.type === "code");
		expect(codeMark).toBeDefined();
		expect(codeMark!.start).toBe(0);
		expect(codeMark!.end).toBe(4);
	});

	it("strikethrough mark via GFM (AC 21)", () => {
		const blocks = convert("~~strike~~");

		expect(blocks).toHaveLength(1);
		expect(blocks[0].content).toBe("strike");

		const strikeMark = blocks[0].marks!.find(
			(m) => m.type === "strikethrough",
		);
		expect(strikeMark).toBeDefined();
		expect(strikeMark!.start).toBe(0);
		expect(strikeMark!.end).toBe(6);
	});

	it("check list items (AC 22)", () => {
		const blocks = convert("- [ ] unchecked\n- [x] checked");

		expect(blocks).toHaveLength(2);
		expect(blocks[0]).toMatchObject({
			type: "checkListItem",
			content: "unchecked",
			props: { indent: 0, checked: false },
		});
		expect(blocks[1]).toMatchObject({
			type: "checkListItem",
			content: "checked",
			props: { indent: 0, checked: true },
		});
	});

	it("fenced code block with language (AC 23)", () => {
		const blocks = convert("```javascript\nconst x = 1;\n```");

		expect(blocks).toHaveLength(1);
		expect(blocks[0].type).toBe("codeBlock");
		expect(blocks[0].props.language).toBe("javascript");
		expect(blocks[0].content).toBe("const x = 1;");
	});

	it("thematic break → divider (AC 24)", () => {
		const blocks = convert("---");

		expect(blocks).toHaveLength(1);
		expect(blocks[0].type).toBe("divider");
	});

	it("image block with src and alt (AC 25)", () => {
		const blocks = convert('![alt text](https://example.com/img.png "title")');

		expect(blocks).toHaveLength(1);
		expect(blocks[0].type).toBe("image");
		expect(blocks[0].props.src).toBe("https://example.com/img.png");
		expect(blocks[0].props.alt).toBe("alt text");
		expect(blocks[0].props.caption).toBe("title");
	});

	it("GFM table with header (AC 26)", () => {
		const blocks = convert("| A | B |\n|---|---|\n| 1 | 2 |");

		expect(blocks).toHaveLength(1);
		expect(blocks[0].type).toBe("table");
		expect(blocks[0].props.hasHeaderRow).toBe(true);
		expect(blocks[0].children).toHaveLength(2);
		expect(blocks[0].children![0].type).toBe("__table_row");
		expect(blocks[0].children![0].children).toHaveLength(2);
	});

	it("round-trips exported database markdown back into a database block", async () => {
		const source = databaseEditor();
		const markdown = await markdownExporter.export(source);

		const blocks = convert(markdown, defaultRegistry);
		const databaseBlock = blocks.find((block) => block.type === "database");
		expect(databaseBlock).toMatchObject({
			type: "database",
			props: { title: "Roadmap", dataSource: "local" },
		});
		expect(databaseBlock?.database).toEqual(
			expect.objectContaining({
				primaryViewId: expect.any(String),
				rows: [
					expect.objectContaining({
						id: expect.any(String),
						values: {
							name: "Ship importer",
							tags: JSON.stringify(["feature"]),
							done: "false",
						},
					}),
				],
			}),
		);

		const target = createEditor({
			schema: defaultRegistry,
			preset: noDefaultExtensionsPreset,
		});
		const ops = blocksToOps(blocks);
		target.apply(ops, { origin: "import", undoGroup: true });
		const imported = Array.from(target.documentState.allBlocks()).find(
			(block) => block.type === "database",
		);
		expect(imported?.props.title).toBe("Roadmap");
		expect(imported?.tableColumns().map((column) => column.id)).toEqual(["name", "tags", "done"]);
		expect(imported?.tableRow(0)?.id).toEqual(expect.any(String));
		expect(imported?.tableCell(0, 1)?.textContent()).toBe(JSON.stringify(["feature"]));
		expect(imported?.databaseActiveView()).toEqual(
			expect.objectContaining({
				title: "Main",
				visibleColumnIds: ["name", "tags"],
				columnOrder: ["name", "tags", "done"],
			}),
		);

		source.destroy();
		target.destroy();
	});

	it("preserves intentionally empty database rows when round-tripping markdown", async () => {
		const source = databaseEditor();
		source.apply([{
			type: "database-insert-row",
			blockId: "d1",
			rowId: "empty-row",
		}]);
		const markdown = await markdownExporter.export(source);

		const blocks = convert(markdown, defaultRegistry);
		const databaseBlock = blocks.find((block) => block.type === "database");
		expect(databaseBlock?.database?.rows).toEqual([
			expect.objectContaining({
				values: {
					name: "Ship importer",
					tags: JSON.stringify(["feature"]),
					done: "false",
				},
			}),
			{
				id: "empty-row",
				values: {
					name: "",
					tags: "",
					done: "",
				},
			},
		]);

		const target = createEditor({
			schema: defaultRegistry,
			preset: noDefaultExtensionsPreset,
		});
		target.apply(blocksToOps(blocks), { origin: "import", undoGroup: true });

		const imported = Array.from(target.documentState.allBlocks()).find(
			(block) => block.type === "database",
		);
		expect(imported?.tableRowCount()).toBe(2);
		expect(imported?.tableRow(1)?.id).toBe("empty-row");
		expect(imported?.tableCell(1, 0)?.textContent()).toBe("");
		expect(imported?.tableCell(1, 1)?.textContent()).toBe("");
		expect(imported?.tableCell(1, 2)?.textContent()).toBe("");

		source.destroy();
		target.destroy();
	});

	it("numbered list items", () => {
		const blocks = convert("1. first\n2. second\n3. third");

		expect(blocks).toHaveLength(3);
		expect(blocks[0]).toMatchObject({
			type: "numberedListItem",
			content: "first",
			props: { indent: 0 },
		});
		expect(blocks[1]).toMatchObject({
			type: "numberedListItem",
			content: "second",
			props: { indent: 0 },
		});
	});

	it("blockquote", () => {
		const blocks = convert("> quoted text");

		expect(blocks).toHaveLength(1);
		expect(blocks[0].type).toBe("blockquote");
		expect(blocks[0].content).toBe("quoted text");
	});

	it("heading levels 1-6", () => {
		const blocks = convert("# H1\n\n## H2\n\n### H3\n\n#### H4\n\n##### H5\n\n###### H6");

		expect(blocks).toHaveLength(6);
		for (let i = 0; i < 6; i++) {
			expect(blocks[i].type).toBe("heading");
			expect(blocks[i].props.level).toBe(i + 1);
		}
	});

	it("overlapping marks", () => {
		const blocks = convert("**bold and *both***");

		expect(blocks).toHaveLength(1);
		const marks = blocks[0].marks!;
		expect(marks.some((m) => m.type === "bold")).toBe(true);
		expect(marks.some((m) => m.type === "italic")).toBe(true);
	});

	it("blocksToOps generates correct ops", () => {
		const blocks = convert("# Title\n\nHello **world**");
		const ops = blocksToOps(blocks);

		const insertBlocks = ops.filter((o) => o.type === "insert-block");
		expect(insertBlocks).toHaveLength(2);
		expect(insertBlocks[0].blockType).toBe("heading");
		expect(insertBlocks[1].blockType).toBe("paragraph");

		const insertTexts = ops.filter((o) => o.type === "insert-text");
		expect(insertTexts).toHaveLength(2);

		const formatTexts = ops.filter((o) => o.type === "format-text");
		expect(formatTexts.length).toBeGreaterThan(0);
		expect(formatTexts[0].marks).toHaveProperty("bold");
	});

	it("all blocks in single undo group (AC 27)", () => {
		const blocks = convert("# Title\n\nParagraph\n\n- item");
		const ops = blocksToOps(blocks);

		expect(ops.length).toBeGreaterThan(0);
		expect(ops.every((o) => o.type === "insert-block" || o.type === "insert-text" || o.type === "format-text")).toBe(true);
	});

	it("> **Note:** text → callout block via schema fromMarkdown", () => {
		const blocks = convert("> **Note:** This is important", defaultRegistry);

		expect(blocks).toHaveLength(1);
		expect(blocks[0]).toMatchObject({
			type: "callout",
			props: { type: "info" },
		});
		expect(blocks[0].content).toContain("This is important");
	});

	it("> **Warning:** text → callout with warning type", () => {
		const blocks = convert("> **Warning:** Be careful here", defaultRegistry);

		expect(blocks).toHaveLength(1);
		expect(blocks[0]).toMatchObject({
			type: "callout",
			props: { type: "warning" },
		});
	});

	it("> **Error:** text → callout with error type", () => {
		const blocks = convert("> **Error:** Something went wrong", defaultRegistry);

		expect(blocks).toHaveLength(1);
		expect(blocks[0]).toMatchObject({
			type: "callout",
			props: { type: "error" },
		});
	});

	it("preserves inline formatting after a markdown callout prefix", () => {
		const blocks = convert(
			"> **Note:** This is *very* [important](https://example.com)",
			defaultRegistry,
		);

		expect(blocks).toHaveLength(1);
		expect(blocks[0]).toMatchObject({
			type: "callout",
			props: { type: "info" },
			content: "This is very important",
		});

		const italicMark = blocks[0].marks?.find((mark) => mark.type === "italic");
		expect(italicMark).toMatchObject({ start: 8, end: 12 });

		const linkMark = blocks[0].marks?.find((mark) => mark.type === "link");
		expect(linkMark).toMatchObject({
			start: 13,
			end: 22,
			props: { href: "https://example.com" },
		});
	});

	it("preserves inline formatting inside a toggle summary HTML block", () => {
		const blocks = convert(
			"<details><summary><em>Very</em> <a href=\"https://example.com\">important</a></summary></details>",
			defaultRegistry,
		);

		expect(blocks).toHaveLength(1);
		expect(blocks[0]).toMatchObject({
			type: "toggle",
			props: { open: false },
			content: "Very important",
		});

		const italicMark = blocks[0].marks?.find((mark) => mark.type === "italic");
		expect(italicMark).toMatchObject({ start: 0, end: 4 });

		const linkMark = blocks[0].marks?.find((mark) => mark.type === "link");
		expect(linkMark).toMatchObject({
			start: 5,
			end: 14,
			props: { href: "https://example.com" },
		});
	});

	it("plain blockquote stays blockquote (not callout)", () => {
		const blocks = convert("> Just a regular quote", defaultRegistry);

		expect(blocks).toHaveLength(1);
		expect(blocks[0].type).toBe("blockquote");
	});

	it("keeps parseMarkdownToBlocks parse-only in flow documents", () => {
		const source = databaseEditor();
		const markdown = markdownExporter.export(source);
		const editor = createEditor({
			schema: defaultRegistry,
			documentProfile: "flow",
			preset: noDefaultExtensionsPreset,
		});

		const blocks = parseMarkdownToBlocks(`${markdown}\n\n## Allowed`, editor);

		expect(blocks.map((block) => block.type)).toEqual(["database", "heading"]);

		source.destroy();
		editor.destroy();
	});

  it("does not emit normalization diagnostics during parseMarkdownToBlocks", () => {
    const source = databaseEditor();
    const markdown = markdownExporter.export(source);
    const editor = createEditor({
      schema: defaultRegistry,
      documentProfile: "flow",
      preset: noDefaultExtensionsPreset,
    });
    const diagnostics: unknown[] = [];

    editor.on("diagnostic", (event) => {
      diagnostics.push(event);
    });

    parseMarkdownToBlocks(`${markdown}\n\n## Allowed`, editor);

    expect(diagnostics).toEqual([]);

    source.destroy();
    editor.destroy();
  });

	it("filters flow-disallowed blocks during direct markdown import into flow documents", () => {
		const source = databaseEditor();
		const markdown = markdownExporter.export(source);
		const editor = createEditor({
			schema: defaultRegistry,
			documentProfile: "flow",
			preset: noDefaultExtensionsPreset,
		});

		markdownImporter.import(`${markdown}\n\n## Allowed`, editor);

		const blockOrder = editor.documentState.blockOrder;
		expect(
			blockOrder.some((blockId) => editor.getBlock(blockId)?.type === "heading"),
		).toBe(true);
		expect(
			blockOrder.some((blockId) => editor.getBlock(blockId)?.type === "database"),
		).toBe(false);

		source.destroy();
		editor.destroy();
	});

  it("returns a structured import result for markdown imports with normalization", () => {
    const source = databaseEditor();
    const markdown = markdownExporter.export(source);
    const editor = createEditor({
      schema: defaultRegistry,
      documentProfile: "flow",
      preset: noDefaultExtensionsPreset,
    });

    const result = markdownImporter.import(`${markdown}\n\n## Allowed`, editor);

    expect(result).toEqual({
      parsedTopLevelBlockCount: 2,
      importedTopLevelBlockCount: 1,
      droppedBlockCount: 1,
      droppedBlockTypes: ["database"],
      normalized: true,
    });

    source.destroy();
    editor.destroy();
  });
});
