// @vitest-environment jsdom

import React, { act } from "react";
import { describe, expect, it } from "vitest";
import { createRoot } from "react-dom/client";
import {
	createDecorationSet,
	createEditor as createCoreEditor,
} from "@pen/core";
import { defaultPreset } from "@pen/preset-default";
import { defineExtension } from "@pen/types";
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

function createEditor(
	options: Parameters<typeof createCoreEditor>[0] = {},
): ReturnType<typeof createCoreEditor> {
	if (shouldUseSelectionDeletionPreset(options)) {
		const { without: _without, ...rest } = options;
		return createCoreEditor({
			...rest,
			preset: defaultPreset({
				documentOps: false,
				deltaStream: false,
				undo: false,
			}),
		});
	}

	if (usesLegacySelectionDeletionDefaults(options.without)) {
		const { without: _without, ...rest } = options;
		return createCoreEditor({
			...rest,
			preset: defaultPreset({
				documentOps: false,
				deltaStream: false,
				undo: false,
			}),
		});
	}

	return createCoreEditor(options);
}

function createUndoSelectionDeletionEditor(
	options: Parameters<typeof createCoreEditor>[0] = {},
): ReturnType<typeof createCoreEditor> {
	return createCoreEditor({
		...options,
		preset: defaultPreset({
			documentOps: false,
			deltaStream: false,
			undo: true,
		}),
	});
}

function shouldUseSelectionDeletionPreset(
	options: NonNullable<Parameters<typeof createCoreEditor>[0]>,
): boolean {
	return (
		options.without == null &&
		options.preset == null &&
		options.extensions == null
	);
}

