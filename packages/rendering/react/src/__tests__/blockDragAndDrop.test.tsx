// @vitest-environment jsdom

import React, { act, type Ref } from "react";
import { describe, expect, it, vi } from "vitest";
import { createRoot } from "react-dom/client";
import { createEditor } from "@pen/core";
import type { BlockHandle, BlockRenderContext, Editor } from "@pen/types";
import { generateId } from "@pen/types";
import { defaultPreset } from "@pen/preset-default";
import { Pen } from "../primitives/index";
import type { BlockControlsProps } from "../context/editorContext";
import { useBlockDragHandle } from "../hooks/useBlockDragHandle";

(
	globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

type TestRenderResult = {
	container: HTMLDivElement;
	root: ReturnType<typeof createRoot>;
	unmount: () => Promise<void>;
};

type MockDataTransfer = DataTransfer & {
	effectAllowed: string;
	dropEffect: string;
	setDragImageMock: ReturnType<typeof vi.fn>;
};

function createDataTransfer(): MockDataTransfer {
	const data = new Map<string, string>();
	const types: string[] = [];
	const setDragImage = vi.fn();

	return {
		effectAllowed: "",
		dropEffect: "",
		types,
		setDragImage,
		setDragImageMock: setDragImage,
		files: [] as unknown as FileList,
		getData(type: string) {
			return data.get(type) ?? "";
		},
		setData(type: string, value: string) {
			data.set(type, value);
			if (!types.includes(type)) {
				types.push(type);
			}
		},
		clearData(type?: string) {
			if (type) {
				data.delete(type);
				const index = types.indexOf(type);
				if (index >= 0) {
					types.splice(index, 1);
				}
				return;
			}
			data.clear();
			types.splice(0, types.length);
		},
	} as unknown as MockDataTransfer;
}

function createDragEvent(
	type: "dragstart" | "dragover" | "drop" | "dragend",
	dataTransfer: MockDataTransfer,
	coords: { clientX?: number; clientY?: number } = {},
): MouseEvent & { dataTransfer: DataTransfer } {
	const event = new MouseEvent(type, {
		bubbles: true,
		cancelable: true,
		clientX: coords.clientX ?? 20,
		clientY: coords.clientY ?? 20,
	}) as MouseEvent & { dataTransfer: DataTransfer };

	Object.defineProperty(event, "dataTransfer", {
		value: dataTransfer,
	});

	return event;
}

function getBlockOrder(editor: Editor): string[] {
	return [...editor.documentState.blockOrder];
}

function seedBlocks(editor: Editor, count: number): string[] {
	const ids = [editor.firstBlock()!.id];

	for (let index = 1; index < count; index += 1) {
		const blockId = generateId();
		editor.apply([
			{
				type: "insert-block",
				blockId,
				blockType: "paragraph",
				props: {},
				position: "last",
			},
		]);
		ids.push(blockId);
	}

	return ids;
}

async function renderEditor(element: React.ReactElement): Promise<TestRenderResult> {
	const container = document.createElement("div");
	document.body.appendChild(container);
	const root = createRoot(container);

	await act(async () => {
		root.render(element);
	});

	return {
		container,
		root,
		unmount: async () => {
			await act(async () => {
				root.unmount();
			});
			container.remove();
		},
	};
}

function createBlockDragEditor(
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

function setBlockRect(
	container: HTMLElement,
	blockId: string,
	rect: { top: number; height?: number },
): HTMLElement {
	const element = container.querySelector(
		`[data-block-id="${blockId}"]`,
	) as HTMLElement | null;
	if (!element) {
		throw new Error(`Missing block element for ${blockId}`);
	}

	const height = rect.height ?? 40;
	element.getBoundingClientRect = () =>
		({
			top: rect.top,
			bottom: rect.top + height,
			height,
			left: 0,
			right: 300,
			width: 300,
			x: 0,
			y: rect.top,
			toJSON() {
				return {};
			},
		}) as DOMRect;

	return element;
}

function CustomHandleParagraphRenderer(
	block: BlockHandle,
	ctx: BlockRenderContext,
): React.ReactElement {
	return <CustomHandleParagraph blockId={block.id} ctx={ctx} />;
}

function CustomHandleParagraph(props: {
	blockId: string;
	ctx: BlockRenderContext;
}): React.ReactElement {
	const { blockId, ctx } = props;
	const { props: dragProps } = useBlockDragHandle(blockId);

	return (
		<div
			ref={ctx.ref as Ref<HTMLDivElement>}
			data-block-type="paragraph"
			data-selected={ctx.selected || undefined}
		>
			<button {...dragProps} data-testid={`custom-handle-${blockId}`}>
				Drag
			</button>
			<div data-pen-inline-content="">Paragraph</div>
		</div>
	);
}

function GlobalHandle(props: BlockControlsProps): React.ReactElement {
	const { blockId } = props;
	const { props: dragProps } = useBlockDragHandle(blockId);

	return (
		<button {...dragProps} data-testid={`global-handle-${blockId}`}>
			Drag
		</button>
	);
}

describe("@pen/react block drag and drop", () => {
	it("enables custom block handles in structured mode and disables them in flow mode by default", async () => {
		const structuredEditor = createBlockDragEditor();
		seedBlocks(structuredEditor, 3);

		const structuredView = await renderEditor(
			<Pen.Editor.Root
				editor={structuredEditor}
				renderers={{ paragraph: CustomHandleParagraphRenderer }}
			>
				<Pen.Editor.Content />
			</Pen.Editor.Root>,
		);

		const structuredHandles = structuredView.container.querySelectorAll(
			"[data-pen-block-handle]",
		);
		expect(structuredHandles.length).toBe(3);
		expect(structuredHandles[0]?.getAttribute("draggable")).toBe("true");

		await structuredView.unmount();

		const flowEditor = createBlockDragEditor({
			editorViewMode: "flow",
		});
		seedBlocks(flowEditor, 3);

		const flowView = await renderEditor(
			<Pen.Editor.Root
				editor={flowEditor}
				renderers={{ paragraph: CustomHandleParagraphRenderer }}
			>
				<Pen.Editor.Content />
			</Pen.Editor.Root>,
		);

		const flowHandles = flowView.container.querySelectorAll(
			"[data-pen-block-handle]",
		);
		expect(flowHandles.length).toBe(3);
		expect(flowHandles[0]?.getAttribute("draggable")).toBe("false");

		await flowView.unmount();
	});

	it("renders block controls for every block from a single root prop", async () => {
		const editor = createBlockDragEditor();
		const [blockA, blockB, blockC] = seedBlocks(editor, 3);

		const view = await renderEditor(
			<Pen.Editor.Root
				editor={editor}
				blockControls={GlobalHandle}
			>
				<Pen.Editor.Content />
			</Pen.Editor.Root>,
		);

		const allHandles = view.container.querySelectorAll("[data-pen-block-handle]");
		expect(allHandles.length).toBe(3);

		const globalHandle = view.container.querySelector(
			`[data-testid="global-handle-${blockC}"]`,
		) as HTMLElement | null;
		expect(globalHandle).not.toBeNull();

		const targetBlock = setBlockRect(view.container, blockA, { top: 0 });
		const dataTransfer = createDataTransfer();

		await act(async () => {
			globalHandle!.dispatchEvent(createDragEvent("dragstart", dataTransfer));
			targetBlock.dispatchEvent(
				createDragEvent("dragover", dataTransfer, { clientY: 1 }),
			);
			targetBlock.dispatchEvent(
				createDragEvent("drop", dataTransfer, { clientY: 1 }),
			);
			globalHandle!.dispatchEvent(createDragEvent("dragend", dataTransfer));
		});

		expect(getBlockOrder(editor)).toEqual([blockC, blockA, blockB]);

		await view.unmount();
	});

	it("resolves drops from the content surface instead of requiring block hover", async () => {
		const editor = createBlockDragEditor();
		const [blockA, blockB, blockC] = seedBlocks(editor, 3);

		const view = await renderEditor(
			<Pen.Editor.Root editor={editor} blockControls={GlobalHandle}>
				<Pen.Editor.Content />
			</Pen.Editor.Root>,
		);

		setBlockRect(view.container, blockA, { top: 0 });
		setBlockRect(view.container, blockB, { top: 44 });
		setBlockRect(view.container, blockC, { top: 88 });

		const handle = view.container.querySelector(
			`[data-testid="global-handle-${blockC}"]`,
		) as HTMLElement | null;
		const content = view.container.querySelector(
			"[data-pen-editor-content]",
		) as HTMLElement | null;
		expect(handle).not.toBeNull();
		expect(content).not.toBeNull();

		const dataTransfer = createDataTransfer();

		await act(async () => {
			handle!.dispatchEvent(createDragEvent("dragstart", dataTransfer));
			content!.dispatchEvent(
				createDragEvent("dragover", dataTransfer, { clientY: 22 }),
			);
			content!.dispatchEvent(
				createDragEvent("drop", dataTransfer, { clientY: 22 }),
			);
			handle!.dispatchEvent(createDragEvent("dragend", dataTransfer));
		});

		expect(getBlockOrder(editor)).toEqual([blockA, blockC, blockB]);

		await view.unmount();
	});

	it("falls back to the drag session when dragover cannot read custom MIME payload data", async () => {
		const editor = createBlockDragEditor();
		const [blockA, blockB, blockC] = seedBlocks(editor, 3);

		const view = await renderEditor(
			<Pen.Editor.Root editor={editor} blockControls={GlobalHandle}>
				<Pen.Editor.Content />
			</Pen.Editor.Root>,
		);

		setBlockRect(view.container, blockA, { top: 0 });
		setBlockRect(view.container, blockB, { top: 44 });
		setBlockRect(view.container, blockC, { top: 88 });

		const handle = view.container.querySelector(
			`[data-testid="global-handle-${blockC}"]`,
		) as HTMLElement | null;
		const content = view.container.querySelector(
			"[data-pen-editor-content]",
		) as HTMLElement | null;
		const targetBlock = view.container.querySelector(
			`[data-block-id="${blockA}"]`,
		) as HTMLElement | null;
		expect(handle).not.toBeNull();
		expect(content).not.toBeNull();
		expect(targetBlock).not.toBeNull();

		const dataTransfer = createDataTransfer();
		const originalGetData = dataTransfer.getData.bind(dataTransfer);

		await act(async () => {
			handle!.dispatchEvent(createDragEvent("dragstart", dataTransfer));
		});

		dataTransfer.getData = ((type: string) =>
			type === "application/x-pen-block-drag" ? "" : originalGetData(type)) as typeof dataTransfer.getData;

		await act(async () => {
			content!.dispatchEvent(
				createDragEvent("dragover", dataTransfer, { clientY: 1 }),
			);
		});

		expect(targetBlock?.getAttribute("data-drop-target")).toBe("true");
		expect(targetBlock?.getAttribute("data-drop-position")).toBe("before");

		await act(async () => {
			content!.dispatchEvent(
				createDragEvent("drop", dataTransfer, { clientY: 1 }),
			);
			handle!.dispatchEvent(createDragEvent("dragend", dataTransfer));
		});

		expect(getBlockOrder(editor)).toEqual([blockC, blockA, blockB]);

		await view.unmount();
	});

	it("does not render a drag overlay when no DragOverlay is mounted", async () => {
		const editor = createBlockDragEditor();
		const [blockA] = seedBlocks(editor, 1);

		const view = await renderEditor(
			<Pen.Editor.Root
				editor={editor}
				renderers={{ paragraph: CustomHandleParagraphRenderer }}
			>
				<Pen.Editor.Content />
			</Pen.Editor.Root>,
		);

		const handle = view.container.querySelector(
			`[data-testid="custom-handle-${blockA}"]`,
		) as HTMLElement | null;
		expect(handle).not.toBeNull();
		const dataTransfer = createDataTransfer();

		await act(async () => {
			handle!.dispatchEvent(createDragEvent("dragstart", dataTransfer));
		});

		const overlay = view.container.querySelector(
			"[data-pen-drag-overlay]",
		) as HTMLElement | null;
		expect(overlay).toBeNull();

		await act(async () => {
			handle!.dispatchEvent(createDragEvent("dragend", dataTransfer));
		});

		await view.unmount();
	});

	it("uses a block preview element as the native drag image", async () => {
		const editor = createBlockDragEditor();
		const [blockA] = seedBlocks(editor, 1);

		const view = await renderEditor(
			<Pen.Editor.Root
				editor={editor}
				renderers={{ paragraph: CustomHandleParagraphRenderer }}
			>
				<Pen.Editor.Content />
			</Pen.Editor.Root>,
		);

		const handle = view.container.querySelector(
			`[data-testid="custom-handle-${blockA}"]`,
		) as HTMLElement | null;
		expect(handle).not.toBeNull();
		setBlockRect(view.container, blockA, { top: 0 });
		const dataTransfer = createDataTransfer();

		await act(async () => {
			handle!.dispatchEvent(
				createDragEvent("dragstart", dataTransfer, { clientX: 20, clientY: 20 }),
			);
		});

		expect(dataTransfer.setDragImageMock).toHaveBeenCalledTimes(1);
		const [previewElement] = dataTransfer.setDragImageMock.mock.calls[0] ?? [];
		expect(previewElement).toBeInstanceOf(HTMLElement);
		expect((previewElement as HTMLElement)?.textContent).toContain("Paragraph");
		expect(
			document.querySelector("[data-pen-block-drag-preview-root]"),
		).not.toBeNull();

		await act(async () => {
			handle!.dispatchEvent(createDragEvent("dragend", dataTransfer));
		});

		expect(
			document.querySelector("[data-pen-block-drag-preview-root]"),
		).toBeNull();

		await view.unmount();
	});

	it("drags the full selected block set when dragging from a selected block", async () => {
		const editor = createBlockDragEditor();
		const [blockA, blockB, blockC, blockD] = seedBlocks(editor, 4);
		editor.selectBlocks([blockB, blockC]);

		const view = await renderEditor(
			<Pen.Editor.Root
				editor={editor}
				renderers={{ paragraph: CustomHandleParagraphRenderer }}
			>
				<Pen.Editor.Content />
			</Pen.Editor.Root>,
		);

		const handle = view.container.querySelector(
			`[data-testid="custom-handle-${blockB}"]`,
		) as HTMLElement | null;
		expect(handle).not.toBeNull();
		const targetBlock = setBlockRect(view.container, blockA, { top: 0 });
		const dataTransfer = createDataTransfer();

		await act(async () => {
			handle!.dispatchEvent(createDragEvent("dragstart", dataTransfer));
			targetBlock.dispatchEvent(
				createDragEvent("dragover", dataTransfer, { clientY: 1 }),
			);
			targetBlock.dispatchEvent(
				createDragEvent("drop", dataTransfer, { clientY: 1 }),
			);
			handle!.dispatchEvent(createDragEvent("dragend", dataTransfer));
		});

		expect(getBlockOrder(editor)).toEqual([blockB, blockC, blockA, blockD]);

		await view.unmount();
	});

	it("drags only the initiating block when dragging from an unselected block", async () => {
		const editor = createBlockDragEditor();
		const [blockA, blockB, blockC, blockD] = seedBlocks(editor, 4);
		editor.selectBlocks([blockA, blockB]);

		const view = await renderEditor(
			<Pen.Editor.Root
				editor={editor}
				renderers={{ paragraph: CustomHandleParagraphRenderer }}
			>
				<Pen.Editor.Content />
			</Pen.Editor.Root>,
		);

		const handle = view.container.querySelector(
			`[data-testid="custom-handle-${blockC}"]`,
		) as HTMLElement | null;
		expect(handle).not.toBeNull();
		const targetBlock = setBlockRect(view.container, blockA, { top: 0 });
		const dataTransfer = createDataTransfer();

		await act(async () => {
			handle!.dispatchEvent(createDragEvent("dragstart", dataTransfer));
			targetBlock.dispatchEvent(
				createDragEvent("dragover", dataTransfer, { clientY: 1 }),
			);
			targetBlock.dispatchEvent(
				createDragEvent("drop", dataTransfer, { clientY: 1 }),
			);
			handle!.dispatchEvent(createDragEvent("dragend", dataTransfer));
		});

		expect(getBlockOrder(editor)).toEqual([blockC, blockA, blockB, blockD]);

		await view.unmount();
	});

	it("supports custom handles when block drag and drop is enabled", async () => {
		const editor = createBlockDragEditor();
		const [blockA, blockB, blockC] = seedBlocks(editor, 3);

		const view = await renderEditor(
			<Pen.Editor.Root
				editor={editor}
				blockDragAndDrop={{ enabled: true }}
				renderers={{ paragraph: CustomHandleParagraphRenderer }}
			>
				<Pen.Editor.Content />
			</Pen.Editor.Root>,
		);

		const allHandles = view.container.querySelectorAll("[data-pen-block-handle]");
		expect(allHandles.length).toBe(3);
		expect(
			view.container.querySelector(
				`[data-testid="custom-handle-${blockA}"]`,
			),
		).not.toBeNull();

		const customHandle = view.container.querySelector(
			`[data-testid="custom-handle-${blockC}"]`,
		) as HTMLElement | null;
		expect(customHandle).not.toBeNull();

		const targetBlock = setBlockRect(view.container, blockA, { top: 0 });
		const dataTransfer = createDataTransfer();

		await act(async () => {
			customHandle!.dispatchEvent(createDragEvent("dragstart", dataTransfer));
			targetBlock.dispatchEvent(
				createDragEvent("dragover", dataTransfer, { clientY: 1 }),
			);
			targetBlock.dispatchEvent(
				createDragEvent("drop", dataTransfer, { clientY: 1 }),
			);
			customHandle!.dispatchEvent(createDragEvent("dragend", dataTransfer));
		});

		expect(getBlockOrder(editor)).toEqual([blockC, blockA, blockB]);

		await view.unmount();
	});

	it("ignores cross-root drag payloads", async () => {
		const leftEditor = createBlockDragEditor();
		const [leftA, leftB] = seedBlocks(leftEditor, 2);

		const rightEditor = createBlockDragEditor();
		const [rightA, rightB] = seedBlocks(rightEditor, 2);

		const view = await renderEditor(
			<div>
				<Pen.Editor.Root
					editor={leftEditor}
					renderers={{ paragraph: CustomHandleParagraphRenderer }}
				>
					<Pen.Editor.Content />
				</Pen.Editor.Root>
				<Pen.Editor.Root
					editor={rightEditor}
					renderers={{ paragraph: CustomHandleParagraphRenderer }}
				>
					<Pen.Editor.Content />
				</Pen.Editor.Root>
			</div>,
		);

		const leftHandle = view.container.querySelector(
			`[data-testid="custom-handle-${leftA}"]`,
		) as HTMLElement | null;
		expect(leftHandle).not.toBeNull();

		const rightTargetBlock = setBlockRect(view.container, rightA, { top: 0 });
		const dataTransfer = createDataTransfer();

		await act(async () => {
			leftHandle!.dispatchEvent(createDragEvent("dragstart", dataTransfer));
			rightTargetBlock.dispatchEvent(
				createDragEvent("dragover", dataTransfer, { clientY: 1 }),
			);
			rightTargetBlock.dispatchEvent(
				createDragEvent("drop", dataTransfer, { clientY: 1 }),
			);
			leftHandle!.dispatchEvent(createDragEvent("dragend", dataTransfer));
		});

		expect(getBlockOrder(leftEditor)).toEqual([leftA, leftB]);
		expect(getBlockOrder(rightEditor)).toEqual([rightA, rightB]);

		await view.unmount();
	});

	it("does not make blocks draggable from the body in block-first mode", async () => {
		const editor = createBlockDragEditor();
		const [, blockB] = seedBlocks(editor, 3);
		editor.selectBlock(blockB);

		const view = await renderEditor(
			<Pen.Editor.Root editor={editor} interactionModel="block-first">
				<Pen.Editor.Content />
			</Pen.Editor.Root>,
		);

		const draggedBlock = setBlockRect(view.container, blockB, { top: 44 });

		expect(draggedBlock.getAttribute("draggable")).toBeNull();

		await view.unmount();
	});

	it("does not auto-enable handle drag in flow mode when block-first interaction is enabled", async () => {
		const editor = createBlockDragEditor({
			editorViewMode: "flow",
		});
		const [blockA] = seedBlocks(editor, 1);

		const view = await renderEditor(
			<Pen.Editor.Root
				editor={editor}
				interactionModel="block-first"
				renderers={{ paragraph: CustomHandleParagraphRenderer }}
			>
				<Pen.Editor.Content />
			</Pen.Editor.Root>,
		);

		const handle = view.container.querySelector(
			`[data-testid="custom-handle-${blockA}"]`,
		) as HTMLElement | null;
		expect(handle).not.toBeNull();
		expect(handle?.getAttribute("draggable")).toBe("false");

		await view.unmount();
	});

	it("disables drag behavior when block drag and drop is disabled", async () => {
		const editor = createBlockDragEditor();
		const [blockA, blockB] = seedBlocks(editor, 2);

		const view = await renderEditor(
			<Pen.Editor.Root
				editor={editor}
				blockDragAndDrop={{ enabled: false }}
				renderers={{ paragraph: CustomHandleParagraphRenderer }}
			>
				<Pen.Editor.Content />
			</Pen.Editor.Root>,
		);

		const customHandle = view.container.querySelector(
			`[data-testid="custom-handle-${blockB}"]`,
		) as HTMLElement | null;
		expect(customHandle).not.toBeNull();
		expect(customHandle?.getAttribute("draggable")).toBe("false");

		const targetBlock = setBlockRect(view.container, blockA, { top: 0 });
		const dataTransfer = createDataTransfer();

		await act(async () => {
			customHandle!.dispatchEvent(createDragEvent("dragstart", dataTransfer));
			targetBlock.dispatchEvent(
				createDragEvent("dragover", dataTransfer, { clientY: 1 }),
			);
			targetBlock.dispatchEvent(
				createDragEvent("drop", dataTransfer, { clientY: 1 }),
			);
		});

		expect(getBlockOrder(editor)).toEqual([blockA, blockB]);

		await view.unmount();
	});
});
