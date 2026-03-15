import type { Editor } from "@pen/types";
import type { FieldEditorTransferController } from "./controller";
import type { PasteImporters } from "../context/editorContext";
import type { ResolvedDropTarget } from "./dropResolver";
import type {
	TransferCursorContext,
	TransferSelectionSnapshot,
} from "./transferSelection";

export const IMAGE_BLOCK_TYPE = "image";

export type TransferSource = "paste" | "drop";

export type TransferKind =
	| "pen-blocks"
	| "html"
	| "plain-text"
	| "image-files"
	| "unknown";

export interface ExecuteTransferOptions {
	source: TransferSource;
	editor: Editor;
	dataTransfer: DataTransfer;
	fieldEditor?: FieldEditorTransferController;
	importers?: PasteImporters;
	dropTarget?: ResolvedDropTarget | null;
	cursorBefore?: TransferCursorContext | null;
	selectionBefore?: TransferSelectionSnapshot;
}

export interface UploadedImage {
	src: string;
	alt: string;
}
