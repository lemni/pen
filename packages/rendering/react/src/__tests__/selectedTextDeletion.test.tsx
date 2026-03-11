// @vitest-environment jsdom

import React, { act } from "react";
import { describe, expect, it } from "vitest";
import { createRoot } from "react-dom/client";
import { createEditor } from "@pen/core";
import type { FieldEditorImpl } from "../field-editor/fieldEditorImpl";
import { FIELD_EDITOR_SLOT_KEY } from "../constants/fieldEditor";
import { domSelectionToEditor } from "../field-editor/selectionBridge";
import { Pen } from "../primitives/index";
import { FakeEditContext } from "./utils/fakeEditContext";

(
	globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

async function flushAnimationFrames(count = 1): Promise<void> {
	for (let i = 0; i < count; i++) {
		await new Promise<void>((resolve) => {
			requestAnimationFrame(() => resolve());
		});
	}
}

function createKeyEvent(
	key: string,
	options: KeyboardEventInit = {},
): KeyboardEvent {
	return new KeyboardEvent("keydown", {
		key,
		bubbles: true,
		...options,
	});
}

function createSelectAllEvent(): KeyboardEvent {
	return createKeyEvent("a", {
		metaKey: true,
		cancelable: true,
	});
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

describe("@pen/react selected text deletion", () => {
	it("preserves the full native selection on mouseup after a word select gesture", async () => {
		const editor = createEditor({
			without: ["document-ops", "delta-stream", "undo"],
		});
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
			fieldEditor.activate(blockId);
			await flushAnimationFrames(2);
		});

		const originalCaretRangeFromPoint = (
			document as Document & {
				caretRangeFromPoint?: (x: number, y: number) => Range | null;
			}
		).caretRangeFromPoint;

		try {
			(
				document as Document & {
					caretRangeFromPoint?: (x: number, y: number) => Range | null;
				}
			).caretRangeFromPoint = () => {
				const range = document.createRange();
				range.setStart(inlineElement!.firstChild ?? inlineElement!, 2);
				range.collapse(true);
				return range;
			};

			await act(async () => {
				inlineElement!.dispatchEvent(
					new MouseEvent("mousedown", {
						bubbles: true,
						button: 0,
						clientX: 12,
						clientY: 8,
					}),
				);

				const selection = document.getSelection();
				const range = document.createRange();
				range.setStart(inlineElement!.firstChild ?? inlineElement!, 0);
				range.setEnd(inlineElement!.firstChild ?? inlineElement!, 5);
				selection?.removeAllRanges();
				selection?.addRange(range);

				document.dispatchEvent(
					new MouseEvent("mouseup", {
						bubbles: true,
						button: 0,
						clientX: 12,
						clientY: 8,
					}),
				);
				await flushAnimationFrames(3);
			});
		} finally {
			(
				document as Document & {
					caretRangeFromPoint?: (x: number, y: number) => Range | null;
				}
			).caretRangeFromPoint = originalCaretRangeFromPoint;
		}

		expect(editor.selection).toMatchObject({
			type: "text",
			anchor: { blockId, offset: 0 },
			focus: { blockId, offset: 5 },
			isCollapsed: false,
		});
		expect(domSelectionToEditor(rootElement!)).toMatchObject({
			anchor: { blockId, offset: 0 },
			focus: { blockId, offset: 5 },
		});

		await act(async () => {
			root.unmount();
		});
		container.remove();
		editor.destroy();
	});

	it("preserves third-click block selection when the native range settles after mouseup", async () => {
		const editor = createEditor({
			without: ["document-ops", "delta-stream", "undo"],
		});
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
			fieldEditor.activate(blockId);
			await flushAnimationFrames(2);
		});

		const originalCaretRangeFromPoint = (
			document as Document & {
				caretRangeFromPoint?: (x: number, y: number) => Range | null;
			}
		).caretRangeFromPoint;

		try {
			(
				document as Document & {
					caretRangeFromPoint?: (x: number, y: number) => Range | null;
				}
			).caretRangeFromPoint = () => {
				const range = document.createRange();
				range.setStart(inlineElement!.firstChild ?? inlineElement!, 2);
				range.collapse(true);
				return range;
			};

			await act(async () => {
				inlineElement!.dispatchEvent(
					new MouseEvent("mousedown", {
						bubbles: true,
						button: 0,
						clientX: 12,
						clientY: 8,
						detail: 3,
					}),
				);

				const collapsedRange = document.createRange();
				collapsedRange.setStart(
					inlineElement!.firstChild ?? inlineElement!,
					2,
				);
				collapsedRange.collapse(true);
				document.getSelection()?.removeAllRanges();
				document.getSelection()?.addRange(collapsedRange);

				document.dispatchEvent(
					new MouseEvent("mouseup", {
						bubbles: true,
						button: 0,
						clientX: 12,
						clientY: 8,
						detail: 3,
					}),
				);

				setNativeSelectionRange(inlineElement!, 0, inlineElement!, 11);
				await flushAnimationFrames(3);
			});
		} finally {
			(
				document as Document & {
					caretRangeFromPoint?: (x: number, y: number) => Range | null;
				}
			).caretRangeFromPoint = originalCaretRangeFromPoint;
		}

		expect(editor.selection).toMatchObject({
			type: "text",
			anchor: { blockId, offset: 0 },
			focus: { blockId, offset: 11 },
			isCollapsed: false,
		});
		expect(domSelectionToEditor(rootElement!)).toMatchObject({
			anchor: { blockId, offset: 0 },
			focus: { blockId, offset: 11 },
		});

		await act(async () => {
			root.unmount();
		});
		container.remove();
		editor.destroy();
	});

	it("collapses backspace deletion to the normalized range start", async () => {
		const editor = createEditor({
			without: ["document-ops", "delta-stream", "undo"],
		});
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
		const rootElement = container.querySelector(
			"[data-pen-editor-root]",
		) as HTMLElement | null;
		const inlineElement = container.querySelector(
			"[data-pen-inline-content]",
		) as HTMLElement | null;

		expect(rootElement).not.toBeNull();
		expect(inlineElement).not.toBeNull();

		await act(async () => {
			fieldEditor.activate(blockId);
			await flushAnimationFrames(1);
		});

		await act(async () => {
			const selection = document.getSelection();
			const range = document.createRange();
			range.setStart(inlineElement!.firstChild ?? inlineElement!, 1);
			range.setEnd(inlineElement!.firstChild ?? inlineElement!, 4);

			selection?.removeAllRanges();
			selection?.addRange(range);
			document.dispatchEvent(new Event("selectionchange"));
			await flushAnimationFrames(1);
		});

		expect(editor.selection).toMatchObject({
			type: "text",
			anchor: { blockId, offset: 1 },
			focus: { blockId, offset: 4 },
			isCollapsed: false,
			isMultiBlock: false,
		});

		await act(async () => {
			inlineElement!.dispatchEvent(
				new InputEvent("beforeinput", {
					bubbles: true,
					cancelable: true,
					inputType: "deleteContentBackward",
				}),
			);
			await flushAnimationFrames(2);
		});

		expect(editor.getBlock(blockId)?.textContent()).toBe("Ho");
		expect(editor.selection).toMatchObject({
			type: "text",
			anchor: { blockId, offset: 1 },
			focus: { blockId, offset: 1 },
			isCollapsed: true,
			isMultiBlock: false,
		});
		expect(domSelectionToEditor(rootElement!)).toMatchObject({
			anchor: { blockId, offset: 1 },
			focus: { blockId, offset: 1 },
		});

		await act(async () => {
			root.unmount();
		});
		container.remove();
		editor.destroy();
	});

	it("backspace exits an empty blockquote via beforeinput", async () => {
		const editor = createEditor({
			without: ["document-ops", "delta-stream", "undo"],
		});
		const blockId = editor.firstBlock()!.id;

		editor.apply([{ type: "convert-block", blockId, newType: "blockquote" }]);

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
			fieldEditor.activateTextSelection(blockId, 0, 0);
			await flushAnimationFrames(3);
		});

		await act(async () => {
			inlineElement!.dispatchEvent(
				new InputEvent("beforeinput", {
					bubbles: true,
					cancelable: true,
					inputType: "deleteContentBackward",
				}),
			);
			await flushAnimationFrames(2);
		});

		expect(editor.getBlock(blockId)?.type).toBe("paragraph");
		expect(editor.selection).toMatchObject({
			type: "text",
			anchor: { blockId, offset: 0 },
			focus: { blockId, offset: 0 },
			isCollapsed: true,
			isMultiBlock: false,
		});
		expect(domSelectionToEditor(rootElement!)).toMatchObject({
			anchor: { blockId, offset: 0 },
			focus: { blockId, offset: 0 },
		});

		await act(async () => {
			root.unmount();
		});
		container.remove();
		editor.destroy();
	});

	it("backspace exits an empty bullet list item via beforeinput", async () => {
		const editor = createEditor({
			without: ["document-ops", "delta-stream", "undo"],
		});
		const blockId = editor.firstBlock()!.id;

		editor.apply([
			{ type: "convert-block", blockId, newType: "bulletListItem" },
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
			fieldEditor.activateTextSelection(blockId, 0, 0);
			await flushAnimationFrames(3);
		});

		await act(async () => {
			inlineElement!.dispatchEvent(
				new InputEvent("beforeinput", {
					bubbles: true,
					cancelable: true,
					inputType: "deleteContentBackward",
				}),
			);
			await flushAnimationFrames(2);
		});

		expect(editor.getBlock(blockId)?.type).toBe("paragraph");
		expect(editor.selection).toMatchObject({
			type: "text",
			anchor: { blockId, offset: 0 },
			focus: { blockId, offset: 0 },
			isCollapsed: true,
			isMultiBlock: false,
		});
		expect(domSelectionToEditor(rootElement!)).toMatchObject({
			anchor: { blockId, offset: 0 },
			focus: { blockId, offset: 0 },
		});

		await act(async () => {
			root.unmount();
		});
		container.remove();
		editor.destroy();
	});

	it("converts '- ' into a bullet list item via beforeinput", async () => {
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
			fieldEditor.activateTextSelection(blockId, 0, 0);
			await flushAnimationFrames(3);
		});

		await act(async () => {
			inlineElement!.dispatchEvent(
				new InputEvent("beforeinput", {
					bubbles: true,
					cancelable: true,
					inputType: "insertText",
					data: "-",
				}),
			);
			await flushAnimationFrames(2);
		});

		await act(async () => {
			inlineElement!.dispatchEvent(
				new InputEvent("beforeinput", {
					bubbles: true,
					cancelable: true,
					inputType: "insertText",
					data: " ",
				}),
			);
			await flushAnimationFrames(2);
		});

		expect(editor.getBlock(blockId)?.type).toBe("bulletListItem");
		expect(editor.getBlock(blockId)?.textContent()).toBe("");
		expect(editor.selection).toMatchObject({
			type: "text",
			anchor: { blockId, offset: 0 },
			focus: { blockId, offset: 0 },
			isCollapsed: true,
			isMultiBlock: false,
		});
		expect(domSelectionToEditor(rootElement!)).toMatchObject({
			anchor: { blockId, offset: 0 },
			focus: { blockId, offset: 0 },
		});

		await act(async () => {
			root.unmount();
		});
		container.remove();
		editor.destroy();
	});

	it("converts '3. ' into a numbered list item via beforeinput", async () => {
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
			fieldEditor.activateTextSelection(blockId, 0, 0);
			await flushAnimationFrames(3);
		});

		await act(async () => {
			inlineElement!.dispatchEvent(
				new InputEvent("beforeinput", {
					bubbles: true,
					cancelable: true,
					inputType: "insertText",
					data: "3",
				}),
			);
			inlineElement!.dispatchEvent(
				new InputEvent("beforeinput", {
					bubbles: true,
					cancelable: true,
					inputType: "insertText",
					data: ".",
				}),
			);
			inlineElement!.dispatchEvent(
				new InputEvent("beforeinput", {
					bubbles: true,
					cancelable: true,
					inputType: "insertText",
					data: " ",
				}),
			);
			await flushAnimationFrames(3);
		});

		expect(editor.getBlock(blockId)?.type).toBe("numberedListItem");
		expect(editor.getBlock(blockId)?.props?.start).toBe(3);
		expect(editor.getBlock(blockId)?.textContent()).toBe("");
		expect(editor.selection).toMatchObject({
			type: "text",
			anchor: { blockId, offset: 0 },
			focus: { blockId, offset: 0 },
			isCollapsed: true,
			isMultiBlock: false,
		});
		expect(domSelectionToEditor(rootElement!)).toMatchObject({
			anchor: { blockId, offset: 0 },
			focus: { blockId, offset: 0 },
		});

		await act(async () => {
			root.unmount();
		});
		container.remove();
		editor.destroy();
	});

	it("converts '[ ] ' into a check list item via beforeinput", async () => {
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
			fieldEditor.activateTextSelection(blockId, 0, 0);
			await flushAnimationFrames(3);
		});

		await act(async () => {
			inlineElement!.dispatchEvent(
				new InputEvent("beforeinput", {
					bubbles: true,
					cancelable: true,
					inputType: "insertText",
					data: "[",
				}),
			);
			inlineElement!.dispatchEvent(
				new InputEvent("beforeinput", {
					bubbles: true,
					cancelable: true,
					inputType: "insertText",
					data: " ",
				}),
			);
			inlineElement!.dispatchEvent(
				new InputEvent("beforeinput", {
					bubbles: true,
					cancelable: true,
					inputType: "insertText",
					data: "]",
				}),
			);
			inlineElement!.dispatchEvent(
				new InputEvent("beforeinput", {
					bubbles: true,
					cancelable: true,
					inputType: "insertText",
					data: " ",
				}),
			);
			await flushAnimationFrames(3);
		});

		expect(editor.getBlock(blockId)?.type).toBe("checkListItem");
		expect(editor.getBlock(blockId)?.textContent()).toBe("");
		expect(editor.selection).toMatchObject({
			type: "text",
			anchor: { blockId, offset: 0 },
			focus: { blockId, offset: 0 },
			isCollapsed: true,
			isMultiBlock: false,
		});
		expect(domSelectionToEditor(rootElement!)).toMatchObject({
			anchor: { blockId, offset: 0 },
			focus: { blockId, offset: 0 },
		});

		await act(async () => {
			root.unmount();
		});
		container.remove();
		editor.destroy();
	});

	it("does not convert headings with list triggers via beforeinput", async () => {
		const editor = createEditor({
			without: ["document-ops", "delta-stream", "undo"],
		});
		const blockId = editor.firstBlock()!.id;

		editor.apply([{ type: "convert-block", blockId, newType: "heading" }]);

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
			fieldEditor.activateTextSelection(blockId, 0, 0);
			await flushAnimationFrames(3);
		});

		await act(async () => {
			inlineElement!.dispatchEvent(
				new InputEvent("beforeinput", {
					bubbles: true,
					cancelable: true,
					inputType: "insertText",
					data: "-",
				}),
			);
			inlineElement!.dispatchEvent(
				new InputEvent("beforeinput", {
					bubbles: true,
					cancelable: true,
					inputType: "insertText",
					data: " ",
				}),
			);
			await flushAnimationFrames(3);
		});

		expect(editor.getBlock(blockId)?.type).toBe("heading");
		expect(editor.getBlock(blockId)?.textContent()).toBe("- ");
		expect(editor.selection).toMatchObject({
			type: "text",
			anchor: { blockId, offset: 2 },
			focus: { blockId, offset: 2 },
			isCollapsed: true,
			isMultiBlock: false,
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

	it("lets the active editing surface own first cmd+a backspace deletion", async () => {
		const editor = createEditor({
			without: ["document-ops", "delta-stream", "undo"],
		});
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
			fieldEditor.activate(blockId);
			await flushAnimationFrames(2);
		});

		await act(async () => {
			document.dispatchEvent(createSelectAllEvent());
			await flushAnimationFrames(2);
		});

		expect(editor.selection).toMatchObject({
			type: "text",
			anchor: { blockId, offset: 0 },
			focus: { blockId, offset: 5 },
			isCollapsed: false,
			isMultiBlock: false,
		});

		await act(async () => {
			document.dispatchEvent(createKeyEvent("Backspace"));
			await flushAnimationFrames(1);
		});

		expect(editor.getBlock(blockId)?.textContent()).toBe("Hello");
		expect(editor.selection).toMatchObject({
			type: "text",
			anchor: { blockId, offset: 0 },
			focus: { blockId, offset: 5 },
			isCollapsed: false,
			isMultiBlock: false,
		});

		await act(async () => {
			inlineElement!.dispatchEvent(
				new InputEvent("beforeinput", {
					bubbles: true,
					cancelable: true,
					inputType: "deleteContentBackward",
				}),
			);
			await flushAnimationFrames(2);
		});

		expect(editor.blockCount()).toBe(1);
		expect(editor.getBlock(blockId)?.textContent()).toBe("");
		expect(editor.selection).toMatchObject({
			type: "text",
			anchor: { blockId, offset: 0 },
			focus: { blockId, offset: 0 },
			isCollapsed: true,
			isMultiBlock: false,
		});

		await act(async () => {
			root.unmount();
		});
		container.remove();
		editor.destroy();
	});

	it("deletes a selected single-block range when focus moves to editor chrome", async () => {
		const editor = createEditor({
			without: ["document-ops", "delta-stream", "undo"],
		});
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
					<button type="button">Toolbar</button>
					<Pen.Editor.Content />
				</Pen.Editor.Root>,
			);
		});

		const fieldEditor = getFieldEditor(editor);
		const toolbarButton = container.querySelector("button") as
			| HTMLButtonElement
			| null;

		expect(toolbarButton).not.toBeNull();

		await act(async () => {
			fieldEditor.activateTextSelection(blockId, 1, 4);
			await flushAnimationFrames(3);
		});

		expect(editor.selection).toMatchObject({
			type: "text",
			anchor: { blockId, offset: 1 },
			focus: { blockId, offset: 4 },
			isCollapsed: false,
			isMultiBlock: false,
		});

		await act(async () => {
			toolbarButton!.focus();
			fieldEditor.setFocused(true);
			await flushAnimationFrames(1);
		});

		await act(async () => {
			document.dispatchEvent(createKeyEvent("Backspace"));
			await flushAnimationFrames(3);
		});

		expect(editor.getBlock(blockId)?.textContent()).toBe("Ho");
		expect(editor.selection).toMatchObject({
			type: "text",
			anchor: { blockId, offset: 1 },
			focus: { blockId, offset: 1 },
			isCollapsed: true,
			isMultiBlock: false,
		});

		await act(async () => {
			root.unmount();
		});
		container.remove();
		editor.destroy();
	});

	it("deletes the full-document selection after first cmd+a in flow documents", async () => {
		const editor = createEditor({
			documentProfile: "flow",
			without: ["document-ops", "delta-stream", "undo"],
		});
		const firstBlockId = editor.firstBlock()!.id;
		const secondBlockId = crypto.randomUUID();

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
			focus: { blockId: secondBlockId, offset: 5 },
			isCollapsed: false,
			isMultiBlock: true,
		});

		await act(async () => {
			document.dispatchEvent(createKeyEvent("Backspace"));
			await flushAnimationFrames(4);
		});

		expect(editor.blockCount()).toBe(1);
		expect(editor.getBlock(firstBlockId)?.textContent()).toBe("");
		expect(editor.selection).toMatchObject({
			type: "text",
			anchor: { blockId: firstBlockId, offset: 0 },
			focus: { blockId: firstBlockId, offset: 0 },
			isCollapsed: true,
			isMultiBlock: false,
		});
		expect(domSelectionToEditor(rootElement!)).toMatchObject({
			anchor: { blockId: firstBlockId, offset: 0 },
			focus: { blockId: firstBlockId, offset: 0 },
		});

		await act(async () => {
			root.unmount();
		});
		container.remove();
		editor.destroy();
	});

	it("keeps advancing the caret across consecutive insertText events", async () => {
		const editor = createEditor({
			without: ["document-ops", "delta-stream", "undo"],
		});
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
		const rootElement = container.querySelector(
			"[data-pen-editor-root]",
		) as HTMLElement | null;
		const inlineElement = container.querySelector(
			"[data-pen-inline-content]",
		) as HTMLElement | null;

		expect(rootElement).not.toBeNull();
		expect(inlineElement).not.toBeNull();

		await act(async () => {
			fieldEditor.activateTextSelection(blockId, 2, 2);
			await flushAnimationFrames(3);
		});

		await act(async () => {
			inlineElement!.dispatchEvent(
				new InputEvent("beforeinput", {
					bubbles: true,
					cancelable: true,
					inputType: "insertText",
					data: "X",
				}),
			);
			await flushAnimationFrames(2);
		});

		expect(editor.getBlock(blockId)?.textContent()).toBe("HeXllo");
		expect(editor.selection).toMatchObject({
			type: "text",
			anchor: { blockId, offset: 3 },
			focus: { blockId, offset: 3 },
			isCollapsed: true,
		});
		expect(domSelectionToEditor(rootElement!)).toMatchObject({
			anchor: { blockId, offset: 3 },
			focus: { blockId, offset: 3 },
		});

		await act(async () => {
			inlineElement!.dispatchEvent(
				new InputEvent("beforeinput", {
					bubbles: true,
					cancelable: true,
					inputType: "insertText",
					data: "Y",
				}),
			);
			await flushAnimationFrames(2);
		});

		expect(editor.getBlock(blockId)?.textContent()).toBe("HeXYllo");
		expect(editor.selection).toMatchObject({
			type: "text",
			anchor: { blockId, offset: 4 },
			focus: { blockId, offset: 4 },
			isCollapsed: true,
		});
		expect(domSelectionToEditor(rootElement!)).toMatchObject({
			anchor: { blockId, offset: 4 },
			focus: { blockId, offset: 4 },
		});

		await act(async () => {
			root.unmount();
		});
		container.remove();
		editor.destroy();
	});

	it("moves the caret into the inserted block after Enter at block end", async () => {
		const editor = createEditor({
			without: ["document-ops", "delta-stream", "undo"],
		});
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
		const rootElement = container.querySelector(
			"[data-pen-editor-root]",
		) as HTMLElement | null;
		const inlineElement = container.querySelector(
			"[data-pen-inline-content]",
		) as HTMLElement | null;

		expect(rootElement).not.toBeNull();
		expect(inlineElement).not.toBeNull();

		await act(async () => {
			fieldEditor.activateTextSelection(blockId, 5, 5);
			await flushAnimationFrames(4);
		});

		await act(async () => {
			inlineElement!.dispatchEvent(
				new InputEvent("beforeinput", {
					bubbles: true,
					cancelable: true,
					inputType: "insertParagraph",
				}),
			);
			await flushAnimationFrames(4);
		});

		const blockIds = editor.documentState.blockOrder;
		const newBlockId = blockIds[1];

		expect(newBlockId).toBeTruthy();
		expect(editor.selection).toMatchObject({
			type: "text",
			anchor: { blockId: newBlockId, offset: 0 },
			focus: { blockId: newBlockId, offset: 0 },
			isCollapsed: true,
			isMultiBlock: false,
		});
		expect(domSelectionToEditor(rootElement!)).toMatchObject({
			anchor: { blockId: newBlockId, offset: 0 },
			focus: { blockId: newBlockId, offset: 0 },
		});

		await act(async () => {
			root.unmount();
		});
		container.remove();
		editor.destroy();
	});

	it("shows the next ordered-list marker after Enter continues a numbered list", async () => {
		const editor = createEditor({
			without: ["document-ops", "delta-stream", "undo"],
		});
		const blockId = editor.firstBlock()!.id;

		editor.apply([
			{
				type: "convert-block",
				blockId,
				newType: "numberedListItem",
				newProps: { start: 3 },
			},
			{ type: "insert-text", blockId, offset: 0, text: "Third" },
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
			await flushAnimationFrames(4);
		});

		await act(async () => {
			inlineElement!.dispatchEvent(
				new InputEvent("beforeinput", {
					bubbles: true,
					cancelable: true,
					inputType: "insertParagraph",
				}),
			);
			await flushAnimationFrames(4);
		});

		const markerTexts = Array.from(
			container.querySelectorAll(
				"[data-pen-list-item-layout][data-block-type='numberedListItem'] [data-pen-list-marker]",
			),
		).map((marker) => marker.textContent ?? "");

		expect(markerTexts).toEqual(["3.", "4."]);

		await act(async () => {
			root.unmount();
		});
		container.remove();
		editor.destroy();
	});

	it("deletes a promoted cross-block selection from document keydown", async () => {
		const editor = createEditor({
			without: ["document-ops", "delta-stream", "undo"],
		});
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
			fieldEditor.activate(firstBlockId);
			editor.selectTextRange(
				{ blockId: firstBlockId, offset: 1 },
				{ blockId: secondBlockId, offset: 2 },
			);
			await flushAnimationFrames(4);
		});

		await act(async () => {
			document.getSelection()?.removeAllRanges();
			rootElement!.focus();
			await flushAnimationFrames(1);
		});

		await act(async () => {
			document.dispatchEvent(createKeyEvent("Backspace"));
			await flushAnimationFrames(4);
		});

		expect(editor.getBlock(firstBlockId)?.textContent()).toBe("Hrld");
		expect(editor.getBlock(secondBlockId)).toBeNull();
		expect(editor.selection).toMatchObject({
			type: "text",
			anchor: { blockId: firstBlockId, offset: 1 },
			focus: { blockId: firstBlockId, offset: 1 },
			isCollapsed: true,
		});
		expect(domSelectionToEditor(rootElement!)).toMatchObject({
			anchor: { blockId: firstBlockId, offset: 1 },
			focus: { blockId: firstBlockId, offset: 1 },
		});

		await act(async () => {
			root.unmount();
		});
		container.remove();
		editor.destroy();
	});

	it("reconciles expanded active blocks after replaceSelection commits", async () => {
		const editor = createEditor({
			without: ["document-ops", "delta-stream", "undo"],
		});
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

		await act(async () => {
			fieldEditor.activate(firstBlockId);
			editor.selectTextRange(
				{ blockId: firstBlockId, offset: 1 },
				{ blockId: secondBlockId, offset: 2 },
			);
			await flushAnimationFrames(4);
		});

		await act(async () => {
			editor.replaceSelection("X");
			await flushAnimationFrames(4);
		});

		const inlineElements = Array.from(
			container.querySelectorAll("[data-pen-inline-content]"),
		) as HTMLElement[];

		expect(editor.getBlock(firstBlockId)?.textContent()).toBe("HXrld");
		expect(editor.getBlock(secondBlockId)).toBeNull();
		expect(inlineElements).toHaveLength(1);
		expect(inlineElements[0]?.textContent).toBe("HXrld");

		await act(async () => {
			root.unmount();
		});
		container.remove();
		editor.destroy();
	});

	it("prevents native drag and drop on a single-block text selection", async () => {
		const editor = createEditor({
			without: ["document-ops", "delta-stream", "undo"],
		});
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
		const inlineElement = container.querySelector(
			"[data-pen-inline-content]",
		) as HTMLElement | null;

		expect(inlineElement).not.toBeNull();

		await act(async () => {
			fieldEditor.activateTextSelection(blockId, 1, 5);
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

		expect(inlineElement?.dispatchEvent(dragStartEvent)).toBe(false);
		expect(dragStartEvent.defaultPrevented).toBe(true);
		expect(inlineElement?.dispatchEvent(dropEvent)).toBe(false);
		expect(dropEvent.defaultPrevented).toBe(true);
		expect(editor.getBlock(blockId)?.textContent()).toBe("Hello world");

		await act(async () => {
			root.unmount();
		});
		container.remove();
		editor.destroy();
	});

	it("keeps advancing the caret for EditContext textupdate events", async () => {
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

		const editor = createEditor({
			without: ["document-ops", "delta-stream", "undo"],
		});
		const blockId = editor.firstBlock()!.id;

		editor.apply([
			{ type: "insert-text", blockId, offset: 0, text: "Hello" },
		]);

		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);

		try {
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
			) as
				| (HTMLElement & { editContext?: FakeEditContext | null })
				| null;

			expect(rootElement).not.toBeNull();
			expect(inlineElement).not.toBeNull();

			await act(async () => {
				fieldEditor.activateTextSelection(blockId, 2, 2);
				await flushAnimationFrames(3);
			});

			const editContext = inlineElement?.editContext;
			expect(editContext).toBeTruthy();

			await act(async () => {
				editContext!.emit("textupdate", {
					updateRangeStart: 2,
					updateRangeEnd: 2,
					text: "X",
					selectionStart: 3,
					selectionEnd: 3,
				});
				await flushAnimationFrames(2);
			});

			expect(editor.getBlock(blockId)?.textContent()).toBe("HeXllo");
			expect(editor.selection).toMatchObject({
				type: "text",
				anchor: { blockId, offset: 3 },
				focus: { blockId, offset: 3 },
				isCollapsed: true,
			});
			expect(domSelectionToEditor(rootElement!)).toMatchObject({
				anchor: { blockId, offset: 3 },
				focus: { blockId, offset: 3 },
			});

			await act(async () => {
				editContext!.emit("textupdate", {
					updateRangeStart: 3,
					updateRangeEnd: 3,
					text: "Y",
					selectionStart: 4,
					selectionEnd: 4,
				});
				await flushAnimationFrames(2);
			});

			expect(editor.getBlock(blockId)?.textContent()).toBe("HeXYllo");
			expect(editor.selection).toMatchObject({
				type: "text",
				anchor: { blockId, offset: 4 },
				focus: { blockId, offset: 4 },
				isCollapsed: true,
			});
			expect(domSelectionToEditor(rootElement!)).toMatchObject({
				anchor: { blockId, offset: 4 },
				focus: { blockId, offset: 4 },
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

	it("applies inline markdown input rules for EditContext textupdate events", async () => {
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

		const editor = createEditor({
			without: ["document-ops", "delta-stream", "undo"],
		});
		const blockId = editor.firstBlock()!.id;

		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);

		try {
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
			) as
				| (HTMLElement & { editContext?: FakeEditContext | null })
				| null;

			expect(inlineElement).not.toBeNull();

			await act(async () => {
				fieldEditor.activateTextSelection(blockId, 0, 0);
				await flushAnimationFrames(3);
			});

			const editContext = inlineElement?.editContext;
			expect(editContext).toBeTruthy();

			const updates = ["*", "*", "h", "e", "y", "*", "*"];
			for (const [index, text] of updates.entries()) {
				await act(async () => {
					editContext!.emit("textupdate", {
						updateRangeStart: index,
						updateRangeEnd: index,
						text,
						selectionStart: index + 1,
						selectionEnd: index + 1,
					});
					await flushAnimationFrames(2);
					await Promise.resolve();
					await Promise.resolve();
				});
			}

			expect(editor.getBlock(blockId)?.textContent()).toBe("hey");
			expect(editor.getBlock(blockId)?.textDeltas()).toEqual([
				{
					insert: "hey",
					attributes: { bold: true },
				},
			]);

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

	it("converts '3. ' into a numbered list item via EditContext textupdate", async () => {
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

		const editor = createEditor({
			without: ["document-ops", "delta-stream", "undo"],
		});
		const blockId = editor.firstBlock()!.id;

		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);

		try {
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
			) as
				| (HTMLElement & { editContext?: FakeEditContext | null })
				| null;

			expect(rootElement).not.toBeNull();
			expect(inlineElement).not.toBeNull();

			await act(async () => {
				fieldEditor.activateTextSelection(blockId, 0, 0);
				await flushAnimationFrames(3);
			});

			const editContext = inlineElement?.editContext;
			expect(editContext).toBeTruthy();

			await act(async () => {
				editContext!.emit("textupdate", {
					updateRangeStart: 0,
					updateRangeEnd: 0,
					text: "3",
					selectionStart: 1,
					selectionEnd: 1,
				});
				await flushAnimationFrames(2);
			});

			await act(async () => {
				editContext!.emit("textupdate", {
					updateRangeStart: 1,
					updateRangeEnd: 1,
					text: ".",
					selectionStart: 2,
					selectionEnd: 2,
				});
				await flushAnimationFrames(2);
			});

			await act(async () => {
				editContext!.emit("textupdate", {
					updateRangeStart: 2,
					updateRangeEnd: 2,
					text: " ",
					selectionStart: 3,
					selectionEnd: 3,
				});
				await flushAnimationFrames(2);
			});

			expect(editor.getBlock(blockId)?.type).toBe("numberedListItem");
			expect(editor.getBlock(blockId)?.props?.start).toBe(3);
			expect(editor.getBlock(blockId)?.textContent()).toBe("");
			expect(editor.selection).toMatchObject({
				type: "text",
				anchor: { blockId, offset: 0 },
				focus: { blockId, offset: 0 },
				isCollapsed: true,
				isMultiBlock: false,
			});
			expect(domSelectionToEditor(rootElement!)).toMatchObject({
				anchor: { blockId, offset: 0 },
				focus: { blockId, offset: 0 },
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

	it("restores logical selection on undo and redo", async () => {
		const editor = createEditor({
			without: ["document-ops", "delta-stream"],
		});
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
		const rootElement = container.querySelector(
			"[data-pen-editor-root]",
		) as HTMLElement | null;
		const inlineElement = container.querySelector(
			"[data-pen-inline-content]",
		) as HTMLElement | null;

		expect(rootElement).not.toBeNull();
		expect(inlineElement).not.toBeNull();

		await act(async () => {
			fieldEditor.activateTextSelection(blockId, 2, 2);
			await flushAnimationFrames(3);
		});

		await act(async () => {
			inlineElement!.dispatchEvent(
				new InputEvent("beforeinput", {
					bubbles: true,
					cancelable: true,
					inputType: "insertText",
					data: "X",
				}),
			);
			await flushAnimationFrames(3);
		});

		expect(editor.getBlock(blockId)?.textContent()).toBe("HeXllo");
		expect(editor.selection).toMatchObject({
			type: "text",
			anchor: { blockId, offset: 3 },
			focus: { blockId, offset: 3 },
		});

		await act(async () => {
			editor.undoManager.undo();
			await flushAnimationFrames(4);
		});

		expect(editor.getBlock(blockId)?.textContent()).toBe("Hello");
		expect(editor.selection).toMatchObject({
			type: "text",
			anchor: { blockId, offset: 2 },
			focus: { blockId, offset: 2 },
		});
		expect(domSelectionToEditor(rootElement!)).toMatchObject({
			anchor: { blockId, offset: 2 },
			focus: { blockId, offset: 2 },
		});

		await act(async () => {
			editor.undoManager.redo();
			await flushAnimationFrames(4);
		});

		expect(editor.getBlock(blockId)?.textContent()).toBe("HeXllo");
		expect(editor.selection).toMatchObject({
			type: "text",
			anchor: { blockId, offset: 3 },
			focus: { blockId, offset: 3 },
		});
		expect(domSelectionToEditor(rootElement!)).toMatchObject({
			anchor: { blockId, offset: 3 },
			focus: { blockId, offset: 3 },
		});

		await act(async () => {
			root.unmount();
		});
		container.remove();
		editor.destroy();
	});

	it("moves the DOM caret across blocks on undo and redo", async () => {
		const editor = createEditor({
			without: ["document-ops", "delta-stream"],
		});
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
		const rootElement = container.querySelector(
			"[data-pen-editor-root]",
		) as HTMLElement | null;
		const inlineElement = container.querySelector(
			"[data-pen-inline-content]",
		) as HTMLElement | null;

		expect(rootElement).not.toBeNull();
		expect(inlineElement).not.toBeNull();

		await act(async () => {
			fieldEditor.activateTextSelection(blockId, 5, 5);
			await flushAnimationFrames(4);
		});

		await act(async () => {
			inlineElement!.dispatchEvent(
				new InputEvent("beforeinput", {
					bubbles: true,
					cancelable: true,
					inputType: "insertParagraph",
				}),
			);
			await flushAnimationFrames(4);
		});

		const insertedBlockId = editor.selection?.type === "text"
			? editor.selection.focus.blockId
			: null;
		expect(insertedBlockId).toBeTruthy();
		expect(domSelectionToEditor(rootElement!)).toMatchObject({
			anchor: { blockId: insertedBlockId, offset: 0 },
			focus: { blockId: insertedBlockId, offset: 0 },
		});

		await act(async () => {
			editor.undoManager.undo();
			await flushAnimationFrames(4);
		});

		expect(editor.documentState.blockOrder).toEqual([blockId]);
		expect(editor.selection).toMatchObject({
			type: "text",
			anchor: { blockId, offset: 5 },
			focus: { blockId, offset: 5 },
		});
		expect(domSelectionToEditor(rootElement!)).toMatchObject({
			anchor: { blockId, offset: 5 },
			focus: { blockId, offset: 5 },
		});

		await act(async () => {
			editor.undoManager.redo();
			await flushAnimationFrames(4);
		});

		const redoneBlockId = editor.selection?.type === "text"
			? editor.selection.focus.blockId
			: null;
		expect(redoneBlockId).toBeTruthy();
		expect(editor.selection).toMatchObject({
			type: "text",
			anchor: { blockId: redoneBlockId, offset: 0 },
			focus: { blockId: redoneBlockId, offset: 0 },
		});
		expect(domSelectionToEditor(rootElement!)).toMatchObject({
			anchor: { blockId: redoneBlockId, offset: 0 },
			focus: { blockId: redoneBlockId, offset: 0 },
		});

		await act(async () => {
			root.unmount();
		});
		container.remove();
		editor.destroy();
	});

	it("reconciles blurred active blocks during undo and redo", async () => {
		const editor = createEditor({
			without: ["document-ops", "delta-stream"],
		});
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
			fieldEditor.activateTextSelection(blockId, 2, 2);
			await flushAnimationFrames(3);
		});

		await act(async () => {
			inlineElement!.dispatchEvent(
				new InputEvent("beforeinput", {
					bubbles: true,
					cancelable: true,
					inputType: "insertText",
					data: "X",
				}),
			);
			await flushAnimationFrames(3);
		});

		expect(editor.getBlock(blockId)?.textContent()).toBe("HeXllo");
		expect(inlineElement?.textContent).toBe("HeXllo");

		await act(async () => {
			fieldEditor.setFocused(false);
			editor.undoManager.undo();
			await flushAnimationFrames(4);
		});

		expect(editor.getBlock(blockId)?.textContent()).toBe("Hello");
		expect(inlineElement?.textContent).toBe("Hello");

		await act(async () => {
			editor.undoManager.redo();
			await flushAnimationFrames(4);
		});

		expect(editor.getBlock(blockId)?.textContent()).toBe("HeXllo");
		expect(inlineElement?.textContent).toBe("HeXllo");

		await act(async () => {
			root.unmount();
		});
		container.remove();
		editor.destroy();
	});

	it("reconciles repeated undo steps while focus is on a toolbar button", async () => {
		const editor = createEditor({
			without: ["document-ops", "delta-stream"],
		});
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
					<button type="button">Undo</button>
					<Pen.Editor.Content />
				</Pen.Editor.Root>,
			);
		});

		const fieldEditor = getFieldEditor(editor);
		const inlineElement = container.querySelector(
			"[data-pen-inline-content]",
		) as HTMLElement | null;
		const toolbarButton = container.querySelector("button") as
			| HTMLButtonElement
			| null;

		expect(inlineElement).not.toBeNull();
		expect(toolbarButton).not.toBeNull();

		await act(async () => {
			fieldEditor.activateTextSelection(blockId, 2, 2);
			await flushAnimationFrames(3);
		});

		await act(async () => {
			inlineElement!.dispatchEvent(
				new InputEvent("beforeinput", {
					bubbles: true,
					cancelable: true,
					inputType: "insertText",
					data: "X",
				}),
			);
			await flushAnimationFrames(3);
		});

		await act(async () => {
			editor.undoManager.stopCapturing();
			inlineElement!.dispatchEvent(
				new InputEvent("beforeinput", {
					bubbles: true,
					cancelable: true,
					inputType: "insertText",
					data: "Y",
				}),
			);
			await flushAnimationFrames(3);
		});

		expect(editor.getBlock(blockId)?.textContent()).toBe("HeXYllo");
		expect(inlineElement?.textContent).toBe("HeXYllo");

		await act(async () => {
			toolbarButton!.focus();
			fieldEditor.setFocused(true);
			await flushAnimationFrames(1);
		});

		await act(async () => {
			editor.undoManager.undo();
			await flushAnimationFrames(4);
		});

		expect(editor.getBlock(blockId)?.textContent()).toBe("HeXllo");
		expect(inlineElement?.textContent).toBe("HeXllo");

		await act(async () => {
			editor.undoManager.undo();
			await flushAnimationFrames(4);
		});

		expect(editor.getBlock(blockId)?.textContent()).toBe("Hello");
		expect(inlineElement?.textContent).toBe("Hello");

		await act(async () => {
			root.unmount();
		});
		container.remove();
		editor.destroy();
	});

	it("reconciles repeated undo steps with EditContext while focus is on a toolbar button", async () => {
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
				without: ["document-ops", "delta-stream"],
			});
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
						<button type="button">Undo</button>
						<Pen.Editor.Content />
					</Pen.Editor.Root>,
				);
			});

			const fieldEditor = getFieldEditor(editor);
			const inlineElement = container.querySelector(
				"[data-pen-inline-content]",
			) as (HTMLElement & { editContext?: FakeEditContext | null }) | null;
			const toolbarButton = container.querySelector("button") as
				| HTMLButtonElement
				| null;

			expect(inlineElement).not.toBeNull();
			expect(toolbarButton).not.toBeNull();

			await act(async () => {
				fieldEditor.activateTextSelection(blockId, 2, 2);
				await flushAnimationFrames(3);
			});

			const editContext = inlineElement?.editContext;
			expect(editContext).toBeTruthy();

			await act(async () => {
				editContext!.emit("textupdate", {
					updateRangeStart: 2,
					updateRangeEnd: 2,
					text: "X",
					selectionStart: 3,
					selectionEnd: 3,
				});
				await flushAnimationFrames(3);
			});

			await act(async () => {
				editor.undoManager.stopCapturing();
				editContext!.emit("textupdate", {
					updateRangeStart: 3,
					updateRangeEnd: 3,
					text: "Y",
					selectionStart: 4,
					selectionEnd: 4,
				});
				await flushAnimationFrames(3);
			});

			expect(editor.getBlock(blockId)?.textContent()).toBe("HeXYllo");
			expect(inlineElement?.textContent).toBe("HeXYllo");

			await act(async () => {
				toolbarButton!.focus();
				fieldEditor.setFocused(true);
				await flushAnimationFrames(1);
			});

			await act(async () => {
				editor.undoManager.undo();
				await flushAnimationFrames(4);
			});

			expect(editor.getBlock(blockId)?.textContent()).toBe("HeXllo");
			expect(inlineElement?.textContent).toBe("HeXllo");

			await act(async () => {
				editor.undoManager.undo();
				await flushAnimationFrames(4);
			});

			expect(editor.getBlock(blockId)?.textContent()).toBe("Hello");
			expect(inlineElement?.textContent).toBe("Hello");

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

	it("reconciles repeated undo steps on the active block with EditContext focus", async () => {
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
				without: ["document-ops", "delta-stream"],
			});
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
			) as (HTMLElement & { editContext?: FakeEditContext | null }) | null;

			expect(inlineElement).not.toBeNull();

			await act(async () => {
				fieldEditor.activateTextSelection(blockId, 2, 2);
				await flushAnimationFrames(3);
			});

			const editContext = inlineElement?.editContext;
			expect(editContext).toBeTruthy();

			await act(async () => {
				editContext!.emit("textupdate", {
					updateRangeStart: 2,
					updateRangeEnd: 2,
					text: "X",
					selectionStart: 3,
					selectionEnd: 3,
				});
				await flushAnimationFrames(3);
			});

			await act(async () => {
				editor.undoManager.stopCapturing();
				editContext!.emit("textupdate", {
					updateRangeStart: 3,
					updateRangeEnd: 3,
					text: "Y",
					selectionStart: 4,
					selectionEnd: 4,
				});
				await flushAnimationFrames(3);
			});

			expect(editor.getBlock(blockId)?.textContent()).toBe("HeXYllo");
			expect(inlineElement?.textContent).toBe("HeXYllo");

			await act(async () => {
				editor.undoManager.undo();
				await flushAnimationFrames(4);
			});

			expect(editor.getBlock(blockId)?.textContent()).toBe("HeXllo");
			expect(inlineElement?.textContent).toBe("HeXllo");

			await act(async () => {
				editor.undoManager.undo();
				await flushAnimationFrames(4);
			});

			expect(editor.getBlock(blockId)?.textContent()).toBe("Hello");
			expect(inlineElement?.textContent).toBe("Hello");

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

	it("reconciles history changes for passive blocks outside activeBlockIds", async () => {
		const editor = createEditor({
			without: ["document-ops", "delta-stream"],
		});
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
					<button type="button">Undo</button>
					<Pen.Editor.Content />
				</Pen.Editor.Root>,
			);
		});

		const fieldEditor = getFieldEditor(editor);
		const inlineElements = Array.from(
			container.querySelectorAll("[data-pen-inline-content]"),
		) as HTMLElement[];
		const secondInlineElement = inlineElements[1] ?? null;
		const toolbarButton = container.querySelector("button") as
			| HTMLButtonElement
			| null;

		expect(secondInlineElement).not.toBeNull();
		expect(toolbarButton).not.toBeNull();

		await act(async () => {
			fieldEditor.activateTextSelection(firstBlockId, 5, 5);
			await flushAnimationFrames(3);
		});

		expect(fieldEditor.getSnapshot()).toMatchObject({
			focusBlockId: firstBlockId,
			activeBlockIds: [firstBlockId],
			mode: "single",
		});

		await act(async () => {
			editor.apply(
				[
					{
						type: "insert-text",
						blockId: secondBlockId,
						offset: 6,
						text: "!",
					},
				],
				{ origin: "user" },
			);
			await flushAnimationFrames(3);
		});

		expect(editor.getBlock(secondBlockId)?.textContent()).toBe("Second!");
		expect(secondInlineElement?.textContent).toBe("Second!");

		await act(async () => {
			toolbarButton!.focus();
			fieldEditor.setFocused(true);
			await flushAnimationFrames(1);
		});

		await act(async () => {
			editor.undoManager.undo();
			await flushAnimationFrames(4);
		});

		expect(fieldEditor.getSnapshot()).toMatchObject({
			focusBlockId: firstBlockId,
			activeBlockIds: [firstBlockId],
			mode: "single",
		});
		expect(editor.getBlock(secondBlockId)?.textContent()).toBe("Second");
		expect(secondInlineElement?.textContent).toBe("Second");

		await act(async () => {
			editor.undoManager.redo();
			await flushAnimationFrames(4);
		});

		expect(fieldEditor.getSnapshot()).toMatchObject({
			focusBlockId: firstBlockId,
			activeBlockIds: [firstBlockId],
			mode: "single",
		});
		expect(editor.getBlock(secondBlockId)?.textContent()).toBe("Second!");
		expect(secondInlineElement?.textContent).toBe("Second!");

		await act(async () => {
			root.unmount();
		});
		container.remove();
		editor.destroy();
	});

	it("reconciles repeated history changes outside activeBlockIds during expanded editing", async () => {
		const editor = createEditor({
			without: ["document-ops", "delta-stream"],
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
					<button type="button">Undo</button>
					<Pen.Editor.Content />
				</Pen.Editor.Root>,
			);
		});

		const fieldEditor = getFieldEditor(editor);
		const inlineElements = Array.from(
			container.querySelectorAll("[data-pen-inline-content]"),
		) as HTMLElement[];
		const thirdInlineElement = inlineElements[2] ?? null;
		const toolbarButton = container.querySelector("button") as
			| HTMLButtonElement
			| null;

		expect(thirdInlineElement).not.toBeNull();
		expect(toolbarButton).not.toBeNull();

		await act(async () => {
			fieldEditor.activate(firstBlockId);
			editor.selectTextRange(
				{ blockId: firstBlockId, offset: 0 },
				{ blockId: secondBlockId, offset: 6 },
			);
			await flushAnimationFrames(4);
		});

		expect(fieldEditor.getSnapshot()).toMatchObject({
			focusBlockId: firstBlockId,
			activeBlockIds: [firstBlockId, secondBlockId],
			mode: "expanded",
		});

		await act(async () => {
			editor.apply(
				[
					{
						type: "insert-text",
						blockId: thirdBlockId,
						offset: 5,
						text: "!",
					},
				],
				{ origin: "user" },
			);
			await flushAnimationFrames(3);
		});

		await act(async () => {
			editor.undoManager.stopCapturing();
			editor.apply(
				[
					{
						type: "insert-text",
						blockId: thirdBlockId,
						offset: 6,
						text: "?",
					},
				],
				{ origin: "user" },
			);
			await flushAnimationFrames(3);
		});

		expect(editor.getBlock(thirdBlockId)?.textContent()).toBe("Third!?");
		expect(thirdInlineElement?.textContent).toBe("Third!?");

		await act(async () => {
			toolbarButton!.focus();
			fieldEditor.setFocused(true);
			await flushAnimationFrames(1);
		});

		await act(async () => {
			editor.undoManager.undo();
			await flushAnimationFrames(4);
		});

		expect(fieldEditor.getSnapshot()).toMatchObject({
			focusBlockId: firstBlockId,
			activeBlockIds: [firstBlockId, secondBlockId],
			mode: "expanded",
		});
		expect(editor.getBlock(thirdBlockId)?.textContent()).toBe("Third!");
		expect(thirdInlineElement?.textContent).toBe("Third!");

		await act(async () => {
			editor.undoManager.undo();
			await flushAnimationFrames(4);
		});

		expect(editor.getBlock(thirdBlockId)?.textContent()).toBe("Third");
		expect(thirdInlineElement?.textContent).toBe("Third");

		await act(async () => {
			editor.undoManager.redo();
			await flushAnimationFrames(4);
		});

		expect(editor.getBlock(thirdBlockId)?.textContent()).toBe("Third!");
		expect(thirdInlineElement?.textContent).toBe("Third!");

		await act(async () => {
			editor.undoManager.redo();
			await flushAnimationFrames(4);
		});

		expect(editor.getBlock(thirdBlockId)?.textContent()).toBe("Third!?");
		expect(thirdInlineElement?.textContent).toBe("Third!?");

		await act(async () => {
			root.unmount();
		});
		container.remove();
		editor.destroy();
	});

});
