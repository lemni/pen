// @vitest-environment jsdom

import React, { act } from "react";
import { describe, expect, it } from "vitest";
import { createRoot } from "react-dom/client";
import { createEditor } from "@pen/core";
import { defaultPreset } from "@pen/preset-default";
import { PenEditor } from "../penEditor";
import { resolveRenderer, SubdocumentRenderer } from "../index";

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

describe("@pen/react subdocument rendering", () => {
	it("registers the subdocument renderer in the public renderer map", () => {
		expect(resolveRenderer("subdocument")).toBe(SubdocumentRenderer);
		expect(typeof SubdocumentRenderer).toBe("function");
	});

	it("mounts nested editors without leaking parent selection handlers", async () => {
		const editor = createEditor({
			preset: defaultPreset({
				documentOps: false,
				deltaStream: false,
				undo: false,
			}),
		});
		editor.apply([
			{
				type: "insert-block",
				blockId: "subdoc-block",
				blockType: "subdocument",
				props: { title: "Nested" },
				position: "last",
			},
		]);

		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);

		try {
			await act(async () => {
				root.render(<PenEditor editor={editor} />);
				await flushAnimationFrames(3);
			});

			const editorRoots = container.querySelectorAll("[data-pen-editor-root]");
			const nestedContent = container.querySelectorAll("[data-pen-editor-content]")[1] as
				| HTMLElement
				| undefined;

			expect(editorRoots).toHaveLength(2);
			expect(
				container.querySelector("[data-pen-subdocument-host] [data-pen-editor-root]"),
			).not.toBeNull();
			expect(nestedContent).toBeTruthy();

			await act(async () => {
				nestedContent?.dispatchEvent(
					new MouseEvent("mousedown", {
						bubbles: true,
						cancelable: true,
						button: 0,
						buttons: 1,
					}),
				);
				document.dispatchEvent(
					new MouseEvent("mouseup", {
						bubbles: true,
						cancelable: true,
						button: 0,
					}),
				);
				nestedContent?.dispatchEvent(
					new MouseEvent("click", {
						bubbles: true,
						cancelable: true,
						button: 0,
					}),
				);
				await flushAnimationFrames(2);
			});

			expect(editor.selection).toBeNull();
		} finally {
			await act(async () => {
				root.unmount();
			});
			container.remove();
			editor.destroy();
		}
	});
});
