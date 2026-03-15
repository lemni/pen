import { describe, expect, it } from "vitest";
import { createEditor } from "@pen/core";
import { buildDocumentMutationPlanExecution } from "../planExecutor";

const noDefaultExtensionsPreset = {
	resolve() {
		return { extensions: [] };
	},
};

function createPlanExecutorEditor() {
	return createEditor({
		preset: noDefaultExtensionsPreset,
	});
}

describe("document mutation plan executor", () => {
	it("builds replace-text ops for text edit plans", () => {
		const editor = createPlanExecutorEditor();
		const blockId = editor.firstBlock()!.id;
		editor.apply(
			[{ type: "insert-text", blockId, offset: 0, text: "Hello world" }],
			{ origin: "system" },
		);

		const execution = buildDocumentMutationPlanExecution(editor, {
			kind: "text_edit",
			target: {
				blockId,
				range: {
					startOffset: 6,
					endOffset: 11,
				},
			},
			operation: "replace",
			text: "planet",
		});

		expect(execution.reviewSafe).toBe(true);
		expect(execution.issues).toEqual([]);
		expect(execution.ops).toEqual([
			{
				type: "replace-text",
				blockId,
				offset: 6,
				length: 5,
				text: "planet",
			},
		]);
	});

	it("builds native ops for flow patch plans", () => {
		const editor = createPlanExecutorEditor();
		const firstBlockId = editor.firstBlock()!.id;
		editor.apply(
			[{
				type: "replace-text",
				blockId: firstBlockId,
				offset: 0,
				length: 0,
				text: "Alpha",
			}],
			{ origin: "system" },
		);
		editor.apply(
			[{
				type: "insert-block",
				blockId: "block-2",
				blockType: "paragraph",
				props: {},
				position: { after: firstBlockId },
			}, {
				type: "insert-text",
				blockId: "block-2",
				offset: 0,
				text: "Bravo",
			}],
			{ origin: "system" },
		);

		const execution = buildDocumentMutationPlanExecution(editor, {
			kind: "flow_patch",
			instructions: "I am updating the current paragraph and inserting a heading after it.",
			scope: "adjacent-blocks",
			targetSpanId: `span:${firstBlockId}`,
			edits: [
				{
					operation: "replace_text",
					locator: {
						blockId: firstBlockId,
						expectedBlockType: "paragraph",
					},
					text: "Alpha updated",
				},
				{
					operation: "insert_after",
					locator: {
						blockId: "block-2",
					},
					markdown: "## Next step",
				},
			],
		});

		expect(execution.reviewSafe).toBe(true);
		expect(execution.issues).toEqual([]);
		expect(execution.ops[0]).toEqual({
			type: "replace-text",
			blockId: firstBlockId,
			offset: 0,
			length: 5,
			text: "Alpha updated",
		});
		expect(execution.ops.some((op) => op.type === "insert-block")).toBe(true);
		expect(execution.ops.some((op) => op.type === "insert-text")).toBe(true);
	});

	it("optimizes single-block markdown replacements into native ops", () => {
		const editor = createPlanExecutorEditor();
		const blockId = editor.firstBlock()!.id;
		editor.apply(
			[{ type: "insert-text", blockId, offset: 0, text: "Old title" }],
			{ origin: "system" },
		);

		const execution = buildDocumentMutationPlanExecution(editor, {
			kind: "flow_patch",
			instructions: "I am turning the paragraph into a heading with new copy.",
			scope: "single-block",
			targetSpanId: `span:${blockId}`,
			edits: [
				{
					operation: "replace_blocks",
					locator: {
						blockIds: [blockId],
					},
					markdown: "## New title",
				},
			],
		});

		expect(execution.issues).toEqual([]);
		expect(execution.reviewSafe).toBe(true);
		expect(execution.ops).toEqual([
			{
				type: "convert-block",
				blockId,
				newType: "heading",
				newProps: { level: 2 },
			},
			{
				type: "replace-text",
				blockId,
				offset: 0,
				length: "Old title".length,
				text: "New title",
			},
		]);
	});

	it("optimizes adjacent multi-block markdown replacements into native ops", () => {
		const editor = createPlanExecutorEditor();
		const headingId = editor.firstBlock()!.id;
		editor.apply(
			[
				{ type: "convert-block", blockId: headingId, newType: "heading", newProps: { level: 1 } },
				{ type: "insert-text", blockId: headingId, offset: 0, text: "Old heading" },
				{
					type: "insert-block",
					blockId: "paragraph-2",
					blockType: "paragraph",
					props: {},
					position: { after: headingId },
				},
				{
					type: "insert-text",
					blockId: "paragraph-2",
					offset: 0,
					text: "Old body",
				},
			],
			{ origin: "system" },
		);

		const execution = buildDocumentMutationPlanExecution(editor, {
			kind: "flow_patch",
			instructions: "I am rewriting the heading and paragraph together.",
			scope: "adjacent-blocks",
			targetSpanId: `span:${headingId}`,
			edits: [
				{
					operation: "replace_blocks",
					locator: {
						blockIds: [headingId, "paragraph-2"],
					},
					markdown: ["## New heading", "", "New body copy"].join("\n"),
				},
			],
		});

		expect(execution.issues).toEqual([]);
		expect(execution.reviewSafe).toBe(true);
		expect(execution.ops).toEqual([
			{
				type: "update-block",
				blockId: headingId,
				props: { level: 2 },
			},
			{
				type: "replace-text",
				blockId: headingId,
				offset: 0,
				length: "Old heading".length,
				text: "New heading",
			},
			{
				type: "replace-text",
				blockId: "paragraph-2",
				offset: 0,
				length: "Old body".length,
				text: "New body copy",
			},
		]);
	});

	it("optimizes adjacent list rewrites into native ops", () => {
		const editor = createPlanExecutorEditor();
		const firstId = editor.firstBlock()!.id;
		editor.apply(
			[
				{ type: "convert-block", blockId: firstId, newType: "bulletListItem", newProps: { indent: 0 } },
				{ type: "insert-text", blockId: firstId, offset: 0, text: "Alpha" },
				{
					type: "insert-block",
					blockId: "item-2",
					blockType: "bulletListItem",
					props: { indent: 0 },
					position: { after: firstId },
				},
				{
					type: "insert-text",
					blockId: "item-2",
					offset: 0,
					text: "Beta",
				},
			],
			{ origin: "system" },
		);

		const execution = buildDocumentMutationPlanExecution(editor, {
			kind: "flow_patch",
			instructions: "I am converting the bullet list into a numbered list.",
			scope: "adjacent-blocks",
			targetSpanId: `span:${firstId}`,
			edits: [
				{
					operation: "replace_blocks",
					locator: {
						blockIds: [firstId, "item-2"],
					},
					markdown: ["1. First", "2. Second"].join("\n"),
				},
			],
		});

		expect(execution.issues).toEqual([]);
		expect(execution.reviewSafe).toBe(true);
		expect(execution.ops).toEqual([
			{
				type: "convert-block",
				blockId: firstId,
				newType: "numberedListItem",
				newProps: { indent: 0, start: 1 },
			},
			{
				type: "replace-text",
				blockId: firstId,
				offset: 0,
				length: "Alpha".length,
				text: "First",
			},
			{
				type: "convert-block",
				blockId: "item-2",
				newType: "numberedListItem",
				newProps: { indent: 0, start: undefined },
			},
			{
				type: "replace-text",
				blockId: "item-2",
				offset: 0,
				length: "Beta".length,
				text: "Second",
			},
		]);
	});

	it("reuses matching suffix blocks when a flow patch inserts at the front", () => {
		const editor = createPlanExecutorEditor();
		const firstId = editor.firstBlock()!.id;
		editor.apply(
			[
				{ type: "insert-text", blockId: firstId, offset: 0, text: "Keep first" },
				{
					type: "insert-block",
					blockId: "block-2",
					blockType: "paragraph",
					props: {},
					position: { after: firstId },
				},
				{
					type: "insert-text",
					blockId: "block-2",
					offset: 0,
					text: "Keep second",
				},
			],
			{ origin: "system" },
		);

		const execution = buildDocumentMutationPlanExecution(editor, {
			kind: "flow_patch",
			instructions: "I am inserting a new heading before the existing paragraphs.",
			scope: "adjacent-blocks",
			targetSpanId: `span:${firstId}`,
			edits: [
				{
					operation: "replace_blocks",
					locator: {
						blockIds: [firstId, "block-2"],
					},
					markdown: ["## New intro", "", "Keep first", "", "Keep second"].join("\n"),
				},
			],
		});

		expect(execution.issues).toEqual([]);
		expect(execution.reviewSafe).toBe(true);
		expect(execution.ops).toEqual([
			{
				type: "insert-block",
				blockId: expect.any(String),
				blockType: "heading",
				props: { level: 2 },
				position: { before: firstId },
			},
			{
				type: "insert-text",
				blockId: expect.any(String),
				offset: 0,
				text: "New intro",
			},
		]);
	});

	it("reuses matching prefix blocks when a flow patch deletes at the end", () => {
		const editor = createPlanExecutorEditor();
		const firstId = editor.firstBlock()!.id;
		editor.apply(
			[
				{ type: "insert-text", blockId: firstId, offset: 0, text: "Keep first" },
				{
					type: "insert-block",
					blockId: "block-2",
					blockType: "paragraph",
					props: {},
					position: { after: firstId },
				},
				{
					type: "insert-text",
					blockId: "block-2",
					offset: 0,
					text: "Keep second",
				},
				{
					type: "insert-block",
					blockId: "block-3",
					blockType: "paragraph",
					props: {},
					position: { after: "block-2" },
				},
				{
					type: "insert-text",
					blockId: "block-3",
					offset: 0,
					text: "Remove me",
				},
			],
			{ origin: "system" },
		);

		const execution = buildDocumentMutationPlanExecution(editor, {
			kind: "flow_patch",
			instructions: "I am trimming the trailing paragraph.",
			scope: "adjacent-blocks",
			targetSpanId: `span:${firstId}`,
			edits: [
				{
					operation: "replace_blocks",
					locator: {
						blockIds: [firstId, "block-2", "block-3"],
					},
					markdown: ["Keep first", "", "Keep second"].join("\n"),
				},
			],
		});

		expect(execution.issues).toEqual([]);
		expect(execution.reviewSafe).toBe(true);
		expect(execution.ops).toEqual([
			{
				type: "delete-block",
				blockId: "block-3",
			},
		]);
	});

	it("reuses and rewrites a near-match suffix block during front insertions", () => {
		const editor = createPlanExecutorEditor();
		const firstId = editor.firstBlock()!.id;
		editor.apply(
			[
				{ type: "insert-text", blockId: firstId, offset: 0, text: "Keep first" },
				{
					type: "insert-block",
					blockId: "block-2",
					blockType: "paragraph",
					props: {},
					position: { after: firstId },
				},
				{
					type: "insert-text",
					blockId: "block-2",
					offset: 0,
					text: "Final thoughts",
				},
			],
			{ origin: "system" },
		);

		const execution = buildDocumentMutationPlanExecution(editor, {
			kind: "flow_patch",
			instructions: "I am inserting a new intro and lightly revising the ending.",
			scope: "adjacent-blocks",
			targetSpanId: `span:${firstId}`,
			edits: [
				{
					operation: "replace_blocks",
					locator: {
						blockIds: [firstId, "block-2"],
					},
					markdown: [
						"New intro",
						"",
						"Keep first",
						"",
						"Final thoughts updated",
					].join("\n"),
				},
			],
		});

		expect(execution.issues).toEqual([]);
		expect(execution.reviewSafe).toBe(true);
		expect(execution.ops).toEqual([
			{
				type: "insert-block",
				blockId: expect.any(String),
				blockType: "paragraph",
				props: {},
				position: { before: firstId },
			},
			{
				type: "insert-text",
				blockId: expect.any(String),
				offset: 0,
				text: "New intro",
			},
			{
				type: "replace-text",
				blockId: "block-2",
				offset: 0,
				length: "Final thoughts".length,
				text: "Final thoughts updated",
			},
		]);
	});

	it("reuses and reformats a suffix block when inline marks are added", () => {
		const editor = createPlanExecutorEditor();
		const firstId = editor.firstBlock()!.id;
		editor.apply(
			[
				{ type: "insert-text", blockId: firstId, offset: 0, text: "Keep first" },
				{
					type: "insert-block",
					blockId: "block-2",
					blockType: "paragraph",
					props: {},
					position: { after: firstId },
				},
				{
					type: "insert-text",
					blockId: "block-2",
					offset: 0,
					text: "Final thoughts",
				},
			],
			{ origin: "system" },
		);

		const execution = buildDocumentMutationPlanExecution(editor, {
			kind: "flow_patch",
			instructions: "I am inserting a new intro and bolding the ending.",
			scope: "adjacent-blocks",
			targetSpanId: `span:${firstId}`,
			edits: [
				{
					operation: "replace_blocks",
					locator: {
						blockIds: [firstId, "block-2"],
					},
					markdown: [
						"New intro",
						"",
						"Keep first",
						"",
						"**Final thoughts**",
					].join("\n"),
				},
			],
		});

		expect(execution.issues).toEqual([]);
		expect(execution.reviewSafe).toBe(true);
		expect(execution.ops).toEqual([
			{
				type: "insert-block",
				blockId: expect.any(String),
				blockType: "paragraph",
				props: {},
				position: { before: firstId },
			},
			{
				type: "insert-text",
				blockId: expect.any(String),
				offset: 0,
				text: "New intro",
			},
			{
				type: "replace-text",
				blockId: "block-2",
				offset: 0,
				length: "Final thoughts".length,
				text: "Final thoughts",
			},
			{
				type: "format-text",
				blockId: "block-2",
				offset: 0,
				length: "Final thoughts".length,
				marks: { bold: true },
			},
		]);
	});

	it("reuses block ids when a flow patch inserts in the middle", () => {
		const editor = createPlanExecutorEditor();
		const firstId = editor.firstBlock()!.id;
		editor.apply(
			[
				{ type: "insert-text", blockId: firstId, offset: 0, text: "Alpha" },
				{
					type: "insert-block",
					blockId: "block-2",
					blockType: "paragraph",
					props: {},
					position: { after: firstId },
				},
				{
					type: "insert-text",
					blockId: "block-2",
					offset: 0,
					text: "Bravo",
				},
				{
					type: "insert-block",
					blockId: "block-3",
					blockType: "paragraph",
					props: {},
					position: { after: "block-2" },
				},
				{
					type: "insert-text",
					blockId: "block-3",
					offset: 0,
					text: "Charlie",
				},
			],
			{ origin: "system" },
		);

		const execution = buildDocumentMutationPlanExecution(editor, {
			kind: "flow_patch",
			instructions: "I am inserting a new paragraph between Bravo and Charlie.",
			scope: "adjacent-blocks",
			targetSpanId: `span:${firstId}`,
			edits: [
				{
					operation: "replace_blocks",
					locator: {
						blockIds: [firstId, "block-2", "block-3"],
					},
					markdown: ["Alpha", "", "Bravo", "", "Inserted middle", "", "Charlie"].join("\n"),
				},
			],
		});

		expect(execution.issues).toEqual([]);
		expect(execution.reviewSafe).toBe(true);
		expect(execution.ops).toEqual([
			{
				type: "insert-block",
				blockId: expect.any(String),
				blockType: "paragraph",
				props: {},
				position: { after: "block-2" },
			},
			{
				type: "insert-text",
				blockId: expect.any(String),
				offset: 0,
				text: "Inserted middle",
			},
		]);
		expect(execution.metrics?.flowPatchAlignment).toEqual({
			preservedBlockCount: 3,
			rewrittenBlockCount: 0,
			unchangedBlockCount: 3,
			insertedBlockCount: 1,
			deletedBlockCount: 0,
			estimatedOperationCost: 2,
		});
	});

	it("reuses block ids when a flow patch deletes in the middle", () => {
		const editor = createPlanExecutorEditor();
		const firstId = editor.firstBlock()!.id;
		editor.apply(
			[
				{ type: "insert-text", blockId: firstId, offset: 0, text: "Alpha" },
				{
					type: "insert-block",
					blockId: "block-2",
					blockType: "paragraph",
					props: {},
					position: { after: firstId },
				},
				{
					type: "insert-text",
					blockId: "block-2",
					offset: 0,
					text: "Remove me",
				},
				{
					type: "insert-block",
					blockId: "block-3",
					blockType: "paragraph",
					props: {},
					position: { after: "block-2" },
				},
				{
					type: "insert-text",
					blockId: "block-3",
					offset: 0,
					text: "Charlie",
				},
			],
			{ origin: "system" },
		);

		const execution = buildDocumentMutationPlanExecution(editor, {
			kind: "flow_patch",
			instructions: "I am deleting the middle paragraph.",
			scope: "adjacent-blocks",
			targetSpanId: `span:${firstId}`,
			edits: [
				{
					operation: "replace_blocks",
					locator: {
						blockIds: [firstId, "block-2", "block-3"],
					},
					markdown: ["Alpha", "", "Charlie"].join("\n"),
				},
			],
		});

		expect(execution.issues).toEqual([]);
		expect(execution.reviewSafe).toBe(true);
		expect(execution.ops).toEqual([
			{
				type: "delete-block",
				blockId: "block-2",
			},
		]);
		expect(execution.metrics?.flowPatchAlignment).toEqual({
			preservedBlockCount: 2,
			rewrittenBlockCount: 0,
			unchangedBlockCount: 2,
			insertedBlockCount: 0,
			deletedBlockCount: 1,
			estimatedOperationCost: 1,
		});
	});

	it("prefers the lower-op middle alignment when repeated blocks create multiple match options", () => {
		const editor = createPlanExecutorEditor();
		const firstId = editor.firstBlock()!.id;
		editor.apply(
			[
				{
					type: "convert-block",
					blockId: firstId,
					newType: "heading",
					newProps: { level: 1 },
				},
				{ type: "insert-text", blockId: firstId, offset: 0, text: "Alpha" },
				{
					type: "insert-block",
					blockId: "block-2",
					blockType: "paragraph",
					props: {},
					position: { after: firstId },
				},
				{
					type: "insert-text",
					blockId: "block-2",
					offset: 0,
					text: "Note",
				},
				{
					type: "insert-block",
					blockId: "block-3",
					blockType: "paragraph",
					props: {},
					position: { after: "block-2" },
				},
				{
					type: "insert-text",
					blockId: "block-3",
					offset: 0,
					text: "Omega",
				},
			],
			{ origin: "system" },
		);

		const execution = buildDocumentMutationPlanExecution(editor, {
			kind: "flow_patch",
			instructions: "I am moving a revised note before Alpha while keeping Omega.",
			scope: "adjacent-blocks",
			targetSpanId: `span:${firstId}`,
			edits: [
				{
					operation: "replace_blocks",
					locator: {
						blockIds: [firstId, "block-2", "block-3"],
					},
					markdown: ["Note updated", "", "# Alpha", "", "Omega"].join("\n"),
				},
			],
		});

		expect(execution.issues).toEqual([]);
		expect(execution.reviewSafe).toBe(true);
		expect(execution.ops).toEqual([
			{
				type: "insert-block",
				blockId: expect.any(String),
				blockType: "paragraph",
				props: {},
				position: { before: firstId },
			},
			{
				type: "insert-text",
				blockId: expect.any(String),
				offset: 0,
				text: "Note updated",
			},
			{
				type: "delete-block",
				blockId: "block-2",
			},
		]);
		expect(execution.metrics?.flowPatchAlignment).toEqual({
			preservedBlockCount: 2,
			rewrittenBlockCount: 0,
			unchangedBlockCount: 2,
			insertedBlockCount: 1,
			deletedBlockCount: 1,
			estimatedOperationCost: 3,
		});
	});

	it("builds database ops and stringifies database values", () => {
		const editor = createPlanExecutorEditor();
		editor.apply(
			[{
				type: "insert-block",
				blockId: "database-1",
				blockType: "database",
				props: {},
				position: "last",
			}],
			{ origin: "system" },
		);

		const execution = buildDocumentMutationPlanExecution(editor, {
			kind: "database_edit",
			blockId: "database-1",
			steps: [
				{
					op: "insert_row",
					rowId: "row-1",
					values: { done: true, count: 3 },
				},
				{
					op: "update_cell",
					rowId: "row-1",
					columnId: "name",
					value: { label: "Ship" },
				},
			],
		});

		expect(execution.reviewSafe).toBe(false);
		expect(execution.issues).toEqual([]);
		expect(execution.ops).toEqual([
			{
				type: "database-insert-row",
				blockId: "database-1",
				rowId: "row-1",
				values: { done: "true", count: "3" },
			},
			{
				type: "database-update-cell",
				blockId: "database-1",
				rowId: "row-1",
				columnId: "name",
				value: JSON.stringify({ label: "Ship" }),
			},
		]);
	});

	it("marks review bundles as not review-safe when they contain database edits", () => {
		const editor = createPlanExecutorEditor();
		editor.apply(
			[
				{
					type: "insert-block",
					blockId: "database-1",
					blockType: "database",
					props: {},
					position: "last",
				},
			],
			{ origin: "system" },
		);

		const execution = buildDocumentMutationPlanExecution(editor, {
			kind: "review_bundle",
			label: "Review",
			reason: "Bundle",
			plans: [
				{
					kind: "block_insert",
					blockType: "paragraph",
					position: "last",
					initialText: "Hello",
				},
				{
					kind: "database_edit",
					blockId: "database-1",
					steps: [{ op: "set_active_view", viewId: "view-1" }],
				},
			],
		});

		expect(execution.reviewSafe).toBe(false);
		expect(execution.issues).toEqual([]);
		expect(execution.ops.some((op) => op.type === "insert-block")).toBe(true);
		expect(
			execution.ops.some((op) => op.type === "database-set-active-view"),
		).toBe(true);
	});

	it("supports review bundles that insert then update and edit a regular block", () => {
		const editor = createPlanExecutorEditor();

		const execution = buildDocumentMutationPlanExecution(editor, {
			kind: "review_bundle",
			label: "Create heading",
			reason: "Insert, refine props, and edit text.",
			plans: [
				{
					kind: "block_insert",
					blockId: "heading-new",
					blockType: "paragraph",
					position: "last",
					initialText: "Draft",
				},
				{
					kind: "block_update",
					blockId: "heading-new",
					props: { tone: "title" },
				},
				{
					kind: "text_edit",
					target: {
						blockId: "heading-new",
						range: {
							startOffset: 0,
							endOffset: 5,
						},
					},
					operation: "replace",
					text: "Final",
				},
			],
		});

		expect(execution.issues).toEqual([]);
		expect(execution.ops).toEqual([
			{
				type: "insert-block",
				blockId: "heading-new",
				blockType: "paragraph",
				props: {},
				position: "last",
			},
			{
				type: "insert-text",
				blockId: "heading-new",
				offset: 0,
				text: "Draft",
			},
			{
				type: "update-block",
				blockId: "heading-new",
				props: { tone: "title" },
			},
			{
				type: "replace-text",
				blockId: "heading-new",
				offset: 0,
				length: 5,
				text: "Final",
			},
		]);
	});

	it("supports review bundles that insert then convert a regular block", () => {
		const editor = createPlanExecutorEditor();

		const execution = buildDocumentMutationPlanExecution(editor, {
			kind: "review_bundle",
			label: "Create heading",
			reason: "Insert then convert the new block.",
			plans: [
				{
					kind: "block_insert",
					blockId: "heading-new",
					blockType: "paragraph",
					position: "last",
					initialText: "Hello",
				},
				{
					kind: "block_convert",
					blockId: "heading-new",
					newType: "heading",
					props: { level: 2 },
				},
			],
		});

		expect(execution.issues).toEqual([]);
		expect(execution.ops).toEqual([
			{
				type: "insert-block",
				blockId: "heading-new",
				blockType: "paragraph",
				props: {},
				position: "last",
			},
			{
				type: "insert-text",
				blockId: "heading-new",
				offset: 0,
				text: "Hello",
			},
			{
				type: "convert-block",
				blockId: "heading-new",
				newType: "heading",
				newProps: { level: 2 },
			},
		]);
	});

	it("supports review bundles that insert and then populate a database", () => {
		const editor = createPlanExecutorEditor();

		const execution = buildDocumentMutationPlanExecution(editor, {
			kind: "review_bundle",
			label: "Create people database",
			reason: "Insert and populate a new database.",
			plans: [
				{
					kind: "block_insert",
					blockId: "database-new",
					blockType: "database",
					position: "last",
				},
				{
					kind: "database_edit",
					blockId: "database-new",
					steps: [
						{
							op: "add_column",
							column: { id: "name", title: "Name", type: "text" },
						},
						{
							op: "insert_row",
							rowId: "row-1",
							values: { name: "Alice" },
						},
					],
				},
			],
		});

		expect(execution.reviewSafe).toBe(false);
		expect(execution.issues).toEqual([]);
		expect(execution.ops).toEqual([
			{
				type: "insert-block",
				blockId: "database-new",
				blockType: "database",
				props: {},
				position: "last",
			},
			{
				type: "database-add-column",
				blockId: "database-new",
				column: { id: "name", title: "Name", type: "text" },
			},
			{
				type: "database-insert-row",
				blockId: "database-new",
				rowId: "row-1",
				values: { name: "Alice" },
			},
		]);
	});
});
