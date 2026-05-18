// @vitest-environment jsdom

import React, { act } from "react";
import { describe, expect, it } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { createEditor as createCoreEditor } from "@pen/core";
import { defaultPreset } from "@pen/preset-default";
import type { FieldEditorImpl } from "../field-editor/fieldEditorImpl";
import { FIELD_EDITOR_SLOT_KEY } from "../constants/fieldEditor";
import { Pen } from "../primitives/index";

(
	globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function createEditor(options: Parameters<typeof createCoreEditor>[0] = {}) {
	const { without: _without, ...restOptions } = options;
	return createCoreEditor({
		...restOptions,
		preset: defaultPreset({
			documentOps: false,
			deltaStream: false,
			undo: false,
		}),
	});
}

async function flushAnimationFrames(count = 1): Promise<void> {
	for (let i = 0; i < count; i++) {
		await new Promise<void>((resolve) => {
			requestAnimationFrame(() => resolve());
		});
	}
}

async function renderEditor(editor: ReturnType<typeof createEditor>): Promise<{
	container: HTMLDivElement;
	root: Root;
}> {
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

	return { container, root };
}

async function cleanupEditor(
	editor: ReturnType<typeof createEditor>,
	root: Root,
	container: HTMLElement,
): Promise<void> {
	await act(async () => {
		root.unmount();
	});
	container.remove();
	editor.destroy();
}

function getFieldEditor(editor: ReturnType<typeof createEditor>): FieldEditorImpl {
	const fieldEditor = editor.internals.getSlot<FieldEditorImpl>(
		FIELD_EDITOR_SLOT_KEY,
	);
	if (!fieldEditor) {
		throw new Error("Missing attached field editor");
	}
	return fieldEditor;
}

describe("@pen/react text entry surface semantics", () => {
	it("marks only the active inline edit surface as a multiline textbox", async () => {
		const editor = createEditor();
		const firstBlockId = editor.firstBlock()!.id;
		const secondBlockId = "semantic-second-block";

		editor.apply([
			{
				type: "insert-block",
				blockId: secondBlockId,
				blockType: "paragraph",
				props: {},
				position: { after: firstBlockId },
			},
		]);

		const { container, root } = await renderEditor(editor);
		const fieldEditor = getFieldEditor(editor);
		const firstSurface = container.querySelector(
			`[data-block-id="${firstBlockId}"] [data-pen-inline-content]`,
		) as HTMLElement | null;
		const secondSurface = container.querySelector(
			`[data-block-id="${secondBlockId}"] [data-pen-inline-content]`,
		) as HTMLElement | null;

		expect(firstSurface).not.toBeNull();
		expect(secondSurface).not.toBeNull();
		expect(container.querySelectorAll('[role="textbox"]')).toHaveLength(0);

		await act(async () => {
			fieldEditor.activate(firstBlockId);
			await flushAnimationFrames(2);
		});

		expect(firstSurface?.getAttribute("role")).toBe("textbox");
		expect(firstSurface?.getAttribute("aria-multiline")).toBe("true");
		expect(secondSurface?.hasAttribute("role")).toBe(false);

		await cleanupEditor(editor, root, container);
	});

	it("marks the active table cell edit surface as a multiline textbox", async () => {
		const editor = createEditor();

		editor.apply([
			{
				type: "insert-block",
				blockId: "semantic-table",
				blockType: "table",
				props: {},
				position: "last",
			},
			{
				type: "insert-table-cell-text",
				blockId: "semantic-table",
				row: 0,
				col: 0,
				offset: 0,
				text: "Alpha",
			},
			{
				type: "insert-table-cell-text",
				blockId: "semantic-table",
				row: 0,
				col: 1,
				offset: 0,
				text: "Beta",
			},
		]);

		const { container, root } = await renderEditor(editor);
		const fieldEditor = getFieldEditor(editor);
		const firstCellSurface = container.querySelector(
			`[data-block-id="semantic-table"] [data-cell-row="0"][data-cell-col="0"] [data-pen-field-editor-surface]`,
		) as HTMLElement | null;
		const secondCellSurface = container.querySelector(
			`[data-block-id="semantic-table"] [data-cell-row="0"][data-cell-col="1"] [data-pen-field-editor-surface]`,
		) as HTMLElement | null;

		expect(firstCellSurface).not.toBeNull();
		expect(secondCellSurface).not.toBeNull();
		expect(container.querySelectorAll('[role="textbox"]')).toHaveLength(0);

		await act(async () => {
			editor.selectCell("semantic-table", 0, 0);
			fieldEditor.activateCellFromElement?.(
				"semantic-table",
				0,
				0,
				firstCellSurface!,
			);
			await flushAnimationFrames(2);
		});

		expect(firstCellSurface?.getAttribute("role")).toBe("textbox");
		expect(firstCellSurface?.getAttribute("aria-multiline")).toBe("true");
		expect(secondCellSurface?.hasAttribute("role")).toBe(false);

		await cleanupEditor(editor, root, container);
	});

	it("marks the expanded edit surface as a multiline textbox", async () => {
		const editor = createEditor();
		const firstBlockId = editor.firstBlock()!.id;
		const secondBlockId = "semantic-expanded-second";

		editor.apply([
			{ type: "insert-text", blockId: firstBlockId, offset: 0, text: "Hello" },
			{
				type: "insert-block",
				blockId: secondBlockId,
				blockType: "paragraph",
				props: {},
				position: { after: firstBlockId },
			},
			{ type: "insert-text", blockId: secondBlockId, offset: 0, text: "World" },
		]);

		const { container, root } = await renderEditor(editor);
		const fieldEditor = getFieldEditor(editor);
		const blocksHost = container.querySelector(
			"[data-pen-editor-blocks-host]",
		) as HTMLElement | null;

		expect(blocksHost).not.toBeNull();
		expect(blocksHost?.hasAttribute("role")).toBe(false);

		await act(async () => {
			fieldEditor.activate(firstBlockId);
			editor.selectTextRange(
				{ blockId: firstBlockId, offset: 1 },
				{ blockId: secondBlockId, offset: 2 },
			);
			await flushAnimationFrames(2);
		});

		expect(fieldEditor.getSnapshot().mode).toBe("expanded");
		expect(blocksHost?.getAttribute("role")).toBe("textbox");
		expect(blocksHost?.getAttribute("aria-multiline")).toBe("true");

		await cleanupEditor(editor, root, container);
	});
});
