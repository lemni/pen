import { describe, it, expect } from "vitest";
import { blocksToOps, createEditor } from "@pen/core";
import type { HTMLImportElement, SchemaRegistry } from "@pen/core";
import { createDefaultSchema } from "@pen/schema-default";
import { htmlExporter } from "@pen/export-html";
import { htmlImporter, parseHtmlToBlocks } from "../importer";
import { sanitizeHTML } from "../sanitize";
import { parseHTML } from "../domAdapter";
import { domToBlocks } from "../domToBlocks";
import { parseInlineContent } from "../inlineParser";
import type { DOMNode } from "../domAdapter";

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

function convert(html: string, registry: SchemaRegistry = stubRegistry) {
	const sanitized = sanitizeHTML(html);
	const dom = parseHTML(sanitized);
	return domToBlocks(dom, registry);
}

function databaseEditor() {
	const editor = createEditor({
		schema: defaultRegistry,
		without: ["document-ops", "delta-stream", "undo"],
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

describe("sanitizeHTML", () => {
	it("strips <script> tags (AC 29, 42)", () => {
		const result = sanitizeHTML('<p>safe</p><script>alert("xss")</script>');
		expect(result).not.toContain("script");
		expect(result).toContain("safe");
	});

	it("strips <style> tags (AC 42)", () => {
		const result = sanitizeHTML("<p>text</p><style>body{color:red}</style>");
		expect(result).not.toContain("style>");
		expect(result).toContain("text");
	});

	it("strips <iframe> tags (AC 42)", () => {
		const result = sanitizeHTML('<iframe src="evil.com"></iframe><p>ok</p>');
		expect(result).not.toContain("iframe");
		expect(result).toContain("ok");
	});

	it("strips event handler attributes (AC 42)", () => {
		const result = sanitizeHTML('<div onclick="alert(1)">text</div>');
		expect(result).not.toContain("onclick");
		expect(result).toContain("text");
	});

	it("handles javascript: URLs (AC 31)", () => {
		const result = sanitizeHTML('<a href="javascript:void(0)">link</a>');
		expect(result).not.toContain("javascript:");
	});

	it("preserves allowed tags", () => {
		const result = sanitizeHTML("<p><strong>bold</strong></p>");
		expect(result).toContain("<strong>");
		expect(result).toContain("bold");
	});

	it("preserves img with allowed attributes", () => {
		const result = sanitizeHTML('<img src="photo.jpg" alt="photo" />');
		expect(result).toContain("src");
		expect(result).toContain("alt");
	});

	it("only preserves the inline styles the importer understands", () => {
		const result = sanitizeHTML(
			'<p style="color: red; position: fixed; background-color: blue; z-index: 1">styled</p>',
		);
		expect(result).toContain('style="color: red; background-color: blue"');
		expect(result).not.toContain("position:");
		expect(result).not.toContain("z-index:");
	});
});

describe("parseInlineContent", () => {
	it("extracts text from text nodes", () => {
		const node: DOMNode = { type: "text", textContent: "hello" };
		const result = parseInlineContent(node);
		expect(result.text).toBe("hello");
		expect(result.marks).toHaveLength(0);
	});

	it("extracts bold mark", () => {
		const node: DOMNode = {
			type: "element",
			tagName: "strong",
			children: [{ type: "text", textContent: "bold" }],
		};
		const result = parseInlineContent(node);
		expect(result.text).toBe("bold");
		expect(result.marks).toHaveLength(1);
		expect(result.marks[0]).toMatchObject({
			type: "bold",
			start: 0,
			end: 4,
		});
	});

	it("extracts link mark with href", () => {
		const node: DOMNode = {
			type: "element",
			tagName: "a",
			attributes: { href: "https://example.com", title: "Example" },
			children: [{ type: "text", textContent: "link" }],
		};
		const result = parseInlineContent(node);
		expect(result.text).toBe("link");
		expect(result.marks[0]).toMatchObject({
			type: "link",
			props: { href: "https://example.com", title: "Example" },
		});
	});

	it("handles nested marks", () => {
		const node: DOMNode = {
			type: "element",
			tagName: "strong",
			children: [
				{
					type: "element",
					tagName: "em",
					children: [{ type: "text", textContent: "both" }],
				},
			],
		};
		const result = parseInlineContent(node);
		expect(result.text).toBe("both");
		expect(result.marks).toHaveLength(2);
		expect(result.marks.some((m) => m.type === "bold")).toBe(true);
		expect(result.marks.some((m) => m.type === "italic")).toBe(true);
	});
});

describe("@pen/import-html dom-to-blocks", () => {
	it("heading + paragraph (AC 28)", () => {
		const blocks = convert("<h1>Title</h1><p>Body</p>");

		expect(blocks).toHaveLength(2);
		expect(blocks[0]).toMatchObject({
			type: "heading",
			props: { level: 1 },
			content: "Title",
		});
		expect(blocks[1]).toMatchObject({
			type: "paragraph",
			content: "Body",
		});
	});

	it("script tag is stripped (AC 29)", () => {
		const blocks = convert('<script>alert("xss")</script><p>safe</p>');

		const types = blocks.map((b) => b.type);
		expect(types).not.toContain("script");
		expect(blocks.some((b) => b.content === "safe")).toBe(true);
	});

	it("event handler stripped, text preserved (AC 30)", () => {
		const blocks = convert('<div onclick="alert(1)">text</div>');

		expect(blocks.length).toBeGreaterThanOrEqual(1);
		const hasText = blocks.some(
			(b) => b.content?.includes("text"),
		);
		expect(hasText).toBe(true);
	});

	it("bold mark from <strong> (AC 32)", () => {
		const blocks = convert("<p><strong>bold</strong></p>");

		expect(blocks).toHaveLength(1);
		expect(blocks[0].content).toBe("bold");
		expect(blocks[0].marks?.some((m) => m.type === "bold")).toBe(true);
	});

	it("italic mark from <em> (AC 33)", () => {
		const blocks = convert("<p><em>italic</em></p>");

		expect(blocks).toHaveLength(1);
		expect(blocks[0].content).toBe("italic");
		expect(blocks[0].marks?.some((m) => m.type === "italic")).toBe(true);
	});

	it("link mark with href (AC 34)", () => {
		const blocks = convert('<p><a href="https://example.com">text</a></p>');

		expect(blocks).toHaveLength(1);
		expect(blocks[0].content).toBe("text");
		const linkMark = blocks[0].marks?.find((m) => m.type === "link");
		expect(linkMark).toBeDefined();
		expect(linkMark!.props!.href).toBe("https://example.com");
	});

	it("bullet list items (AC 35)", () => {
		const blocks = convert("<ul><li>a</li><li>b</li></ul>");

		expect(blocks).toHaveLength(2);
		expect(blocks[0]).toMatchObject({
			type: "bulletListItem",
			content: "a",
		});
		expect(blocks[1]).toMatchObject({
			type: "bulletListItem",
			content: "b",
		});
	});

	it("numbered list items (AC 36)", () => {
		const blocks = convert("<ol><li>a</li><li>b</li></ol>");

		expect(blocks).toHaveLength(2);
		expect(blocks[0]).toMatchObject({
			type: "numberedListItem",
			content: "a",
		});
		expect(blocks[1]).toMatchObject({
			type: "numberedListItem",
			content: "b",
		});
	});

	it("nested list with indent (AC 37)", () => {
		const blocks = convert(
			"<ul><li>a<ul><li>b</li></ul></li></ul>",
		);

		expect(blocks).toHaveLength(2);
		expect(blocks[0]).toMatchObject({
			type: "bulletListItem",
			content: "a",
			props: { indent: 0 },
		});
		expect(blocks[1]).toMatchObject({
			type: "bulletListItem",
			content: "b",
			props: { indent: 1 },
		});
	});

	it("code block with language (AC 38)", () => {
		const blocks = convert(
			'<pre><code class="language-js">const x = 1;</code></pre>',
		);

		expect(blocks).toHaveLength(1);
		expect(blocks[0]).toMatchObject({
			type: "codeBlock",
			props: { language: "js" },
			content: "const x = 1;",
		});
	});

	it("hr → divider (AC 39)", () => {
		const blocks = convert("<hr />");

		expect(blocks).toHaveLength(1);
		expect(blocks[0].type).toBe("divider");
	});

	it("image with props (AC 40)", () => {
		const blocks = convert('<img src="url" alt="text" title="cap" />');

		expect(blocks).toHaveLength(1);
		expect(blocks[0]).toMatchObject({
			type: "image",
			props: { src: "url", alt: "text", caption: "cap" },
		});
	});

	it("heading levels 1-6", () => {
		const blocks = convert(
			"<h1>H1</h1><h2>H2</h2><h3>H3</h3><h4>H4</h4><h5>H5</h5><h6>H6</h6>",
		);

		expect(blocks).toHaveLength(6);
		for (let i = 0; i < 6; i++) {
			expect(blocks[i].type).toBe("heading");
			expect(blocks[i].props.level).toBe(i + 1);
		}
	});

	it("div content is unwrapped (block container)", () => {
		const blocks = convert("<div><p>inner</p></div>");

		expect(blocks).toHaveLength(1);
		expect(blocks[0]).toMatchObject({
			type: "paragraph",
			content: "inner",
		});
	});

	it("table with header (AC 40 extension)", () => {
		const blocks = convert(
			"<table><thead><tr><th>A</th><th>B</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table>",
		);

		expect(blocks).toHaveLength(1);
		expect(blocks[0].type).toBe("table");
		expect(blocks[0].props.hasHeaderRow).toBe(true);
		expect(blocks[0].children).toHaveLength(2);
	});

	it("round-trips exported database HTML back into a database block", async () => {
		const source = databaseEditor();
		const html = await htmlExporter.export(source);

		const blocks = convert(html, defaultRegistry);
		const databaseBlock = blocks.find((block) => block.type === "database");
		expect(databaseBlock).toMatchObject({
			type: "database",
			props: { title: "Roadmap", dataSource: "local" },
		});
		expect(databaseBlock?.database).toEqual(
			expect.objectContaining({
				primaryViewId: expect.any(String),
				columns: [
					expect.objectContaining({ id: "name", title: "Name", type: "text" }),
					expect.objectContaining({ id: "tags", title: "Tags", type: "multiSelect" }),
					expect.objectContaining({ id: "done", title: "Done", type: "checkbox" }),
				],
				rows: expect.arrayContaining([
					expect.objectContaining({
						id: expect.any(String),
						values: {
							name: "Ship importer",
							tags: JSON.stringify(["feature"]),
							done: "false",
						},
					}),
				]),
			}),
		);

		const target = createEditor({
			schema: defaultRegistry,
			without: ["document-ops", "delta-stream", "undo"],
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

	it("preserves intentionally empty database rows when round-tripping HTML", async () => {
		const source = databaseEditor();
		source.apply([{
			type: "database-insert-row",
			blockId: "d1",
			rowId: "empty-row",
		}]);
		const html = await htmlExporter.export(source);

		const blocks = convert(html, defaultRegistry);
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
			without: ["document-ops", "delta-stream", "undo"],
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

	it("imports typed HTML tables as database blocks without Pen payload", () => {
		const blocks = convert(
			'<table><thead><tr><th data-col-id="name" data-col-type="text">Name</th><th data-col-id="status" data-col-type="select" data-col-options="%5B%7B%22id%22%3A%22todo%22%2C%22value%22%3A%22Todo%22%7D%5D">Status</th></tr></thead><tbody><tr><td>Ship it</td><td>todo</td></tr></tbody></table>',
			defaultRegistry,
		);

		expect(blocks).toHaveLength(1);
		expect(blocks[0]).toMatchObject({
			type: "database",
			props: { title: "Untitled", dataSource: "local" },
			database: {
				columns: [
					expect.objectContaining({ id: "name", title: "Name", type: "text" }),
					expect.objectContaining({
						id: "status",
						title: "Status",
						type: "select",
						options: [{ id: "todo", value: "Todo" }],
					}),
				],
				rows: [
					expect.objectContaining({
						values: { name: "Ship it", status: "todo" },
					}),
				],
			},
		});
	});

	it("coerces select labels to option IDs during typed HTML import", () => {
		const blocks = convert(
			'<table><thead><tr><th data-col-id="name" data-col-type="text">Name</th><th data-col-id="status" data-col-type="select" data-col-options="%5B%7B%22id%22%3A%22todo%22%2C%22value%22%3A%22Todo%22%7D%2C%7B%22id%22%3A%22done%22%2C%22value%22%3A%22Done%22%7D%5D">Status</th></tr></thead><tbody><tr><td>Task A</td><td>Todo</td></tr><tr><td>Task B</td><td>done</td></tr></tbody></table>',
			defaultRegistry,
		);

		expect(blocks).toHaveLength(1);
		const rows = blocks[0].database!.rows;
		expect(rows[0].values.status).toBe("todo");
		expect(rows[1].values.status).toBe("done");
	});

	it("coerces multiSelect labels to option IDs during typed HTML import", () => {
		const blocks = convert(
			'<table><thead><tr><th data-col-id="tags" data-col-type="multiSelect" data-col-options="%5B%7B%22id%22%3A%22bug%22%2C%22value%22%3A%22Bug%22%7D%2C%7B%22id%22%3A%22feat%22%2C%22value%22%3A%22Feature%22%7D%5D">Tags</th></tr></thead><tbody><tr><td>Bug, Feature</td></tr></tbody></table>',
			defaultRegistry,
		);

		expect(blocks).toHaveLength(1);
		const rows = blocks[0].database!.rows;
		expect(rows[0].values.tags).toBe(JSON.stringify(["bug", "feat"]));
	});

	it("preserves hidden and readonly false values during typed HTML import", () => {
		const blocks = convert(
			'<table><thead><tr><th data-col-id="a" data-col-type="text" data-col-hidden="false" data-col-readonly="false">A</th></tr></thead><tbody><tr><td>x</td></tr></tbody></table>',
			defaultRegistry,
		);

		expect(blocks).toHaveLength(1);
		const col = blocks[0].database!.columns[0];
		expect(col.hidden).toBe(false);
		expect(col.readonly).toBe(false);
	});

	it("blocksToOps generates correct ops (AC 41)", () => {
		const blocks = convert("<h1>Title</h1><p><strong>bold</strong></p>");
		const ops = blocksToOps(blocks);

		const insertBlocks = ops.filter((o) => o.type === "insert-block");
		expect(insertBlocks).toHaveLength(2);

		const formatTexts = ops.filter((o) => o.type === "format-text");
		expect(formatTexts.length).toBeGreaterThan(0);
		expect(formatTexts[0].marks).toHaveProperty("bold");
	});

	it("inline-only at block level wraps in paragraph", () => {
		const dom = parseHTML("<strong>bold at root</strong>");
		const blocks = domToBlocks(dom, stubRegistry);

		expect(blocks.some((b) => b.type === "paragraph" && b.content?.includes("bold at root"))).toBe(true);
	});

	it("server-side parsing produces identical blocks as browser-side for same input (AC 43)", () => {
		const inputs = [
			"<h1>Title</h1><p>Body</p>",
			"<ul><li>a</li><li>b</li></ul>",
			'<pre><code class="language-js">const x = 1;</code></pre>',
			"<hr />",
			'<img src="url" alt="text" />',
			"<p><strong>bold</strong> and <em>italic</em></p>",
		];

		for (const html of inputs) {
			const sanitized = sanitizeHTML(html);
			const dom = parseHTML(sanitized);
			const blocks = domToBlocks(dom, stubRegistry);

			expect(blocks.length).toBeGreaterThan(0);
			for (const block of blocks) {
				expect(block.type).toBeTruthy();
				expect(block.props).toBeDefined();
			}
		}
	});

	it("<details> → toggle block via schema fromHTML", () => {
		const blocks = convert(
			"<details><summary>Toggle title</summary></details>",
			defaultRegistry,
		);

		expect(blocks).toHaveLength(1);
		expect(blocks[0]).toMatchObject({
			type: "toggle",
			props: { open: false },
			content: "Toggle title",
		});
	});

	it("passes the public HTML import element to schema fromHTML hooks", () => {
		let receivedElement: HTMLImportElement | null = null;
		const registry: SchemaRegistry = {
			...stubRegistry,
			allBlocks: () => [{
				type: "custom",
				propSchema: {},
				content: "inline",
				serialize: {
					fromHTML(element: HTMLImportElement) {
						receivedElement = element;
						if (element.tagName !== "div") {
							return null;
						}
						return {
							type: "paragraph",
							props: {},
							content: element.getAttribute("data-title") ?? "",
						};
					},
				},
			}],
			resolve: (type) => (type === "custom" ? registry.allBlocks()[0] : null),
		};

		const blocks = convert('<div data-title="From hook"></div>', registry);

		expect(receivedElement).toMatchObject({
			type: "element",
			tagName: "div",
			attributes: { "data-title": "From hook" },
		});
		if (!receivedElement) {
			throw new Error("Expected schema fromHTML hook to receive an element");
		}
		const hookElement = receivedElement as unknown as HTMLImportElement;
		expect(hookElement.getAttribute("data-title")).toBe("From hook");
		expect(hookElement.hasAttribute("data-title")).toBe(true);
		expect(blocks).toMatchObject([
			{
				type: "paragraph",
				content: "From hook",
			},
		]);
	});

	it("<details open> → toggle block with open=true", () => {
		const blocks = convert(
			'<details open><summary>Open toggle</summary></details>',
			defaultRegistry,
		);

		expect(blocks).toHaveLength(1);
		expect(blocks[0]).toMatchObject({
			type: "toggle",
			props: { open: true },
			content: "Open toggle",
		});
	});

	it("preserves inline formatting inside an HTML toggle summary", () => {
		const blocks = convert(
			"<details><summary><strong>Bold</strong> and <em>italic</em></summary></details>",
			defaultRegistry,
		);

		expect(blocks).toHaveLength(1);
		expect(blocks[0]).toMatchObject({
			type: "toggle",
			content: "Bold and italic",
		});
		expect(blocks[0].marks?.some((mark) => mark.type === "bold")).toBe(true);
		expect(blocks[0].marks?.some((mark) => mark.type === "italic")).toBe(true);
	});

	it("<div class='callout callout-warning'> → callout block", () => {
		const blocks = convert(
			'<div class="callout callout-warning">Be careful</div>',
			defaultRegistry,
		);

		expect(blocks).toHaveLength(1);
		expect(blocks[0]).toMatchObject({
			type: "callout",
			props: { type: "warning" },
			content: "Be careful",
		});
	});

	it("<div class='callout callout-error'> → callout block", () => {
		const blocks = convert(
			'<div class="callout callout-error">Something failed</div>',
			defaultRegistry,
		);

		expect(blocks).toHaveLength(1);
		expect(blocks[0]).toMatchObject({
			type: "callout",
			props: { type: "error" },
			content: "Something failed",
		});
	});

	it("<div class='callout callout-info'> → callout block", () => {
		const blocks = convert(
			'<div class="callout callout-info">FYI</div>',
			defaultRegistry,
		);

		expect(blocks).toHaveLength(1);
		expect(blocks[0]).toMatchObject({
			type: "callout",
			props: { type: "info" },
			content: "FYI",
		});
	});

	it("<ol start='5'> preserves start value on first list item", () => {
		const blocks = convert('<ol start="5"><li>fifth</li><li>sixth</li></ol>');

		expect(blocks).toHaveLength(2);
		expect(blocks[0]).toMatchObject({
			type: "numberedListItem",
			content: "fifth",
			props: { indent: 0, start: 5 },
		});
		expect(blocks[1]).toMatchObject({
			type: "numberedListItem",
			content: "sixth",
			props: { indent: 0 },
		});
	});

	it("<ol> without start attribute does not set start", () => {
		const blocks = convert("<ol><li>first</li></ol>");

		expect(blocks).toHaveLength(1);
		expect(blocks[0].props.start).toBeUndefined();
	});

	it("keeps parseHtmlToBlocks parse-only in flow documents", () => {
		const source = databaseEditor();
		const html = htmlExporter.export(source);
		const editor = createEditor({
			schema: defaultRegistry,
			documentProfile: "flow",
			without: ["document-ops", "delta-stream", "undo"],
		});

		const blocks = parseHtmlToBlocks(`${html}<h2>Allowed</h2>`, editor);

		expect(blocks.some((block) => block.type === "database")).toBe(true);
		expect(blocks.some((block) => block.type === "heading")).toBe(true);

		source.destroy();
		editor.destroy();
	});

  it("does not emit normalization diagnostics during parseHtmlToBlocks", () => {
    const source = databaseEditor();
    const html = htmlExporter.export(source);
    const editor = createEditor({
      schema: defaultRegistry,
      documentProfile: "flow",
      without: ["document-ops", "delta-stream", "undo"],
    });
    const diagnostics: unknown[] = [];

    editor.on("diagnostic", (event) => {
      diagnostics.push(event);
    });

    parseHtmlToBlocks(`${html}<h2>Allowed</h2>`, editor);

    expect(diagnostics).toEqual([]);

    source.destroy();
    editor.destroy();
  });

	it("filters flow-disallowed blocks during direct HTML import into flow documents", async () => {
		const source = databaseEditor();
		const html = htmlExporter.export(source);
		const editor = createEditor({
			schema: defaultRegistry,
			documentProfile: "flow",
			without: ["document-ops", "delta-stream", "undo"],
		});

		await htmlImporter.import(`${html}<h2>Allowed</h2>`, editor);

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

  it("returns a structured import result for HTML imports with normalization", async () => {
    const source = databaseEditor();
    const html = htmlExporter.export(source);
    const editor = createEditor({
      schema: defaultRegistry,
      documentProfile: "flow",
      without: ["document-ops", "delta-stream", "undo"],
    });

    const result = await htmlImporter.import(`${html}<h2>Allowed</h2>`, editor);

    expect(result).toEqual({
      parsedTopLevelBlockCount: 3,
      importedTopLevelBlockCount: 2,
      droppedBlockCount: 1,
      droppedBlockTypes: ["database"],
      normalized: true,
    });

    source.destroy();
    editor.destroy();
  });
});
