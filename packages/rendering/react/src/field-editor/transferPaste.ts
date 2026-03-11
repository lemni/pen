import {
	blocksToOps,
	normalizePendingBlocksForImport,
	reportPendingBlockImportViolations,
	type DocumentOp,
	type Editor,
	type PendingBlock,
	type Position,
	resolveBlockFlowCapability,
} from "@pen/core";
import type { FieldEditorTransferController } from "./controller";
import { decodePenBlocksFromHtml, type PenBlock } from "../utils/clipboardPayload";
import { pasteBlocks, pasteInlineText } from "./transferBlocks";
import {
	deleteSelectionForTransfer,
	getTransferCursorContext,
	selectionSnapshotMatches,
	snapshotTransferSelection,
} from "./transferSelection";
import {
	canAcceptImageTransfer,
	getAssetProvider,
	getImageFiles,
	insertUploadedImages,
	uploadImageFiles,
} from "./transferImages";
import { IMAGE_BLOCK_TYPE, type ExecuteTransferOptions, type UploadedImage } from "./transferTypes";
import {
	shouldAllowDirectBlockPaste,
} from "../utils/flowCapabilities";

export async function executePasteTransfer(
	options: ExecuteTransferOptions,
): Promise<boolean> {
	const { editor, dataTransfer, fieldEditor, importers } = options;
	if (!fieldEditor) {
		return false;
	}

	editor.undoManager.stopCapturing();

	const cursorBefore =
		options.cursorBefore ?? getTransferCursorContext(editor);
	const selectionBefore =
		options.selectionBefore ?? snapshotTransferSelection(editor);

	const penPayload = dataTransfer.getData("application/x-pen-blocks");
	if (penPayload) {
		try {
			const blocks = JSON.parse(penPayload) as PenBlock[];
			if (
				Array.isArray(blocks) &&
				blocks.length > 0 &&
				blocks.every((block) =>
					shouldAllowDirectBlockPaste(
						editor.documentProfile,
						resolveBlockFlowCapability(editor.schema, block.type),
					),
				)
			) {
				const { cursorAfter } = deleteSelectionForTransfer(
					editor,
					cursorBefore,
				);
				pasteBlocks(blocks, editor, fieldEditor, cursorAfter, {
					undoGroup: false,
				});
				return true;
			}
		} catch {
			/* fall through */
		}
	}

	const html = dataTransfer.getData("text/html");
	if (html) {
		const penMatch = html.match(/data-pen-blocks="([^"]*)"/);
		if (penMatch) {
			try {
				const blocks = decodePenBlocksFromHtml(penMatch[1]);
				if (
					Array.isArray(blocks) &&
					blocks.length > 0 &&
					blocks.every((block) =>
						shouldAllowDirectBlockPaste(
							editor.documentProfile,
							resolveBlockFlowCapability(editor.schema, block.type),
						),
					)
				) {
					const { cursorAfter } = deleteSelectionForTransfer(
						editor,
						cursorBefore,
					);
					pasteBlocks(blocks, editor, fieldEditor, cursorAfter, {
						undoGroup: false,
					});
					return true;
				}
			} catch {
				/* fall through to HTML import */
			}
		}

		if (importers?.html) {
			const handled = await applyParsedImporterPaste({
				editor,
				fieldEditor,
				importer: importers.html,
				input: html,
				cursorBefore,
				surface: "paste-html:parse",
				undoGroup: false,
			});
			if (handled) {
				return true;
			}

			const {
				position,
				emptyBlockToRemove,
			} = deleteSelectionForTransfer(editor, cursorBefore);
			const blockCountBefore = editor.documentState.blockOrder.length;
			importers.html.import(html, editor, {
				position,
				undoGroup: false,
			});
			const removed = removeLegacyEmptyPlaceholderIfNeeded({
				editor,
				fieldEditor,
				emptyBlockToRemove,
				blockCountBefore,
			});
			if (!removed) {
				placeCursorAfterImport(editor, fieldEditor);
			}
			return true;
		}
	}

	if (canAcceptImageTransfer(editor, dataTransfer)) {
		const assetProvider = getAssetProvider(editor);
		if (!assetProvider || !editor.schema.resolve(IMAGE_BLOCK_TYPE)) {
			return false;
		}

		const uploaded = await uploadImageFiles(
			getImageFiles(dataTransfer),
			assetProvider,
		);
		if (uploaded.length === 0) {
			return true;
		}

		return executePasteImageTransfer({
			editor,
			uploaded,
			cursorBefore,
			selectionBefore,
		});
	}

	const text = dataTransfer.getData("text/plain");
	if (text) {
		if (importers?.markdown) {
			const handled = await applyParsedImporterPaste({
				editor,
				fieldEditor,
				importer: importers.markdown,
				input: text,
				cursorBefore,
				surface: "paste-markdown:parse",
				undoGroup: false,
			});
			if (handled) {
				return true;
			}

			const {
				position,
				emptyBlockToRemove,
			} = deleteSelectionForTransfer(editor, cursorBefore);
			const blockCountBefore = editor.documentState.blockOrder.length;
			importers.markdown.import(text, editor, {
				position,
				undoGroup: false,
			});
			const removed = removeLegacyEmptyPlaceholderIfNeeded({
				editor,
				fieldEditor,
				emptyBlockToRemove,
				blockCountBefore,
			});
			if (!removed) {
				placeCursorAfterImport(editor, fieldEditor);
			}
			return true;
		}
		const { cursorAfter } = deleteSelectionForTransfer(editor, cursorBefore);
		pasteInlineText(editor, fieldEditor, text, cursorAfter, {
			undoGroup: false,
		});
		return true;
	}

	return false;
}

