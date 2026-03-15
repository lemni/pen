import {
	buildTableChildren,
} from "@pen/core";
import type { Editor, TextSelection } from "@pen/types";
import type { FieldEditorTransferController } from "./controller";
import type { PasteImporters } from "../context/editorContext";
import { executeTransfer } from "./transfer";
import {
	type Delta,
	type PenBlock,
} from "../utils/clipboardPayload";
import {
	serializeDeltasToFormat,
	sliceDeltas,
	writePenClipboard,
} from "../utils/clipboardSerialization";

type PasteInputEvent = InputEvent & {
	dataTransfer?: DataTransfer | null;
};

// ── Paste entry points ──────────────────────────────────────

/**
 * Paste handler for `beforeinput` `insertFromPaste` events.
 */
export function handlePaste(
	event: InputEvent,
	editor: Editor,
	fieldEditor: FieldEditorTransferController,
	importers?: PasteImporters,
): void {
	const dataTransfer = (event as PasteInputEvent).dataTransfer ?? null;
	if (!dataTransfer) return;
	applyPasteFromDataTransfer(dataTransfer, editor, fieldEditor, importers);
}

/**
 * Paste handler for native `ClipboardEvent` (used by EditContext backend
 * and any path that doesn't get `beforeinput` `insertFromPaste`).
 */
export function handleClipboardPaste(
	event: ClipboardEvent,
	editor: Editor,
	fieldEditor: FieldEditorTransferController,
	importers?: PasteImporters,
): void {
	const dataTransfer = event.clipboardData;
	if (!dataTransfer) return;
	applyPasteFromDataTransfer(dataTransfer, editor, fieldEditor, importers);
}

// ── Paste pipeline ──────────────────────────────────────────

function applyPasteFromDataTransfer(
	dataTransfer: DataTransfer,
	editor: Editor,
	fieldEditor: FieldEditorTransferController,
	importers?: PasteImporters,
): void {
	void executeTransfer({
		source: "paste",
		editor,
		dataTransfer,
		fieldEditor,
		importers,
	});
}

// ── Copy ────────────────────────────────────────────────────

/**
 * Copy handler. Serializes selected content to the clipboard via
 * the synchronous ClipboardEvent.clipboardData API.
 *
 * For single-block partial text selections, copies only the selected
 * text (not the whole block) and marks it as `isPartial` so paste
 * knows to insert inline rather than create a new block.
 */
export function handleCopy(editor: Editor, event?: ClipboardEvent): void {
	const selection = editor.selection;
	if (!selection) return;
	if (selection.type === "text" && selection.isCollapsed) return;

	if (selection.type === "cell") return;

	if (selection.type === "text" && !selection.isMultiBlock) {
		copyInlineSelection(editor, selection, event);
		return;
	}

	copyBlockSelection(editor, event);
}

function copyInlineSelection(
	editor: Editor,
	selection: TextSelection,
	event?: ClipboardEvent,
): void {
	const blockId = selection.anchor.blockId;
	const from = Math.min(selection.anchor.offset, selection.focus.offset);
	const to = Math.max(selection.anchor.offset, selection.focus.offset);
	const block = editor.getBlock(blockId);
	if (!block) return;

	const selectedText = block.textContent().slice(from, to);
	if (!selectedText) return;

	const schema = editor.schema.resolve(block.type);
	const isFullBlock = from === 0 && to >= block.textContent().length;
	const selectedDeltas = sliceDeltas(block.textDeltas(), from, to);

	const penBlock: PenBlock = {
		type: block.type,
		props: isFullBlock ? block.props : {},
		content: selectedText,
		deltas: selectedDeltas,
		isPartial: !isFullBlock,
	};

	let htmlContent = "";
	if (schema?.serialize?.toHTML) {
		const inlineHtml = serializeDeltasToFormat(
			selectedDeltas,
			editor,
			"html",
		);
		htmlContent = schema.serialize.toHTML({
			id: block.id,
			type: block.type,
			props: isFullBlock ? block.props : {},
			content: inlineHtml || selectedText,
		});
	}

	let mdContent = "";
	if (schema?.serialize?.toMarkdown) {
		const inlineMd = serializeDeltasToFormat(
			selectedDeltas,
			editor,
			"markdown",
		);
		mdContent = schema.serialize.toMarkdown({
			id: block.id,
			type: block.type,
			props: isFullBlock ? block.props : {},
			content: inlineMd || selectedText,
		});
	}

	const plainText = mdContent || selectedText;
	writePenClipboard([penBlock], htmlContent, plainText, event);
}

function copyBlockSelection(editor: Editor, event?: ClipboardEvent): void {
	const selection = editor.selection;
	if (!selection) return;

	const blocks = editor.getSelectedBlocks();
	if (blocks.length === 0) return;

	const isText = selection.type === "text";
	const range = isText ? (selection as TextSelection).toRange() : null;

	const htmlParts: string[] = [];
	const mdParts: string[] = [];
	const penBlocks: PenBlock[] = [];

	for (let i = 0; i < blocks.length; i++) {
		const block = blocks[i];
		const schema = editor.schema.resolve(block.type);
		const fullText = block.textContent();
		const isFirst = i === 0;
		const isLast = i === blocks.length - 1;

		let sliceFrom = 0;
		let sliceTo = fullText.length;
		if (isText && range) {
			if (isFirst) sliceFrom = range.start.offset;
			if (isLast) sliceTo = range.end.offset;
		}
		const isPartial = sliceFrom > 0 || sliceTo < fullText.length;
		const content = isPartial ? fullText.slice(sliceFrom, sliceTo) : fullText;
		const deltas = block.textDeltas();
		const slicedDeltas = isPartial
			? sliceDeltas(deltas, sliceFrom, sliceTo)
			: deltas;

		const tableChildren = buildTableChildren(block);

		penBlocks.push({
			type: block.type,
			props: block.props,
			content,
			deltas: slicedDeltas,
			isPartial,
			children: tableChildren,
		});

		if (schema?.serialize?.toHTML) {
			const inlineHtml = serializeDeltasToFormat(slicedDeltas, editor, "html");
			htmlParts.push(
				schema.serialize.toHTML({
					id: block.id,
					type: block.type,
					props: block.props,
					content: inlineHtml || content,
					children: tableChildren,
				}),
			);
		}
		if (schema?.serialize?.toMarkdown) {
			const inlineMd = serializeDeltasToFormat(
				slicedDeltas,
				editor,
				"markdown",
			);
			mdParts.push(
				schema.serialize.toMarkdown({
					id: block.id,
					type: block.type,
					props: block.props,
					content: inlineMd || content,
					children: tableChildren,
				}),
			);
		}
	}

	const htmlContent = htmlParts.join("\n");
	const plainText =
		mdParts.join("\n") || blocks.map((b) => b.textContent()).join("\n");

	writePenClipboard(penBlocks, htmlContent, plainText, event);
}

// ── Cut ─────────────────────────────────────────────────────

export function handleCut(editor: Editor, event?: ClipboardEvent): void {
	handleCopy(editor, event);
	editor.deleteSelection();
}

