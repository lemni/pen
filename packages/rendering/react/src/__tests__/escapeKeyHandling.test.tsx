// @vitest-environment jsdom

import React, { act } from "react";
import { describe, expect, it } from "vitest";
import { createRoot } from "react-dom/client";
import {
	createEditor as createCoreEditor,
	DocumentRangeImpl,
	ensureInlineCompletionController,
} from "@pen/core";
import { defaultPreset } from "@pen/preset-default";
import type { FieldEditorImpl } from "../field-editor/fieldEditorImpl";
import { Pen } from "../primitives/index";
import { FIELD_EDITOR_SLOT_KEY } from "../constants/fieldEditor";
import {
	domSelectionToEditor,
	editorSelectionToDOM,
} from "../field-editor/selectionBridge";
import { FakeEditContext } from "./utils/fakeEditContext";

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

function createEscapeEvent(): KeyboardEvent {
	return new KeyboardEvent("keydown", {
		key: "Escape",
		bubbles: true,
	});
}

function createSelectAllEvent(): KeyboardEvent {
	return new KeyboardEvent("keydown", {
		key: "a",
		metaKey: true,
		bubbles: true,
		cancelable: true,
	});
}

async function flushAnimationFrames(count = 1): Promise<void> {
	for (let i = 0; i < count; i++) {
		await new Promise<void>((resolve) => {
			requestAnimationFrame(() => resolve());
		});
	}
}

function getFieldEditor(
	editor: ReturnType<typeof createEditor>,
): FieldEditorImpl {
	const fieldEditor = editor.internals.getSlot<FieldEditorImpl>(
		FIELD_EDITOR_SLOT_KEY,
	);
	if (!fieldEditor) {
		throw new Error("Missing attached field editor");
	}
	return fieldEditor;
}

function setNativeSelectionRange(
	startElement: HTMLElement,
	startOffset: number,
	endElement: HTMLElement,
	endOffset: number,
): void {
	const selection = document.getSelection();
	const range = document.createRange();
	range.setStart(startElement.firstChild ?? startElement, startOffset);
	range.setEnd(endElement.firstChild ?? endElement, endOffset);
	selection?.removeAllRanges();
	selection?.addRange(range);
}

function createMouseUpEvent(clientX = 40, clientY = 40): MouseEvent {
	return new MouseEvent("mouseup", {
		bubbles: true,
		clientX,
		clientY,
	});
}

