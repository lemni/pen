import type { Block, DocumentOp, Editor, Position } from "@pen/types";
import type { FieldEditorTransferController } from "./controller";
import type { Delta, PenBlock } from "../utils/clipboardPayload";
import type { TransferCursorContext } from "./transferSelection";
import { getInsertSiblingBlockOp } from "../utils/parentIdTree";

export function pasteBlocks(
	blocks: PenBlock[],
	editor: Editor,
	fieldEditor: FieldEditorTransferController,
	cursor: TransferCursorContext | null,
	options?: { undoGroup?: boolean },
): void {
	const valid = blocks.filter(
		(block) =>
			block &&
			typeof block === "object" &&
			block.type &&
			editor.schema.resolve(block.type),
	);
	if (valid.length === 0) return;

	const single = valid.length === 1 ? valid[0] : null;
	const singleSchema = single?.type
		? editor.schema.resolve(single.type)
		: null;
	const singleIsPartialInline =
		single &&
		singleSchema?.content === "inline" &&
		(Array.isArray(single.deltas) || typeof single.content === "string") &&
		single.isPartial;

	if (singleIsPartialInline && cursor?.isInline) {
		const deltas = getPenBlockInlineDeltas(single);
		if (deltas.length > 0) {
			pasteInlineFragment(editor, fieldEditor, deltas, cursor, options);
			return;
		}
		if (typeof single.content === "string") {
			pasteInlineText(editor, fieldEditor, single.content, cursor, options);
		}
		return;
	}

	const ops: DocumentOp[] = [];
	let previousBlockId: string | null = null;
	let lastBlockId: string | null = null;
	let lastContentLength = 0;
	let lastIsInline = false;
	const shouldReplaceEmpty = cursor?.isEmpty;

	for (const block of valid) {
		const schema = editor.schema.resolve(block.type!)!;
		const blockId = crypto.randomUUID();
		const insertBlockOp =
			previousBlockId
				? ({
					type: "insert-block",
					blockId,
					blockType: block.type!,
					props: block.props ?? {},
					position: { after: previousBlockId } as Position,
				} as DocumentOp)
				: cursor
					? shouldReplaceEmpty
						? ({
							type: "insert-block",
							blockId,
							blockType: block.type!,
							props: block.props ?? {},
							position: { before: cursor.blockId } as Position,
						} as DocumentOp)
						: getInsertSiblingBlockOp(editor, {
							siblingBlockId: cursor.blockId,
							blockId,
							blockType: block.type!,
							props: block.props ?? {},
						})
					: ({
						type: "insert-block",
						blockId,
						blockType: block.type!,
						props: block.props ?? {},
						position: "last" as Position,
					} as DocumentOp);

		ops.push(insertBlockOp);

		if (schema.content === "inline") {
			const deltas = getPenBlockInlineDeltas(block);
			lastContentLength =
				deltas.length > 0 ? appendInlineContentOps(ops, blockId, deltas) : 0;
		} else if (schema.content === "table" && block.children) {
			appendTableChildrenOps(ops, blockId, block.children);
			lastContentLength = 0;
		} else {
			lastContentLength = 0;
		}

		lastBlockId = blockId;
		lastIsInline = schema.content === "inline";
		previousBlockId = blockId;
	}

	if (shouldReplaceEmpty && cursor) {
		ops.push({ type: "delete-block", blockId: cursor.blockId });
	}

	if (ops.length > 0) {
		editor.apply(ops, {
			origin: "user",
			...(options?.undoGroup === false ? {} : { undoGroup: true }),
		});
	}

	if (lastBlockId && lastIsInline) {
		fieldEditor.activateTextSelection(
			lastBlockId,
			lastContentLength,
			lastContentLength,
		);
	}
}