function executePasteImageTransfer(options: {
	editor: Editor;
	uploaded: UploadedImage[];
	cursorBefore: ReturnType<typeof getTransferCursorContext>;
	selectionBefore: ReturnType<typeof snapshotTransferSelection>;
}): boolean {
	const { editor, uploaded, cursorBefore, selectionBefore } = options;
	if (!selectionSnapshotMatches(editor, selectionBefore)) {
		return true;
	}

	const { position } = deleteSelectionForTransfer(
		editor,
		cursorBefore,
	);
	insertUploadedImages(editor, uploaded, position ?? "last", {
		undoGroup: false,
	});
	return true;
}

function placeCursorAfterImport(
	editor: Editor,
	fieldEditor: FieldEditorTransferController,
): void {
	const selection = editor.selection;
	if (selection?.type === "text") {
		fieldEditor.activateTextSelection(
			selection.anchor.blockId,
			selection.anchor.offset,
			selection.anchor.offset,
		);
	}
}

async function applyParsedImporterPaste(options: {
	editor: Editor;
	fieldEditor: FieldEditorTransferController;
	importer: {
		parse?: (input: string, editor: Editor) => PendingBlock[] | Promise<PendingBlock[]>;
	};
	input: string;
	cursorBefore: ReturnType<typeof getTransferCursorContext>;
	surface: string;
	undoGroup: boolean;
}): Promise<boolean> {
	const {
		editor,
		fieldEditor,
		importer,
		input,
		cursorBefore,
		surface,
		undoGroup,
	} = options;
	if (!importer.parse) {
		return false;
	}

	const blocks = await importer.parse(input, editor);
	if (!Array.isArray(blocks) || blocks.length === 0) {
		return false;
	}

	const normalized = normalizePendingBlocksForImport(
		blocks,
		editor.documentProfile,
		editor.schema,
	);
	reportPendingBlockImportViolations(editor, normalized.violations, surface);
	if (normalized.blocks.length === 0) {
		return true;
	}

	const {
		position,
		emptyBlockToRemove,
	} = deleteSelectionForTransfer(editor, cursorBefore);
	const ops = blocksToOps(normalized.blocks, { position });
	if (emptyBlockToRemove) {
		ops.push({ type: "delete-block", blockId: emptyBlockToRemove });
	}

	const lastInsertedBlockId = getLastTopLevelInsertedBlockId(ops);
	const lastBlock = normalized.blocks[normalized.blocks.length - 1];

	editor.apply(ops, {
		origin: "user",
		...(undoGroup ? { undoGroup: true } : {}),
	});
	restoreCursorAfterParsedPaste(editor, fieldEditor, lastInsertedBlockId, lastBlock);
	return true;
}

function getLastTopLevelInsertedBlockId(ops: DocumentOp[]): string | null {
	for (let i = ops.length - 1; i >= 0; i--) {
		const op = ops[i];
		if (op.type !== "insert-block") continue;
		if (typeof op.position === "object" && "parent" in op.position) continue;
		return op.blockId;
	}
	return null;
}

function restoreCursorAfterParsedPaste(
	editor: Editor,
	fieldEditor: FieldEditorTransferController,
	blockId: string | null,
	block: PendingBlock | undefined,
): void {
	if (!blockId || !block) return;
	const schema = editor.schema.resolve(block.type);
	if (schema?.content === "inline") {
		const offset = block.content?.length ?? 0;
		fieldEditor.activateTextSelection(blockId, offset, offset);
		return;
	}
	editor.selectBlock(blockId);
}

function removeLegacyEmptyPlaceholderIfNeeded(options: {
	editor: Editor;
	fieldEditor: FieldEditorTransferController;
	emptyBlockToRemove?: string;
	blockCountBefore: number;
}): boolean {
	const { editor, fieldEditor, emptyBlockToRemove, blockCountBefore } = options;
	if (!emptyBlockToRemove) return false;
	if (!editor.getBlock(emptyBlockToRemove)) return false;

	const blockOrder = editor.documentState.blockOrder;
	if (blockOrder.length <= blockCountBefore) {
		return false;
	}

	const emptyIndex = blockOrder.indexOf(emptyBlockToRemove);
	if (emptyIndex <= 0) {
		return false;
	}

	const replacementBlockId = blockOrder[emptyIndex - 1] ?? null;
	editor.apply(
		[{ type: "delete-block", blockId: emptyBlockToRemove }],
		{ origin: "user", undoGroup: true },
	);
	if (replacementBlockId) {
		restoreCursorAtBlockEnd(editor, fieldEditor, replacementBlockId);
	}
	return true;
}

function restoreCursorAtBlockEnd(
	editor: Editor,
	fieldEditor: FieldEditorTransferController,
	blockId: string,
): void {
	const block = editor.getBlock(blockId);
	if (!block) return;
	const schema = editor.schema.resolve(block.type);
	if (schema?.content === "inline") {
		const offset = block.textContent().length;
		fieldEditor.activateTextSelection(blockId, offset, offset);
		return;
	}
	editor.selectBlock(blockId);
}
