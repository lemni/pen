// @vitest-environment jsdom

import {
	act,
	type DragEvent as ReactDragEvent,
	type ReactElement,
	type Ref,
} from "react";
import { describe, expect, it, vi } from "vitest";
import { createRoot } from "react-dom/client";
import { createEditor } from "@pen/core";
import type { AssetProvider, BlockHandle, BlockRenderContext } from "@pen/types";
import { defaultPreset } from "@pen/preset-default";
import { Pen } from "../primitives/index";
import { useEditorContext } from "../context/editorContext";
import { DATA_ATTRS } from "../utils/dataAttributes";

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
	const types = files.length > 0 ? ["Files"] : [];

	return {
		files: createFileList(files),
		types,
		getData() {
			return "";
		},
	} as unknown as DataTransfer;
}

function createDragEvent(
	type: "dragover" | "drop",
	dataTransfer: DataTransfer,
): MouseEvent & { dataTransfer: DataTransfer } {
	const event = new MouseEvent(type, {
		bubbles: true,
		cancelable: true,
	}) as MouseEvent & { dataTransfer: DataTransfer };

	Object.defineProperty(event, "dataTransfer", {
		value: dataTransfer,
	});

	return event;
}

function CustomImageRenderer(
	block: BlockHandle,
	ctx: BlockRenderContext,
): ReactElement {
	return (
		<div
			ref={ctx.ref as Ref<HTMLDivElement>}
			data-block-type="image"
			data-selected={ctx.selected || undefined}
			data-testid={`custom-renderer-${block.id}`}
		>
			Custom renderer
		</div>
	);
}

function UploadCardRenderer(
	block: BlockHandle,
	ctx: BlockRenderContext,
): ReactElement {
	return <UploadCard block={block} ctx={ctx} />;
}

function UploadCard(props: {
	block: BlockHandle;
	ctx: BlockRenderContext;
}): ReactElement {
	const { block, ctx } = props;
	const { editor, assets } = useEditorContext();

	async function handleDrop(
		event: ReactDragEvent<HTMLButtonElement>,
	): Promise<void> {
		event.preventDefault();
		event.stopPropagation();

		const file = event.dataTransfer.files.item(0);
		if (!file || !assets) {
			return;
		}

		const ref = await assets.upload(file, { mimeType: file.type });
		editor.apply(
			[
				{
					type: "update-block",
					blockId: block.id,
					props: {
						src: assets.resolve(ref),
						alt: "photo",
					},
				},
			],
			{ origin: "user", undoGroup: true },
		);
	}

	function handleDragOver(event: ReactDragEvent<HTMLButtonElement>) {
		event.preventDefault();
	}

	return (
		<div
			ref={ctx.ref as Ref<HTMLDivElement>}
			data-block-type="image"
			data-selected={ctx.selected || undefined}
		>
			<button
				type="button"
				{...{ [DATA_ATTRS.ignoreTransfer]: "" }}
				onDragOver={handleDragOver}
				onDrop={(event) => {
					void handleDrop(event);
				}}
			>
				Upload image...
			</button>
		</div>
	);
}

function createImageEditor() {
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
			type: "convert-block",
			blockId,
			newType: "image",
			newProps: {},
		},
	]);

	return { editor, blockId };
}

describe("@pen/react renderer overrides", () => {
	it("scopes custom renderers to a single editor root", async () => {
		const first = createImageEditor();
		const second = createImageEditor();
		second.editor.apply([
			{
				type: "update-block",
				blockId: second.blockId,
				props: {
					src: "memory://existing.png",
					alt: "Existing image",
				},
			},
		]);
		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);

		try {
			await act(async () => {
				root.render(
					<>
						<div data-testid="first-root">
							<Pen.Editor.Root
								editor={first.editor}
								renderers={{ image: CustomImageRenderer }}
							>
								<Pen.Editor.Content />
							</Pen.Editor.Root>
						</div>
						<div data-testid="second-root">
							<Pen.Editor.Root editor={second.editor}>
								<Pen.Editor.Content />
							</Pen.Editor.Root>
						</div>
					</>,
				);
			});

			expect(
				container.querySelector('[data-testid^="custom-renderer-"]'),
			).not.toBeNull();
			expect(
				container
					.querySelector('[data-testid="second-root"]')
					?.querySelector('[data-testid^="custom-renderer-"]'),
			).toBeNull();
			expect(
				container
					.querySelector('[data-testid="second-root"]')
					?.querySelector("img"),
			).not.toBeNull();
		} finally {
			await act(async () => {
				root.unmount();
			});
			container.remove();
			first.editor.destroy();
			second.editor.destroy();
		}
	});

	it("lets ignored custom drop targets handle image uploads", async () => {
		const { editor, blockId } = createImageEditor();
		const assetProvider: AssetProvider = {
			upload: vi.fn().mockResolvedValue({
				id: "asset-1",
				url: "memory://photo.png",
				mimeType: "image/png",
				size: 5,
			}),
			resolve(ref) {
				return ref.url;
			},
			async delete() {},
		};
		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);

		try {
			await act(async () => {
				root.render(
					<Pen.Editor.Root
						editor={editor}
						assets={assetProvider}
						renderers={{ image: UploadCardRenderer }}
					>
						<Pen.Editor.Content />
					</Pen.Editor.Root>,
				);
			});

			const button = container.querySelector("button");
			expect(button).not.toBeNull();

			const file = new File(["image"], "photo.png", { type: "image/png" });
			const dataTransfer = createDataTransfer([file]);
			const dragOverEvent = createDragEvent("dragover", dataTransfer);
			const dropEvent = createDragEvent("drop", dataTransfer);

			await act(async () => {
				button!.dispatchEvent(dragOverEvent);
				button!.dispatchEvent(dropEvent);
				await new Promise((resolve) => setTimeout(resolve, 0));
			});

			expect(assetProvider.upload).toHaveBeenCalledTimes(1);
			expect(editor.documentState.blockOrder).toEqual([blockId]);
			expect(editor.getBlock(blockId)?.props).toMatchObject({
				src: "memory://photo.png",
				alt: "photo",
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
