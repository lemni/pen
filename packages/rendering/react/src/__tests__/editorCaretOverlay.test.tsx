// @vitest-environment jsdom

import React, { act } from "react";
import { describe, expect, it } from "vitest";
import { createRoot } from "react-dom/client";
import { createEditor } from "@pen/core";
import { defaultPreset } from "@pen/preset-default";
import { Pen } from "../primitives/index";
import { PenEditor } from "../penEditor";
import { FIELD_EDITOR_SLOT_KEY } from "../constants/fieldEditor";

(
	globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe("@pen/react editor caret overlay", () => {
	it("renders a custom local caret for collapsed selections only", async () => {
		const editor = createEditor({
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
		]);

		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);
		let caretStyle: React.CSSProperties | null = null;

		try {
			await act(async () => {
				root.render(
					<Pen.Editor.Root editor={editor}>
						<Pen.Editor.Content />
						<Pen.Editor.CaretOverlay
							renderCaret={(props) => {
								caretStyle = props.caretStyle;
								return (
									<div
										{...props.attributes}
										style={props.caretStyle}
									/>
								);
							}}
						/>
					</Pen.Editor.Root>,
				);
			});

			const fieldEditor = getFieldEditor(editor);
			const inlineElement = container.querySelector(
				"[data-pen-inline-content]",
			) as HTMLElement | null;

			expect(inlineElement).not.toBeNull();
			if (!inlineElement) {
				throw new Error("Missing inline content element");
			}
			expect(
				container.querySelector("[data-pen-editor-caret]"),
			).toBeNull();

			Object.defineProperty(inlineElement, "getBoundingClientRect", {
				configurable: true,
				value: () => new DOMRect(24, 32, 240, 24),
			});

			await act(async () => {
				fieldEditor.activateTextSelection(blockId, 2, 2);
				inlineElement?.dispatchEvent(
					new Event("focusin", { bubbles: true }),
				);
			});

			const caretElement = container.querySelector(
				"[data-pen-editor-caret]",
			) as HTMLElement | null;
			expect(caretElement?.getAttribute("data-block-id")).toBe(blockId);
			expect(caretElement?.getAttribute("data-offset")).toBe("2");
			expect(caretElement?.style.animation).toBe("none");
			const resolvedCaretStyle = caretStyle as React.CSSProperties | null;
			expect(resolvedCaretStyle?.width).toBe(
				"var(--pen-editor-caret-width, var(--pen-caret-width, 1px))",
			);
			expect(resolvedCaretStyle?.borderRadius).toBe(
				"var(--pen-editor-caret-radius, var(--pen-caret-radius, 0px))",
			);
			expect(resolvedCaretStyle?.background).toBe(
				"var(--pen-editor-caret-color, var(--pen-caret-color, var(--palette-b100, currentColor)))",
			);
			expect(inlineElement?.style.caretColor).toBe("transparent");
			expect(
				container
					.querySelector("[data-pen-editor-caret-overlay]")
					?.hasAttribute("data-caret-visible"),
			).toBe(true);

			await act(async () => {
				await wait(550);
			});
			expect(caretElement?.style.animation).toBe(
				"var(--pen-editor-caret-animation, none)",
			);

			await act(async () => {
				inlineElement.dispatchEvent(
					new Event("beforeinput", {
						bubbles: true,
						cancelable: true,
					}),
				);
			});
			expect(caretElement?.style.animation).toBe("none");

			await act(async () => {
				editor.selectText(blockId, 1, 4);
			});

			expect(
				container.querySelector("[data-pen-editor-caret]"),
			).toBeNull();
			expect(inlineElement?.style.caretColor).toBe("");
			expect(
				container
					.querySelector("[data-pen-editor-caret-overlay]")
					?.hasAttribute("data-caret-visible"),
			).toBe(false);
		} finally {
			await act(async () => {
				root.unmount();
			});
			container.remove();
			editor.destroy();
		}
	});

	it("uses macOS caret defaults when requested", async () => {
		const editor = createEditor({
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
		]);

		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);
		let caretStyle: React.CSSProperties | null = null;

		try {
			await act(async () => {
				root.render(
					<Pen.Editor.Root editor={editor}>
						<Pen.Editor.Content />
						<Pen.Editor.CaretOverlay
							variant={Pen.Editor.CARET.MACOS}
							renderCaret={(props) => {
								caretStyle = props.caretStyle;
								return (
									<div
										{...props.attributes}
										style={props.caretStyle}
									/>
								);
							}}
						/>
					</Pen.Editor.Root>,
				);
			});

			const fieldEditor = getFieldEditor(editor);
			const inlineElement = container.querySelector(
				"[data-pen-inline-content]",
			) as HTMLElement | null;
			expect(inlineElement).not.toBeNull();
			if (!inlineElement) {
				throw new Error("Missing inline content element");
			}

			Object.defineProperty(inlineElement, "getBoundingClientRect", {
				configurable: true,
				value: () => new DOMRect(24, 32, 240, 24),
			});

			await act(async () => {
				fieldEditor.activateTextSelection(blockId, 2, 2);
				inlineElement.dispatchEvent(
					new Event("focusin", { bubbles: true }),
				);
			});

			const resolvedCaretStyle = caretStyle as React.CSSProperties | null;
			expect(resolvedCaretStyle?.width).toBe(
				"var(--pen-editor-caret-width, var(--pen-caret-width, 2px))",
			);
			expect(resolvedCaretStyle?.borderRadius).toBe(
				"var(--pen-editor-caret-radius, var(--pen-caret-radius, 999px))",
			);
			expect(resolvedCaretStyle?.background).toBe(
				"var(--pen-editor-caret-color, var(--pen-caret-color, var(--palette-blue, #0a84ff)))",
			);
		} finally {
			await act(async () => {
				root.unmount();
			});
			container.remove();
			editor.destroy();
		}
	});

	it("keeps the convenience PenEditor API opt-in", async () => {
		const editor = createEditor({
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
		]);

		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);

		try {
			await act(async () => {
				root.render(<PenEditor editor={editor} />);
			});

			const fieldEditor = getFieldEditor(editor);
			const inlineElement = container.querySelector(
				"[data-pen-inline-content]",
			) as HTMLElement | null;
			if (!inlineElement) {
				throw new Error("Missing inline content element");
			}

			Object.defineProperty(inlineElement, "getBoundingClientRect", {
				configurable: true,
				value: () => new DOMRect(24, 32, 240, 24),
			});

			await act(async () => {
				fieldEditor.activateTextSelection(blockId, 2, 2);
				inlineElement.dispatchEvent(
					new Event("focusin", { bubbles: true }),
				);
			});

			expect(
				container.querySelector("[data-pen-editor-caret]"),
			).toBeNull();

			await act(async () => {
				root.render(<PenEditor editor={editor} customCaret />);
			});

			expect(
				container.querySelector("[data-pen-editor-caret]"),
			).not.toBeNull();
		} finally {
			await act(async () => {
				root.unmount();
			});
			container.remove();
			editor.destroy();
		}
	});
});

function wait(ms: number): Promise<void> {
	return new Promise((resolve) => {
		window.setTimeout(resolve, ms);
	});
}

function getFieldEditor(editor: ReturnType<typeof createEditor>) {
	const fieldEditor = editor.internals.getSlot<{
		activateTextSelection(
			blockId: string,
			anchorOffset: number,
			focusOffset: number,
		): void;
	}>(FIELD_EDITOR_SLOT_KEY);
	if (!fieldEditor) {
		throw new Error("Missing attached field editor");
	}
	return fieldEditor;
}
