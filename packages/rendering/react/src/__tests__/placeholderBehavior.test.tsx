// @vitest-environment jsdom

import React, { act } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { createRoot } from "react-dom/client";
import { createEditor } from "@pen/core";
import type { BlockHandle, BlockRenderContext } from "@pen/types";
import { defaultPreset } from "@pen/preset-default";
import { InlineContent } from "../primitives/editor/inlineContent";
import { Pen } from "../primitives/index";
import {
	ParagraphRenderer,
	registerRenderer,
} from "../renderers/index";

(
	globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function PlaceholderParagraphRenderer(
	block: BlockHandle,
	ctx: BlockRenderContext,
): React.ReactElement {
	return (
		<div
			ref={ctx.ref as React.Ref<HTMLDivElement>}
			data-block-type="paragraph"
			data-selected={ctx.selected || undefined}
		>
			<InlineContent
				blockId={block.id}
				placeholder="Type / for commands"
			/>
		</div>
	);
}

afterEach(() => {
	registerRenderer("paragraph", ParagraphRenderer);
});

describe("@pen/react placeholder behavior", () => {
	it("shows the document empty placeholder for a single empty block", async () => {
		registerRenderer("paragraph", PlaceholderParagraphRenderer);

		const editor = createEditor({
			preset: defaultPreset({
				documentOps: false,
				deltaStream: false,
				undo: false,
			}),
		});
		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);

		await act(async () => {
			root.render(
				<Pen.Editor.Root editor={editor}>
					<Pen.Editor.Content emptyPlaceholder="Start writing..." />
				</Pen.Editor.Root>,
			);
		});

		const placeholders = container.querySelectorAll("[data-placeholder-visible]");
		expect(placeholders).toHaveLength(1);
		expect(placeholders[0]?.getAttribute("data-placeholder")).toBe(
			"Start writing...",
		);
		expect(
			placeholders[0]?.hasAttribute("data-pen-field-editor-surface"),
		).toBe(true);

		await act(async () => {
			root.unmount();
		});
		container.remove();
		editor.destroy();
	});

	it("does not treat a single structural block as an empty document", async () => {
		const editor = createEditor({
			preset: defaultPreset({
				documentOps: false,
				deltaStream: false,
				undo: false,
			}),
		});
		const blockId = editor.firstBlock()!.id;
		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);

		editor.apply([{ type: "convert-block", blockId, newType: "divider" }]);

		await act(async () => {
			root.render(
				<Pen.Editor.Root editor={editor}>
					<Pen.Editor.Content emptyPlaceholder="Start writing..." />
				</Pen.Editor.Root>,
			);
		});

		expect(
			container.querySelectorAll("[data-placeholder-visible]"),
		).toHaveLength(0);
		expect(
			container
				.querySelector("[data-pen-editor-root]")
				?.hasAttribute("data-empty"),
		).toBe(false);

		await act(async () => {
			root.unmount();
		});
		container.remove();
		editor.destroy();
	});

	it("clears the document placeholder when a second empty block is inserted", async () => {
		registerRenderer("paragraph", PlaceholderParagraphRenderer);

		const editor = createEditor({
			preset: defaultPreset({
				documentOps: false,
				deltaStream: false,
				undo: false,
			}),
		});
		const firstBlockId = editor.firstBlock()!.id;
		const secondBlockId = crypto.randomUUID();
		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);

		await act(async () => {
			root.render(
				<Pen.Editor.Root editor={editor}>
					<Pen.Editor.Content emptyPlaceholder="Start writing..." />
				</Pen.Editor.Root>,
			);
		});

		expect(
			container.querySelectorAll("[data-placeholder-visible]"),
		).toHaveLength(1);

		await act(async () => {
			editor.apply([
				{
					type: "insert-block",
					blockId: secondBlockId,
					blockType: "paragraph",
					props: {},
					position: { after: firstBlockId },
				},
			]);
		});

		expect(
			container.querySelectorAll("[data-placeholder-visible]"),
		).toHaveLength(0);

		await act(async () => {
			root.unmount();
		});
		container.remove();
		editor.destroy();
	});

	it("shows a block placeholder only for the active empty block", async () => {
		registerRenderer("paragraph", PlaceholderParagraphRenderer);

		const editor = createEditor({
			preset: defaultPreset({
				documentOps: false,
				deltaStream: false,
				undo: false,
			}),
		});
		const firstBlockId = editor.firstBlock()!.id;
		const secondBlockId = crypto.randomUUID();
		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);

		editor.apply([
			{
				type: "insert-block",
				blockId: secondBlockId,
				blockType: "paragraph",
				props: {},
				position: { after: firstBlockId },
			},
		]);

		await act(async () => {
			root.render(
				<Pen.Editor.Root editor={editor}>
					<Pen.Editor.Content emptyPlaceholder="Start writing..." />
				</Pen.Editor.Root>,
			);
		});

		expect(
			container.querySelectorAll("[data-placeholder-visible]"),
		).toHaveLength(0);

		await act(async () => {
			editor.selectText(secondBlockId, 0, 0);
		});

		const placeholders = container.querySelectorAll("[data-placeholder-visible]");
		expect(placeholders).toHaveLength(1);
		expect(placeholders[0]?.getAttribute("data-placeholder")).toBe(
			"Type / for commands",
		);
		expect(
			placeholders[0]?.closest("[data-block-id]")?.getAttribute("data-block-id"),
		).toBe(secondBlockId);

		await act(async () => {
			root.unmount();
		});
		container.remove();
		editor.destroy();
	});
});
