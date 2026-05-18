// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import { createEditor } from "@pen/core";
import { defaultPreset } from "@pen/preset-default";
import {
	getInlineAtomElementData,
	getLogicalTextContent,
	INLINE_ATOM_REPLACEMENT_TEXT,
} from "@pen/dom/field-editor/inlineAtomDom";
import {
	applyDeltaToDOM,
	fullReconcileDeltasToDOM,
} from "@pen/dom/field-editor/reconciler";
import { DATA_ATTRS } from "../utils/dataAttributes";
import {
	domPointToOffset,
	domSelectionToEditor,
	editorSelectionToDOM,
} from "../field-editor/selectionBridge";
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

function createPresetEditor() {
	return createEditor({
		preset: defaultPreset({
			documentOps: false,
			deltaStream: false,
			undo: false,
		}),
	});
}

function seedInlineAtomDocument(editor: ReturnType<typeof createPresetEditor>) {
	const blockId = editor.firstBlock()!.id;
	editor.apply([
		{ type: "insert-text", blockId, offset: 0, text: "A" },
		{
			type: "insert-inline-node",
			blockId,
			offset: 1,
			nodeType: "mention",
			props: { id: "user-1", label: "Ada" },
		},
		{ type: "insert-text", blockId, offset: 2, text: "B" },
	]);
	return blockId;
}

