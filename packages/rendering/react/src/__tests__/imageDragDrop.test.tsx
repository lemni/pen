// @vitest-environment jsdom

import React, { act } from "react";
import { describe, expect, it, vi } from "vitest";
import { createRoot } from "react-dom/client";
import { createEditor } from "@pen/core";
import type { AssetProvider } from "@pen/types";
import { defaultPreset } from "@pen/preset-default";
import { Pen } from "../primitives/index";

(
	globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function createFileList(files: File[]): FileList {
	return Object.assign([...files], {
		item(index: number) {
			return files[index] ?? null;
		},
	}) as unknown as FileList;
}

function createDataTransfer(files: File[]): DataTransfer {
	const data = new Map<string, string>();
	const types: string[] = files.length > 0 ? ["Files"] : [];

	return {
		files: createFileList(files),
		types,
		getData(type: string) {
			return data.get(type) ?? "";
		},
		setData(type: string, value: string) {
			data.set(type, value);
		},
	} as unknown as DataTransfer;
}

function createDragEvent(
	type: "dragenter" | "dragleave" | "dragover" | "drop",
	options: {
	dataTransfer: DataTransfer;
	clientX: number;
	clientY: number;
	},
): MouseEvent & { dataTransfer: DataTransfer } {
	const event = new MouseEvent(type, {
		bubbles: true,
		cancelable: true,
		clientX: options.clientX,
		clientY: options.clientY,
	}) as MouseEvent & { dataTransfer: DataTransfer };

	Object.defineProperty(event, "dataTransfer", {
		value: options.dataTransfer,
	});

	return event;
}

describe("@pen/react image drag and drop", () => {
	it("splits inline text when dropping an image at a caret position", async () => {
		const editor = createEditor({
			preset: defaultPreset({
				documentOps: false,
				deltaStream: false,
				undo: false,
			}),
		});
		const paragraphId = editor.firstBlock()!.id;
		const assetProvider: AssetProvider = {
			upload: vi.fn().mockResolvedValue({
				url: "memory://photo.png",
				mimeType: "image/png",
			}),
			resolve(ref) {
				return ref.url;
			},
			async delete() {},
		};

		editor.apply([
			{ type: "insert-text", blockId: paragraphId, offset: 0, text: "Hello" },
		]);

		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);

		const originalElementFromPoint = document.elementFromPoint;
		const docWithCaretRange = document as Document & {
			caretRangeFromPoint?: (x: number, y: number) => Range | null;
		};
		const originalCaretRangeFromPoint = docWithCaretRange.caretRangeFromPoint;

		try {
			await act(async () => {
				root.render(
					<Pen.Editor.Root editor={editor} assets={assetProvider}>
						<Pen.Editor.Content />
					</Pen.Editor.Root>,
				);
			});

			const inlineElement = container.querySelector(
				"[data-pen-inline-content]",
			) as HTMLElement | null;
			const contentElement = container.querySelector(
				"[data-pen-editor-content]",
			) as HTMLElement | null;

			expect(inlineElement).not.toBeNull();
			expect(contentElement).not.toBeNull();

			const textNode = inlineElement!.firstChild;
			expect(textNode).not.toBeNull();

			inlineElement!.getBoundingClientRect = () =>
				({
					left: 0,
					top: 0,
					right: 120,
					bottom: 24,
					width: 120,
					height: 24,
					x: 0,
					y: 0,
					toJSON() {
						return {};
					},
				}) as DOMRect;

			document.elementFromPoint = () => inlineElement;
			docWithCaretRange.caretRangeFromPoint = () => {
				const range = document.createRange();
				range.setStart(textNode!, 2);
				range.collapse(true);
				return range;
			};

			const file = new File(["image"], "photo.png", { type: "image/png" });
			const dataTransfer = createDataTransfer([file]);
			const dragEnterEvent = createDragEvent("dragenter", {
				dataTransfer,
				clientX: 40,
				clientY: 12,
			});
			const dragOverEvent = createDragEvent("dragover", {
				dataTransfer,
				clientX: 40,
				clientY: 12,
			});
			const dropEvent = createDragEvent("drop", {
				dataTransfer,
				clientX: 40,
				clientY: 12,
			});

			await act(async () => {
				inlineElement!.dispatchEvent(dragEnterEvent);
				inlineElement!.dispatchEvent(dragOverEvent);
			});

			expect(contentElement?.hasAttribute("data-drop-target")).toBe(true);
			expect(
				container.querySelector("[data-pen-drop-caret]"),
			).not.toBeNull();

			await act(async () => {
				inlineElement!.dispatchEvent(dropEvent);
				await new Promise((resolve) => setTimeout(resolve, 0));
			});

			const blockOrder = editor.documentState.blockOrder;
			const insertedImageId = blockOrder[1]!;
			const insertedImage = editor.getBlock(insertedImageId);
			expect(assetProvider.upload).toHaveBeenCalledTimes(1);
			expect(insertedImage?.type).toBe("image");
			expect(insertedImage?.props).toMatchObject({
				src: "memory://photo.png",
				alt: "photo",
			});
			expect(blockOrder).toHaveLength(3);
			expect(blockOrder[0]).toBe(paragraphId);
			expect(blockOrder[1]).toBe(insertedImageId);
			const trailingParagraphId = blockOrder[2]!;
			expect(editor.getBlock(paragraphId)?.textContent()).toBe("He");
			expect(editor.getBlock(trailingParagraphId)?.textContent()).toBe("llo");
			expect(editor.selection).toMatchObject({
				type: "block",
				blockIds: [insertedImage!.id],
			});
			expect(contentElement?.hasAttribute("data-drop-target")).toBe(false);

			await act(async () => {
				root.unmount();
			});
		} finally {
			docWithCaretRange.caretRangeFromPoint = originalCaretRangeFromPoint;
			document.elementFromPoint = originalElementFromPoint;
			container.remove();
			editor.destroy();
		}
	});

	it("moves the drop target out of the focused block", async () => {
		const editor = createEditor({
			preset: defaultPreset({
				documentOps: false,
				deltaStream: false,
				undo: false,
			}),
		});
		const firstParagraphId = editor.firstBlock()!.id;
		const secondParagraphId = crypto.randomUUID();
		const assetProvider: AssetProvider = {
			upload: vi.fn().mockResolvedValue({
				url: "memory://photo.png",
				mimeType: "image/png",
			}),
			resolve(ref) {
				return ref.url;
			},
			async delete() {},
		};

		editor.apply([
			{ type: "insert-text", blockId: firstParagraphId, offset: 0, text: "Hello" },
			{
				type: "insert-block",
				blockId: secondParagraphId,
				blockType: "paragraph",
				props: {},
				position: { after: firstParagraphId },
			},
			{
				type: "insert-text",
				blockId: secondParagraphId,
				offset: 0,
				text: "World",
			},
		]);

		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);

		const originalElementFromPoint = document.elementFromPoint;
		const docWithCaretRange = document as Document & {
			caretRangeFromPoint?: (x: number, y: number) => Range | null;
		};
		const originalCaretRangeFromPoint = docWithCaretRange.caretRangeFromPoint;

		try {
			await act(async () => {
				root.render(
					<Pen.Editor.Root editor={editor} assets={assetProvider}>
						<Pen.Editor.Content />
					</Pen.Editor.Root>,
				);
			});

			const inlineElements = Array.from(
				container.querySelectorAll("[data-pen-inline-content]"),
			) as HTMLElement[];
			const contentElement = container.querySelector(
				"[data-pen-editor-content]",
			) as HTMLElement | null;
			const firstInlineElement = inlineElements[0] ?? null;
			const secondInlineElement = inlineElements[1] ?? null;

			expect(firstInlineElement).not.toBeNull();
			expect(secondInlineElement).not.toBeNull();
			expect(contentElement).not.toBeNull();

			const firstTextNode = firstInlineElement!.firstChild;
			expect(firstTextNode).not.toBeNull();

			firstInlineElement!.getBoundingClientRect = () =>
				({
					left: 0,
					top: 0,
					right: 120,
					bottom: 24,
					width: 120,
					height: 24,
					x: 0,
					y: 0,
					toJSON() {
						return {};
					},
				}) as DOMRect;

			secondInlineElement!.getBoundingClientRect = () =>
				({
					left: 0,
					top: 40,
					right: 120,
					bottom: 64,
					width: 120,
					height: 24,
					x: 0,
					y: 40,
					toJSON() {
						return {};
					},
				}) as DOMRect;

			document.elementFromPoint = () => secondInlineElement;
			docWithCaretRange.caretRangeFromPoint = () => {
				const range = document.createRange();
				range.setStart(firstTextNode!, 2);
				range.collapse(true);
				return range;
			};

			const file = new File(["image"], "photo.png", { type: "image/png" });
			const dataTransfer = createDataTransfer([file]);
			const dragEnterEvent = createDragEvent("dragenter", {
				dataTransfer,
				clientX: 40,
				clientY: 52,
			});
			const dragOverEvent = createDragEvent("dragover", {
				dataTransfer,
				clientX: 40,
				clientY: 52,
			});
			const dropEvent = createDragEvent("drop", {
				dataTransfer,
				clientX: 40,
				clientY: 52,
			});

			await act(async () => {
				secondInlineElement!.dispatchEvent(dragEnterEvent);
				secondInlineElement!.dispatchEvent(dragOverEvent);
			});

			expect(contentElement?.hasAttribute("data-drop-target")).toBe(true);
			expect(
				container.querySelector("[data-pen-drop-caret]"),
			).not.toBeNull();

			await act(async () => {
				secondInlineElement!.dispatchEvent(dropEvent);
				await new Promise((resolve) => setTimeout(resolve, 0));
			});

			const blockOrder = editor.documentState.blockOrder;
			const insertedImageId = blockOrder[1]!;
			const insertedImage = editor.getBlock(insertedImageId);
			expect(insertedImage?.type).toBe("image");
			expect(blockOrder).toEqual([
				firstParagraphId,
				insertedImageId,
				secondParagraphId,
			]);
			expect(editor.getBlock(firstParagraphId)?.textContent()).toBe("Hello");
			expect(editor.getBlock(secondParagraphId)?.textContent()).toBe("World");

			await act(async () => {
				root.unmount();
			});
		} finally {
			docWithCaretRange.caretRangeFromPoint = originalCaretRangeFromPoint;
			document.elementFromPoint = originalElementFromPoint;
			container.remove();
			editor.destroy();
		}
	});

	it("shows the insertion side on structural block drop targets", async () => {
		const editor = createEditor({
			preset: defaultPreset({
				documentOps: false,
				deltaStream: false,
				undo: false,
			}),
		});
		const paragraphId = editor.firstBlock()!.id;
		const dividerId = crypto.randomUUID();
		const assetProvider: AssetProvider = {
			upload: vi.fn().mockResolvedValue({
				url: "memory://photo.png",
				mimeType: "image/png",
			}),
			resolve(ref) {
				return ref.url;
			},
			async delete() {},
		};

		editor.apply([
			{ type: "insert-text", blockId: paragraphId, offset: 0, text: "Hello" },
			{
				type: "insert-block",
				blockId: dividerId,
				blockType: "divider",
				props: {},
				position: { after: paragraphId },
			},
		]);

		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);
		const originalElementFromPoint = document.elementFromPoint;

		try {
			await act(async () => {
				root.render(
					<Pen.Editor.Root editor={editor} assets={assetProvider}>
						<Pen.Editor.Content />
					</Pen.Editor.Root>,
				);
			});

			const contentElement = container.querySelector(
				"[data-pen-editor-content]",
			) as HTMLElement | null;
			const dividerElement = container.querySelector(
				`[data-block-id="${dividerId}"]`,
			) as HTMLElement | null;

			expect(contentElement).not.toBeNull();
			expect(dividerElement).not.toBeNull();

			dividerElement!.getBoundingClientRect = () =>
				({
					left: 0,
					top: 40,
					right: 120,
					bottom: 64,
					width: 120,
					height: 24,
					x: 0,
					y: 40,
					toJSON() {
						return {};
					},
				}) as DOMRect;

			document.elementFromPoint = () => dividerElement;

			const file = new File(["image"], "photo.png", { type: "image/png" });
			const dataTransfer = createDataTransfer([file]);
			const dragEnterEvent = createDragEvent("dragenter", {
				dataTransfer,
				clientX: 40,
				clientY: 44,
			});
			const dragOverEvent = createDragEvent("dragover", {
				dataTransfer,
				clientX: 40,
				clientY: 44,
			});
			const dropEvent = createDragEvent("drop", {
				dataTransfer,
				clientX: 40,
				clientY: 44,
			});

			await act(async () => {
				dividerElement!.dispatchEvent(dragEnterEvent);
				dividerElement!.dispatchEvent(dragOverEvent);
			});

			expect(contentElement?.hasAttribute("data-drop-target")).toBe(true);
			expect(dividerElement?.hasAttribute("data-drop-target")).toBe(true);
			expect(dividerElement?.getAttribute("data-drop-position")).toBe("before");

			await act(async () => {
				dividerElement!.dispatchEvent(dropEvent);
				await new Promise((resolve) => setTimeout(resolve, 0));
			});

			const blockOrder = editor.documentState.blockOrder;
			const insertedImageIndex = blockOrder.findIndex((id) => id !== paragraphId && id !== dividerId);
			expect(insertedImageIndex).toBe(1);
			expect(blockOrder).toEqual([paragraphId, blockOrder[1]!, dividerId]);
			expect(contentElement?.hasAttribute("data-drop-target")).toBe(false);
			expect(dividerElement?.hasAttribute("data-drop-target")).toBe(false);

			await act(async () => {
				root.unmount();
			});
		} finally {
			document.elementFromPoint = originalElementFromPoint;
			container.remove();
			editor.destroy();
		}
	});

	it("prevents native root-level drop navigation for image files", async () => {
		const editor = createEditor({
			preset: defaultPreset({
				documentOps: false,
				deltaStream: false,
				undo: false,
			}),
		});
		const paragraphId = editor.firstBlock()!.id;
		const assetProvider: AssetProvider = {
			upload: vi.fn().mockResolvedValue({
				url: "memory://photo.png",
				mimeType: "image/png",
			}),
			resolve(ref) {
				return ref.url;
			},
			async delete() {},
		};

		editor.apply([
			{ type: "insert-text", blockId: paragraphId, offset: 0, text: "Hello" },
		]);

		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);
		const originalElementFromPoint = document.elementFromPoint;

		try {
			await act(async () => {
				root.render(
					<Pen.Editor.Root editor={editor} assets={assetProvider}>
						<Pen.Editor.Content />
					</Pen.Editor.Root>,
				);
			});

			const rootElement = container.querySelector(
				"[data-pen-editor-root]",
			) as HTMLElement | null;
			const contentElement = container.querySelector(
				"[data-pen-editor-content]",
			) as HTMLElement | null;
			const inlineElement = container.querySelector(
				"[data-pen-inline-content]",
			) as HTMLElement | null;

			expect(rootElement).not.toBeNull();
			expect(contentElement).not.toBeNull();
			expect(inlineElement).not.toBeNull();

			contentElement!.getBoundingClientRect = () =>
				({
					left: 0,
					top: 0,
					right: 120,
					bottom: 24,
					width: 120,
					height: 24,
					x: 0,
					y: 0,
					toJSON() {
						return {};
					},
				}) as DOMRect;

			inlineElement!.getBoundingClientRect = () =>
				({
					left: 0,
					top: 0,
					right: 120,
					bottom: 24,
					width: 120,
					height: 24,
					x: 0,
					y: 0,
					toJSON() {
						return {};
					},
				}) as DOMRect;

			document.elementFromPoint = () => inlineElement;

			const file = new File(["image"], "photo.png", { type: "image/png" });
			const dataTransfer = createDataTransfer([file]);
			const dragOverEvent = createDragEvent("dragover", {
				dataTransfer,
				clientX: 40,
				clientY: 12,
			});
			const dropEvent = createDragEvent("drop", {
				dataTransfer,
				clientX: 40,
				clientY: 12,
			});

			await act(async () => {
				expect(rootElement!.dispatchEvent(dragOverEvent)).toBe(false);
				expect(dragOverEvent.defaultPrevented).toBe(true);
				expect(rootElement!.dispatchEvent(dropEvent)).toBe(false);
				await new Promise((resolve) => setTimeout(resolve, 0));
			});

			expect(dropEvent.defaultPrevented).toBe(true);

			await act(async () => {
				root.unmount();
			});
		} finally {
			document.elementFromPoint = originalElementFromPoint;
			container.remove();
			editor.destroy();
		}
	});
});
