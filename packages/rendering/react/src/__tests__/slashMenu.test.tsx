// @vitest-environment jsdom

import React, { act } from "react";
import { describe, expect, it, vi } from "vitest";
import { createRoot } from "react-dom/client";
import { createEditor } from "@pen/core";
import { defaultPreset } from "@pen/preset-default";
import { Pen } from "../primitives/index";
import { useSlashMenu } from "../hooks/useSlashMenu";
import { getAttachedFieldEditor } from "../utils/fieldEditor";

(
	globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

async function flushAnimationFrames(count = 1): Promise<void> {
	for (let i = 0; i < count; i++) {
		await new Promise<void>((resolve) => {
			window.requestAnimationFrame(() => resolve());
		});
	}
}

function createSlashMenuEditor(
	options: Parameters<typeof createEditor>[0] = {},
) {
	return createEditor({
		...options,
		preset: defaultPreset({
			documentOps: false,
			deltaStream: false,
			undo: false,
		}),
	});
}

function dispatchKey(key: string, target: EventTarget = document) {
	target.dispatchEvent(
		new KeyboardEvent("keydown", {
			key,
			bubbles: true,
			cancelable: true,
		}),
	);
}

describe("@pen/react slash menu", () => {
	it("handles navigation keys without transform-based placement or downstream propagation", async () => {
		const editor = createSlashMenuEditor();
		const blockId = editor.firstBlock()!.id;
		editor.selectText(blockId, 0, 0);
		const confirm = vi.fn();
		const select = vi.fn();

		const controller = {
			confirm,
			dismiss: vi.fn(),
			items: [
				{ type: "paragraph", display: { title: "Paragraph" } },
				{ type: "heading", display: { title: "Heading" } },
			],
			open: true,
			query: "",
			select,
			selectedIndex: 0,
			setQuery: vi.fn(),
		};

		function Harness() {
			return (
				<Pen.Editor.Root editor={editor}>
					<Pen.Editor.Content />
					<Pen.SlashMenu.Root controller={controller} editor={editor}>
						<Pen.SlashMenu.Content>
							<Pen.SlashMenu.List>
								<Pen.SlashMenu.Item index={0}>
									Paragraph
								</Pen.SlashMenu.Item>
								<Pen.SlashMenu.Item index={1}>
									Heading
								</Pen.SlashMenu.Item>
							</Pen.SlashMenu.List>
						</Pen.SlashMenu.Content>
					</Pen.SlashMenu.Root>
				</Pen.Editor.Root>
			);
		}

		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);

		await act(async () => {
			root.render(<Harness />);
		});

		const slashContent = container.querySelector<HTMLElement>(
			"[data-pen-slash-menu-content]",
		);
		expect(slashContent).not.toBeNull();
		expect(slashContent?.style.transform).toBe("");

		const downstreamKeyDown = vi.fn();
		container.addEventListener("keydown", downstreamKeyDown);
		await act(async () => {
			dispatchKey("ArrowDown", container);
			dispatchKey("Enter", container);
		});

		expect(select).toHaveBeenCalledWith(1);
		expect(confirm).toHaveBeenCalledWith(1);
		expect(downstreamKeyDown).not.toHaveBeenCalled();

		await act(async () => {
			root.unmount();
		});
		container.remove();
		editor.destroy();
	});

	it("does not notify controlled open changes when confirm has no selected item", async () => {
		const editor = createSlashMenuEditor();
		const blockId = editor.firstBlock()!.id;
		editor.selectText(blockId, 0, 0);
		const onOpenChange = vi.fn();

		const controller = {
			confirm: vi.fn(() => false),
			dismiss: vi.fn(),
			items: [],
			open: true,
			query: "",
			select: vi.fn(),
			selectedIndex: 0,
			setQuery: vi.fn(),
			target: null,
		};

		function Harness() {
			return (
				<Pen.Editor.Root editor={editor}>
					<Pen.Editor.Content />
					<Pen.SlashMenu.Root
						controller={controller}
						editor={editor}
						open
						onOpenChange={onOpenChange}
					/>
				</Pen.Editor.Root>
			);
		}

		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);

		await act(async () => {
			root.render(<Harness />);
		});

		await act(async () => {
			dispatchKey("Enter", container);
		});

		expect(controller.confirm).toHaveBeenCalledWith(0);
		expect(onOpenChange).not.toHaveBeenCalled();

		await act(async () => {
			root.unmount();
		});
		container.remove();
		editor.destroy();
	});

	it("opens after selection sync when slash text commits before a text selection exists", async () => {
		const editor = createSlashMenuEditor();
		const blockId = editor.firstBlock()!.id;

		const slashMenuRef: {
			current: ReturnType<typeof useSlashMenu> | null;
		} = { current: null };

		function Harness() {
			slashMenuRef.current = useSlashMenu(editor);

			return (
				<Pen.Editor.Root editor={editor}>
					<Pen.Editor.Content />
				</Pen.Editor.Root>
			);
		}

		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);

		await act(async () => {
			root.render(<Harness />);
		});

		await act(async () => {
			editor.apply([
				{ type: "insert-text", blockId, offset: 0, text: "/" },
			]);
		});

		const slashMenuBeforeSelection = slashMenuRef.current;
		expect(slashMenuBeforeSelection).not.toBeNull();
		expect(slashMenuBeforeSelection!.open).toBe(false);

		await act(async () => {
			editor.selectText(blockId, 1, 1);
		});

		const slashMenuAfterSelection = slashMenuRef.current;
		expect(slashMenuAfterSelection).not.toBeNull();
		expect(slashMenuAfterSelection!.open).toBe(true);
		expect(slashMenuAfterSelection!.query).toBe("");

		await act(async () => {
			root.unmount();
		});
		container.remove();
		editor.destroy();
	});

	it("activates the first starter table cell after inserting a table", async () => {
		const editor = createSlashMenuEditor();
		const blockId = editor.firstBlock()!.id;
		editor.selectText(blockId, 0, 0);

		const slashMenuRef: {
			current: ReturnType<typeof useSlashMenu> | null;
		} = { current: null };

		function Harness() {
			slashMenuRef.current = useSlashMenu(editor);

			return (
				<Pen.Editor.Root editor={editor}>
					<Pen.Editor.Content />
				</Pen.Editor.Root>
			);
		}

		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);

		await act(async () => {
			root.render(<Harness />);
		});

		await act(async () => {
			slashMenuRef.current?.setQuery("table");
		});

		await act(async () => {
			slashMenuRef.current?.confirm(0);
			await flushAnimationFrames();
		});

		expect(editor.getBlock(blockId)?.type).toBe("table");
		expect(slashMenuRef.current?.open).toBe(false);
		expect(slashMenuRef.current?.target).toBeNull();
		expect(editor.getBlock(blockId)?.props.hasHeaderRow).toBe(true);
		expect(editor.getBlock(blockId)?.tableRowCount()).toBe(2);
		expect(editor.getBlock(blockId)?.tableColumnCount()).toBe(2);

		const activeCell = container.querySelector(
			"[data-pen-table-cell][data-cell-row='0'][data-cell-col='0'] [data-pen-field-editor-active-surface]",
		);
		expect(activeCell).not.toBeNull();

		await act(async () => {
			root.unmount();
		});
		container.remove();
		editor.destroy();
	});

	it("allows typing into the starter cell after slash-menu insertion", async () => {
		const editor = createSlashMenuEditor();
		const blockId = editor.firstBlock()!.id;
		editor.selectText(blockId, 0, 0);

		const slashMenuRef: {
			current: ReturnType<typeof useSlashMenu> | null;
		} = { current: null };

		function Harness() {
			slashMenuRef.current = useSlashMenu(editor);

			return (
				<Pen.Editor.Root editor={editor}>
					<Pen.Editor.Content />
				</Pen.Editor.Root>
			);
		}

		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);

		await act(async () => {
			root.render(<Harness />);
		});

		await act(async () => {
			slashMenuRef.current?.setQuery("table");
		});

		await act(async () => {
			slashMenuRef.current?.confirm(0);
			await flushAnimationFrames();
		});

		const fieldEditor = getAttachedFieldEditor(editor) as {
			activateCell(blockId: string, row: number, col: number): void;
		} | null;
		await act(async () => {
			fieldEditor?.activateCell(blockId, 0, 0);
			await flushAnimationFrames();
		});

		const cellSurface = container.querySelector(
			"[data-pen-table-cell][data-cell-row='0'][data-cell-col='0'] [data-pen-inline-content]",
		) as HTMLElement | null;
		expect(cellSurface).not.toBeNull();

		await act(async () => {
			cellSurface?.dispatchEvent(
				new InputEvent("beforeinput", {
					bubbles: true,
					cancelable: true,
					inputType: "insertText",
					data: "A",
				}),
			);
			await flushAnimationFrames();
		});

		await act(async () => {
			cellSurface?.dispatchEvent(
				new InputEvent("beforeinput", {
					bubbles: true,
					cancelable: true,
					inputType: "insertText",
					data: "B",
				}),
			);
			await flushAnimationFrames();
		});

		expect(editor.getBlock(blockId)?.tableCell(0, 0)?.textContent()).toBe(
			"AB",
		);

		await act(async () => {
			root.unmount();
		});
		container.remove();
		editor.destroy();
	});

	it("hides subdocument from the slash menu", async () => {
		const editor = createSlashMenuEditor();
		const blockId = editor.firstBlock()!.id;
		editor.selectText(blockId, 0, 0);

		const slashMenuRef: {
			current: ReturnType<typeof useSlashMenu> | null;
		} = { current: null };

		function Harness() {
			slashMenuRef.current = useSlashMenu(editor);

			return (
				<Pen.Editor.Root editor={editor}>
					<Pen.Editor.Content />
				</Pen.Editor.Root>
			);
		}

		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);

		await act(async () => {
			root.render(<Harness />);
		});

		await act(async () => {
			slashMenuRef.current?.setQuery("subdocument");
		});

		const activeSlashMenu = slashMenuRef.current;
		expect(activeSlashMenu).not.toBeNull();
		if (!activeSlashMenu) {
			throw new Error("Slash menu did not initialize");
		}

		const itemTypes = activeSlashMenu.items.map((item) => item.type);
		expect(itemTypes).not.toContain("subdocument");

		await act(async () => {
			root.unmount();
		});
		container.remove();
		editor.destroy();
	});

	it("inserts a non-empty nested block after its visible subtree", async () => {
		const editor = createSlashMenuEditor();
		const toggleBlockId = editor.firstBlock()!.id;
		const nestedToggleId = crypto.randomUUID();
		const nestedChildId = crypto.randomUUID();

		editor.apply([
			{
				type: "convert-block",
				blockId: toggleBlockId,
				newType: "toggle",
				newProps: { open: true },
			},
			{
				type: "insert-text",
				blockId: toggleBlockId,
				offset: 0,
				text: "Parent",
			},
			{
				type: "insert-block",
				blockId: nestedToggleId,
				blockType: "toggle",
				props: { open: true },
				position: { after: toggleBlockId },
			},
			{
				type: "insert-text",
				blockId: nestedToggleId,
				offset: 0,
				text: "Nested",
			},
			{
				type: "update-block",
				blockId: nestedToggleId,
				props: { parentId: toggleBlockId },
			},
			{
				type: "insert-block",
				blockId: nestedChildId,
				blockType: "paragraph",
				props: {},
				position: { after: nestedToggleId },
			},
			{
				type: "insert-text",
				blockId: nestedChildId,
				offset: 0,
				text: "Nested child",
			},
			{
				type: "update-block",
				blockId: nestedChildId,
				props: { parentId: nestedToggleId },
			},
		]);
		editor.selectText(nestedToggleId, 0, 0);

		let slashMenu: ReturnType<typeof useSlashMenu> | null = null;

		function Harness() {
			slashMenu = useSlashMenu(editor);

			return (
				<Pen.Editor.Root editor={editor}>
					<Pen.Editor.Content />
				</Pen.Editor.Root>
			);
		}

		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);

		await act(async () => {
			root.render(<Harness />);
		});

		await act(async () => {
			slashMenu?.setQuery("heading");
		});

		await act(async () => {
			slashMenu?.confirm(0);
		});

		const insertedBlockIds = editor.documentState.blockOrder.filter(
			(blockId) =>
				blockId !== toggleBlockId &&
				blockId !== nestedToggleId &&
				blockId !== nestedChildId,
		);
		expect(insertedBlockIds).toHaveLength(1);

		const insertedBlockId = insertedBlockIds[0]!;
		expect(editor.getBlock(insertedBlockId)?.type).toBe("heading");
		expect(editor.documentState.parentOf(insertedBlockId)).toBe(
			toggleBlockId,
		);
		expect(editor.documentState.blockOrder).toEqual([
			toggleBlockId,
			nestedToggleId,
			nestedChildId,
			insertedBlockId,
		]);

		await act(async () => {
			root.unmount();
		});
		container.remove();
		editor.destroy();
	});

	it("hides flow-disallowed blocks from the slash menu in flow documents", async () => {
		const editor = createSlashMenuEditor({
			documentProfile: "flow",
		});
		const blockId = editor.firstBlock()!.id;
		editor.selectText(blockId, 0, 0);

		let slashMenu: ReturnType<typeof useSlashMenu> | null = null;

		function Harness() {
			slashMenu = useSlashMenu(editor);

			return (
				<Pen.Editor.Root editor={editor}>
					<Pen.Editor.Content />
				</Pen.Editor.Root>
			);
		}

		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);

		await act(async () => {
			root.render(<Harness />);
		});

		await act(async () => {
			slashMenu?.setQuery("");
		});

		expect(slashMenu).not.toBeNull();
		const itemTypes = slashMenu!.items.map((item) => item.type);
		expect(itemTypes).not.toContain("database");
		expect(itemTypes).not.toContain("subdocument");
		expect(itemTypes).toContain("table");

		await act(async () => {
			root.unmount();
		});
		container.remove();
		editor.destroy();
	});
});
