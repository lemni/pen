// @vitest-environment jsdom

import React, { act } from "react";
import { describe, expect, it } from "vitest";
import { createRoot } from "react-dom/client";
import { createEditor } from "@pen/core";
import { Pen } from "../primitives/index";
import { getAttachedFieldEditor } from "../utils/fieldEditor";

(
	globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const BLOCK_TYPE_OPTIONS = [
	{ value: "paragraph", label: "Paragraph" },
	{ value: "heading", label: "Heading" },
];

const TABLE_BLOCK_TYPE_OPTIONS = [
	{ value: "paragraph", label: "Paragraph" },
	{ value: "table", label: "Table" },
];

function visibleText(text: string | null | undefined): string {
	return (text ?? "").replace(/\u200B/g, "");
}

function numberedListMarkers(container: HTMLElement): string[] {
	return Array.from(
		container.querySelectorAll(
			"[data-pen-list-item-layout][data-block-type='numberedListItem'] [data-pen-list-marker]",
		),
	).map((marker) => marker.textContent ?? "");
}

describe("@pen/react block type rendering", () => {
	it("derives flow-aware default block type options from schema metadata", async () => {
		const editor = createEditor({
			documentProfile: "flow",
			without: ["document-ops", "delta-stream", "undo"],
		});
		const blockId = editor.firstBlock()!.id;
		editor.selectText(blockId, 0, 0);

		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);

		await act(async () => {
			root.render(
				<Pen.Editor.Root editor={editor}>
					<Pen.Toolbar.Root editor={editor}>
						<Pen.Toolbar.Select format="blockType" />
					</Pen.Toolbar.Root>
					<Pen.Editor.Content />
				</Pen.Editor.Root>,
			);
		});

		const optionValues = Array.from(container.querySelectorAll("option")).map(
			(option) => (option as HTMLOptionElement).value,
		);
		expect(optionValues).toContain("paragraph");
		expect(optionValues).toContain("table");
		expect(optionValues).not.toContain("database");
		expect(optionValues).not.toContain("subdocument");
		expect(optionValues.indexOf("paragraph")).toBeLessThan(
			optionValues.indexOf("table"),
		);

		await act(async () => {
			root.unmount();
		});
		container.remove();
		editor.destroy();
	});

	it("keeps structured-only block types in default toolbar options", async () => {
		const editor = createEditor({
			without: ["document-ops", "delta-stream", "undo"],
		});
		const blockId = editor.firstBlock()!.id;
		editor.selectText(blockId, 0, 0);

		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);

		await act(async () => {
			root.render(
				<Pen.Editor.Root editor={editor}>
					<Pen.Toolbar.Root editor={editor}>
						<Pen.Toolbar.Select format="blockType" />
					</Pen.Toolbar.Root>
					<Pen.Editor.Content />
				</Pen.Editor.Root>,
			);
		});

		const optionValues = Array.from(container.querySelectorAll("option")).map(
			(option) => (option as HTMLOptionElement).value,
		);
		expect(optionValues).toContain("database");
		expect(optionValues).not.toContain("subdocument");

		await act(async () => {
			root.unmount();
		});
		container.remove();
		editor.destroy();
	});

	it("updates the rendered block immediately when the toolbar converts block type", async () => {
		const editor = createEditor({
			without: ["document-ops", "delta-stream", "undo"],
		});
		const blockId = editor.firstBlock()!.id;

		editor.apply([
			{ type: "insert-text", blockId, offset: 0, text: "Hello world" },
		]);
		editor.selectText(blockId, 0, 0);

		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);

		await act(async () => {
			root.render(
				<Pen.Editor.Root editor={editor}>
					<Pen.Toolbar.Root editor={editor}>
						<Pen.Toolbar.Select
							format="blockType"
							options={BLOCK_TYPE_OPTIONS}
						/>
					</Pen.Toolbar.Root>
					<Pen.Editor.Content />
				</Pen.Editor.Root>,
			);
		});

		const select = container.querySelector(
			"[data-pen-toolbar-select]",
		) as HTMLSelectElement | null;

		expect(select?.value).toBe("paragraph");
		expect(
			container.querySelector("h1[data-block-type='heading']"),
		).toBeNull();
		expect(
			container.querySelector("div[data-block-type='paragraph']"),
		).not.toBeNull();

		await act(async () => {
			if (!select) {
				throw new Error("Missing toolbar select");
			}
			select.value = "heading";
			select.dispatchEvent(new Event("change", { bubbles: true }));
		});

		expect(editor.getBlock(blockId)?.type).toBe("heading");
		expect(select?.value).toBe("heading");
		expect(
			container.querySelector("h1[data-block-type='heading']"),
		).not.toBeNull();

		await act(async () => {
			root.unmount();
		});
		container.remove();
		editor.destroy();
	});

	it("converts a rendered paragraph to a toggle without violating hook order", async () => {
		const editor = createEditor({
			without: ["document-ops", "delta-stream", "undo"],
		});
		const blockId = editor.firstBlock()!.id;

		editor.apply([
			{ type: "insert-text", blockId, offset: 0, text: "Toggle me" },
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

		expect(
			container.querySelector("div[data-block-type='paragraph']"),
		).not.toBeNull();

		await act(async () => {
			editor.apply([
				{ type: "convert-block", blockId, newType: "toggle" },
			]);
		});

		const toggleTrigger = container.querySelector(
			"[data-pen-toggle-trigger]",
		);
		expect(toggleTrigger).not.toBeNull();
		expect(
			container.querySelector("div[data-block-type='toggle']"),
		).not.toBeNull();

		await act(async () => {
			root.unmount();
		});
		container.remove();
		editor.destroy();
	});

	it("preserves block text and focuses the next starter cell when converting to table", async () => {
		const editor = createEditor({
			without: ["document-ops", "delta-stream", "undo"],
		});
		const blockId = editor.firstBlock()!.id;

		editor.apply([
			{ type: "insert-text", blockId, offset: 0, text: "Name" },
		]);
		editor.selectText(blockId, 0, 0);

		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);

		await act(async () => {
			root.render(
				<Pen.Editor.Root editor={editor}>
					<Pen.Toolbar.Root editor={editor}>
						<Pen.Toolbar.Select
							format="blockType"
							options={TABLE_BLOCK_TYPE_OPTIONS}
						/>
					</Pen.Toolbar.Root>
					<Pen.Editor.Content />
				</Pen.Editor.Root>,
			);
		});

		const select = container.querySelector(
			"[data-pen-toolbar-select]",
		) as HTMLSelectElement | null;

		await act(async () => {
			if (!select) {
				throw new Error("Missing toolbar select");
			}
			select.value = "table";
			select.dispatchEvent(new Event("change", { bubbles: true }));
			await new Promise<void>((resolve) => {
				window.requestAnimationFrame(() => resolve());
			});
		});

		expect(editor.getBlock(blockId)?.type).toBe("table");
		expect(editor.getBlock(blockId)?.props.hasHeaderRow).toBe(true);
		expect(editor.getBlock(blockId)?.tableCell(0, 0)?.textContent()).toBe("Name");

		const activeCell = container.querySelector(
			"[data-pen-table-cell][data-cell-row='0'][data-cell-col='1'] [data-pen-field-editor-active-surface]",
		);
		expect(activeCell).not.toBeNull();

		await act(async () => {
			root.unmount();
		});
		container.remove();
		editor.destroy();
	});

	it("keeps toggle expansion on a dedicated trigger instead of the editable title", async () => {
		const editor = createEditor({
			without: ["document-ops", "delta-stream", "undo"],
		});
		const blockId = editor.firstBlock()!.id;

		editor.apply([
			{ type: "convert-block", blockId, newType: "toggle" },
			{ type: "insert-text", blockId, offset: 0, text: "Toggle title" },
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

		const trigger = container.querySelector(
			"[data-pen-toggle-trigger]",
		) as HTMLButtonElement | null;
		const titleSurface = container.querySelector(
			"[data-pen-toggle-title] [data-pen-inline-content]",
		) as HTMLElement | null;

		expect(trigger).not.toBeNull();
		expect(titleSurface).not.toBeNull();
		expect(container.querySelector("summary")).toBeNull();
		expect(editor.getBlock(blockId)?.props.open).toBe(false);

		const fieldEditor = getAttachedFieldEditor(editor);
		await act(async () => {
			fieldEditor?.activateTextSelection?.(blockId, 2, 2);
			await new Promise<void>((resolve) => {
				window.requestAnimationFrame(() => resolve());
			});
		});

		expect(fieldEditor?.isEditing).toBe(true);
		expect(
			titleSurface?.hasAttribute("data-pen-field-editor-active-surface"),
		).toBe(true);

		await act(async () => {
			titleSurface?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
		});

		expect(editor.getBlock(blockId)?.props.open).toBe(false);

		await act(async () => {
			trigger?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
			document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
			trigger?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
			await new Promise<void>((resolve) => {
				window.requestAnimationFrame(() => resolve());
			});
		});

		expect(editor.getBlock(blockId)?.props.open).toBe(true);
		expect(trigger?.getAttribute("aria-expanded")).toBe("true");
		expect(fieldEditor?.isEditing).toBe(false);
		expect(
			titleSurface?.hasAttribute("data-pen-field-editor-active-surface"),
		).toBe(false);

		await act(async () => {
			root.unmount();
		});
		container.remove();
		editor.destroy();
	});

	it("renders parentId child blocks inside an open toggle and hides them from the root flow", async () => {
		const editor = createEditor({
			without: ["document-ops", "delta-stream", "undo"],
		});
		const toggleBlockId = editor.firstBlock()!.id;
		const childBlockId = crypto.randomUUID();

		editor.apply([
			{
				type: "convert-block",
				blockId: toggleBlockId,
				newType: "toggle",
				newProps: { open: true },
			},
			{
				type: "insert-text",
				blockId: toggleBlockId,
				offset: 0,
				text: "Parent toggle",
			},
			{
				type: "insert-block",
				blockId: childBlockId,
				blockType: "heading",
				props: { level: 2 },
				position: "last",
			},
			{
				type: "insert-text",
				blockId: childBlockId,
				offset: 0,
				text: "Nested heading",
			},
			{
				type: "update-block",
				blockId: childBlockId,
				props: { parentId: toggleBlockId },
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

		const toggleBody = container.querySelector(
			"[data-pen-toggle-body]",
		) as HTMLElement | null;
		const nestedHeading = toggleBody?.querySelector(
			"h2[data-block-type='heading']",
		);
		const allNestedHeadings = container.querySelectorAll(
			"h2[data-block-type='heading']",
		);
		const rootBlocks = container.querySelectorAll("[data-pen-editor-block]");

		expect(toggleBody).not.toBeNull();
		expect(nestedHeading?.textContent).toBe("Nested heading");
		expect(allNestedHeadings).toHaveLength(1);
		expect(rootBlocks).toHaveLength(2);

		await act(async () => {
			editor.apply([
				{
					type: "update-block",
					blockId: toggleBlockId,
					props: { open: false },
				},
			]);
		});

		expect(container.querySelector("[data-pen-toggle-body]")).toBeNull();
		expect(
			container.querySelector("h2[data-block-type='heading']"),
		).toBeNull();

		await act(async () => {
			root.unmount();
		});
		container.remove();
		editor.destroy();
	});

	it("creates the first nested child block from an empty open toggle", async () => {
		const editor = createEditor({
			without: ["document-ops", "delta-stream", "undo"],
		});
		const toggleBlockId = editor.firstBlock()!.id;

		editor.apply([
			{
				type: "convert-block",
				blockId: toggleBlockId,
				newType: "toggle",
				newProps: { open: true },
			},
			{
				type: "insert-text",
				blockId: toggleBlockId,
				offset: 0,
				text: "Toggle",
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

		const emptyButton = container.querySelector(
			"[data-pen-toggle-empty-button]",
		) as HTMLButtonElement | null;

		expect(emptyButton?.textContent).toBe("Empty toggle. Click to add a block.");
		expect(container.querySelector("[data-pen-toggle-body]")).toBeNull();

		await act(async () => {
			emptyButton?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
			emptyButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
			await new Promise<void>((resolve) => {
				window.requestAnimationFrame(() => resolve());
			});
		});

		const childBlockIds = editor.documentState.blockOrder.filter(
			(blockId) => blockId !== toggleBlockId,
		);
		const nestedParagraph = container.querySelector(
			"[data-pen-toggle-body] div[data-block-type='paragraph']",
		) as HTMLElement | null;

		expect(childBlockIds).toHaveLength(1);
		expect(editor.documentState.parentOf(childBlockIds[0]!)).toBe(toggleBlockId);
		expect(editor.getBlock(childBlockIds[0]!)?.type).toBe("paragraph");
		expect(container.querySelector("[data-pen-toggle-empty-button]")).toBeNull();
		expect(nestedParagraph).not.toBeNull();
		expect(
			nestedParagraph?.querySelector("[data-placeholder-visible]"),
		).not.toBeNull();

		await act(async () => {
			root.unmount();
		});
		container.remove();
		editor.destroy();
	});

	it("renders numbered list items with a shared marker and content row", async () => {
		const editor = createEditor({
			without: ["document-ops", "delta-stream", "undo"],
		});
		const blockId = editor.firstBlock()!.id;

		editor.apply([
			{ type: "convert-block", blockId, newType: "numberedListItem" },
			{ type: "insert-text", blockId, offset: 0, text: "First item" },
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

		const layout = container.querySelector(
			"[data-pen-list-item-layout][data-block-type='numberedListItem']",
		) as HTMLElement | null;
		const marker = layout?.querySelector("[data-pen-list-marker]");
		const content = layout?.querySelector("[data-pen-list-item-content]");

		expect(layout).not.toBeNull();
		expect(layout?.style.display).toBe("grid");
		expect(marker?.textContent).toBe("1.");
		expect(content?.querySelector("[data-pen-inline-content]")).not.toBeNull();

		await act(async () => {
			root.unmount();
		});
		container.remove();
		editor.destroy();
	});

	it("renumbers numbered list markers when the sequence changes", async () => {
		const editor = createEditor({
			without: ["document-ops", "delta-stream", "undo"],
		});
		const firstBlockId = editor.firstBlock()!.id;
		const secondBlockId = crypto.randomUUID();
		const insertedBlockId = crypto.randomUUID();

		editor.apply([
			{ type: "convert-block", blockId: firstBlockId, newType: "numberedListItem" },
			{ type: "insert-text", blockId: firstBlockId, offset: 0, text: "First item" },
			{
				type: "insert-block",
				blockId: secondBlockId,
				blockType: "numberedListItem",
				props: {},
				position: "last",
			},
			{ type: "insert-text", blockId: secondBlockId, offset: 0, text: "Third item" },
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

		expect(numberedListMarkers(container)).toEqual(["1.", "2."]);

		await act(async () => {
			editor.apply([
				{
					type: "insert-block",
					blockId: insertedBlockId,
					blockType: "numberedListItem",
					props: {},
					position: { after: firstBlockId },
				},
				{
					type: "insert-text",
					blockId: insertedBlockId,
					offset: 0,
					text: "Second item",
				},
			]);
		});

		expect(numberedListMarkers(container)).toEqual(["1.", "2.", "3."]);

		await act(async () => {
			root.unmount();
		});
		container.remove();
		editor.destroy();
	});

	it("renders bullet list items with a shared marker and content row", async () => {
		const editor = createEditor({
			without: ["document-ops", "delta-stream", "undo"],
		});
		const blockId = editor.firstBlock()!.id;

		editor.apply([
			{ type: "convert-block", blockId, newType: "bulletListItem" },
			{ type: "insert-text", blockId, offset: 0, text: "Bullet item" },
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

		const layout = container.querySelector(
			"[data-pen-list-item-layout][data-block-type='bulletListItem']",
		) as HTMLElement | null;
		const marker = layout?.querySelector("[data-pen-list-marker]");
		const content = layout?.querySelector("[data-pen-list-item-content]");

		expect(layout).not.toBeNull();
		expect(layout?.style.display).toBe("grid");
		expect(marker?.textContent).toBe("•");
		expect(content?.querySelector("[data-pen-inline-content]")).not.toBeNull();

		await act(async () => {
			root.unmount();
		});
		container.remove();
		editor.destroy();
	});

	it("renders check list items with the checkbox and content in one layout", async () => {
		const editor = createEditor({
			without: ["document-ops", "delta-stream", "undo"],
		});
		const blockId = editor.firstBlock()!.id;

		editor.apply([
			{ type: "convert-block", blockId, newType: "checkListItem" },
			{ type: "insert-text", blockId, offset: 0, text: "Task item" },
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

		const layout = container.querySelector(
			"[data-pen-list-item-layout][data-block-type='checkListItem']",
		) as HTMLElement | null;
		const checkbox = layout?.querySelector("input[type='checkbox']");
		const content = layout?.querySelector("[data-pen-list-item-content]");

		expect(layout).not.toBeNull();
		expect(layout?.style.display).toBe("grid");
		expect(checkbox).not.toBeNull();
		expect(content?.querySelector("[data-pen-inline-content]")).not.toBeNull();

		await act(async () => {
			root.unmount();
		});
		container.remove();
		editor.destroy();
	});

	it("updates inactive inline content when CRDT text changes", async () => {
		const editor = createEditor({
			without: ["document-ops", "delta-stream", "undo"],
		});
		const blockId = editor.firstBlock()!.id;

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

		const inlineContent = container.querySelector(
			"[data-pen-inline-content]",
		) as HTMLElement | null;

		expect(visibleText(inlineContent?.textContent)).toBe("");

		await act(async () => {
			editor.apply([
				{
					type: "insert-text",
					blockId,
					offset: 0,
					text: "Synced text",
				},
			]);
		});

		expect(visibleText(inlineContent?.textContent)).toBe("Synced text");

		await act(async () => {
			root.unmount();
		});
		container.remove();
		editor.destroy();
	});
});
