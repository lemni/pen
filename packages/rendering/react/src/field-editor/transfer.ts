import type { Editor } from "@pen/types";
import { executePasteTransfer } from "./transferPaste";
import {
	getAssetProvider,
	getImageFiles,
	insertUploadedImagesAtDropTarget,
	resolveDefaultDropTarget,
	uploadImageFiles,
} from "./transferImages";
import {
	IMAGE_BLOCK_TYPE,
	type ExecuteTransferOptions,
	type TransferKind,
} from "./transferTypes";

export { IMAGE_BLOCK_TYPE } from "./transferTypes";
export type {
	ExecuteTransferOptions,
	TransferKind,
	TransferSource,
} from "./transferTypes";

export function resolveTransferKind(
	_editor: Editor,
	dataTransfer: DataTransfer | null,
): TransferKind {
	if (!dataTransfer) return "unknown";
	if (dataTransfer.getData("application/x-pen-blocks")) return "pen-blocks";
	if (dataTransfer.getData("text/html")) return "html";
	if (getImageFiles(dataTransfer).length > 0) return "image-files";
	if (dataTransfer.getData("text/plain")) return "plain-text";
	return "unknown";
}

export async function executeTransfer(
	options: ExecuteTransferOptions,
): Promise<boolean> {
	if (options.source === "paste") {
		return executePasteTransfer(options);
	}

	if (options.source !== "drop") {
		return false;
	}

	const { editor, dataTransfer, dropTarget } = options;
	if (resolveTransferKind(editor, dataTransfer) !== "image-files") {
		return false;
	}

	const assetProvider = getAssetProvider(editor);
	if (!assetProvider || !editor.schema.resolve(IMAGE_BLOCK_TYPE)) {
		return false;
	}

	const files = getImageFiles(dataTransfer);
	if (files.length === 0) {
		return false;
	}

	const uploaded = await uploadImageFiles(files, assetProvider);
	if (uploaded.length === 0) {
		return true;
	}

	const lastInsertedBlockId = insertUploadedImagesAtDropTarget(
		editor,
		uploaded,
		dropTarget ?? resolveDefaultDropTarget(editor),
	);

	if (lastInsertedBlockId) {
		editor.selectBlock(lastInsertedBlockId);
	}

	return true;
}
