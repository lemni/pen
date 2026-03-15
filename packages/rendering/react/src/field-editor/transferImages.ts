import type {
	AssetProvider,
	DocumentOp,
	Editor,
	Position,
} from "@pen/types";
import type { ResolvedDropTarget } from "./dropResolver";
import { IMAGE_BLOCK_TYPE, type UploadedImage } from "./transferTypes";

const IMAGE_MIME_RE = /^image\/(png|jpe?g|gif|webp|svg\+xml|bmp|avif)$/;

export function getAssetProvider(editor: Editor): AssetProvider | null {
	return editor.internals.getSlot<AssetProvider>("paste:assetProvider") ?? null;
}

export function getImageFiles(dataTransfer: DataTransfer): File[] {
	const files: File[] = [];
	for (let i = 0; i < dataTransfer.files.length; i++) {
		const file = dataTransfer.files[i];
		if (IMAGE_MIME_RE.test(file.type)) {
			files.push(file);
		}
	}
	return files;
}

function hasFileType(dataTransfer: DataTransfer): boolean {
	for (let i = 0; i < dataTransfer.types.length; i++) {
		if (dataTransfer.types[i] === "Files") return true;
	}
	return false;
}

/**
 * Whether the editor can accept an image file transfer.
 *
 * During `dragover`/`dragenter` the browser restricts `dataTransfer.files`
 * to an empty list (security sandbox). Only `dataTransfer.types` (containing
 * `"Files"`) is available. We therefore check `types` first and only fall
 * through to the actual file-list when it's populated (i.e. during `drop`).
 */
export function canAcceptImageTransfer(
	editor: Editor,
	dataTransfer: DataTransfer | null,
): boolean {
	if (!dataTransfer) return false;
	const hasFiles = hasFileType(dataTransfer) || dataTransfer.files.length > 0;
	if (!hasFiles) return false;
	if (!editor.schema.resolve(IMAGE_BLOCK_TYPE)) return false;
	return getAssetProvider(editor) !== null;
}

export async function uploadImageFiles(
	files: File[],
	assetProvider: AssetProvider,
): Promise<UploadedImage[]> {
	const uploaded: UploadedImage[] = [];

	for (const file of files) {
		try {
			const ref = await assetProvider.upload(file, {
				mimeType: file.type,
			});

			uploaded.push({
				src: assetProvider.resolve(ref),
				alt: file.name?.replace(/\.[^.]+$/, "") ?? "",
			});
		} catch {
			/* skip files that fail to upload */
		}
	}

	return uploaded;
}

export function insertUploadedImages(
	editor: Editor,
	uploaded: UploadedImage[],
	position: Position,
	options?: { undoGroup?: boolean },
): {
	position: Position | null;
	lastInsertedBlockId: string | null;
} {
	const resolvedPosition = resolveValidImageInsertPosition(editor, position);
	if (!resolvedPosition) {
		return { position: null, lastInsertedBlockId: null };
	}

	const ops: DocumentOp[] = [];
	let previousBlockId: string | null = null;
	let lastInsertedBlockId: string | null = null;

	for (const image of uploaded) {
		const blockId = crypto.randomUUID();
		ops.push({
			type: "insert-block",
			blockId,
			blockType: IMAGE_BLOCK_TYPE,
			props: {
				src: image.src,
				alt: image.alt,
			},
			position: previousBlockId
				? { after: previousBlockId }
				: resolvedPosition,
		});
		previousBlockId = blockId;
		lastInsertedBlockId = blockId;
	}

	if (ops.length === 0) {
		return { position: null, lastInsertedBlockId: null };
	}

	editor.apply(ops, {
		origin: "user",
		...(options?.undoGroup === false ? {} : { undoGroup: true }),
	});
	return { position: resolvedPosition, lastInsertedBlockId };
}

export function insertUploadedImagesAtDropTarget(
	editor: Editor,
	uploaded: UploadedImage[],
	target: ResolvedDropTarget,
	options?: { undoGroup?: boolean },
): string | null {
	if (target.kind === "block-edge" || target.kind === "document-end") {
		return insertUploadedImages(editor, uploaded, target.position, options)
			.lastInsertedBlockId;
	}

	const point = target.point;
	const block = editor.getBlock(point.blockId);
	const schema = block ? editor.schema.resolve(block.type) : null;
	if (!block || schema?.content !== "inline") {
		return insertUploadedImages(editor, uploaded, "last", options).lastInsertedBlockId;
	}

	const textLength = block.textContent().length;
	const clampedOffset = Math.max(0, Math.min(point.offset, textLength));
	if (clampedOffset === 0) {
		return insertUploadedImages(editor, uploaded, {
			before: point.blockId,
		}, options).lastInsertedBlockId;
	}
	if (clampedOffset >= textLength) {
		return insertUploadedImages(editor, uploaded, {
			after: point.blockId,
		}, options).lastInsertedBlockId;
	}

	const tailBlockId = crypto.randomUUID();
	const ops: DocumentOp[] = [
		{
			type: "split-block",
			blockId: point.blockId,
			offset: clampedOffset,
			newBlockId: tailBlockId,
		},
	];
	let previousInsertedBlockId: string | null = null;
	let lastInsertedBlockId: string | null = null;

	for (const image of uploaded) {
		const blockId = crypto.randomUUID();
		ops.push({
			type: "insert-block",
			blockId,
			blockType: IMAGE_BLOCK_TYPE,
			props: {
				src: image.src,
				alt: image.alt,
			},
			position: previousInsertedBlockId
				? { after: previousInsertedBlockId }
				: { before: tailBlockId },
		});
		previousInsertedBlockId = blockId;
		lastInsertedBlockId = blockId;
	}

	if (!lastInsertedBlockId) {
		return null;
	}

	editor.apply(ops, {
		origin: "user",
		...(options?.undoGroup === false ? {} : { undoGroup: true }),
	});
	return lastInsertedBlockId;
}

export function resolveDefaultDropTarget(editor: Editor): ResolvedDropTarget {
	const lastBlock = editor.lastBlock();
	if (!lastBlock) {
		return {
			kind: "document-end",
			position: "last",
		};
	}

	return {
		kind: "block-edge",
		blockId: lastBlock.id,
		side: "after",
		position: { after: lastBlock.id },
	};
}

function resolveValidImageInsertPosition(
	editor: Editor,
	position: Position,
): Position | null {
	if (position === "first" || position === "last") {
		return position;
	}

	if ("before" in position) {
		if (editor.getBlock(position.before)) {
			return position;
		}
	} else if ("after" in position) {
		if (editor.getBlock(position.after)) {
			return position;
		}
	} else if (editor.getBlock(position.parent)) {
		return position;
	}

	const lastBlock = editor.lastBlock();
	if (lastBlock) {
		return { after: lastBlock.id };
	}

	return null;
}