export function pasteInlineText(
	editor: Editor,
	fieldEditor: FieldEditorTransferController,
	text: string,
	cursor: TransferCursorContext | null,
	options?: { undoGroup?: boolean },
): void {
	if (!cursor?.isInline) return;

	const { blockId, offset, blockType } = cursor;
	const lines = text.split(/\r?\n/);

	if (lines.length === 1) {
		const insertedText = lines[0];
		editor.apply(
			[{ type: "insert-text", blockId, offset, text: insertedText }],
			{
				origin: "user",
				...(options?.undoGroup === false ? {} : { undoGroup: true }),
			},
		);
		fieldEditor.activateTextSelection(
			blockId,
			offset + insertedText.length,
			offset + insertedText.length,
		);
		return;
	}

	const ops: DocumentOp[] = [];
	const firstLine = lines[0];
	if (firstLine) {
		ops.push({ type: "insert-text", blockId, offset, text: firstLine });
	}

	const tailText = editor.getBlock(blockId)?.textContent().slice(offset) ?? "";
	if (tailText) {
		ops.push({
			type: "delete-text",
			blockId,
			offset: offset + (firstLine?.length ?? 0),
			length: tailText.length,
		});
	}

	let previousBlockId = blockId;
	let lastInsertedId = blockId;
	let lastInsertedTextLength = offset + (firstLine?.length ?? 0);

	for (let i = 1; i < lines.length; i++) {
		const newId = crypto.randomUUID();
		const isLast = i === lines.length - 1;
		const lineText = isLast ? lines[i] + tailText : lines[i];

		ops.push({
			...(previousBlockId === blockId
				? getInsertSiblingBlockOp(editor, {
					siblingBlockId: previousBlockId,
					blockId: newId,
					blockType,
					props: {},
				})
				: {
					type: "insert-block",
					blockId: newId,
					blockType,
					props: {},
					position: { after: previousBlockId },
				}),
		});

		if (lineText) {
			ops.push({
				type: "insert-text",
				blockId: newId,
				offset: 0,
				text: lineText,
			});
		}

		lastInsertedId = newId;
		lastInsertedTextLength = lines[i]?.length ?? 0;
		previousBlockId = newId;
	}

	if (ops.length > 0) {
		editor.apply(ops, {
			origin: "user",
			...(options?.undoGroup === false ? {} : { undoGroup: true }),
		});
		fieldEditor.activateTextSelection(
			lastInsertedId,
			lastInsertedTextLength,
			lastInsertedTextLength,
		);
	}
}

function pasteInlineFragment(
	editor: Editor,
	fieldEditor: FieldEditorTransferController,
	deltas: Delta[],
	cursor: TransferCursorContext | null,
	options?: { undoGroup?: boolean },
): void {
	if (!cursor?.isInline) return;

	const plainText = deltasToPlainText(deltas);
	if (!plainText) return;
	if (plainText.includes("\n") || !hasAttributedDeltas(deltas)) {
		pasteInlineText(editor, fieldEditor, plainText, cursor, options);
		return;
	}

	const ops: DocumentOp[] = [];
	let offset = cursor.offset;
	for (const delta of deltas) {
		if (!delta.insert) continue;
		ops.push({
			type: "insert-text",
			blockId: cursor.blockId,
			offset,
			text: delta.insert,
			...(delta.attributes ? { marks: delta.attributes } : {}),
		});
		offset += delta.insert.length;
	}

	if (ops.length === 0) return;
	editor.apply(ops, {
		origin: "user",
		...(options?.undoGroup === false ? {} : { undoGroup: true }),
	});
	fieldEditor.activateTextSelection(cursor.blockId, offset, offset);
}

function getPenBlockInlineDeltas(block: PenBlock): Delta[] {
	if (Array.isArray(block.deltas)) {
		const deltas = block.deltas.filter(
			(delta) =>
				delta &&
				typeof delta === "object" &&
				typeof delta.insert === "string" &&
				delta.insert.length > 0,
		);
		if (deltas.length > 0) return deltas;
	}

	if (typeof block.content === "string" && block.content.length > 0) {
		return [{ insert: block.content }];
	}

	return [];
}

function appendInlineContentOps(
	ops: DocumentOp[],
	blockId: string,
	deltas: Delta[],
): number {
	let offset = 0;

	for (const delta of deltas) {
		if (!delta.insert) continue;
		ops.push({
			type: "insert-text",
			blockId,
			offset,
			text: delta.insert,
			...(delta.attributes ? { marks: delta.attributes } : {}),
		});
		offset += delta.insert.length;
	}

	return offset;
}

function deltasToPlainText(deltas: Delta[]): string {
	return deltas.map((delta) => delta.insert).join("");
}

function hasAttributedDeltas(deltas: Delta[]): boolean {
	return deltas.some(
		(delta) => delta.attributes && Object.keys(delta.attributes).length > 0,
	);
}

function appendTableChildrenOps(
	ops: DocumentOp[],
	blockId: string,
	children: Block[],
): void {
	const tableRows = children.filter((child) => child.type === "__table_row");
	for (let rowIdx = 0; rowIdx < tableRows.length; rowIdx++) {
		const row = tableRows[rowIdx];
		const cells = (row.children ?? []).filter(
			(cell: Block) => cell.type === "__table_cell",
		);

		if (rowIdx > 0) {
			ops.push({
				type: "insert-table-row",
				blockId,
				index: rowIdx,
			} as DocumentOp);
		}

		for (let colIdx = 0; colIdx < cells.length; colIdx++) {
			if (rowIdx === 0 && colIdx > 0) {
				ops.push({
					type: "insert-table-column",
					blockId,
					index: colIdx,
				} as DocumentOp);
			}

			const cellContent = cells[colIdx].content;
			if (cellContent) {
				ops.push({
					type: "insert-table-cell-text",
					blockId,
					row: rowIdx,
					col: colIdx,
					offset: 0,
					text: cellContent,
				} as DocumentOp);
			}
		}
	}
}