describe("@pen/react escape key handling", () => {
	it("preserves backwards same-block selection direction when collapsing", async () => {
		const editor = createEditor();
		const blockId = editor.firstBlock()!.id;

		editor.apply([
			{ type: "insert-text", blockId, offset: 0, text: "Hello world" },
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

		const fieldEditor = getFieldEditor(editor);
		const rootElement = container.querySelector(
			"[data-pen-editor-root]",
		) as HTMLElement | null;
		const inlineElement = container.querySelector(
			"[data-pen-inline-content]",
		) as HTMLElement | null;

		expect(rootElement).not.toBeNull();
		expect(inlineElement).not.toBeNull();
		expect(
			inlineElement?.hasAttribute("data-pen-field-editor-active-surface"),
		).toBe(false);

		await act(async () => {
			fieldEditor.activate(blockId);
			editor.setSelection(
				new DocumentRangeImpl(
					{ blockId, offset: 5 },
					{ blockId, offset: 2 },
					editor.internals.doc,
				).toTextSelection(),
			);
			editorSelectionToDOM(
				rootElement!,
				{ blockId, offset: 5 },
				{ blockId, offset: 2 },
			);
		});

		expect(editor.selection).toMatchObject({
			type: "text",
			anchor: { blockId, offset: 5 },
			focus: { blockId, offset: 2 },
			isCollapsed: false,
		});
		expect(domSelectionToEditor(rootElement!)).toMatchObject({
			anchor: { blockId, offset: 5 },
			focus: { blockId, offset: 2 },
		});
		expect(
			inlineElement?.hasAttribute("data-pen-field-editor-active-surface"),
		).toBe(true);

		await act(async () => {
			rootElement?.dispatchEvent(createEscapeEvent());
			await flushAnimationFrames(2);
		});

		expect(editor.selection).toMatchObject({
			type: "text",
			anchor: { blockId, offset: 2 },
			focus: { blockId, offset: 2 },
			isCollapsed: true,
		});
		expect(domSelectionToEditor(rootElement!)).toMatchObject({
			anchor: { blockId, offset: 2 },
			focus: { blockId, offset: 2 },
		});

		await act(async () => {
			root.unmount();
		});
		container.remove();
		editor.destroy();
	});

	it("walks the selection ladder from range to caret to block to clear", async () => {
		const editor = createEditor();
		const blockId = editor.firstBlock()!.id;

		editor.apply([
			{ type: "insert-text", blockId, offset: 0, text: "Hello world" },
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

		const fieldEditor = getFieldEditor(editor);
		const rootElement = container.querySelector(
			"[data-pen-editor-root]",
		) as HTMLElement | null;
		const blockElement = container.querySelector(
			`[data-block-id="${blockId}"]`,
		) as HTMLElement | null;
		const inlineElement = container.querySelector(
			"[data-pen-inline-content]",
		) as HTMLElement | null;

		expect(rootElement).not.toBeNull();
		expect(blockElement).not.toBeNull();
		expect(inlineElement).not.toBeNull();

		await act(async () => {
			fieldEditor.activate(blockId);
			editor.selectTextRange(
				{ blockId, offset: 0 },
				{ blockId, offset: 5 },
			);
		});

		expect(editor.selection).toMatchObject({
			type: "text",
			anchor: { blockId, offset: 0 },
			focus: { blockId, offset: 5 },
			isCollapsed: false,
		});

		await act(async () => {
			rootElement?.dispatchEvent(createEscapeEvent());
			await flushAnimationFrames(2);
		});

		expect(editor.selection).toMatchObject({
			type: "text",
			anchor: { blockId, offset: 5 },
			focus: { blockId, offset: 5 },
			isCollapsed: true,
		});
		expect(domSelectionToEditor(rootElement!)).toMatchObject({
			anchor: { blockId, offset: 5 },
			focus: { blockId, offset: 5 },
		});
		expect(fieldEditor.getSnapshot()).toMatchObject({
			focusBlockId: blockId,
			isEditing: true,
			mode: "single",
		});

		await act(async () => {
			rootElement?.dispatchEvent(createEscapeEvent());
		});

		expect(editor.selection).toEqual({
			type: "block",
			blockIds: [blockId],
		});
		expect(fieldEditor.getSnapshot()).toMatchObject({
			focusBlockId: null,
			isEditing: false,
			mode: "inactive",
		});
		expect(document.activeElement).toBe(blockElement);

		await act(async () => {
			blockElement?.dispatchEvent(createEscapeEvent());
		});

		expect(editor.selection).toBeNull();
		expect(document.activeElement).toBe(blockElement);

		await act(async () => {
			root.unmount();
		});
		container.remove();
		editor.destroy();
	});

	it("ignores Escape while composition is active", async () => {
		const editor = createEditor();
		const blockId = editor.firstBlock()!.id;

		editor.apply([
			{ type: "insert-text", blockId, offset: 0, text: "Hello world" },
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

		const fieldEditor = getFieldEditor(editor);
		const rootElement = container.querySelector(
			"[data-pen-editor-root]",
		) as HTMLElement | null;
		const inlineElement = container.querySelector(
			"[data-pen-inline-content]",
		) as HTMLElement | null;

		expect(rootElement).not.toBeNull();
		expect(inlineElement).not.toBeNull();

		await act(async () => {
			fieldEditor.activateTextSelection(blockId, 0, 5);
			await flushAnimationFrames(2);
		});

		await act(async () => {
			inlineElement?.dispatchEvent(
				new CompositionEvent("compositionstart", { bubbles: true }),
			);
		});

		expect(fieldEditor.getSnapshot()).toMatchObject({
			focusBlockId: blockId,
			isComposing: true,
			isEditing: true,
			mode: "single",
		});

		await act(async () => {
			rootElement?.dispatchEvent(createEscapeEvent());
			await flushAnimationFrames(2);
		});

		expect(editor.selection).toMatchObject({
			type: "text",
			anchor: { blockId, offset: 0 },
			focus: { blockId, offset: 5 },
			isCollapsed: false,
		});
		expect(fieldEditor.getSnapshot()).toMatchObject({
			focusBlockId: blockId,
			isComposing: true,
			isEditing: true,
			mode: "single",
		});

		await act(async () => {
			inlineElement?.dispatchEvent(
				new CompositionEvent("compositionend", { bubbles: true }),
			);
			await flushAnimationFrames(2);
			root.unmount();
		});
		container.remove();
		editor.destroy();
	});

	it("preserves remote edits that land during IME composition", async () => {
		const editor = createEditor();
		const blockId = editor.firstBlock()!.id;

		editor.apply([
			{ type: "insert-text", blockId, offset: 0, text: "Hello" },
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

		const fieldEditor = getFieldEditor(editor);
		const inlineElement = container.querySelector(
			"[data-pen-inline-content]",
		) as HTMLElement | null;

		expect(inlineElement).not.toBeNull();

		await act(async () => {
			fieldEditor.activateTextSelection(blockId, 5, 5);
			await flushAnimationFrames(2);
		});

		await act(async () => {
			inlineElement?.dispatchEvent(
				new CompositionEvent("compositionstart", { bubbles: true }),
			);
		});

		await act(async () => {
			if (inlineElement) {
				inlineElement.textContent = "Hello!";
			}
			editor.apply(
				[{ type: "insert-text", blockId, offset: 0, text: "X" }],
				{ origin: "collaborator" },
			);
			await flushAnimationFrames(2);
		});

		await act(async () => {
			inlineElement?.dispatchEvent(
				new CompositionEvent("compositionend", { bubbles: true }),
			);
			await flushAnimationFrames(2);
		});

		expect(editor.getBlock(blockId)?.textContent()).toBe("XHello!");

		await act(async () => {
			root.unmount();
		});
		container.remove();
		editor.destroy();
	});

	it("re-homes the active field editor when native selection moves into another block", async () => {
		const editor = createEditor();
		const firstBlockId = editor.firstBlock()!.id;
		const secondBlockId = crypto.randomUUID();

		editor.apply([
			{
				type: "insert-text",
				blockId: firstBlockId,
				offset: 0,
				text: "Hello",
			},
			{
				type: "insert-block",
				blockId: secondBlockId,
				blockType: "paragraph",
				props: {},
				position: { after: firstBlockId },
			},
			{
				type: "insert-text",
				blockId: secondBlockId,
				offset: 0,
				text: "World",
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

		const fieldEditor = getFieldEditor(editor);
		const rootElement = container.querySelector(
			"[data-pen-editor-root]",
		) as HTMLElement | null;
		const inlineElements = container.querySelectorAll(
			"[data-pen-inline-content]",
		);
		const secondInlineElement = inlineElements[1] as
			| HTMLElement
			| undefined;

		expect(rootElement).not.toBeNull();
		expect(secondInlineElement).toBeDefined();

		await act(async () => {
			fieldEditor.activate(firstBlockId);
			editor.selectTextRange(
				{ blockId: firstBlockId, offset: 0 },
				{ blockId: firstBlockId, offset: 0 },
			);
			await flushAnimationFrames(2);
		});

		await act(async () => {
			const selection = document.getSelection();
			const range = document.createRange();
			range.setStart(
				secondInlineElement!.firstChild ?? secondInlineElement!,
				1,
			);
			range.setEnd(
				secondInlineElement!.firstChild ?? secondInlineElement!,
				1,
			);
			selection?.removeAllRanges();
			selection?.addRange(range);
			document.dispatchEvent(new Event("selectionchange"));
			await flushAnimationFrames(3);
		});

		expect(editor.selection).toMatchObject({
			type: "text",
			anchor: { blockId: secondBlockId, offset: 1 },
			focus: { blockId: secondBlockId, offset: 1 },
			isCollapsed: true,
		});
		expect(fieldEditor.getSnapshot()).toMatchObject({
			focusBlockId: secondBlockId,
			activeBlockIds: [secondBlockId],
			isEditing: true,
			mode: "single",
		});
		expect(domSelectionToEditor(rootElement!)).toMatchObject({
			anchor: { blockId: secondBlockId, offset: 1 },
			focus: { blockId: secondBlockId, offset: 1 },
		});

		await act(async () => {
			root.unmount();
		});
		container.remove();
		editor.destroy();
	});

	it("maps cmd+a from block selection directly to full-document selection in flow documents", async () => {
		const editor = createEditor({
			documentProfile: "flow",
		});
		const firstBlockId = editor.firstBlock()!.id;
		const secondBlockId = crypto.randomUUID();
		const thirdBlockId = crypto.randomUUID();

		editor.apply([
			{
				type: "insert-text",
				blockId: firstBlockId,
				offset: 0,
				text: "First",
			},
			{
				type: "insert-block",
				blockId: secondBlockId,
				blockType: "paragraph",
				props: {},
				position: { after: firstBlockId },
			},
			{
				type: "insert-text",
				blockId: secondBlockId,
				offset: 0,
				text: "Second",
			},
			{
				type: "insert-block",
				blockId: thirdBlockId,
				blockType: "paragraph",
				props: {},
				position: { after: secondBlockId },
			},
			{
				type: "insert-text",
				blockId: thirdBlockId,
				offset: 0,
				text: "Third",
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

		const fieldEditor = getFieldEditor(editor);
		await act(async () => {
			fieldEditor.activate(firstBlockId);
			editor.selectTextRange(
				{ blockId: firstBlockId, offset: 0 },
				{ blockId: firstBlockId, offset: 2 },
			);
			await flushAnimationFrames(2);
		});

		await act(async () => {
			document.dispatchEvent(createSelectAllEvent());
			await flushAnimationFrames(2);
		});

		expect(editor.selection).toMatchObject({
			type: "text",
			anchor: { blockId: firstBlockId, offset: 0 },
			focus: { blockId: thirdBlockId, offset: 5 },
			isMultiBlock: true,
		});
		expect(fieldEditor.getSnapshot()).toMatchObject({
			focusBlockId: firstBlockId,
			activeBlockIds: [firstBlockId, secondBlockId, thirdBlockId],
			isEditing: true,
			mode: "expanded",
		});

		await act(async () => {
			root.unmount();
		});
		container.remove();
		editor.destroy();
	});

	it("maps cmd+a from an empty block directly to full-document selection in flow documents", async () => {
		const editor = createEditor({
			documentProfile: "flow",
		});
		const firstBlockId = editor.firstBlock()!.id;
		const secondBlockId = crypto.randomUUID();
		const thirdBlockId = crypto.randomUUID();

		editor.apply([
			{
				type: "insert-block",
				blockId: secondBlockId,
				blockType: "paragraph",
				props: {},
				position: { after: firstBlockId },
			},
			{
				type: "insert-text",
				blockId: secondBlockId,
				offset: 0,
				text: "Second",
			},
			{
				type: "insert-block",
				blockId: thirdBlockId,
				blockType: "paragraph",
				props: {},
				position: { after: secondBlockId },
			},
			{
				type: "insert-text",
				blockId: thirdBlockId,
				offset: 0,
				text: "Third",
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

		const fieldEditor = getFieldEditor(editor);
		await act(async () => {
			fieldEditor.activate(firstBlockId);
			await flushAnimationFrames(2);
		});

		await act(async () => {
			document.dispatchEvent(createSelectAllEvent());
			await flushAnimationFrames(2);
		});

		expect(editor.selection).toMatchObject({
			type: "text",
			anchor: { blockId: firstBlockId, offset: 0 },
			focus: { blockId: thirdBlockId, offset: 5 },
			isMultiBlock: true,
		});
		expect(fieldEditor.getSnapshot()).toMatchObject({
			focusBlockId: firstBlockId,
			activeBlockIds: [firstBlockId, secondBlockId, thirdBlockId],
			isEditing: true,
			mode: "expanded",
		});

		await act(async () => {
			root.unmount();
		});
		container.remove();
		editor.destroy();
	});

	it("maps cmd+a from a collapsed EditContext selection via the root handler", async () => {
		const originalEditContext = (
			globalThis as typeof globalThis & {
				EditContext?: typeof FakeEditContext;
			}
		).EditContext;
		(
			globalThis as typeof globalThis & {
				EditContext?: typeof FakeEditContext;
			}
		).EditContext = FakeEditContext;

		try {
			const editor = createEditor({
				documentProfile: "flow",
			});
			const firstBlockId = editor.firstBlock()!.id;
			const secondBlockId = crypto.randomUUID();
			const thirdBlockId = crypto.randomUUID();

			editor.apply([
				{
					type: "insert-text",
					blockId: firstBlockId,
					offset: 0,
					text: "First",
				},
				{
					type: "insert-block",
					blockId: secondBlockId,
					blockType: "paragraph",
					props: {},
					position: { after: firstBlockId },
				},
				{
					type: "insert-text",
					blockId: secondBlockId,
					offset: 0,
					text: "Second",
				},
				{
					type: "insert-block",
					blockId: thirdBlockId,
					blockType: "paragraph",
					props: {},
					position: { after: secondBlockId },
				},
				{
					type: "insert-text",
					blockId: thirdBlockId,
					offset: 0,
					text: "Third",
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

			const fieldEditor = getFieldEditor(editor);
			await act(async () => {
				fieldEditor.activateTextSelection(firstBlockId, 1, 1);
				await flushAnimationFrames(2);
			});

			await act(async () => {
				document.dispatchEvent(createSelectAllEvent());
				await flushAnimationFrames(2);
			});

			expect(editor.selection).toMatchObject({
				type: "text",
				anchor: { blockId: firstBlockId, offset: 0 },
				focus: { blockId: thirdBlockId, offset: 5 },
				isMultiBlock: true,
			});

			await act(async () => {
				root.unmount();
			});
			container.remove();
			editor.destroy();
		} finally {
			(
				globalThis as typeof globalThis & {
					EditContext?: typeof FakeEditContext;
				}
			).EditContext = originalEditContext;
		}
	});

	it("uses document-first cmd+a by default for content-first structured documents", async () => {
		const editor = createEditor();
		const firstBlockId = editor.firstBlock()!.id;
		const secondBlockId = crypto.randomUUID();

		editor.apply([
			{
				type: "insert-text",
				blockId: firstBlockId,
				offset: 0,
				text: "First",
			},
			{
				type: "insert-block",
				blockId: secondBlockId,
				blockType: "paragraph",
				props: {},
				position: { after: firstBlockId },
			},
			{
				type: "insert-text",
				blockId: secondBlockId,
				offset: 0,
				text: "Second",
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

		const fieldEditor = getFieldEditor(editor);
		await act(async () => {
			fieldEditor.activateTextSelection(firstBlockId, 0, 5);
			await flushAnimationFrames(2);
		});

		await act(async () => {
			document.dispatchEvent(createSelectAllEvent());
			await flushAnimationFrames(2);
		});

		expect(editor.selection).toMatchObject({
			type: "text",
			anchor: { blockId: firstBlockId, offset: 0 },
			focus: { blockId: secondBlockId, offset: 6 },
			isMultiBlock: true,
		});

		await act(async () => {
			root.unmount();
		});
		container.remove();
		editor.destroy();
	});

	it("uses block-first cmd+a when block-first interaction is enabled", async () => {
		const editor = createEditor();
		const firstBlockId = editor.firstBlock()!.id;
		const secondBlockId = crypto.randomUUID();
		const thirdBlockId = crypto.randomUUID();

		editor.apply([
			{
				type: "insert-text",
				blockId: firstBlockId,
				offset: 0,
				text: "First",
			},
			{
				type: "insert-block",
				blockId: secondBlockId,
				blockType: "paragraph",
				props: {},
				position: { after: firstBlockId },
			},
			{
				type: "insert-text",
				blockId: secondBlockId,
				offset: 0,
				text: "Second",
			},
			{
				type: "insert-block",
				blockId: thirdBlockId,
				blockType: "paragraph",
				props: {},
				position: { after: secondBlockId },
			},
			{
				type: "insert-text",
				blockId: thirdBlockId,
				offset: 0,
				text: "Third",
			},
		]);

		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);

		await act(async () => {
			root.render(
				<Pen.Editor.Root editor={editor} interactionModel="block-first">
					<Pen.Editor.Content />
				</Pen.Editor.Root>,
			);
		});

		const fieldEditor = getFieldEditor(editor);
		await act(async () => {
			fieldEditor.activateTextSelection(firstBlockId, 1, 1);
			await flushAnimationFrames(2);
		});

		await act(async () => {
			document.dispatchEvent(createSelectAllEvent());
			await flushAnimationFrames(2);
		});

		expect(editor.selection).toMatchObject({
			type: "text",
			anchor: { blockId: firstBlockId, offset: 0 },
			focus: { blockId: firstBlockId, offset: 5 },
			isMultiBlock: false,
		});

		await act(async () => {
			document.dispatchEvent(createSelectAllEvent());
			await flushAnimationFrames(2);
		});

		expect(editor.selection).toMatchObject({
			type: "text",
			anchor: { blockId: firstBlockId, offset: 0 },
			focus: { blockId: thirdBlockId, offset: 5 },
			isMultiBlock: true,
		});

		await act(async () => {
			root.unmount();
		});
		container.remove();
		editor.destroy();
	});

	it("keeps cmd+a block-scoped before selecting the document when a block is selected in block-first mode", async () => {
		const editor = createEditor();
		const firstBlockId = editor.firstBlock()!.id;
		const secondBlockId = crypto.randomUUID();

		editor.apply([
			{
				type: "insert-text",
				blockId: firstBlockId,
				offset: 0,
				text: "First",
			},
			{
				type: "insert-block",
				blockId: secondBlockId,
				blockType: "paragraph",
				props: {},
				position: { after: firstBlockId },
			},
			{
				type: "insert-text",
				blockId: secondBlockId,
				offset: 0,
				text: "Second",
			},
		]);

		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);

		await act(async () => {
			root.render(
				<Pen.Editor.Root editor={editor} interactionModel="block-first">
					<Pen.Editor.Content />
				</Pen.Editor.Root>,
			);
		});

		const editorRoot = container.querySelector(
			"[data-pen-editor-root]",
		) as HTMLElement | null;
		expect(editorRoot).not.toBeNull();

		await act(async () => {
			editor.selectBlock(firstBlockId);
			editorRoot?.focus();
			await flushAnimationFrames(2);
		});

		await act(async () => {
			document.dispatchEvent(createSelectAllEvent());
			await flushAnimationFrames(2);
		});

		expect(editor.selection).toMatchObject({
			type: "text",
			anchor: { blockId: firstBlockId, offset: 0 },
			focus: { blockId: firstBlockId, offset: 5 },
			isMultiBlock: false,
		});

		await act(async () => {
			document.dispatchEvent(createSelectAllEvent());
			await flushAnimationFrames(2);
		});

		expect(editor.selection).toMatchObject({
			type: "text",
			anchor: { blockId: firstBlockId, offset: 0 },
			focus: { blockId: secondBlockId, offset: 6 },
			isMultiBlock: true,
		});

		await act(async () => {
			root.unmount();
		});
		container.remove();
		editor.destroy();
	});

	it("collapses cross-block selections to the focus caret", async () => {
		const editor = createEditor();
		const firstBlockId = editor.firstBlock()!.id;
		const secondBlockId = crypto.randomUUID();

		editor.apply([
			{
				type: "insert-text",
				blockId: firstBlockId,
				offset: 0,
				text: "Hello",
			},
			{
				type: "insert-block",
				blockId: secondBlockId,
				blockType: "paragraph",
				props: {},
				position: { after: firstBlockId },
			},
			{
				type: "insert-text",
				blockId: secondBlockId,
				offset: 0,
				text: "World",
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

		const fieldEditor = getFieldEditor(editor);
		const rootElement = container.querySelector(
			"[data-pen-editor-root]",
		) as HTMLElement | null;

		expect(rootElement).not.toBeNull();

		await act(async () => {
			editor.setSelection(
				new DocumentRangeImpl(
					{ blockId: firstBlockId, offset: 1 },
					{ blockId: secondBlockId, offset: 2 },
					editor.internals.doc,
				).toTextSelection(),
			);
		});

		expect(editor.selection).toMatchObject({
			type: "text",
			anchor: { blockId: firstBlockId, offset: 1 },
			focus: { blockId: secondBlockId, offset: 2 },
			isMultiBlock: true,
		});

		await act(async () => {
			document.dispatchEvent(createEscapeEvent());
			await flushAnimationFrames(2);
		});

		expect(editor.selection).toMatchObject({
			type: "text",
			anchor: { blockId: secondBlockId, offset: 2 },
			focus: { blockId: secondBlockId, offset: 2 },
			isCollapsed: true,
			isMultiBlock: false,
		});
		expect(domSelectionToEditor(rootElement!)).toMatchObject({
			anchor: { blockId: secondBlockId, offset: 2 },
			focus: { blockId: secondBlockId, offset: 2 },
		});
		expect(fieldEditor.getSnapshot()).toMatchObject({
			focusBlockId: secondBlockId,
			activeBlockIds: [secondBlockId],
			isEditing: true,
			mode: "single",
		});

		await act(async () => {
			root.unmount();
		});
		container.remove();
		editor.destroy();
	});

	it("handles Escape from the active expanded host after cmd+a", async () => {
		const editor = createEditor({
			documentProfile: "flow",
		});
		const firstBlockId = editor.firstBlock()!.id;
		const secondBlockId = crypto.randomUUID();
		const thirdBlockId = crypto.randomUUID();

		editor.apply([
			{
				type: "insert-text",
				blockId: firstBlockId,
				offset: 0,
				text: "First",
			},
			{
				type: "insert-block",
				blockId: secondBlockId,
				blockType: "paragraph",
				props: {},
				position: { after: firstBlockId },
			},
			{
				type: "insert-text",
				blockId: secondBlockId,
				offset: 0,
				text: "Second",
			},
			{
				type: "insert-block",
				blockId: thirdBlockId,
				blockType: "paragraph",
				props: {},
				position: { after: secondBlockId },
			},
			{
				type: "insert-text",
				blockId: thirdBlockId,
				offset: 0,
				text: "Third",
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

		const fieldEditor = getFieldEditor(editor);
		const blocksHost = container.querySelector(
			"[data-pen-editor-blocks-host]",
		) as HTMLElement | null;

		expect(blocksHost).not.toBeNull();

		await act(async () => {
			fieldEditor.activate(firstBlockId);
			document.dispatchEvent(createSelectAllEvent());
			await flushAnimationFrames(2);
		});

		expect(editor.selection).toMatchObject({
			type: "text",
			anchor: { blockId: firstBlockId, offset: 0 },
			focus: { blockId: thirdBlockId, offset: 5 },
			isMultiBlock: true,
		});
		expect(fieldEditor.getSnapshot()).toMatchObject({
			focusBlockId: firstBlockId,
			activeBlockIds: [firstBlockId, secondBlockId, thirdBlockId],
			isEditing: true,
			mode: "expanded",
		});

		await act(async () => {
			blocksHost?.dispatchEvent(createEscapeEvent());
			await flushAnimationFrames(2);
		});

		expect(editor.selection).toMatchObject({
			type: "text",
			anchor: { blockId: thirdBlockId, offset: 5 },
			focus: { blockId: thirdBlockId, offset: 5 },
			isCollapsed: true,
			isMultiBlock: false,
		});
		expect(fieldEditor.getSnapshot()).toMatchObject({
			focusBlockId: thirdBlockId,
			activeBlockIds: [thirdBlockId],
			isEditing: true,
			mode: "single",
		});

		await act(async () => {
			root.unmount();
		});
		container.remove();
		editor.destroy();
	});

	it("collapses backwards cross-block selections to the focus caret", async () => {
		const editor = createEditor();
		const firstBlockId = editor.firstBlock()!.id;
		const secondBlockId = crypto.randomUUID();

		editor.apply([
			{
				type: "insert-text",
				blockId: firstBlockId,
				offset: 0,
				text: "Hello",
			},
			{
				type: "insert-block",
				blockId: secondBlockId,
				blockType: "paragraph",
				props: {},
				position: { after: firstBlockId },
			},
			{
				type: "insert-text",
				blockId: secondBlockId,
				offset: 0,
				text: "World",
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

		const fieldEditor = getFieldEditor(editor);
		const rootElement = container.querySelector(
			"[data-pen-editor-root]",
		) as HTMLElement | null;

		expect(rootElement).not.toBeNull();

		await act(async () => {
			editor.setSelection(
				new DocumentRangeImpl(
					{ blockId: secondBlockId, offset: 4 },
					{ blockId: firstBlockId, offset: 1 },
					editor.internals.doc,
				).toTextSelection(),
			);
			await flushAnimationFrames(2);
		});

		expect(editor.selection).toMatchObject({
			type: "text",
			anchor: { blockId: secondBlockId, offset: 4 },
			focus: { blockId: firstBlockId, offset: 1 },
			isMultiBlock: true,
		});

		await act(async () => {
			rootElement?.dispatchEvent(createEscapeEvent());
			await flushAnimationFrames(2);
		});

		expect(editor.selection).toMatchObject({
			type: "text",
			anchor: { blockId: firstBlockId, offset: 1 },
			focus: { blockId: firstBlockId, offset: 1 },
			isCollapsed: true,
			isMultiBlock: false,
		});
		expect(domSelectionToEditor(rootElement!)).toMatchObject({
			anchor: { blockId: firstBlockId, offset: 1 },
			focus: { blockId: firstBlockId, offset: 1 },
		});
		expect(fieldEditor.getSnapshot()).toMatchObject({
			focusBlockId: firstBlockId,
			activeBlockIds: [firstBlockId],
			isEditing: true,
			mode: "single",
		});

		await act(async () => {
			root.unmount();
		});
		container.remove();
		editor.destroy();
	});

	it("promotes native cross-block DOM selection into expanded text selection", async () => {
		const editor = createEditor();
		const firstBlockId = editor.firstBlock()!.id;
		const secondBlockId = crypto.randomUUID();

		editor.apply([
			{
				type: "insert-text",
				blockId: firstBlockId,
				offset: 0,
				text: "Hello",
			},
			{
				type: "insert-block",
				blockId: secondBlockId,
				blockType: "paragraph",
				props: {},
				position: { after: firstBlockId },
			},
			{
				type: "insert-text",
				blockId: secondBlockId,
				offset: 0,
				text: "World",
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

		const fieldEditor = getFieldEditor(editor);
		const rootElement = container.querySelector(
			"[data-pen-editor-root]",
		) as HTMLElement | null;
		const inlineElements = container.querySelectorAll(
			"[data-pen-inline-content]",
		);
		const firstInlineElement = inlineElements[0] as HTMLElement | undefined;
		const secondInlineElement = inlineElements[1] as
			| HTMLElement
			| undefined;

		expect(rootElement).not.toBeNull();
		expect(firstInlineElement).toBeDefined();
		expect(secondInlineElement).toBeDefined();

		await act(async () => {
			fieldEditor.activate(firstBlockId);
			await flushAnimationFrames(1);
		});

		await act(async () => {
			const selection = document.getSelection();
			const range = document.createRange();
			range.setStart(
				firstInlineElement!.firstChild ?? firstInlineElement!,
				1,
			);
			range.setEnd(
				secondInlineElement!.firstChild ?? secondInlineElement!,
				2,
			);

			selection?.removeAllRanges();
			selection?.addRange(range);
			document.dispatchEvent(new Event("selectionchange"));
			await flushAnimationFrames(2);
		});

		expect(domSelectionToEditor(rootElement!)).toMatchObject({
			anchor: { blockId: firstBlockId, offset: 1 },
			focus: { blockId: secondBlockId, offset: 2 },
		});
		expect(editor.selection).toMatchObject({
			type: "text",
			anchor: { blockId: firstBlockId, offset: 1 },
			focus: { blockId: secondBlockId, offset: 2 },
			isMultiBlock: true,
		});
		expect(fieldEditor.getSnapshot()).toMatchObject({
			focusBlockId: firstBlockId,
			activeBlockIds: [firstBlockId, secondBlockId],
			isEditing: true,
			mode: "expanded",
		});

		await act(async () => {
			root.unmount();
		});
		container.remove();
		editor.destroy();
	});

	it("keeps expanded inline blocks reconciled from CRDT updates", async () => {
		const editor = createEditor();
		const firstBlockId = editor.firstBlock()!.id;
		const secondBlockId = crypto.randomUUID();

		editor.apply([
			{
				type: "insert-text",
				blockId: firstBlockId,
				offset: 0,
				text: "Hello",
			},
			{
				type: "insert-block",
				blockId: secondBlockId,
				blockType: "paragraph",
				props: {},
				position: { after: firstBlockId },
			},
			{
				type: "insert-text",
				blockId: secondBlockId,
				offset: 0,
				text: "World",
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

		const fieldEditor = getFieldEditor(editor);
		const blocksHost = container.querySelector(
			"[data-pen-editor-blocks-host]",
		) as HTMLElement | null;
		const inlineElements = container.querySelectorAll(
			"[data-pen-inline-content]",
		);
		const secondInlineElement = inlineElements[1] as
			| HTMLElement
			| undefined;

		expect(blocksHost).not.toBeNull();
		expect(blocksHost?.hasAttribute("data-pen-field-editor-surface")).toBe(
			false,
		);
		expect(
			blocksHost?.hasAttribute("data-pen-field-editor-active-surface"),
		).toBe(false);
		expect(secondInlineElement).toBeDefined();

		await act(async () => {
			fieldEditor.activate(firstBlockId);
			editor.selectTextRange(
				{ blockId: firstBlockId, offset: 1 },
				{ blockId: secondBlockId, offset: 2 },
			);
			await flushAnimationFrames(2);
		});

		expect(fieldEditor.getSnapshot()).toMatchObject({
			activeBlockIds: [firstBlockId, secondBlockId],
			mode: "expanded",
		});
		expect(blocksHost?.hasAttribute("data-pen-field-editor-surface")).toBe(
			true,
		);
		expect(
			blocksHost?.hasAttribute("data-pen-field-editor-active-surface"),
		).toBe(true);

		await act(async () => {
			editor.apply([
				{
					type: "insert-text",
					blockId: secondBlockId,
					offset: 5,
					text: "!",
				},
			]);
			await flushAnimationFrames(2);
		});

		expect(secondInlineElement?.textContent).toBe("World!");

		await act(async () => {
			root.unmount();
		});
		container.remove();
		editor.destroy();
	});

	it("expands an in-progress drag selection into the next block", async () => {
		const editor = createEditor();
		const firstBlockId = editor.firstBlock()!.id;
		const secondBlockId = crypto.randomUUID();

		editor.apply([
			{
				type: "insert-text",
				blockId: firstBlockId,
				offset: 0,
				text: "Hello",
			},
			{
				type: "insert-block",
				blockId: secondBlockId,
				blockType: "paragraph",
				props: {},
				position: { after: firstBlockId },
			},
			{
				type: "insert-text",
				blockId: secondBlockId,
				offset: 0,
				text: "World",
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

		const fieldEditor = getFieldEditor(editor);
		const inlineElements = container.querySelectorAll(
			"[data-pen-inline-content]",
		);
		const blockElements = container.querySelectorAll("[data-block-id]");
		const rootElement = container.querySelector(
			"[data-pen-editor-root]",
		) as HTMLElement | null;
		const blocksHost = container.querySelector(
			"[data-pen-editor-blocks-host]",
		) as HTMLElement | null;
		const firstInlineElement = inlineElements[0] as HTMLElement | undefined;
		const secondInlineElement = inlineElements[1] as
			| HTMLElement
			| undefined;
		const secondBlockElement = blockElements[1] as HTMLElement | undefined;

		expect(rootElement).not.toBeNull();
		expect(blocksHost).not.toBeNull();
		expect(firstInlineElement).toBeDefined();
		expect(secondInlineElement).toBeDefined();
		expect(secondBlockElement).toBeDefined();

		await act(async () => {
			fieldEditor.activate(firstBlockId);
			editor.selectTextRange(
				{ blockId: firstBlockId, offset: 1 },
				{ blockId: firstBlockId, offset: 5 },
			);
			firstInlineElement?.dispatchEvent(
				new MouseEvent("mousedown", {
					bubbles: true,
					button: 0,
					buttons: 1,
				}),
			);
			setNativeSelectionRange(
				firstInlineElement!,
				1,
				secondInlineElement!,
				2,
			);
			document.dispatchEvent(createMouseUpEvent());
			await flushAnimationFrames(2);
		});

		expect(editor.selection).toMatchObject({
			type: "text",
			anchor: { blockId: firstBlockId, offset: 1 },
			focus: { blockId: secondBlockId, offset: 2 },
			isMultiBlock: true,
		});
		expect(domSelectionToEditor(rootElement!)).toMatchObject({
			anchor: { blockId: firstBlockId, offset: 1 },
			focus: { blockId: secondBlockId, offset: 2 },
		});
		expect(fieldEditor.getSnapshot()).toMatchObject({
			focusBlockId: firstBlockId,
			activeBlockIds: [firstBlockId, secondBlockId],
			mode: "expanded",
		});
		expect(document.activeElement).toBe(blocksHost);

		await act(async () => {
			secondBlockElement?.dispatchEvent(
				new MouseEvent("click", {
					bubbles: true,
					button: 0,
				}),
			);
		});

		expect(editor.selection).toMatchObject({
			type: "text",
			anchor: { blockId: firstBlockId, offset: 1 },
			focus: { blockId: secondBlockId, offset: 2 },
			isMultiBlock: true,
		});
		expect(domSelectionToEditor(rootElement!)).toMatchObject({
			anchor: { blockId: firstBlockId, offset: 1 },
			focus: { blockId: secondBlockId, offset: 2 },
		});

		await act(async () => {
			root.unmount();
		});
		container.remove();
		editor.destroy();
	});

	it("hands off drag updates to native selection after expansion", async () => {
		const editor = createEditor();
		const firstBlockId = editor.firstBlock()!.id;
		const secondBlockId = crypto.randomUUID();

		editor.apply([
			{
				type: "insert-text",
				blockId: firstBlockId,
				offset: 0,
				text: "Hello",
			},
			{
				type: "insert-block",
				blockId: secondBlockId,
				blockType: "paragraph",
				props: {},
				position: { after: firstBlockId },
			},
			{
				type: "insert-text",
				blockId: secondBlockId,
				offset: 0,
				text: "World",
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

		const fieldEditor = getFieldEditor(editor);
		const inlineElements = container.querySelectorAll(
			"[data-pen-inline-content]",
		);
		const blockElements = container.querySelectorAll("[data-block-id]");
		const rootElement = container.querySelector(
			"[data-pen-editor-root]",
		) as HTMLElement | null;
		const firstInlineElement = inlineElements[0] as HTMLElement | undefined;
		const secondInlineElement = inlineElements[1] as
			| HTMLElement
			| undefined;
		const secondBlockElement = blockElements[1] as HTMLElement | undefined;

		expect(rootElement).not.toBeNull();
		expect(firstInlineElement).toBeDefined();
		expect(secondInlineElement).toBeDefined();
		expect(secondBlockElement).toBeDefined();

		await act(async () => {
			fieldEditor.activate(firstBlockId);
			editor.selectTextRange(
				{ blockId: firstBlockId, offset: 1 },
				{ blockId: firstBlockId, offset: 5 },
			);
			firstInlineElement?.dispatchEvent(
				new MouseEvent("mousedown", {
					bubbles: true,
					button: 0,
					buttons: 1,
				}),
			);
			setNativeSelectionRange(
				firstInlineElement!,
				1,
				secondInlineElement!,
				2,
			);
			document.dispatchEvent(createMouseUpEvent());
			await flushAnimationFrames(2);
		});

		expect(editor.selection).toMatchObject({
			type: "text",
			anchor: { blockId: firstBlockId, offset: 1 },
			focus: { blockId: secondBlockId, offset: 2 },
			isMultiBlock: true,
		});

		await act(async () => {
			setNativeSelectionRange(
				firstInlineElement!,
				1,
				secondInlineElement!,
				4,
			);
			document.dispatchEvent(new Event("selectionchange"));
			await flushAnimationFrames(2);
		});

		expect(editor.selection).toMatchObject({
			type: "text",
			anchor: { blockId: firstBlockId, offset: 1 },
			focus: { blockId: secondBlockId, offset: 4 },
			isMultiBlock: true,
		});
		expect(fieldEditor.getSnapshot()).toMatchObject({
			focusBlockId: firstBlockId,
			activeBlockIds: [firstBlockId, secondBlockId],
			mode: "expanded",
		});

		expect(editor.selection).toMatchObject({
			type: "text",
			anchor: { blockId: firstBlockId, offset: 1 },
			focus: { blockId: secondBlockId, offset: 4 },
			isMultiBlock: true,
		});
		expect(domSelectionToEditor(rootElement!)).toMatchObject({
			anchor: { blockId: firstBlockId, offset: 1 },
			focus: { blockId: secondBlockId, offset: 4 },
		});

		await act(async () => {
			root.unmount();
		});
		container.remove();
		editor.destroy();
	});

	it("waits for mouseup before promoting a native cross-block drag", async () => {
		const editor = createEditor();
		const firstBlockId = editor.firstBlock()!.id;
		const secondBlockId = crypto.randomUUID();

		editor.apply([
			{
				type: "insert-text",
				blockId: firstBlockId,
				offset: 0,
				text: "Hello",
			},
			{
				type: "insert-block",
				blockId: secondBlockId,
				blockType: "paragraph",
				props: {},
				position: { after: firstBlockId },
			},
			{
				type: "insert-text",
				blockId: secondBlockId,
				offset: 0,
				text: "World",
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

		const fieldEditor = getFieldEditor(editor);
		const inlineElements = container.querySelectorAll(
			"[data-pen-inline-content]",
		);
		const blockElements = container.querySelectorAll("[data-block-id]");
		const rootElement = container.querySelector(
			"[data-pen-editor-root]",
		) as HTMLElement | null;
		const firstInlineElement = inlineElements[0] as HTMLElement | undefined;
		const secondInlineElement = inlineElements[1] as
			| HTMLElement
			| undefined;
		const secondBlockElement = blockElements[1] as HTMLElement | undefined;

		expect(rootElement).not.toBeNull();
		expect(firstInlineElement).toBeDefined();
		expect(secondInlineElement).toBeDefined();
		expect(secondBlockElement).toBeDefined();

		await act(async () => {
			fieldEditor.activate(firstBlockId);
			editor.selectTextRange(
				{ blockId: firstBlockId, offset: 1 },
				{ blockId: firstBlockId, offset: 5 },
			);
			firstInlineElement?.dispatchEvent(
				new MouseEvent("mousedown", {
					bubbles: true,
					button: 0,
					buttons: 1,
				}),
			);
			await flushAnimationFrames(1);
		});

		await act(async () => {
			setNativeSelectionRange(
				firstInlineElement!,
				1,
				secondInlineElement!,
				4,
			);
			expect(domSelectionToEditor(rootElement!)).toMatchObject({
				anchor: { blockId: firstBlockId, offset: 1 },
				focus: { blockId: secondBlockId, offset: 4 },
			});
		});

		expect(editor.selection).toMatchObject({
			type: "text",
			anchor: { blockId: firstBlockId, offset: 1 },
			focus: { blockId: firstBlockId, offset: 5 },
			isMultiBlock: false,
		});

		await act(async () => {
			document.dispatchEvent(createMouseUpEvent());
			await flushAnimationFrames(2);
		});

		expect(editor.selection).toMatchObject({
			type: "text",
			anchor: { blockId: firstBlockId, offset: 1 },
			focus: { blockId: secondBlockId, offset: 4 },
			isMultiBlock: true,
		});
		expect(fieldEditor.getSnapshot()).toMatchObject({
			focusBlockId: firstBlockId,
			activeBlockIds: [firstBlockId, secondBlockId],
			mode: "expanded",
		});

		await act(async () => {
			root.unmount();
		});
		container.remove();
		editor.destroy();
	});

	it("preserves a cross-block drag when the native range clears before mouseup", async () => {
		const editor = createEditor();
		const firstBlockId = editor.firstBlock()!.id;
		const secondBlockId = crypto.randomUUID();

		editor.apply([
			{
				type: "insert-text",
				blockId: firstBlockId,
				offset: 0,
				text: "Hello",
			},
			{
				type: "insert-block",
				blockId: secondBlockId,
				blockType: "paragraph",
				props: {},
				position: { after: firstBlockId },
			},
			{
				type: "insert-text",
				blockId: secondBlockId,
				offset: 0,
				text: "World",
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

		const fieldEditor = getFieldEditor(editor);
		const inlineElements = container.querySelectorAll(
			"[data-pen-inline-content]",
		);
		const rootElement = container.querySelector(
			"[data-pen-editor-root]",
		) as HTMLElement | null;
		const firstInlineElement = inlineElements[0] as HTMLElement | undefined;
		const secondInlineElement = inlineElements[1] as
			| HTMLElement
			| undefined;

		expect(rootElement).not.toBeNull();
		expect(firstInlineElement).toBeDefined();
		expect(secondInlineElement).toBeDefined();

		const originalCaretRangeFromPoint = (
			document as Document & {
				caretRangeFromPoint?: (x: number, y: number) => Range | null;
			}
		).caretRangeFromPoint;

		try {
			(
				document as Document & {
					caretRangeFromPoint?: (
						x: number,
						y: number,
					) => Range | null;
				}
			).caretRangeFromPoint = (_x, y) => {
				const range = document.createRange();
				if (y >= 30) {
					range.setStart(
						secondInlineElement!.firstChild ?? secondInlineElement!,
						4,
					);
				} else {
					range.setStart(
						firstInlineElement!.firstChild ?? firstInlineElement!,
						1,
					);
				}
				range.collapse(true);
				return range;
			};

			await act(async () => {
				fieldEditor.activate(firstBlockId);
				editor.selectTextRange(
					{ blockId: firstBlockId, offset: 1 },
					{ blockId: firstBlockId, offset: 5 },
				);
				firstInlineElement?.dispatchEvent(
					new MouseEvent("mousedown", {
						bubbles: true,
						button: 0,
						buttons: 1,
						clientX: 12,
						clientY: 8,
					}),
				);
				await flushAnimationFrames(1);
			});

			await act(async () => {
				setNativeSelectionRange(
					firstInlineElement!,
					1,
					secondInlineElement!,
					4,
				);
				document.getSelection()?.removeAllRanges();
				document.dispatchEvent(createMouseUpEvent(12, 40));
				await flushAnimationFrames(3);
			});
		} finally {
			(
				document as Document & {
					caretRangeFromPoint?: (
						x: number,
						y: number,
					) => Range | null;
				}
			).caretRangeFromPoint = originalCaretRangeFromPoint;
		}

		expect(editor.selection).toMatchObject({
			type: "text",
			anchor: { blockId: firstBlockId, offset: 1 },
			focus: { blockId: secondBlockId, offset: 4 },
			isMultiBlock: true,
		});
		expect(domSelectionToEditor(rootElement!)).toMatchObject({
			anchor: { blockId: firstBlockId, offset: 1 },
			focus: { blockId: secondBlockId, offset: 4 },
		});

		await act(async () => {
			root.unmount();
		});
		container.remove();
		editor.destroy();
	});

	it("uses the live DOM anchor when a cross-block drag starts unfocused", async () => {
		const editor = createEditor();
		const firstBlockId = editor.firstBlock()!.id;
		const secondBlockId = crypto.randomUUID();

		editor.apply([
			{
				type: "insert-text",
				blockId: firstBlockId,
				offset: 0,
				text: "Hello",
			},
			{
				type: "insert-block",
				blockId: secondBlockId,
				blockType: "paragraph",
				props: {},
				position: { after: firstBlockId },
			},
			{
				type: "insert-text",
				blockId: secondBlockId,
				offset: 0,
				text: "World",
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

		const inlineElements = container.querySelectorAll(
			"[data-pen-inline-content]",
		);
		const firstInlineElement = inlineElements[0] as HTMLElement | undefined;
		const secondInlineElement = inlineElements[1] as
			| HTMLElement
			| undefined;

		expect(firstInlineElement).toBeDefined();
		expect(secondInlineElement).toBeDefined();

		const originalCaretRangeFromPoint = (
			document as Document & {
				caretRangeFromPoint?: (x: number, y: number) => Range | null;
			}
		).caretRangeFromPoint;

		try {
			(
				document as Document & {
					caretRangeFromPoint?: (
						x: number,
						y: number,
					) => Range | null;
				}
			).caretRangeFromPoint = (_x, y) => {
				const range = document.createRange();
				if (y >= 30) {
					range.setStart(
						secondInlineElement!.firstChild ?? secondInlineElement!,
						3,
					);
				} else {
					range.setStart(
						firstInlineElement!.firstChild ?? firstInlineElement!,
						2,
					);
				}
				range.collapse(true);
				return range;
			};

			await act(async () => {
				firstInlineElement?.dispatchEvent(
					new MouseEvent("mousedown", {
						bubbles: true,
						button: 0,
						buttons: 1,
						clientX: 12,
						clientY: 8,
					}),
				);
				setNativeSelectionRange(
					firstInlineElement!,
					2,
					secondInlineElement!,
					3,
				);
				document.dispatchEvent(
					new MouseEvent("mousemove", {
						bubbles: true,
						button: 0,
						buttons: 1,
						clientX: 12,
						clientY: 40,
					}),
				);
				await flushAnimationFrames(2);
			});
		} finally {
			(
				document as Document & {
					caretRangeFromPoint?: (
						x: number,
						y: number,
					) => Range | null;
				}
			).caretRangeFromPoint = originalCaretRangeFromPoint;
		}

		expect(editor.selection).toMatchObject({
			type: "text",
			anchor: { blockId: firstBlockId, offset: 2 },
			focus: { blockId: secondBlockId, offset: 3 },
			isMultiBlock: true,
		});

		await act(async () => {
			root.unmount();
		});
		container.remove();
		editor.destroy();
	});

	it("promotes an unfocused cross-block drag on mousemove before mouseup", async () => {
		const editor = createEditor();
		const firstBlockId = editor.firstBlock()!.id;
		const secondBlockId = crypto.randomUUID();

		editor.apply([
			{
				type: "insert-text",
				blockId: firstBlockId,
				offset: 0,
				text: "Hello",
			},
			{
				type: "insert-block",
				blockId: secondBlockId,
				blockType: "paragraph",
				props: {},
				position: { after: firstBlockId },
			},
			{
				type: "insert-text",
				blockId: secondBlockId,
				offset: 0,
				text: "World",
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

		const fieldEditor = getFieldEditor(editor);
		const inlineElements = container.querySelectorAll(
			"[data-pen-inline-content]",
		);
		const firstInlineElement = inlineElements[0] as HTMLElement | undefined;
		const secondInlineElement = inlineElements[1] as
			| HTMLElement
			| undefined;

		expect(firstInlineElement).toBeDefined();
		expect(secondInlineElement).toBeDefined();

		const originalCaretRangeFromPoint = (
			document as Document & {
				caretRangeFromPoint?: (x: number, y: number) => Range | null;
			}
		).caretRangeFromPoint;

		try {
			(
				document as Document & {
					caretRangeFromPoint?: (
						x: number,
						y: number,
					) => Range | null;
				}
			).caretRangeFromPoint = (_x, y) => {
				const range = document.createRange();
				if (y >= 30) {
					range.setStart(
						secondInlineElement!.firstChild ?? secondInlineElement!,
						4,
					);
				} else {
					range.setStart(
						firstInlineElement!.firstChild ?? firstInlineElement!,
						1,
					);
				}
				range.collapse(true);
				return range;
			};

			await act(async () => {
				firstInlineElement?.dispatchEvent(
					new MouseEvent("mousedown", {
						bubbles: true,
						button: 0,
						buttons: 1,
						clientX: 12,
						clientY: 8,
					}),
				);
				setNativeSelectionRange(
					firstInlineElement!,
					1,
					secondInlineElement!,
					4,
				);
				document.dispatchEvent(
					new MouseEvent("mousemove", {
						bubbles: true,
						button: 0,
						buttons: 1,
						clientX: 12,
						clientY: 40,
					}),
				);
				await flushAnimationFrames(2);
			});
		} finally {
			(
				document as Document & {
					caretRangeFromPoint?: (
						x: number,
						y: number,
					) => Range | null;
				}
			).caretRangeFromPoint = originalCaretRangeFromPoint;
		}

		expect(editor.selection).toMatchObject({
			type: "text",
			anchor: { blockId: firstBlockId, offset: 1 },
			focus: { blockId: secondBlockId, offset: 4 },
			isMultiBlock: true,
		});

		await act(async () => {
			root.unmount();
		});
		container.remove();
		editor.destroy();
	});

	it("keeps the initial pointer anchor when an unfocused cross-block drag has no stable native range", async () => {
		const editor = createEditor();
		const firstBlockId = editor.firstBlock()!.id;
		const secondBlockId = crypto.randomUUID();

		editor.apply([
			{
				type: "insert-text",
				blockId: firstBlockId,
				offset: 0,
				text: "Hello",
			},
			{
				type: "insert-block",
				blockId: secondBlockId,
				blockType: "paragraph",
				props: {},
				position: { after: firstBlockId },
			},
			{
				type: "insert-text",
				blockId: secondBlockId,
				offset: 0,
				text: "World",
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

		const inlineElements = container.querySelectorAll(
			"[data-pen-inline-content]",
		);
		const firstInlineElement = inlineElements[0] as HTMLElement | undefined;
		const secondInlineElement = inlineElements[1] as
			| HTMLElement
			| undefined;

		expect(firstInlineElement).toBeDefined();
		expect(secondInlineElement).toBeDefined();

		const originalCaretRangeFromPoint = (
			document as Document & {
				caretRangeFromPoint?: (x: number, y: number) => Range | null;
			}
		).caretRangeFromPoint;

		try {
			(
				document as Document & {
					caretRangeFromPoint?: (
						x: number,
						y: number,
					) => Range | null;
				}
			).caretRangeFromPoint = (_x, y) => {
				const range = document.createRange();
				if (y >= 30) {
					range.setStart(
						secondInlineElement!.firstChild ?? secondInlineElement!,
						3,
					);
				} else {
					range.setStart(
						firstInlineElement!.firstChild ?? firstInlineElement!,
						1,
					);
				}
				range.collapse(true);
				return range;
			};

			await act(async () => {
				firstInlineElement?.dispatchEvent(
					new MouseEvent("mousedown", {
						bubbles: true,
						button: 0,
						buttons: 1,
						clientX: 12,
						clientY: 8,
					}),
				);
				document.dispatchEvent(
					new MouseEvent("mousemove", {
						bubbles: true,
						button: 0,
						buttons: 1,
						clientX: 12,
						clientY: 40,
					}),
				);
				await flushAnimationFrames(2);
			});
		} finally {
			(
				document as Document & {
					caretRangeFromPoint?: (
						x: number,
						y: number,
					) => Range | null;
				}
			).caretRangeFromPoint = originalCaretRangeFromPoint;
		}

		expect(editor.selection).toMatchObject({
			type: "text",
			anchor: { blockId: firstBlockId, offset: 1 },
			focus: { blockId: secondBlockId, offset: 3 },
			isMultiBlock: true,
		});
		expect(getFieldEditor(editor).getSnapshot()).toMatchObject({
			focusBlockId: firstBlockId,
			activeBlockIds: [firstBlockId, secondBlockId],
			mode: "expanded",
		});

		await act(async () => {
			root.unmount();
		});
		container.remove();
		editor.destroy();
	});

	it("keeps all blocks mounted during a three-block cross-selection", async () => {
		const editor = createEditor();
		const firstBlockId = editor.firstBlock()!.id;
		const secondBlockId = crypto.randomUUID();
		const thirdBlockId = crypto.randomUUID();

		editor.apply([
			{
				type: "insert-text",
				blockId: firstBlockId,
				offset: 0,
				text: "First",
			},
			{
				type: "insert-block",
				blockId: secondBlockId,
				blockType: "paragraph",
				props: {},
				position: { after: firstBlockId },
			},
			{
				type: "insert-text",
				blockId: secondBlockId,
				offset: 0,
				text: "Second",
			},
			{
				type: "insert-block",
				blockId: thirdBlockId,
				blockType: "paragraph",
				props: {},
				position: { after: secondBlockId },
			},
			{
				type: "insert-text",
				blockId: thirdBlockId,
				offset: 0,
				text: "Third",
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

		const fieldEditor = getFieldEditor(editor);
		const inlineElements = container.querySelectorAll(
			"[data-pen-inline-content]",
		);
		const blockElements = container.querySelectorAll("[data-block-id]");
		const rootElement = container.querySelector(
			"[data-pen-editor-root]",
		) as HTMLElement | null;
		const firstInlineElement = inlineElements[0] as HTMLElement | undefined;
		const thirdInlineElement = inlineElements[2] as HTMLElement | undefined;
		const thirdBlockElement = blockElements[2] as HTMLElement | undefined;

		expect(rootElement).not.toBeNull();
		expect(firstInlineElement).toBeDefined();
		expect(thirdInlineElement).toBeDefined();
		expect(thirdBlockElement).toBeDefined();
		expect(editor.documentState.blockOrder).toEqual([
			firstBlockId,
			secondBlockId,
			thirdBlockId,
		]);
		expect(container.querySelectorAll("[data-block-id]")).toHaveLength(3);

		await act(async () => {
			fieldEditor.activate(firstBlockId);
			editor.selectTextRange(
				{ blockId: firstBlockId, offset: 1 },
				{ blockId: firstBlockId, offset: 5 },
			);
			firstInlineElement?.dispatchEvent(
				new MouseEvent("mousedown", {
					bubbles: true,
					button: 0,
					buttons: 1,
				}),
			);
			setNativeSelectionRange(
				firstInlineElement!,
				1,
				thirdInlineElement!,
				2,
			);
			document.dispatchEvent(createMouseUpEvent());
			await flushAnimationFrames(2);
		});

		expect(editor.documentState.blockOrder).toEqual([
			firstBlockId,
			secondBlockId,
			thirdBlockId,
		]);
		expect(container.querySelectorAll("[data-block-id]")).toHaveLength(3);
		expect(editor.getBlock(secondBlockId)?.textContent()).toBe("Second");
		expect(editor.getBlock(thirdBlockId)?.textContent()).toBe("Third");
		expect(editor.selection).toMatchObject({
			type: "text",
			anchor: { blockId: firstBlockId, offset: 1 },
			focus: { blockId: thirdBlockId, offset: 2 },
			isMultiBlock: true,
		});

		await act(async () => {
			root.unmount();
		});
		container.remove();
		editor.destroy();
	});

	it("ignores deleteByDrag while extending an expanded selection", async () => {
		const editor = createEditor();
		const firstBlockId = editor.firstBlock()!.id;
		const secondBlockId = crypto.randomUUID();
		const thirdBlockId = crypto.randomUUID();

		editor.apply([
			{
				type: "insert-text",
				blockId: firstBlockId,
				offset: 0,
				text: "First",
			},
			{
				type: "insert-block",
				blockId: secondBlockId,
				blockType: "paragraph",
				props: {},
				position: { after: firstBlockId },
			},
			{
				type: "insert-text",
				blockId: secondBlockId,
				offset: 0,
				text: "Second",
			},
			{
				type: "insert-block",
				blockId: thirdBlockId,
				blockType: "paragraph",
				props: {},
				position: { after: secondBlockId },
			},
			{
				type: "insert-text",
				blockId: thirdBlockId,
				offset: 0,
				text: "Third",
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

		const fieldEditor = getFieldEditor(editor);
		const blocksHost = container.querySelector(
			"[data-pen-editor-blocks-host]",
		) as HTMLElement | null;

		expect(blocksHost).not.toBeNull();

		await act(async () => {
			fieldEditor.activate(firstBlockId);
			editor.selectTextRange(
				{ blockId: firstBlockId, offset: 1 },
				{ blockId: thirdBlockId, offset: 3 },
			);
			await flushAnimationFrames(2);
		});

		expect(fieldEditor.getSnapshot()).toMatchObject({
			focusBlockId: firstBlockId,
			activeBlockIds: [firstBlockId, secondBlockId, thirdBlockId],
			mode: "expanded",
		});

		await act(async () => {
			blocksHost?.dispatchEvent(
				new InputEvent("beforeinput", {
					bubbles: true,
					cancelable: true,
					inputType: "deleteByDrag",
				}),
			);
			await flushAnimationFrames(1);
		});

		expect(editor.documentState.blockOrder).toEqual([
			firstBlockId,
			secondBlockId,
			thirdBlockId,
		]);
		expect(editor.getBlock(firstBlockId)?.textContent()).toBe("First");
		expect(editor.getBlock(secondBlockId)?.textContent()).toBe("Second");
		expect(editor.getBlock(thirdBlockId)?.textContent()).toBe("Third");

		await act(async () => {
			root.unmount();
		});
		container.remove();
		editor.destroy();
	});

	it("handles enter through the expanded backend without native DOM mutation", async () => {
		const editor = createEditor();
		const firstBlockId = editor.firstBlock()!.id;
		const secondBlockId = crypto.randomUUID();

		editor.apply([
			{
				type: "insert-text",
				blockId: firstBlockId,
				offset: 0,
				text: "Hello",
			},
			{
				type: "insert-block",
				blockId: secondBlockId,
				blockType: "paragraph",
				props: {},
				position: { after: firstBlockId },
			},
			{
				type: "insert-text",
				blockId: secondBlockId,
				offset: 0,
				text: "World",
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

		const fieldEditor = getFieldEditor(editor);
		const blocksHost = container.querySelector(
			"[data-pen-editor-blocks-host]",
		) as HTMLElement | null;

		expect(blocksHost).not.toBeNull();

		await act(async () => {
			fieldEditor.activate(firstBlockId);
			editor.selectTextRange(
				{ blockId: firstBlockId, offset: 1 },
				{ blockId: secondBlockId, offset: 2 },
			);
			await flushAnimationFrames(2);
		});

		expect(fieldEditor.getSnapshot()).toMatchObject({
			activeBlockIds: [firstBlockId, secondBlockId],
			mode: "expanded",
		});

		await act(async () => {
			blocksHost?.dispatchEvent(
				new InputEvent("beforeinput", {
					bubbles: true,
					cancelable: true,
					inputType: "insertParagraph",
				}),
			);
			await flushAnimationFrames(2);
		});

		expect(
			container.querySelectorAll("[data-block-id]").length,
		).toBeGreaterThan(0);
		expect(editor.documentState.blockOrder.length).toBeGreaterThan(0);

		await act(async () => {
			root.unmount();
		});
		container.remove();
		editor.destroy();
	});

	it("prevents native drag start on the expanded host", async () => {
		const editor = createEditor();
		const firstBlockId = editor.firstBlock()!.id;
		const secondBlockId = crypto.randomUUID();

		editor.apply([
			{
				type: "insert-text",
				blockId: firstBlockId,
				offset: 0,
				text: "First",
			},
			{
				type: "insert-block",
				blockId: secondBlockId,
				blockType: "paragraph",
				props: {},
				position: { after: firstBlockId },
			},
			{
				type: "insert-text",
				blockId: secondBlockId,
				offset: 0,
				text: "Second",
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

		const fieldEditor = getFieldEditor(editor);
		const blocksHost = container.querySelector(
			"[data-pen-editor-blocks-host]",
		) as HTMLElement | null;

		expect(blocksHost).not.toBeNull();

		await act(async () => {
			fieldEditor.activate(firstBlockId);
			editor.selectTextRange(
				{ blockId: firstBlockId, offset: 1 },
				{ blockId: secondBlockId, offset: 3 },
			);
			await flushAnimationFrames(2);
		});

		const dragStartEvent = new Event("dragstart", {
			bubbles: true,
			cancelable: true,
		});
		const dropEvent = new Event("drop", {
			bubbles: true,
			cancelable: true,
		});

		expect(blocksHost?.dispatchEvent(dragStartEvent)).toBe(false);
		expect(dragStartEvent.defaultPrevented).toBe(true);
		expect(blocksHost?.dispatchEvent(dropEvent)).toBe(false);
		expect(dropEvent.defaultPrevented).toBe(true);

		await act(async () => {
			root.unmount();
		});
		container.remove();
		editor.destroy();
	});

	it("uses the programmatic post-commit caret when a stale selectionchange arrives before typing", async () => {
		const editor = createEditor();
		const blockId = editor.firstBlock()!.id;

		editor.apply([
			{ type: "insert-text", blockId, offset: 0, text: "Hel" },
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

		const fieldEditor = getFieldEditor(editor);
		const inlineElement = container.querySelector(
			"[data-pen-inline-content]",
		) as HTMLElement | null;

		expect(inlineElement).not.toBeNull();

		await act(async () => {
			fieldEditor.activateTextSelection(blockId, 3, 3);
			fieldEditor.focus();
			fieldEditor.setFocused(true);
			await flushAnimationFrames(2);
		});

		await act(async () => {
			editor.apply(
				[
					{
						type: "insert-text",
						blockId,
						offset: 3,
						text: "lo world",
					},
				],
				{ origin: "ai" },
			);
			fieldEditor.commitProgrammaticTextSelection(blockId, 11, 11);
			await flushAnimationFrames(2);
		});

		await act(async () => {
			setNativeSelectionRange(inlineElement!, 11, inlineElement!, 11);
			document.dispatchEvent(new Event("selectionchange"));
			setNativeSelectionRange(inlineElement!, 3, inlineElement!, 3);
			document.dispatchEvent(new Event("selectionchange"));
			inlineElement?.dispatchEvent(
				new InputEvent("beforeinput", {
					bubbles: true,
					cancelable: true,
					inputType: "insertText",
					data: "!",
				}),
			);
			await flushAnimationFrames(2);
		});

		expect(editor.getBlock(blockId)?.textContent()).toBe("Hello world!");
		expect(editor.selection).toMatchObject({
			type: "text",
			anchor: { blockId, offset: 12 },
			focus: { blockId, offset: 12 },
			isCollapsed: true,
		});

		await act(async () => {
			root.unmount();
		});
		container.remove();
		editor.destroy();
	});

	it("uses the accepted inline completion caret for immediate enter with stale EditContext state", async () => {
		const originalEditContext = (
			globalThis as typeof globalThis & {
				EditContext?: typeof FakeEditContext;
			}
		).EditContext;
		(
			globalThis as typeof globalThis & {
				EditContext?: typeof FakeEditContext;
			}
		).EditContext = FakeEditContext;

		try {
			const editor = createEditor();
			const blockId = editor.firstBlock()!.id;
			const { controller: inlineCompletion } =
				ensureInlineCompletionController(editor);

			editor.apply([
				{ type: "insert-text", blockId, offset: 0, text: "Hel" },
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

			const fieldEditor = getFieldEditor(editor);
			const inlineElement = container.querySelector(
				"[data-pen-inline-content]",
			) as (HTMLElement & { editContext?: FakeEditContext }) | null;

			expect(inlineElement).not.toBeNull();

			await act(async () => {
				fieldEditor.activateTextSelection(blockId, 3, 3);
				await flushAnimationFrames(2);
			});

			await act(async () => {
				inlineElement?.editContext?.emit("textupdate", {
					updateRangeStart: 3,
					updateRangeEnd: 3,
					text: "",
					selectionStart: 3,
					selectionEnd: 3,
				});
				inlineCompletion.showSuggestion({
					id: "suggestion-1",
					blockId,
					offset: 3,
					text: "lo world",
					type: "inline",
				});
				setNativeSelectionRange(inlineElement!, 3, inlineElement!, 3);
				inlineElement?.dispatchEvent(
					new KeyboardEvent("keydown", {
						key: "Tab",
						bubbles: true,
						cancelable: true,
					}),
				);
				await flushAnimationFrames(2);
				setNativeSelectionRange(inlineElement!, 11, inlineElement!, 11);
				inlineElement?.dispatchEvent(
					new KeyboardEvent("keydown", {
						key: "Enter",
						bubbles: true,
						cancelable: true,
					}),
				);
			});

			expect(editor.getBlock(blockId)?.textContent()).toBe("Hello world");

			await act(async () => {
				root.unmount();
			});
			container.remove();
			editor.destroy();
		} finally {
			(
				globalThis as typeof globalThis & {
					EditContext?: typeof FakeEditContext;
				}
			).EditContext = originalEditContext;
		}
	});

	it("uses the programmatic post-commit caret for stale EditContext text updates", async () => {
		const originalEditContext = (
			globalThis as typeof globalThis & {
				EditContext?: typeof FakeEditContext;
			}
		).EditContext;
		(
			globalThis as typeof globalThis & {
				EditContext?: typeof FakeEditContext;
			}
		).EditContext = FakeEditContext;

		try {
			const editor = createEditor();
			const blockId = editor.firstBlock()!.id;

			editor.apply([
				{ type: "insert-text", blockId, offset: 0, text: "Hel" },
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

			const fieldEditor = getFieldEditor(editor);
			const inlineElement = container.querySelector(
				"[data-pen-inline-content]",
			) as (HTMLElement & { editContext?: FakeEditContext }) | null;

			expect(inlineElement).not.toBeNull();

			await act(async () => {
				fieldEditor.activateTextSelection(blockId, 3, 3);
				await flushAnimationFrames(2);
			});

			await act(async () => {
				editor.apply(
					[
						{
							type: "insert-text",
							blockId,
							offset: 3,
							text: "lo world",
						},
					],
					{ origin: "ai" },
				);
				fieldEditor.commitProgrammaticTextSelection(blockId, 11, 11);
				await flushAnimationFrames(2);
			});

			await act(async () => {
				inlineElement?.editContext?.emit("textupdate", {
					updateRangeStart: 3,
					updateRangeEnd: 3,
					text: "!",
					selectionStart: 4,
					selectionEnd: 4,
				});
				await flushAnimationFrames(2);
			});

			expect(editor.getBlock(blockId)?.textContent()).toBe(
				"Hello world!",
			);
			expect(editor.selection).toMatchObject({
				type: "text",
				anchor: { blockId, offset: 12 },
				focus: { blockId, offset: 12 },
				isCollapsed: true,
			});

			await act(async () => {
				root.unmount();
			});
			container.remove();
			editor.destroy();
		} finally {
			(
				globalThis as typeof globalThis & {
					EditContext?: typeof FakeEditContext;
				}
			).EditContext = originalEditContext;
		}
	});

	it("snaps delegated block drag targets to legal block boundaries", async () => {
		const editor = createEditor();
		const firstBlockId = editor.firstBlock()!.id;
		const secondBlockId = crypto.randomUUID();

		editor.apply([
			{
				type: "insert-text",
				blockId: firstBlockId,
				offset: 0,
				text: "Hello",
			},
			{
				type: "insert-block",
				blockId: secondBlockId,
				blockType: "codeBlock",
				props: {},
				position: { after: firstBlockId },
			},
			{
				type: "insert-text",
				blockId: secondBlockId,
				offset: 0,
				text: "World",
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

		const fieldEditor = getFieldEditor(editor);
		const inlineElements = container.querySelectorAll(
			"[data-pen-inline-content]",
		);
		const blockElements = container.querySelectorAll("[data-block-id]");
		const rootElement = container.querySelector(
			"[data-pen-editor-root]",
		) as HTMLElement | null;
		const firstInlineElement = inlineElements[0] as HTMLElement | undefined;
		const secondInlineElement = inlineElements[1] as
			| HTMLElement
			| undefined;
		const secondBlockElement = blockElements[1] as HTMLElement | undefined;
		const secondBlockBoundary = 1;

		expect(rootElement).not.toBeNull();
		expect(firstInlineElement).toBeDefined();
		expect(secondInlineElement).toBeDefined();
		expect(secondBlockElement).toBeDefined();

		const docWithCaretRange = document as Document & {
			caretRangeFromPoint?: (x: number, y: number) => Range | null;
		};
		const originalCaretRangeFromPoint =
			docWithCaretRange.caretRangeFromPoint;
		docWithCaretRange.caretRangeFromPoint = () => {
			const range = document.createRange();
			range.setStart(
				secondInlineElement!.firstChild ?? secondInlineElement!,
				2,
			);
			range.setEnd(
				secondInlineElement!.firstChild ?? secondInlineElement!,
				2,
			);
			return range;
		};

		await act(async () => {
			fieldEditor.activate(firstBlockId);
			editor.selectTextRange(
				{ blockId: firstBlockId, offset: 1 },
				{ blockId: firstBlockId, offset: 5 },
			);
			firstInlineElement?.dispatchEvent(
				new MouseEvent("mousedown", {
					bubbles: true,
					button: 0,
					buttons: 1,
				}),
			);
			setNativeSelectionRange(
				firstInlineElement!,
				1,
				secondInlineElement!,
				2,
			);
			document.dispatchEvent(createMouseUpEvent());
			await flushAnimationFrames(2);
		});

		expect(editor.selection).toMatchObject({
			type: "text",
			anchor: { blockId: firstBlockId, offset: 1 },
			focus: { blockId: secondBlockId, offset: secondBlockBoundary },
			isMultiBlock: true,
		});
		expect(domSelectionToEditor(rootElement!)).toMatchObject({
			anchor: { blockId: firstBlockId, offset: 1 },
			focus: { blockId: secondBlockId, offset: secondBlockBoundary },
		});
		expect(fieldEditor.getSnapshot()).toMatchObject({
			focusBlockId: firstBlockId,
			activeBlockIds: [firstBlockId, secondBlockId],
			mode: "expanded",
		});

		docWithCaretRange.caretRangeFromPoint = originalCaretRangeFromPoint;

		await act(async () => {
			root.unmount();
		});
		container.remove();
		editor.destroy();
	});
});
