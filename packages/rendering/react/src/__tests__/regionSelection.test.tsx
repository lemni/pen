// @vitest-environment jsdom

import React, { act } from "react";
import { describe, expect, it } from "vitest";
import { createRoot } from "react-dom/client";
import { createEditor } from "@pen/core";
import { defaultPreset } from "@pen/preset-default";
import { Pen } from "../primitives/index";

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

function createMouseEvent(
	type: "mousedown" | "mousemove" | "mouseup",
	clientX: number,
	clientY: number,
): MouseEvent {
	return new MouseEvent(type, {
		bubbles: true,
		cancelable: true,
		button: 0,
		buttons: type === "mouseup" ? 0 : 1,
		clientX,
		clientY,
	});
}

function setRect(
	element: Element,
	left: number,
	top: number,
	width: number,
	height: number,
): void {
	Object.defineProperty(element, "getBoundingClientRect", {
		configurable: true,
		value: () => new DOMRect(left, top, width, height),
	});
}

function createThreeBlockEditor() {
	const editor = createEditor({
		preset: defaultPreset({
			documentOps: false,
			deltaStream: false,
			undo: false,
		}),
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

	return { editor, firstBlockId, secondBlockId, thirdBlockId };
}

describe("@pen/react region selection", () => {
	it("focuses the existing empty placeholder block on background click", async () => {
		const editor = createEditor({
			preset: defaultPreset({
				documentOps: false,
				deltaStream: false,
				undo: false,
			}),
		});
		const firstBlockId = editor.firstBlock()!.id;
		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);

		try {
			await act(async () => {
				root.render(
					<Pen.Editor.Root editor={editor}>
						<Pen.Editor.Content emptyPlaceholder="Start writing..." />
						<Pen.Editor.RegionSelector />
						<Pen.Editor.SelectionRect />
					</Pen.Editor.Root>,
				);
			});

			const contentElement = container.querySelector(
				"[data-pen-editor-content]",
			) as HTMLElement | null;

			expect(contentElement).not.toBeNull();

			await act(async () => {
				contentElement?.dispatchEvent(createMouseEvent("mousedown", 12, 12));
				document.dispatchEvent(createMouseEvent("mouseup", 12, 12));
				contentElement?.dispatchEvent(
					new MouseEvent("click", {
						bubbles: true,
						cancelable: true,
						button: 0,
					}),
				);
				await flushAnimationFrames(2);
			});

			expect(editor.selection).toMatchObject({
				type: "text",
				anchor: { blockId: firstBlockId, offset: 0 },
				focus: { blockId: firstBlockId, offset: 0 },
			});
		} finally {
			await act(async () => {
				root.unmount();
			});
			container.remove();
			editor.destroy();
		}
	});

	it("inserts a new paragraph when the editor has no blocks", async () => {
		const editor = createEditor({
			preset: defaultPreset({
				documentOps: false,
				deltaStream: false,
				undo: false,
			}),
		});
		const firstBlockId = editor.firstBlock()!.id;
		editor.apply([{ type: "delete-block", blockId: firstBlockId }]);
		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);

		try {
			await act(async () => {
				root.render(
					<Pen.Editor.Root editor={editor}>
						<Pen.Editor.Content emptyPlaceholder="Start writing..." />
						<Pen.Editor.RegionSelector />
						<Pen.Editor.SelectionRect />
					</Pen.Editor.Root>,
				);
			});

			const contentElement = container.querySelector(
				"[data-pen-editor-content]",
			) as HTMLElement | null;

			expect(contentElement).not.toBeNull();
			expect(editor.documentState.blockOrder).toHaveLength(0);

			await act(async () => {
				contentElement?.dispatchEvent(createMouseEvent("mousedown", 12, 12));
				document.dispatchEvent(createMouseEvent("mouseup", 12, 12));
				contentElement?.dispatchEvent(
					new MouseEvent("click", {
						bubbles: true,
						cancelable: true,
						button: 0,
					}),
				);
				await flushAnimationFrames(2);
			});

			expect(editor.documentState.blockOrder).toHaveLength(1);
			const newBlockId = editor.documentState.blockOrder[0]!;
			expect(editor.getBlock(newBlockId)?.type).toBe("paragraph");
			expect(editor.selection).toMatchObject({
				type: "text",
				anchor: { blockId: newBlockId, offset: 0 },
				focus: { blockId: newBlockId, offset: 0 },
			});
		} finally {
			await act(async () => {
				root.unmount();
			});
			container.remove();
			editor.destroy();
		}
	});

	it("preserves normal click-to-focus on blocks", async () => {
		const { editor, firstBlockId } = createThreeBlockEditor();
		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);

		try {
			await act(async () => {
				root.render(
					<Pen.Editor.Root editor={editor}>
						<Pen.Editor.Content />
						<Pen.Editor.RegionSelector />
						<Pen.Editor.SelectionRect />
					</Pen.Editor.Root>,
				);
			});

			const firstBlockElement = container.querySelector(
				`[data-block-id="${firstBlockId}"]`,
			) as HTMLElement | null;

			expect(firstBlockElement).not.toBeNull();

			await act(async () => {
				firstBlockElement?.dispatchEvent(
					new MouseEvent("mousedown", {
						bubbles: true,
						cancelable: true,
						button: 0,
						buttons: 1,
					}),
				);
				document.dispatchEvent(createMouseEvent("mouseup", 12, 12));
				firstBlockElement?.dispatchEvent(
					new MouseEvent("click", {
						bubbles: true,
						cancelable: true,
						button: 0,
					}),
				);
				await flushAnimationFrames(2);
			});

			expect(editor.selection).toMatchObject({
				type: "text",
				anchor: { blockId: firstBlockId, offset: 0 },
				focus: { blockId: firstBlockId, offset: 0 },
			});
			expect(
				container.querySelector("[data-pen-selection-rect]"),
			).toBeNull();
		} finally {
			await act(async () => {
				root.unmount();
			});
			container.remove();
			editor.destroy();
		}
	});

	it("selects intersected blocks in document order and reuses the selection rect overlay", async () => {
		const { editor, firstBlockId, secondBlockId, thirdBlockId } =
			createThreeBlockEditor();
		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);

		try {
			await act(async () => {
				root.render(
					<Pen.Editor.Root editor={editor}>
						<Pen.Editor.Content />
						<Pen.Editor.RegionSelector />
						<Pen.Editor.SelectionRect />
					</Pen.Editor.Root>,
				);
			});

			const contentElement = container.querySelector(
				"[data-pen-editor-content]",
			) as HTMLElement | null;
			const blockElements = container.querySelectorAll("[data-block-id]");

			expect(contentElement).not.toBeNull();
			expect(blockElements).toHaveLength(3);

			setRect(blockElements[0]!, 0, 0, 200, 40);
			setRect(blockElements[1]!, 0, 50, 200, 40);
			setRect(blockElements[2]!, 0, 100, 200, 40);

			await act(async () => {
				contentElement?.dispatchEvent(createMouseEvent("mousedown", 0, 0));
				document.dispatchEvent(createMouseEvent("mousemove", 180, 85));
			});

			expect(editor.selection).toMatchObject({
				type: "block",
				blockIds: [firstBlockId, secondBlockId],
			});

			const activeOverlay = container.querySelector(
				"[data-pen-selection-rect]",
			) as HTMLElement | null;
			expect(activeOverlay).not.toBeNull();
			expect(activeOverlay?.hasAttribute("data-selecting")).toBe(true);

			await act(async () => {
				document.dispatchEvent(createMouseEvent("mouseup", 180, 85));
				await flushAnimationFrames(2);
			});

			expect(editor.selection).toMatchObject({
				type: "block",
				blockIds: [firstBlockId, secondBlockId],
			});
			expect(
				container
					.querySelector(`[data-block-id="${firstBlockId}"]`)
					?.hasAttribute("data-selected"),
			).toBe(true);
			expect(
				container
					.querySelector(`[data-block-id="${secondBlockId}"]`)
					?.hasAttribute("data-selected"),
			).toBe(true);
			expect(
				container
					.querySelector(`[data-block-id="${thirdBlockId}"]`)
					?.hasAttribute("data-selected"),
			).toBe(false);

			const committedOverlay = container.querySelector(
				"[data-pen-selection-rect]",
			) as HTMLElement | null;
			expect(committedOverlay).not.toBeNull();
			expect(committedOverlay?.hasAttribute("data-selecting")).toBe(false);
		} finally {
			await act(async () => {
				root.unmount();
			});
			container.remove();
			editor.destroy();
		}
	});

	it("does not activate marquee selection unless the primitive is mounted", async () => {
		const { editor } = createThreeBlockEditor();
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

			const contentElement = container.querySelector(
				"[data-pen-editor-content]",
			) as HTMLElement | null;
			const blockElements = container.querySelectorAll("[data-block-id]");

			expect(contentElement).not.toBeNull();
			expect(blockElements).toHaveLength(3);

			setRect(blockElements[0]!, 0, 0, 200, 40);
			setRect(blockElements[1]!, 0, 50, 200, 40);
			setRect(blockElements[2]!, 0, 100, 200, 40);

			await act(async () => {
				contentElement?.dispatchEvent(createMouseEvent("mousedown", 0, 0));
				document.dispatchEvent(createMouseEvent("mousemove", 180, 85));
				document.dispatchEvent(createMouseEvent("mouseup", 180, 85));
			});

			expect(editor.selection).toBeNull();
			expect(
				container.querySelector("[data-pen-selection-rect]"),
			).toBeNull();
		} finally {
			await act(async () => {
				root.unmount();
			});
			container.remove();
			editor.destroy();
		}
	});

	it("clips the marquee overlay to the configured region rect", async () => {
		const { editor, firstBlockId } = createThreeBlockEditor();
		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);
		const regionRect = new DOMRect(0, 40, 400, 200);

		try {
			await act(async () => {
				root.render(
					<Pen.Editor.Root editor={editor}>
						<Pen.Editor.Content />
						<Pen.Editor.RegionSelector
							getRegionRect={() => regionRect}
						/>
						<Pen.Editor.SelectionRect />
					</Pen.Editor.Root>,
				);
			});

			const contentElement = container.querySelector(
				"[data-pen-editor-content]",
			) as HTMLElement | null;
			const blockElements = container.querySelectorAll("[data-block-id]");

			expect(contentElement).not.toBeNull();
			expect(blockElements).toHaveLength(3);

			setRect(blockElements[0]!, 0, 50, 200, 40);
			setRect(blockElements[1]!, 0, 100, 200, 40);
			setRect(blockElements[2]!, 0, 150, 200, 40);

			await act(async () => {
				contentElement?.dispatchEvent(createMouseEvent("mousedown", 10, 60));
				document.dispatchEvent(createMouseEvent("mousemove", 180, 20));
			});

			expect(editor.selection).toMatchObject({
				type: "block",
				blockIds: [firstBlockId],
			});

			const activeOverlay = container.querySelector(
				"[data-pen-selection-rect]",
			) as HTMLElement | null;
			expect(activeOverlay).not.toBeNull();
			expect(activeOverlay?.style.top).toBe("40px");
			expect(activeOverlay?.style.height).toBe("20px");
		} finally {
			await act(async () => {
				root.unmount();
			});
			container.remove();
			editor.destroy();
		}
	});

	it("starts marquee selection from the editor root outside content", async () => {
		const { editor, firstBlockId, secondBlockId } = createThreeBlockEditor();
		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);
		const regionRect = new DOMRect(0, 0, 600, 400);

		try {
			await act(async () => {
				root.render(
					<Pen.Editor.Root editor={editor}>
						<div data-testid="toolbar-shell" data-pen-ignore-pointer-gesture="">
							Toolbar
						</div>
						<Pen.Editor.Content />
						<Pen.Editor.RegionSelector
							getRegionRect={() => regionRect}
						/>
						<Pen.Editor.SelectionRect />
					</Pen.Editor.Root>,
				);
			});

			const rootElement = container.querySelector(
				"[data-pen-editor-root]",
			) as HTMLElement | null;
			const blockElements = container.querySelectorAll("[data-block-id]");

			expect(rootElement).not.toBeNull();
			expect(blockElements).toHaveLength(3);

			setRect(blockElements[0]!, 0, 20, 200, 40);
			setRect(blockElements[1]!, 0, 70, 200, 40);
			setRect(blockElements[2]!, 0, 120, 200, 40);

			await act(async () => {
				rootElement?.dispatchEvent(createMouseEvent("mousedown", 260, 10));
				document.dispatchEvent(createMouseEvent("mousemove", 120, 90));
			});

			expect(editor.selection).toMatchObject({
				type: "block",
				blockIds: [firstBlockId, secondBlockId],
			});
		} finally {
			await act(async () => {
				root.unmount();
			});
			container.remove();
			editor.destroy();
		}
	});
});
