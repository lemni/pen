// @vitest-environment jsdom

import React, { act } from "react";
import { describe, expect, it } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { createEditor as createCoreEditor } from "@pen/core";
import { defaultPreset } from "@pen/preset-default";
import { Pen } from "../primitives/index";

(
	globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function createEditor(options: Parameters<typeof createCoreEditor>[0] = {}) {
	return createCoreEditor({
		...options,
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

function setBlockRect(blockElement: Element | null, rect: DOMRect): void {
	if (!(blockElement instanceof HTMLElement)) {
		throw new Error("Missing rendered block element");
	}

	blockElement.getBoundingClientRect = () => rect;
}

function createCaretRangeResolver(
	points: Record<string, { element: HTMLElement; offset: number }>,
): (x: number, y: number) => Range | null {
	return (x: number) => {
		const point = x < 50 ? points.start : points.end;
		const range = document.createRange();
		range.setStart(point.element.firstChild ?? point.element, point.offset);
		range.setEnd(point.element.firstChild ?? point.element, point.offset);
		return range;
	};
}

function getInlineSurface(container: HTMLElement, blockId: string): HTMLElement {
	const inlineSurface = container.querySelector(
		`[data-block-id="${blockId}"] [data-pen-inline-content]`,
	) as HTMLElement | null;
	if (!inlineSurface) {
		throw new Error(`Missing inline surface for block ${blockId}`);
	}
	return inlineSurface;
}

describe("@pen/react block selection", () => {
	it("prevents region selector block selection when root block selection is disabled", async () => {
		const editor = createEditor({ documentProfile: "flow" });
		const firstBlockId = editor.firstBlock()!.id;
		const secondBlockId = crypto.randomUUID();

		editor.apply([
			{ type: "insert-text", blockId: firstBlockId, offset: 0, text: "Alpha" },
			{
				type: "insert-block",
				blockId: secondBlockId,
				blockType: "paragraph",
				props: {},
				position: { after: firstBlockId },
			},
			{ type: "insert-text", blockId: secondBlockId, offset: 0, text: "Beta" },
		]);

		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);

		await act(async () => {
			root.render(
				<Pen.Editor.Root
					editor={editor}
					editorViewMode="flow"
					blockSelection={false}
				>
					<Pen.Editor.Content />
					<Pen.Editor.RegionSelector />
				</Pen.Editor.Root>,
			);
		});

		const content = container.querySelector(
			"[data-pen-editor-content]",
		) as HTMLElement | null;
		expect(content).not.toBeNull();

		setBlockRect(
			container.querySelector(`[data-block-id="${firstBlockId}"]`),
			new DOMRect(10, 10, 80, 20),
		);
		setBlockRect(
			container.querySelector(`[data-block-id="${secondBlockId}"]`),
			new DOMRect(10, 40, 80, 20),
		);

		await act(async () => {
			content!.dispatchEvent(
				new MouseEvent("mousedown", {
					bubbles: true,
					button: 0,
					clientX: 0,
					clientY: 0,
				}),
			);
			document.dispatchEvent(
				new MouseEvent("mousemove", {
					bubbles: true,
					button: 0,
					clientX: 120,
					clientY: 120,
				}),
			);
			document.dispatchEvent(
				new MouseEvent("mouseup", {
					bubbles: true,
					button: 0,
					clientX: 120,
					clientY: 120,
				}),
			);
			await flushAnimationFrames(2);
		});

		expect(editor.selection).toBeNull();

		await cleanupEditor(editor, root, container);
	});

	it("prevents pointer drag from promoting an existing block selection to a block range", async () => {
		const editor = createEditor({ documentProfile: "flow" });
		const firstBlockId = editor.firstBlock()!.id;
		const secondBlockId = crypto.randomUUID();

		editor.apply([
			{ type: "insert-text", blockId: firstBlockId, offset: 0, text: "Alpha" },
			{
				type: "insert-block",
				blockId: secondBlockId,
				blockType: "paragraph",
				props: {},
				position: { after: firstBlockId },
			},
			{ type: "insert-text", blockId: secondBlockId, offset: 0, text: "Beta" },
		]);

		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);
		const originalCaretRangeFromPoint = (
			document as Document & {
				caretRangeFromPoint?: (x: number, y: number) => Range | null;
			}
		).caretRangeFromPoint;

		try {
			await act(async () => {
				root.render(
					<Pen.Editor.Root
						editor={editor}
						editorViewMode="flow"
						blockSelection={false}
					>
						<Pen.Editor.Content />
					</Pen.Editor.Root>,
				);
			});

			const firstSurface = getInlineSurface(container, firstBlockId);
			const secondSurface = getInlineSurface(container, secondBlockId);
			(
				document as Document & {
					caretRangeFromPoint?: (
						x: number,
						y: number,
					) => Range | null;
				}
			).caretRangeFromPoint = createCaretRangeResolver({
				start: { element: firstSurface, offset: 0 },
				end: { element: secondSurface, offset: 1 },
			});

			await act(async () => {
				editor.selectBlock(firstBlockId);
				firstSurface.dispatchEvent(
					new MouseEvent("mousedown", {
						bubbles: true,
						button: 0,
						clientX: 10,
						clientY: 8,
					}),
				);
				document.dispatchEvent(
					new MouseEvent("mousemove", {
						bubbles: true,
						button: 0,
						clientX: 100,
						clientY: 48,
					}),
				);
				document.dispatchEvent(
					new MouseEvent("mouseup", {
						bubbles: true,
						button: 0,
						clientX: 100,
						clientY: 48,
					}),
				);
				await flushAnimationFrames(2);
			});

			expect(editor.selection).toMatchObject({
				type: "block",
				blockIds: [firstBlockId],
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
			await cleanupEditor(editor, root, container);
		}
	});

	it("hides the selection rectangle when root block selection is disabled", async () => {
		const editor = createEditor();
		const blockId = editor.firstBlock()!.id;
		editor.apply([{ type: "insert-text", blockId, offset: 0, text: "Alpha" }]);
		editor.selectBlock(blockId);

		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);

		await act(async () => {
			root.render(
				<Pen.Editor.Root
					editor={editor}
					blockSelection={false}
				>
					<Pen.Editor.Content />
					<Pen.Editor.SelectionRect />
				</Pen.Editor.Root>,
			);
			await flushAnimationFrames(2);
		});

		expect(container.querySelector("[data-pen-selection-rect]")).toBeNull();
		expect(container.textContent).not.toContain("1 block selected");

		await cleanupEditor(editor, root, container);
	});
});
