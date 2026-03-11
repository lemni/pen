import { describe, expect, it } from "vitest";
import {
	SchemaRegistryImpl,
	mergeSchemas,
	suggestion,
} from "@pen/core";
import {
	defaultSchema,
	createDefaultSchema,
	paragraph,
	heading,
	bulletListItem,
	numberedListItem,
	checkListItem,
	codeBlock,
	image,
	table,
	divider,
	callout,
	toggle,
	blockquote,
	bold,
	italic,
	underline,
	strikethrough,
	highlight,
	textColor,
	backgroundColor,
	link,
	code,
	mention,
	inlineApp,
} from "@pen/schema-default";
import type { BlockSchema, InlineSchema } from "@pen/types";
import { defineBlock, prop } from "@pen/types";

describe("SchemaRegistryImpl", () => {
	// ── AC 1: resolves all default block and inline types ───
	describe("AC 1 — resolves all default block and inline types by name", () => {
		it("resolves all 14 default block types", () => {
			const blockTypes = [
				"paragraph",
				"heading",
				"bulletListItem",
				"numberedListItem",
				"checkListItem",
				"codeBlock",
				"image",
				"table",
				"database",
				"divider",
				"callout",
				"toggle",
				"blockquote",
				"subdocument",
			];

			for (const type of blockTypes) {
				const schema = defaultSchema.resolve(type);
				expect(schema, `expected resolve('${type}') to return a schema`).not.toBeNull();
				expect(schema!.type).toBe(type);
			}
		});

		it("resolves all 9 default inline marks", () => {
			const markTypes = [
				"bold",
				"italic",
				"underline",
				"strikethrough",
				"highlight",
				"textColor",
				"backgroundColor",
				"link",
				"code",
			];

			for (const type of markTypes) {
				const schema = defaultSchema.resolveInline(type);
				expect(schema, `expected resolveInline('${type}') to return a schema`).not.toBeNull();
				expect(schema!.type).toBe(type);
			}
		});

		it("resolves both default inline nodes", () => {
			const nodeTypes = ["mention", "inlineApp"];
			for (const type of nodeTypes) {
				const schema = defaultSchema.resolveInline(type);
				expect(schema).not.toBeNull();
				expect(schema!.type).toBe(type);
				expect(schema!.kind).toBe("node");
			}
		});
	});

	// ── AC 2: without removes types ─────────────────────────
	describe("AC 2 — without() removes types", () => {
		it("returns null for removed block type", () => {
			const schema = defaultSchema.without(["table"]);
			expect(schema.resolve("table")).toBeNull();
		});

		it("still resolves other block types", () => {
			const schema = defaultSchema.without(["table"]);
			expect(schema.resolve("paragraph")).not.toBeNull();
		});

		it("returns null for removed inline type", () => {
			const schema = defaultSchema.without(["bold"]);
			expect(schema.resolveInline("bold")).toBeNull();
		});
	});

	// ── AC 3: extend adds new types ─────────────────────────
	describe("AC 3 — extend() adds custom types", () => {
		it("resolves a custom block added via extend()", () => {
			const myBlock = defineBlock("myCustomBlock", {
				content: "inline",
				fieldEditor: "richtext",
				display: { title: "Custom" },
				serialize: {
					toMarkdown: () => "",
					toHTML: () => "<div></div>",
				},
			});
			const schema = defaultSchema.extend([myBlock as unknown as BlockSchema]);
			expect(schema.resolve("myCustomBlock")).not.toBeNull();
			expect(schema.resolve("myCustomBlock")!.type).toBe("myCustomBlock");
		});

		it("resolves a custom inline mark added via extend()", () => {
			const myMark: InlineSchema = {
				type: "customMark",
				propSchema: {},
				kind: "mark",
				expand: "after",
				priority: 150,
				serialize: {
					toMarkdown: (text) => text,
					toHTML: (text) => `<span>${text}</span>`,
				},
			};
			const schema = defaultSchema.extend([myMark]);
			expect(schema.resolveInline("customMark")).not.toBeNull();
		});

		it("keeps system marks added via extend protected from without()", () => {
			const customSystemMark: InlineSchema = {
				type: "customSystemMark",
				propSchema: {},
				kind: "mark",
				system: true,
				expand: "after",
				serialize: {
					toMarkdown: (text) => text,
					toHTML: (text) => text,
				},
			};
			const schema = defaultSchema
				.extend([customSystemMark])
				.without(["customSystemMark"]);
			const resolved = schema.resolveInline("customSystemMark");
			expect(resolved).not.toBeNull();
			expect(resolved!.system).toBe(true);
			expect(resolved!.expand).toBe("after");
		});

		it("extend with existing type replaces the schema", () => {
			const newParagraph = defineBlock("paragraph", {
				content: "inline",
				fieldEditor: "richtext",
				display: { title: "New Paragraph" },
				serialize: {
					toMarkdown: () => "new",
					toHTML: () => "<p>new</p>",
				},
			});
			const schema = defaultSchema.extend([newParagraph as unknown as BlockSchema]);
			expect(schema.resolve("paragraph")!.display?.title).toBe("New Paragraph");
		});
	});

	// ── AC 17: resolves correct counts ──────────────────────
	describe("AC 17 — resolves all 14 blocks, 9 marks, 2 nodes, 1 system mark", () => {
		it("has 14 block schemas", () => {
			expect(defaultSchema.allBlocks()).toHaveLength(14);
		});

		it("has 12 inline schemas (9 marks + 2 nodes + 1 system mark)", () => {
			const all = defaultSchema.allInlines();
			expect(all.length).toBe(12);
		});

		it("suggestion is resolvable as system mark", () => {
			const s = defaultSchema.resolveInline("suggestion");
			expect(s).not.toBeNull();
			expect(s!.system).toBe(true);
		});
	});

	// ── AC 18: mergeSchemas ─────────────────────────────────
	describe("AC 18 — mergeSchemas overrides", () => {
		it("later registry overrides earlier for same type", () => {
			const customHeading = defineBlock("heading", {
				content: "inline",
				fieldEditor: "richtext",
				display: { title: "Custom Heading" },
				serialize: {
					toMarkdown: () => "# custom",
					toHTML: () => "<h1>custom</h1>",
				},
			});
			const registryB = new SchemaRegistryImpl({
				blocks: [customHeading as unknown as BlockSchema],
			});

			const merged = mergeSchemas(defaultSchema, registryB);
			expect(merged.resolve("heading")!.display?.title).toBe("Custom Heading");
		});

		it("preserves schemas from first registry not overridden by second", () => {
			const registryB = new SchemaRegistryImpl({ blocks: [] });
			const merged = mergeSchemas(defaultSchema, registryB);
			expect(merged.resolve("paragraph")).not.toBeNull();
		});
	});

	// ── AC 19: allBlockDisplays ─────────────────────────────
	describe("AC 19 — allBlockDisplays returns visible block entries", () => {
		it("returns only visible entries with display metadata", () => {
			const displays = defaultSchema.allBlockDisplays();
			expect(displays).toHaveLength(13);
			expect(displays.map((entry) => entry.type)).not.toContain("subdocument");
			for (const entry of displays) {
				expect(entry.display).toBeDefined();
				expect(entry.display.title).toBeTruthy();
			}
		});
	});

	// ── AC 25: suggestion system mark ───────────────────────
	describe("AC 25 — suggestion system mark", () => {
		it("has system: true", () => {
			expect(suggestion.system).toBe(true);
		});

		it("has expand: none", () => {
			expect(suggestion.expand).toBe("none");
		});

		it("is always resolvable even after without()", () => {
			const schema = defaultSchema.without(["suggestion"]);
			expect(schema.resolveInline("suggestion")).not.toBeNull();
			expect(schema.resolveInline("suggestion")!.system).toBe(true);
		});
	});

	// ── Composition: override ───────────────────────────────
	describe("override()", () => {
		it("merges patch into existing block schema", () => {
			const schema = defaultSchema.override("heading", {
				display: { title: "Custom Heading" },
			} as Partial<BlockSchema>);
			expect(schema.resolve("heading")!.display?.title).toBe("Custom Heading");
		});

		it("throws for unknown type", () => {
			expect(() =>
				defaultSchema.override("unknown", {} as Partial<BlockSchema>),
			).toThrow("Cannot override unknown block type: unknown");
		});

		it("preserves serialize from original when patch.serialize partial", () => {
			const original = defaultSchema.resolve("heading")!;
			const schema = defaultSchema.override("heading", {
				serialize: { toMarkdown: () => "custom" },
			} as Partial<BlockSchema>);
			const merged = schema.resolve("heading")!;
			expect(merged.serialize.toMarkdown).toBeDefined();
			expect(merged.serialize.toHTML).toBe(original.serialize.toHTML);
		});
	});

	// ── Composition: overrideSystemMark ─────────────────────
	describe("overrideSystemMark()", () => {
		it("replaces system mark behavior", () => {
			const customSuggestion: InlineSchema = {
				type: "suggestion",
				propSchema: {},
				kind: "mark",
				expand: "after",
				serialize: {
					toMarkdown: (text) => text,
					toHTML: (text) => text,
				},
			};
			const schema = defaultSchema.overrideSystemMark(
				"suggestion",
				customSuggestion,
			);
			const resolved = schema.resolveInline("suggestion");
			expect(resolved!.system).toBe(true);
			expect(resolved!.expand).toBe("after");
		});
	});

	// ── Lookup: resolveLayout ───────────────────────────────
	describe("resolveLayout()", () => {
		it("returns null for M0 (no layout blocks)", () => {
			expect(defaultSchema.resolveLayout("paragraph")).toBeNull();
		});
	});

	// ── Lookup: resolveApp ──────────────────────────────────
	describe("resolveApp()", () => {
		it("returns null when no apps registered", () => {
			expect(defaultSchema.resolveApp("unknown")).toBeNull();
		});
	});

	// ── Lookup: onUnknownBlock ──────────────────────────────
	describe("onUnknownBlock handler", () => {
		it("returns null for drop", () => {
			const reg = new SchemaRegistryImpl({
				onUnknownBlock: () => "drop",
			});
			expect(reg.resolve("foo")).toBeNull();
		});

		it("returns passthrough schema for passthrough", () => {
			const reg = new SchemaRegistryImpl({
				onUnknownBlock: () => "passthrough",
			});
			const schema = reg.resolve("foo");
			expect(schema).not.toBeNull();
			expect(schema!.type).toBe("foo");
			expect(schema!.content).toBe("none");
		});

		it("returns custom schema from handler", () => {
			const custom = defineBlock("custom", {
				content: "none",
				fieldEditor: "none",
				serialize: {},
			});
			const reg = new SchemaRegistryImpl({
				onUnknownBlock: () => custom as unknown as BlockSchema,
			});
			expect(reg.resolve("anything")!.type).toBe("custom");
		});
	});
});