function usesLegacySelectionDeletionDefaults(
	without: NonNullable<Parameters<typeof createCoreEditor>[0]>["without"],
): boolean {
	return (
		without?.length === 3 &&
		without[0] === "document-ops" &&
		without[1] === "delta-stream" &&
		without[2] === "undo"
	);
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
	it("keeps the active inline DOM synchronized after direct text input", async () => {
		const editor = createEditor();
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
		const inlineElement = container.querySelector(
			"[data-pen-inline-content]",
		) as HTMLElement | null;

		expect(inlineElement).not.toBeNull();

		await act(async () => {
			fieldEditor.activate(blockId);
			await flushAnimationFrames(2);
		});

		setNativeSelectionRange(inlineElement!, 0, inlineElement!, 0);

		await act(async () => {
			for (const character of "Hello") {
				inlineElement!.dispatchEvent(
					new InputEvent("beforeinput", {
						bubbles: true,
						cancelable: true,
						inputType: "insertText",
						data: character,
					}),
				);
			}
			await flushAnimationFrames(2);
		});

		expect(editor.getBlock(blockId)?.textContent()).toBe("Hello");
		expect(inlineElement!.textContent).toBe("Hello");

		await act(async () => {
			root.unmount();
		});
		container.remove();
		editor.destroy();
	});

	it("keeps active inline text visible after a parent rerender", async () => {
		const editor = createEditor();
		const blockId = editor.firstBlock()!.id;
		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);

		function RerenderingEditor() {
			const [, setCommitCount] = React.useState(0);

			React.useEffect(
				() =>
					editor.onDocumentCommit(() =>
						setCommitCount((count) => count + 1),
					),
				[],
			);

			return (
				<Pen.Editor.Root editor={editor}>
					<Pen.Editor.Content />
				</Pen.Editor.Root>
			);
		}

		await act(async () => {
			root.render(<RerenderingEditor />);
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

		setNativeSelectionRange(inlineElement!, 0, inlineElement!, 0);

		await act(async () => {
			for (const character of "Hello") {
				inlineElement!.dispatchEvent(
					new InputEvent("beforeinput", {
						bubbles: true,
						cancelable: true,
						inputType: "insertText",
						data: character,
					}),
				);
				await flushAnimationFrames(1);
			}
			await flushAnimationFrames(2);
		});

		expect(editor.getBlock(blockId)?.textContent()).toBe("Hello");
		expect(inlineElement!.textContent).toBe("Hello");

		await act(async () => {
			root.unmount();
		});
		container.remove();
		editor.destroy();
	});

	it("reconciles active inline decorations when text is unchanged", async () => {
		let decorationState = "initial";
		const editor = createEditor({
			extensions: [
				defineExtension({
					name: "active-inline-decoration-test",
					decorations(_state, currentEditor) {
						const firstBlock = currentEditor.firstBlock();
						if (!firstBlock || firstBlock.length() === 0) {
							return createDecorationSet([]);
						}

						return createDecorationSet([
							{
								type: "inline",
								blockId: firstBlock.id,
								from: 0,
								to: firstBlock.length(),
								attributes: {
									"data-decoration-state": decorationState,
								},
							},
						]);
					},
				}),
			],
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
		const inlineElement = container.querySelector(
			"[data-pen-inline-content]",
		) as HTMLElement | null;

		expect(inlineElement).not.toBeNull();

		await act(async () => {
			fieldEditor.activate(blockId);
			await flushAnimationFrames(2);
		});

		setNativeSelectionRange(inlineElement!, 0, inlineElement!, 0);

		await act(async () => {
			for (const character of "Hello") {
				inlineElement!.dispatchEvent(
					new InputEvent("beforeinput", {
						bubbles: true,
						cancelable: true,
						inputType: "insertText",
						data: character,
					}),
				);
			}
			await flushAnimationFrames(2);
		});

		expect(
			inlineElement!.querySelector('[data-decoration-state="initial"]'),
		).not.toBeNull();

		decorationState = "updated";
		await act(async () => {
			editor.requestDecorationUpdate();
			await flushAnimationFrames(2);
		});

		expect(inlineElement!.textContent).toBe("Hello");
		expect(
			inlineElement!.querySelector('[data-decoration-state="updated"]'),
		).not.toBeNull();

		await act(async () => {
			root.unmount();
		});
		container.remove();
		editor.destroy();
	});

	it("can opt into contenteditable even when EditContext is available", async () => {
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

		const editor = createEditor();
		const blockId = editor.firstBlock()!.id;
		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);

		try {
			await act(async () => {
				root.render(
					<Pen.Editor.Root
						editor={editor}
						inputBackend="contenteditable"
					>
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
			const rootElement = container.querySelector(
				"[data-pen-editor-root]",
			) as HTMLElement | null;

			expect(inlineElement).not.toBeNull();
			expect(rootElement).not.toBeNull();

			await act(async () => {
				fieldEditor.activate(blockId);
				await flushAnimationFrames(2);
			});

			expect(inlineElement!.editContext).toBeFalsy();
			expect(inlineElement!.contentEditable).toBe("true");

			setNativeSelectionRange(inlineElement!, 0, inlineElement!, 0);

			await act(async () => {
				for (const character of "Hey") {
					inlineElement!.dispatchEvent(
						new InputEvent("beforeinput", {
							bubbles: true,
							cancelable: true,
							inputType: "insertText",
							data: character,
						}),
					);
				}
				await flushAnimationFrames(2);
			});

			expect(editor.getBlock(blockId)?.textContent()).toBe("Hey");
			expect(inlineElement!.textContent).toBe("Hey");
			expect(editor.selection).toMatchObject({
				type: "text",
				anchor: { blockId, offset: 3 },
				focus: { blockId, offset: 3 },
			});
		} finally {
			await act(async () => {
				root.unmount();
			});
			container.remove();
			editor.destroy();
			(
				globalThis as typeof globalThis & {
					EditContext?: typeof FakeEditContext;
				}
			).EditContext = originalEditContext;
		}
	});

	it("keeps active EditContext text visible after a parent rerender", async () => {
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

		const editor = createEditor();
		const blockId = editor.firstBlock()!.id;
		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);

		function RerenderingEditor() {
			const [, setCommitCount] = React.useState(0);

			React.useEffect(
				() =>
					editor.onDocumentCommit(() =>
						setCommitCount((count) => count + 1),
					),
				[],
			);

			return (
				<Pen.Editor.Root editor={editor} inputBackend="edit-context">
					<Pen.Editor.Content />
				</Pen.Editor.Root>
			);
		}

		try {
			await act(async () => {
				root.render(<RerenderingEditor />);
			});

			const fieldEditor = getFieldEditor(editor);
			const inlineElement = container.querySelector(
				"[data-pen-inline-content]",
			) as
				| (HTMLElement & { editContext?: FakeEditContext | null })
				| null;
			const rootElement = container.querySelector(
				"[data-pen-editor-root]",
			) as HTMLElement | null;

			expect(inlineElement).not.toBeNull();
			expect(rootElement).not.toBeNull();

			await act(async () => {
				fieldEditor.activate(blockId);
				await flushAnimationFrames(2);
			});

			const editContext = inlineElement!.editContext;
			expect(editContext).toBeInstanceOf(FakeEditContext);

			await act(async () => {
				for (const character of "Hello") {
					const start = editContext!.selectionStart;
					const end = editContext!.selectionEnd;
					editContext!.emit("textupdate", {
						updateRangeStart: start,
						updateRangeEnd: end,
						text: character,
						selectionStart: start + character.length,
						selectionEnd: start + character.length,
					});
					await flushAnimationFrames(1);
				}
				await flushAnimationFrames(2);
			});

			expect(editor.getBlock(blockId)?.textContent()).toBe("Hello");
			expect(inlineElement!.textContent).toBe("Hello");
		} finally {
			await act(async () => {
				root.unmount();
			});
			container.remove();
			editor.destroy();
			(
				globalThis as typeof globalThis & {
					EditContext?: typeof FakeEditContext;
				}
			).EditContext = originalEditContext;
		}
	});

	it("preserves the full native selection on mouseup after a word select gesture", async () => {
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
					caretRangeFromPoint?: (
						x: number,
						y: number,
					) => Range | null;
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
					caretRangeFromPoint?: (
						x: number,
						y: number,
					) => Range | null;
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

	it("collapses a selected inline range to a caret when clicking inside it", async () => {
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
			fieldEditor.activateTextSelection(blockId, 1, 5);
			await flushAnimationFrames(3);
		});

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
			).caretRangeFromPoint = () => {
				const range = document.createRange();
				range.setStart(inlineElement!.firstChild ?? inlineElement!, 3);
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

				const collapsedRange = document.createRange();
				collapsedRange.setStart(
					inlineElement!.firstChild ?? inlineElement!,
					3,
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
					}),
				);
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
			anchor: { blockId, offset: 3 },
			focus: { blockId, offset: 3 },
			isCollapsed: true,
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

	it("preserves third-click block selection when the native range settles after mouseup", async () => {
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
					caretRangeFromPoint?: (
						x: number,
						y: number,
					) => Range | null;
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
					caretRangeFromPoint?: (
						x: number,
						y: number,
					) => Range | null;
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

	it("selects the full block on the third click after a word selection", async () => {
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
			await flushAnimationFrames(3);
		});

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
			).caretRangeFromPoint = () => {
				const range = document.createRange();
				range.setStart(inlineElement!.firstChild ?? inlineElement!, 3);
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

				setNativeSelectionRange(inlineElement!, 0, inlineElement!, 11);

				document.dispatchEvent(
					new MouseEvent("mouseup", {
						bubbles: true,
						button: 0,
						clientX: 12,
						clientY: 8,
						detail: 3,
					}),
				);
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

	it("collapses a full-block text selection to a caret on the fourth click", async () => {
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
			fieldEditor.activateTextSelection(blockId, 0, 11);
			await flushAnimationFrames(3);
		});

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
			).caretRangeFromPoint = () => {
				const range = document.createRange();
				range.setStart(inlineElement!.firstChild ?? inlineElement!, 3);
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
						detail: 4,
					}),
				);

				setNativeSelectionRange(inlineElement!, 0, inlineElement!, 11);

				document.dispatchEvent(
					new MouseEvent("mouseup", {
						bubbles: true,
						button: 0,
						clientX: 12,
						clientY: 8,
						detail: 4,
					}),
				);
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
			anchor: { blockId, offset: 3 },
			focus: { blockId, offset: 3 },
			isCollapsed: true,
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

	it("collapses an immediate fourth click after triple-click paragraph selection", async () => {
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
					caretRangeFromPoint?: (
						x: number,
						y: number,
					) => Range | null;
				}
			).caretRangeFromPoint = () => {
				const range = document.createRange();
				range.setStart(inlineElement!.firstChild ?? inlineElement!, 3);
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

				setNativeSelectionRange(inlineElement!, 0, inlineElement!, 11);

				document.dispatchEvent(
					new MouseEvent("mouseup", {
						bubbles: true,
						button: 0,
						clientX: 12,
						clientY: 8,
						detail: 3,
					}),
				);

				inlineElement!.dispatchEvent(
					new MouseEvent("mousedown", {
						bubbles: true,
						button: 0,
						clientX: 12,
						clientY: 8,
						detail: 4,
					}),
				);

				setNativeSelectionRange(inlineElement!, 0, inlineElement!, 11);

				document.dispatchEvent(
					new MouseEvent("mouseup", {
						bubbles: true,
						button: 0,
						clientX: 12,
						clientY: 8,
						detail: 4,
					}),
				);

				inlineElement!.dispatchEvent(
					new MouseEvent("click", {
						bubbles: true,
						button: 0,
						clientX: 12,
						clientY: 8,
						detail: 4,
					}),
				);

				await flushAnimationFrames(4);
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
			anchor: { blockId, offset: 3 },
			focus: { blockId, offset: 3 },
			isCollapsed: true,
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

	it("collapses an immediate follow-up single click after triple-click paragraph selection", async () => {
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
					caretRangeFromPoint?: (
						x: number,
						y: number,
					) => Range | null;
				}
			).caretRangeFromPoint = () => {
				const range = document.createRange();
				range.setStart(inlineElement!.firstChild ?? inlineElement!, 3);
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

				setNativeSelectionRange(inlineElement!, 0, inlineElement!, 11);

				document.dispatchEvent(
					new MouseEvent("mouseup", {
						bubbles: true,
						button: 0,
						clientX: 12,
						clientY: 8,
						detail: 3,
					}),
				);

				inlineElement!.dispatchEvent(
					new MouseEvent("mousedown", {
						bubbles: true,
						button: 0,
						clientX: 12,
						clientY: 8,
						detail: 1,
					}),
				);

				const collapsedRange = document.createRange();
				collapsedRange.setStart(
					inlineElement!.firstChild ?? inlineElement!,
					3,
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
						detail: 1,
					}),
				);

				inlineElement!.dispatchEvent(
					new MouseEvent("click", {
						bubbles: true,
						button: 0,
						clientX: 12,
						clientY: 8,
						detail: 1,
					}),
				);

				await flushAnimationFrames(4);
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
			anchor: { blockId, offset: 3 },
			focus: { blockId, offset: 3 },
			isCollapsed: true,
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

	it("ignores a late native full-block selectionchange after collapsing to a caret", async () => {
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
					caretRangeFromPoint?: (
						x: number,
						y: number,
					) => Range | null;
				}
			).caretRangeFromPoint = () => {
				const range = document.createRange();
				range.setStart(inlineElement!.firstChild ?? inlineElement!, 3);
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
						detail: 1,
					}),
				);

				const collapsedRange = document.createRange();
				collapsedRange.setStart(
					inlineElement!.firstChild ?? inlineElement!,
					3,
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
						detail: 1,
					}),
				);

				inlineElement!.dispatchEvent(
					new MouseEvent("click", {
						bubbles: true,
						button: 0,
						clientX: 12,
						clientY: 8,
						detail: 1,
					}),
				);

				setNativeSelectionRange(inlineElement!, 0, inlineElement!, 11);
				document.dispatchEvent(new Event("selectionchange"));

				await flushAnimationFrames(4);
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
			anchor: { blockId, offset: 3 },
			focus: { blockId, offset: 3 },
			isCollapsed: true,
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

	it("collapses a double-click word selection to a caret after a paused single click", async () => {
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
			await flushAnimationFrames(3);
		});

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
			).caretRangeFromPoint = () => {
				const range = document.createRange();
				range.setStart(inlineElement!.firstChild ?? inlineElement!, 3);
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
						detail: 1,
					}),
				);

				setNativeSelectionRange(inlineElement!, 0, inlineElement!, 5);

				document.dispatchEvent(
					new MouseEvent("mouseup", {
						bubbles: true,
						button: 0,
						clientX: 12,
						clientY: 8,
						detail: 1,
					}),
				);
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
			anchor: { blockId, offset: 3 },
			focus: { blockId, offset: 3 },
			isCollapsed: true,
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

	it("collapses backspace deletion to the normalized range start", async () => {
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
		const editor = createEditor();
		const blockId = editor.firstBlock()!.id;

		editor.apply([
			{ type: "convert-block", blockId, newType: "blockquote" },
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

	it("backspace exits an empty bullet list item via beforeinput", async () => {
		const editor = createEditor();
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
		const editor = createEditor();
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
		const editor = createEditor();
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
		const editor = createEditor();
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
		const editor = createEditor();
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

	it("deletes first cmd+a selection from the active editing surface on backspace", async () => {
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
			fieldEditor.activate(blockId);
			await flushAnimationFrames(2);
		});

		await act(async () => {
			inlineElement!.dispatchEvent(createSelectAllEvent());
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
			inlineElement!.dispatchEvent(
				createKeyEvent("Backspace", { cancelable: true }),
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

	it("deletes the full selected paragraph on backspace keydown in the active surface", async () => {
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
			fieldEditor.activateTextSelection(blockId, 0, 5);
			await flushAnimationFrames(3);
		});

		await act(async () => {
			inlineElement!.dispatchEvent(
				createKeyEvent("Backspace", { cancelable: true }),
			);
			await flushAnimationFrames(2);
		});

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

	it("deletes the full selected heading on backspace keydown in the active surface", async () => {
		const editor = createEditor();
		const blockId = editor.firstBlock()!.id;

		editor.apply([
			{ type: "convert-block", blockId, newType: "heading" },
			{ type: "insert-text", blockId, offset: 0, text: "Title" },
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
			fieldEditor.activateTextSelection(blockId, 0, 5);
			await flushAnimationFrames(3);
		});

		await act(async () => {
			inlineElement!.dispatchEvent(
				createKeyEvent("Backspace", { cancelable: true }),
			);
			await flushAnimationFrames(2);
		});

		expect(editor.getBlock(blockId)?.type).toBe("heading");
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

	it("deletes a selected single-block range from editor chrome even with a stale DOM selection", async () => {
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
					<button type="button">Toolbar</button>
					<Pen.Editor.Content />
				</Pen.Editor.Root>,
			);
		});

		const fieldEditor = getFieldEditor(editor);
		const toolbarButton = container.querySelector(
			"button",
		) as HTMLButtonElement | null;
		const inlineElement = container.querySelector(
			"[data-pen-inline-content]",
		) as HTMLElement | null;

		expect(toolbarButton).not.toBeNull();
		expect(inlineElement).not.toBeNull();

		await act(async () => {
			fieldEditor.activateTextSelection(blockId, 1, 4);
			await flushAnimationFrames(3);
		});

		await act(async () => {
			toolbarButton!.focus();
			fieldEditor.setFocused(true);
			setNativeSelectionRange(inlineElement!, 1, inlineElement!, 4);
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

	it("deletes a selected single-block range when focus moves to editor chrome", async () => {
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
					<button type="button">Toolbar</button>
					<Pen.Editor.Content />
				</Pen.Editor.Root>,
			);
		});

		const fieldEditor = getFieldEditor(editor);
		const toolbarButton = container.querySelector(
			"button",
		) as HTMLButtonElement | null;

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

	it("resets an empty heading to paragraph on backspace keydown", async () => {
		const editor = createEditor();
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
				createKeyEvent("Backspace", { cancelable: true }),
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

	it("deletes the full-document selection after first cmd+a in flow documents", async () => {
		const editor = createEditor({
			documentProfile: "flow",
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
		const inlineElement = container.querySelector(
			"[data-pen-inline-content]",
		) as HTMLElement | null;
		const rootElement = container.querySelector(
			"[data-pen-editor-root]",
		) as HTMLElement | null;

		expect(inlineElement).not.toBeNull();
		expect(rootElement).not.toBeNull();

		await act(async () => {
			fieldEditor.activate(firstBlockId);
			await flushAnimationFrames(2);
		});

		await act(async () => {
			inlineElement!.dispatchEvent(createSelectAllEvent());
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
			inlineElement!.dispatchEvent(
				createKeyEvent("Backspace", { cancelable: true }),
			);
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

	it("restores the DOM selection before insertText when the active selection is stale", async () => {
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
			await flushAnimationFrames(3);
		});

		const outsideText = document.createTextNode("outside");
		document.body.appendChild(outsideText);
		const outsideRange = document.createRange();
		outsideRange.setStart(outsideText, 0);
		outsideRange.collapse(true);
		const selection = document.getSelection();
		selection?.removeAllRanges();
		selection?.addRange(outsideRange);

		const inputEvent = new InputEvent("beforeinput", {
			bubbles: true,
			cancelable: true,
			inputType: "insertText",
			data: "!",
		});

		await act(async () => {
			inlineElement!.dispatchEvent(inputEvent);
			await flushAnimationFrames(2);
		});

		expect(inputEvent.defaultPrevented).toBe(true);
		expect(editor.getBlock(blockId)?.textContent()).toBe("Hello!");
		expect(editor.selection).toMatchObject({
			type: "text",
			anchor: { blockId, offset: 6 },
			focus: { blockId, offset: 6 },
			isCollapsed: true,
		});

		await act(async () => {
			root.unmount();
		});
		outsideText.remove();
		container.remove();
		editor.destroy();
	});

	it("moves the caret into the inserted block after Enter at block end", async () => {
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
		const editor = createEditor();
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

		const editor = createEditor();
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
					<Pen.Editor.Root
						editor={editor}
						inputBackend="edit-context"
					>
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
			const originalUpdateText =
				editContext!.updateText.bind(editContext);
			editContext!.updateText = (start, end, text) => {
				originalUpdateText(start, end, text);
				editContext!.selectionStart = start;
				editContext!.selectionEnd = start;
			};

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

	it("uses the editor caret when EditContext reports a stale collapsed insert range", async () => {
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

		const editor = createEditor();
		const blockId = editor.firstBlock()!.id;
		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);

		try {
			await act(async () => {
				root.render(
					<Pen.Editor.Root
						editor={editor}
						inputBackend="edit-context"
					>
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
			const rootElement = container.querySelector(
				"[data-pen-editor-root]",
			) as HTMLElement | null;

			expect(inlineElement).not.toBeNull();
			expect(rootElement).not.toBeNull();

			await act(async () => {
				fieldEditor.activateTextSelection(blockId, 0, 0);
				await flushAnimationFrames(2);
			});

			const editContext = inlineElement?.editContext;
			expect(editContext).toBeTruthy();

			await act(async () => {
				editContext!.emit("textupdate", {
					updateRangeStart: 0,
					updateRangeEnd: 0,
					text: "H",
					selectionStart: 0,
					selectionEnd: 0,
				});
				await flushAnimationFrames(2);
				setNativeSelectionRange(inlineElement!, 0, inlineElement!, 0);
				document.dispatchEvent(new Event("selectionchange"));
				await flushAnimationFrames(2);
			});
			expect(domSelectionToEditor(rootElement!)).toMatchObject({
				anchor: { blockId, offset: 1 },
				focus: { blockId, offset: 1 },
			});

			await act(async () => {
				editContext!.emit("textupdate", {
					updateRangeStart: 1,
					updateRangeEnd: 1,
					text: "e",
					selectionStart: 1,
					selectionEnd: 1,
				});
				await flushAnimationFrames(2);
			});

			expect(editor.selection).toMatchObject({
				type: "text",
				anchor: { blockId, offset: 2 },
				focus: { blockId, offset: 2 },
			});
			await act(async () => {
				fieldEditor.syncTextSelection(blockId, 1, 1);
				await flushAnimationFrames(1);
			});
			expect(editor.selection).toMatchObject({
				type: "text",
				anchor: { blockId, offset: 1 },
				focus: { blockId, offset: 1 },
			});

			await act(async () => {
				editContext!.emit("textupdate", {
					updateRangeStart: 1,
					updateRangeEnd: 1,
					text: "y",
					selectionStart: 1,
					selectionEnd: 1,
				});
				await flushAnimationFrames(2);
			});

			expect(editor.getBlock(blockId)?.textContent()).toBe("Hey");
			expect(inlineElement!.textContent).toBe("Hey");
			expect(editor.selection).toMatchObject({
				type: "text",
				anchor: { blockId, offset: 3 },
				focus: { blockId, offset: 3 },
			});
			expect(domSelectionToEditor(rootElement!)).toMatchObject({
				anchor: { blockId, offset: 3 },
				focus: { blockId, offset: 3 },
			});
			expect(editContext?.selectionStart).toBe(3);
			expect(editContext?.selectionEnd).toBe(3);

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

	it("treats the initial zero-width placeholder as offset zero for EditContext input", async () => {
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

		const editor = createEditor();
		const blockId = editor.firstBlock()!.id;
		editor.apply(
			[{ type: "insert-text", blockId, offset: 0, text: "\u200B" }],
			{ origin: "import" },
		);
		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);

		try {
			await act(async () => {
				root.render(
					<Pen.Editor.Root
						editor={editor}
						inputBackend="edit-context"
					>
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
			const rootElement = container.querySelector(
				"[data-pen-editor-root]",
			) as HTMLElement | null;

			expect(inlineElement).not.toBeNull();
			expect(rootElement).not.toBeNull();

			await act(async () => {
				fieldEditor.activateTextSelection(blockId, 1, 1);
				await flushAnimationFrames(2);
			});

			const editContext = inlineElement?.editContext;
			expect(editContext).toBeTruthy();
			expect(editContext?.text).toBe("");
			expect(editContext?.selectionStart).toBe(0);
			expect(editContext?.selectionEnd).toBe(0);

			await act(async () => {
				editContext!.emit("textupdate", {
					updateRangeStart: 1,
					updateRangeEnd: 1,
					text: "H",
					selectionStart: 1,
					selectionEnd: 1,
				});
				await flushAnimationFrames(2);
				setNativeSelectionRange(inlineElement!, 0, inlineElement!, 0);
				document.dispatchEvent(new Event("selectionchange"));
				await flushAnimationFrames(2);
			});
			expect(domSelectionToEditor(rootElement!)).toMatchObject({
				anchor: { blockId, offset: 1 },
				focus: { blockId, offset: 1 },
			});

			await act(async () => {
				editContext!.emit("textupdate", {
					updateRangeStart: 0,
					updateRangeEnd: 0,
					text: "e",
					selectionStart: 0,
					selectionEnd: 0,
				});
				await flushAnimationFrames(2);
				setNativeSelectionRange(inlineElement!, 0, inlineElement!, 0);
				document.dispatchEvent(new Event("selectionchange"));
				await flushAnimationFrames(2);
			});
			expect(domSelectionToEditor(rootElement!)).toMatchObject({
				anchor: { blockId, offset: 2 },
				focus: { blockId, offset: 2 },
			});

			await act(async () => {
				editContext!.emit("textupdate", {
					updateRangeStart: 0,
					updateRangeEnd: 0,
					text: "y",
					selectionStart: 0,
					selectionEnd: 0,
				});
				await flushAnimationFrames(2);
				setNativeSelectionRange(inlineElement!, 0, inlineElement!, 0);
				document.dispatchEvent(new Event("selectionchange"));
				await flushAnimationFrames(2);
			});

			expect(editor.getBlock(blockId)?.textContent()).toBe("Hey");
			expect(inlineElement!.textContent).toBe("Hey");
			expect(editor.selection).toMatchObject({
				type: "text",
				anchor: { blockId, offset: 3 },
				focus: { blockId, offset: 3 },
			});
			expect(domSelectionToEditor(rootElement!)).toMatchObject({
				anchor: { blockId, offset: 3 },
				focus: { blockId, offset: 3 },
			});
			expect(editContext?.selectionStart).toBe(3);
			expect(editContext?.selectionEnd).toBe(3);

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

	it("updates EditContext text before projecting the post-insert selection", async () => {
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

		const editor = createEditor();
		const blockId = editor.firstBlock()!.id;
		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);

		try {
			await act(async () => {
				root.render(
					<Pen.Editor.Root
						editor={editor}
						inputBackend="edit-context"
					>
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
				await flushAnimationFrames(2);
			});

			const editContext = inlineElement?.editContext;
			expect(editContext).toBeTruthy();
			const calls: string[] = [];
			const originalUpdateText =
				editContext!.updateText.bind(editContext);
			const originalUpdateSelection =
				editContext!.updateSelection.bind(editContext);
			editContext!.updateText = (start, end, text) => {
				calls.push(
					`dom-before-text:${inlineElement!.textContent ?? ""}`,
				);
				calls.push(`text:${start}:${end}:${text}`);
				originalUpdateText(start, end, text);
			};
			editContext!.updateSelection = (start, end) => {
				calls.push(`selection:${start}:${end}`);
				originalUpdateSelection(start, end);
			};

			await act(async () => {
				editContext!.emit("textupdate", {
					updateRangeStart: 0,
					updateRangeEnd: 0,
					text: "H",
					selectionStart: 0,
					selectionEnd: 0,
				});
				await flushAnimationFrames(2);
			});

			const textUpdateIndex = calls.indexOf("text:0:0:H");
			const postInsertSelectionIndex = calls.indexOf("selection:1:1");
			expect(calls).toContain("dom-before-text:H");
			expect(textUpdateIndex).toBeGreaterThanOrEqual(0);
			expect(postInsertSelectionIndex).toBeGreaterThan(textUpdateIndex);
			expect(editor.getBlock(blockId)?.textContent()).toBe("H");
			expect(editor.selection).toMatchObject({
				type: "text",
				anchor: { blockId, offset: 1 },
				focus: { blockId, offset: 1 },
			});
			expect(editContext?.selectionStart).toBe(1);
			expect(editContext?.selectionEnd).toBe(1);

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

	it("ignores stale native selectionchange while projecting the EditContext caret", async () => {
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

		const editor = createEditor();
		const blockId = editor.firstBlock()!.id;
		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);

		try {
			await act(async () => {
				root.render(
					<Pen.Editor.Root
						editor={editor}
						inputBackend="edit-context"
					>
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
				await flushAnimationFrames(2);
			});

			const editContext = inlineElement?.editContext;
			expect(editContext).toBeTruthy();

			await act(async () => {
				editContext!.emit("textupdate", {
					updateRangeStart: 0,
					updateRangeEnd: 0,
					text: "H",
					selectionStart: 0,
					selectionEnd: 0,
				});
				setNativeSelectionRange(inlineElement!, 0, inlineElement!, 0);
				document.dispatchEvent(new Event("selectionchange"));
				await flushAnimationFrames(2);
			});

			expect(editor.getBlock(blockId)?.textContent()).toBe("H");
			expect(editor.selection).toMatchObject({
				type: "text",
				anchor: { blockId, offset: 1 },
				focus: { blockId, offset: 1 },
			});
			expect(editContext?.selectionStart).toBe(1);
			expect(editContext?.selectionEnd).toBe(1);

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

		const editor = createEditor();
		const blockId = editor.firstBlock()!.id;

		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);

		try {
			await act(async () => {
				root.render(
					<Pen.Editor.Root
						editor={editor}
						inputBackend="edit-context"
					>
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

		const editor = createEditor();
		const blockId = editor.firstBlock()!.id;

		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);

		try {
			await act(async () => {
				root.render(
					<Pen.Editor.Root
						editor={editor}
						inputBackend="edit-context"
					>
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

	it("deletes a selected word on Backspace in EditContext when cached selection is stale", async () => {
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

		const editor = createEditor();
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
					<Pen.Editor.Root
						editor={editor}
						inputBackend="edit-context"
					>
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
				fieldEditor.activateTextSelection(blockId, 1, 4);
				await flushAnimationFrames(3);
			});

			const editContext = inlineElement?.editContext;
			expect(editContext).toBeTruthy();

			await act(async () => {
				editContext!.updateSelection(4, 4);
				setNativeSelectionRange(inlineElement!, 1, inlineElement!, 4);
				inlineElement!.dispatchEvent(
					createKeyEvent("Backspace", { cancelable: true }),
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
			expect(editContext?.selectionStart).toBe(1);
			expect(editContext?.selectionEnd).toBe(1);

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

	it("deletes a first cmd+a selection on Backspace in EditContext when cached selection is stale", async () => {
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

		const editor = createEditor();
		const blockId = editor.firstBlock()!.id;

		editor.apply([
			{ type: "insert-text", blockId, offset: 0, text: "Title" },
		]);

		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);

		try {
			await act(async () => {
				root.render(
					<Pen.Editor.Root
						editor={editor}
						inputBackend="edit-context"
					>
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
				fieldEditor.activate(blockId);
				await flushAnimationFrames(2);
			});

			await act(async () => {
				inlineElement!.dispatchEvent(createSelectAllEvent());
				await flushAnimationFrames(2);
			});

			const editContext = inlineElement?.editContext;
			expect(editContext).toBeTruthy();

			await act(async () => {
				editContext!.updateSelection(5, 5);
				setNativeSelectionRange(inlineElement!, 0, inlineElement!, 5);
				inlineElement!.dispatchEvent(
					createKeyEvent("Backspace", { cancelable: true }),
				);
				await flushAnimationFrames(2);
			});

			expect(editor.getBlock(blockId)?.textContent()).toBe("");
			expect(editor.selection).toMatchObject({
				type: "text",
				anchor: { blockId, offset: 0 },
				focus: { blockId, offset: 0 },
				isCollapsed: true,
				isMultiBlock: false,
			});
			expect(editContext?.selectionStart).toBe(0);
			expect(editContext?.selectionEnd).toBe(0);

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

	it("deletes a cmd+a selection on Backspace when the native EditContext range is collapsed", async () => {
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

		const editor = createEditor();
		const blockId = editor.firstBlock()!.id;

		editor.apply([
			{ type: "insert-text", blockId, offset: 0, text: "Title" },
		]);

		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);

		try {
			await act(async () => {
				root.render(
					<Pen.Editor.Root
						editor={editor}
						inputBackend="edit-context"
					>
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
				fieldEditor.activate(blockId);
				await flushAnimationFrames(2);
			});

			await act(async () => {
				inlineElement!.dispatchEvent(createSelectAllEvent());
				await flushAnimationFrames(4);
				setNativeSelectionRange(inlineElement!, 0, inlineElement!, 0);
				document.dispatchEvent(new Event("selectionchange"));
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
				setNativeSelectionRange(inlineElement!, 0, inlineElement!, 0);
				inlineElement!.dispatchEvent(
					createKeyEvent("Backspace", { cancelable: true }),
				);
				await flushAnimationFrames(2);
			});

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
		} finally {
			(
				globalThis as typeof globalThis & {
					EditContext?: typeof FakeEditContext;
				}
			).EditContext = originalEditContext;
		}
	});

	it("keeps repeated cmd+a deletion working after retyping in EditContext", async () => {
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

		const editor = createEditor();
		const blockId = editor.firstBlock()!.id;

		editor.apply([
			{ type: "insert-text", blockId, offset: 0, text: "Title" },
		]);

		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);

		try {
			await act(async () => {
				root.render(
					<Pen.Editor.Root
						editor={editor}
						inputBackend="edit-context"
					>
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
				fieldEditor.activate(blockId);
				await flushAnimationFrames(2);
			});

			await act(async () => {
				inlineElement!.dispatchEvent(createSelectAllEvent());
				await flushAnimationFrames(2);
				inlineElement!.dispatchEvent(
					createKeyEvent("Backspace", { cancelable: true }),
				);
				await flushAnimationFrames(2);
			});

			expect(editor.getBlock(blockId)?.textContent()).toBe("");

			const editContext = inlineElement?.editContext;
			expect(editContext).toBeTruthy();

			await act(async () => {
				editContext!.emit("textupdate", {
					updateRangeStart: 0,
					updateRangeEnd: 0,
					text: "Again",
					selectionStart: 5,
					selectionEnd: 5,
				});
				await flushAnimationFrames(2);
			});

			expect(editor.getBlock(blockId)?.textContent()).toBe("Again");

			await act(async () => {
				inlineElement!.dispatchEvent(createSelectAllEvent());
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
				setNativeSelectionRange(inlineElement!, 0, inlineElement!, 0);
				inlineElement!.dispatchEvent(
					createKeyEvent("Backspace", { cancelable: true }),
				);
				await flushAnimationFrames(2);
			});

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
		} finally {
			(
				globalThis as typeof globalThis & {
					EditContext?: typeof FakeEditContext;
				}
			).EditContext = originalEditContext;
		}
	});

	it("restores logical selection on undo and redo", async () => {
		const editor = createUndoSelectionDeletionEditor();
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
		const editor = createUndoSelectionDeletionEditor();
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

		const insertedBlockId =
			editor.selection?.type === "text"
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

		const redoneBlockId =
			editor.selection?.type === "text"
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
		const editor = createUndoSelectionDeletionEditor();
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
		const editor = createUndoSelectionDeletionEditor();
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
		const toolbarButton = container.querySelector(
			"button",
		) as HTMLButtonElement | null;

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
			const editor = createUndoSelectionDeletionEditor();
			const blockId = editor.firstBlock()!.id;

			editor.apply([
				{ type: "insert-text", blockId, offset: 0, text: "Hello" },
			]);

			const container = document.createElement("div");
			document.body.appendChild(container);
			const root = createRoot(container);

			await act(async () => {
				root.render(
					<Pen.Editor.Root
						editor={editor}
						inputBackend="edit-context"
					>
						<button type="button">Undo</button>
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
			const toolbarButton = container.querySelector(
				"button",
			) as HTMLButtonElement | null;

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
			const editor = createUndoSelectionDeletionEditor();
			const blockId = editor.firstBlock()!.id;

			editor.apply([
				{ type: "insert-text", blockId, offset: 0, text: "Hello" },
			]);

			const container = document.createElement("div");
			document.body.appendChild(container);
			const root = createRoot(container);

			await act(async () => {
				root.render(
					<Pen.Editor.Root
						editor={editor}
						inputBackend="edit-context"
					>
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
		const editor = createUndoSelectionDeletionEditor();
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
		const toolbarButton = container.querySelector(
			"button",
		) as HTMLButtonElement | null;

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
		const editor = createUndoSelectionDeletionEditor();
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
		const toolbarButton = container.querySelector(
			"button",
		) as HTMLButtonElement | null;

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
