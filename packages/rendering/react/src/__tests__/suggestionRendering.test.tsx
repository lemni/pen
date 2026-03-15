// @vitest-environment jsdom

import React, { act } from "react";
import { describe, expect, it } from "vitest";
import { createRoot } from "react-dom/client";
import { createEditor, ensureInlineCompletionController } from "@pen/core";
import { defaultPreset } from "@pen/preset-default";
import { Pen } from "../primitives";

(
	globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe("@pen/react suggestion rendering", () => {
	it("renders suggestion marks with DOM attributes for diff styling and controls", async () => {
		const editor = createEditor({
			documentProfile: "flow",
			preset: defaultPreset({
				documentOps: false,
				deltaStream: false,
				undo: false,
			}),
		});
		const blockId = editor.firstBlock()!.id;

		editor.apply([
			{
				type: "insert-text",
				blockId,
				offset: 0,
				text: "Hello world",
			},
			{
				type: "format-text",
				blockId,
				offset: 0,
				length: 5,
				marks: {
					suggestion: {
						id: "suggestion-insert-1",
						action: "insert",
						author: "ai",
						authorType: "ai",
						createdAt: 1,
					},
				},
			},
			{
				type: "format-text",
				blockId,
				offset: 6,
				length: 5,
				marks: {
					suggestion: {
						id: "suggestion-delete-1",
						action: "delete",
						author: "ai",
						authorType: "ai",
						createdAt: 1,
					},
				},
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

		const insertSuggestion = container.querySelector(
			'[data-suggestion-id="suggestion-insert-1"]',
		);
		const deleteSuggestion = container.querySelector(
			'[data-suggestion-id="suggestion-delete-1"]',
		);

		expect(insertSuggestion).toBeTruthy();
		expect(insertSuggestion?.getAttribute("data-suggestion-action")).toBe(
			"insert",
		);
		expect(insertSuggestion?.classList.contains("pen-suggestion-insert")).toBe(
			true,
		);

		expect(deleteSuggestion).toBeTruthy();
		expect(deleteSuggestion?.getAttribute("data-suggestion-action")).toBe(
			"delete",
		);
		expect(deleteSuggestion?.classList.contains("pen-suggestion-delete")).toBe(
			true,
		);

		await act(async () => {
			root.unmount();
		});
		container.remove();
		editor.destroy();
	});

	it("renders autocomplete preview blocks after the anchor block", async () => {
		const editor = createEditor({
			documentProfile: "flow",
			preset: defaultPreset({
				documentOps: false,
				deltaStream: false,
				undo: false,
			}),
		});
		const blockId = editor.firstBlock()!.id;
		editor.apply([{
			type: "insert-text",
			blockId,
			offset: 0,
			text: "Hello world",
		}]);

		const { controller: inlineCompletion } = ensureInlineCompletionController(editor);
		inlineCompletion.showSuggestion({
			id: "autocomplete-preview-1",
			blockId,
			offset: 11,
			text: " again.",
			type: "inline",
			previewBlocks: [
				{
					id: "preview-block-1",
					text: "This should render as a ghost paragraph.",
					blockType: "paragraph",
				},
				{
					id: "preview-block-2",
					text: "This should render as a second ghost paragraph.",
					blockType: "paragraph",
				},
			],
		});

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

		const previewBlocks = Array.from(
			container.querySelectorAll("[data-pen-autocomplete-preview-block]"),
		);
		expect(previewBlocks).toHaveLength(2);
		expect(previewBlocks[0]?.textContent).toContain(
			"This should render as a ghost paragraph.",
		);
		expect(previewBlocks[1]?.textContent).toContain(
			"This should render as a second ghost paragraph.",
		);
		expect(previewBlocks[0]?.classList.contains("pen-block-suggestion")).toBe(true);

		await act(async () => {
			root.unmount();
		});
		container.remove();
		editor.destroy();
	});

	it("renders markdown-shaped autocomplete preview blocks from preview metadata", async () => {
		const editor = createEditor({
			documentProfile: "flow",
			preset: defaultPreset({
				documentOps: false,
				deltaStream: false,
				undo: false,
			}),
		});
		const blockId = editor.firstBlock()!.id;
		editor.apply([{
			type: "insert-text",
			blockId,
			offset: 0,
			text: "Trip",
		}]);

		const { controller: inlineCompletion } = ensureInlineCompletionController(editor);
		inlineCompletion.showSuggestion({
			id: "autocomplete-preview-markdown-1",
			blockId,
			offset: 4,
			text: " plan",
			type: "inline",
			previewBlocks: [
				{
					id: "preview-markdown-list-1",
					text: "Book flights",
					blockType: "bulletListItem",
					props: { indent: 1 },
				},
				{
					id: "preview-markdown-heading-1",
					text: "Itinerary",
					blockType: "heading",
					props: { level: 2 },
				},
			],
		});

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

		const previewBlocks = Array.from(
			container.querySelectorAll("[data-pen-autocomplete-preview-block]"),
		);
		expect(previewBlocks).toHaveLength(2);
		expect(
			previewBlocks[0]
				?.querySelector("[data-pen-list-item-layout]")
				?.getAttribute("data-block-type"),
		).toBe("bulletListItem");
		expect(
			previewBlocks[0]?.querySelector("[data-pen-list-marker]")?.textContent,
		).toBe("•");
		expect(previewBlocks[1]?.getAttribute("data-block-type")).toBe("heading");
		expect(previewBlocks[1]?.getAttribute("data-anchor-level")).toBe("2");

		await act(async () => {
			root.unmount();
		});
		container.remove();
		editor.destroy();
	});

	it("renders list-shaped autocomplete preview blocks for numbered lists", async () => {
		const editor = createEditor({
			documentProfile: "flow",
			preset: defaultPreset({
				documentOps: false,
				deltaStream: false,
				undo: false,
			}),
		});
		const blockId = editor.firstBlock()!.id;
		editor.apply([
			{
				type: "convert-block",
				blockId,
				newType: "numberedListItem",
			},
			{
				type: "update-block",
				blockId,
				props: { indent: 1 },
			},
			{
				type: "insert-text",
				blockId,
				offset: 0,
				text: "First item",
			},
		]);

		const { controller: inlineCompletion } = ensureInlineCompletionController(editor);
		inlineCompletion.showSuggestion({
			id: "autocomplete-preview-list-1",
			blockId,
			offset: 10,
			text: " with more detail",
			type: "inline",
			previewBlocks: [
				{
					id: "preview-list-1",
					text: "Second item preview",
					blockType: "paragraph",
				},
				{
					id: "preview-list-2",
					text: "Third item preview",
					blockType: "paragraph",
				},
			],
		});

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

		const previewBlocks = Array.from(
			container.querySelectorAll("[data-pen-autocomplete-preview-block]"),
		);
		expect(previewBlocks).toHaveLength(2);
		const listLayouts = previewBlocks.map((element) =>
			element.querySelector("[data-pen-list-item-layout]"),
		);
		expect(listLayouts[0]?.getAttribute("data-block-type")).toBe("numberedListItem");
		expect(listLayouts[0]?.getAttribute("data-indent")).toBe("1");
		const markers = previewBlocks.map((element) =>
			element.querySelector("[data-pen-list-marker]")?.textContent,
		);
		expect(markers).toEqual(["2.", "3."]);

		await act(async () => {
			root.unmount();
		});
		container.remove();
		editor.destroy();
	});

	it("renders container-shaped autocomplete preview blocks for toggles and subdocuments", async () => {
		const editor = createEditor({
			documentProfile: "flow",
			preset: defaultPreset({
				documentOps: false,
				deltaStream: false,
				undo: false,
			}),
		});
		const blockId = editor.firstBlock()!.id;
		await act(async () => {
			editor.apply([
				{
					type: "convert-block",
					blockId,
					newType: "toggle",
				},
				{
					type: "update-block",
					blockId,
					props: { open: true },
				},
				{
					type: "insert-text",
					blockId,
					offset: 0,
					text: "Toggle title",
				},
			]);
		});

		const { controller: inlineCompletion } = ensureInlineCompletionController(editor);
		await act(async () => {
			inlineCompletion.showSuggestion({
				id: "autocomplete-preview-toggle-1",
				blockId,
				offset: 12,
				text: " continues",
				type: "inline",
				previewBlocks: [
					{
						id: "preview-toggle-1",
						text: "Nested toggle child preview",
						blockType: "paragraph",
					},
				],
			});
		});

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

		const togglePreview = container.querySelector("[data-pen-autocomplete-preview-block]");
		expect(togglePreview?.querySelector("[data-pen-toggle-body]")).toBeTruthy();

		await act(async () => {
			inlineCompletion.showSuggestion({
				id: "autocomplete-preview-subdocument-1",
				blockId,
				offset: 12,
				text: " continues",
				type: "inline",
				previewBlocks: [
					{
						id: "preview-subdocument-1",
						text: "Nested subdocument preview",
						blockType: "paragraph",
					},
				],
			});

			editor.apply([
				{
					type: "convert-block",
					blockId,
					newType: "subdocument",
				},
			]);
		});

		await act(async () => {
			root.render(
				<Pen.Editor.Root editor={editor}>
					<Pen.Editor.Content />
				</Pen.Editor.Root>,
			);
		});

		const subdocumentPreview = container.querySelector("[data-pen-autocomplete-preview-block]");
		expect(subdocumentPreview?.querySelector("[data-pen-subdocument-host]")).toBeTruthy();

		await act(async () => {
			root.unmount();
		});
		container.remove();
		editor.destroy();
	});
});