describe("Pen inline atom editing", () => {
	it("renders inline nodes as logical atom elements", async () => {
		const editor = createPresetEditor();
		seedInlineAtomDocument(editor);
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
				await flushAnimationFrames(2);
			});

			const atom = container.querySelector(
				`[${DATA_ATTRS.inlineAtom}]`,
			) as HTMLElement | null;

			expect(atom).not.toBeNull();
			expect(atom?.getAttribute(DATA_ATTRS.inlineAtomType)).toBe(
				"mention",
			);
			expect(atom?.textContent).toBe("@Ada");
		} finally {
			await act(async () => {
				root.unmount();
			});
			container.remove();
			editor.destroy();
		}
	});

	it("renders inline atoms with configured React renderers", async () => {
		const editor = createPresetEditor();
		const blockId = seedInlineAtomDocument(editor);
		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);

		try {
			await act(async () => {
				root.render(
					<Pen.Editor.Root
						editor={editor}
						inlineAtomRenderers={{
							mention: ({ props, selected, text }) => (
								<span
									data-selected={selected ? "true" : "false"}
									data-testid="mention-renderer"
								>
									{props.label as string}:{text}
								</span>
							),
						}}
					>
						<Pen.Editor.Content />
					</Pen.Editor.Root>,
				);
				await flushAnimationFrames(2);
			});

			const atom = container.querySelector(
				`[${DATA_ATTRS.inlineAtom}]`,
			) as HTMLElement | null;
			const renderedAtom = container.querySelector(
				"[data-testid='mention-renderer']",
			);
			const inlineElement = container.querySelector(
				`[${DATA_ATTRS.inlineContent}]`,
			) as HTMLElement | null;

			expect(atom).not.toBeNull();
			expect(inlineElement).not.toBeNull();
			expect(renderedAtom?.textContent).toBe("Ada:@Ada");
			expect(renderedAtom?.getAttribute("data-selected")).toBe("false");
			expect(atom?.textContent).toBe("Ada:@Ada");
			expect(domPointToOffset(inlineElement!, atom!, 0)).toBe(1);
			expect(domPointToOffset(inlineElement!, atom!, 1)).toBe(2);
			expect(
				domPointToOffset(
					inlineElement!,
					renderedAtom?.firstChild ?? renderedAtom!,
					1,
				),
			).toBe(2);
			expect(getInlineAtomElementData(atom!)).toEqual({
				type: "mention",
				props: { id: "user-1", label: "Ada" },
				text: "@Ada",
			});

			await act(async () => {
				editor.selectTextRange(
					{ blockId, offset: 1 },
					{ blockId, offset: 2 },
				);
				await flushAnimationFrames(2);
			});

			expect(renderedAtom?.getAttribute("data-selected")).toBe("true");
			expect(atom?.hasAttribute(DATA_ATTRS.selected)).toBe(true);
		} finally {
			await act(async () => {
				root.unmount();
			});
			container.remove();
			editor.destroy();
		}
	});

	it("applies text deltas around inline atoms at logical boundaries", () => {
		const editor = createPresetEditor();
		const element = document.createElement("span");

		fullReconcileDeltasToDOM(
			[
				{ insert: "A" },
				{
					insert: {
						type: "mention",
						props: { id: "user-1", label: "Ada" },
					},
				},
				{ insert: "B" },
			],
			element,
			editor.schema,
		);

		const atom = element.querySelector(
			`[${DATA_ATTRS.inlineAtom}]`,
		) as HTMLElement | null;
		expect(atom).not.toBeNull();

		expect(
			applyDeltaToDOM(
				[{ retain: 2 }, { insert: "C" }],
				element,
				editor.schema,
			),
		).toBe(true);
		expect(getLogicalTextContent(element)).toBe(
			`A${INLINE_ATOM_REPLACEMENT_TEXT}CB`,
		);
		expect(getInlineAtomElementData(atom!)).toEqual({
			type: "mention",
			props: { id: "user-1", label: "Ada" },
			text: "@Ada",
		});
		expect(atom?.textContent).toBe("@Ada");

		expect(
			applyDeltaToDOM(
				[{ retain: 1 }, { delete: 1 }],
				element,
				editor.schema,
			),
		).toBe(true);
		expect(getLogicalTextContent(element)).toBe("ACB");
		expect(atom?.isConnected).toBe(false);

		editor.destroy();
	});

	it("refreshes inline atom metadata when reconciliation changes atom props", () => {
		const editor = createPresetEditor();
		const element = document.createElement("span");
		const firstDelta = [
			{ insert: "A" },
			{
				insert: {
					type: "mention",
					props: { id: "user-1", label: "Ada" },
				},
			},
			{ insert: "B" },
		];
		const secondDelta = [
			{ insert: "A" },
			{
				insert: {
					type: "mention",
					props: { id: "user-2", label: "Ada" },
				},
			},
			{ insert: "B" },
		];

		fullReconcileDeltasToDOM(firstDelta, element, editor.schema);
		const firstAtom = element.querySelector(
			`[${DATA_ATTRS.inlineAtom}]`,
		) as HTMLElement | null;
		expect(getInlineAtomElementData(firstAtom!)).toEqual({
			type: "mention",
			props: { id: "user-1", label: "Ada" },
			text: "@Ada",
		});

		fullReconcileDeltasToDOM(secondDelta, element, editor.schema);
		const secondAtom = element.querySelector(
			`[${DATA_ATTRS.inlineAtom}]`,
		) as HTMLElement | null;

		expect(secondAtom).not.toBe(firstAtom);
		expect(firstAtom?.isConnected).toBe(false);
		expect(getInlineAtomElementData(secondAtom!)).toEqual({
			type: "mention",
			props: { id: "user-2", label: "Ada" },
			text: "@Ada",
		});

		editor.destroy();
	});

	it("round-trips DOM selection offsets around inline atoms", async () => {
		const editor = createPresetEditor();
		const blockId = seedInlineAtomDocument(editor);
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
				await flushAnimationFrames(2);
			});

			const rootElement = container.querySelector(
				`[${DATA_ATTRS.editorRoot}]`,
			) as HTMLElement | null;
			const inlineElement = container.querySelector(
				`[${DATA_ATTRS.inlineContent}]`,
			) as HTMLElement | null;
			expect(rootElement).not.toBeNull();
			expect(inlineElement).not.toBeNull();
			expect(domPointToOffset(inlineElement!, inlineElement!, 1)).toBe(1);
			expect(domPointToOffset(inlineElement!, inlineElement!, 2)).toBe(2);

			editorSelectionToDOM(
				rootElement!,
				{ blockId, offset: 2 },
				{ blockId, offset: 2 },
			);

			expect(domSelectionToEditor(rootElement!)).toEqual({
				anchor: { blockId, offset: 2 },
				focus: { blockId, offset: 2 },
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
