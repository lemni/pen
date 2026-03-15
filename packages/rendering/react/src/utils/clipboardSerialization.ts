import {
	buildTableChildren,
	sortDeltaAttributes,
} from "@pen/core";
import type { Editor } from "@pen/types";
import {
	encodePenBlocksForHtml,
	type Delta,
	type PenBlock,
} from "./clipboardPayload";

export function writePenClipboard(
	penBlocks: PenBlock[],
	htmlContent: string,
	plainText: string,
	event?: ClipboardEvent,
): void {
	const penBlocksJson = JSON.stringify(penBlocks);
	const encodedPenBlocks = encodePenBlocksForHtml(penBlocksJson);
	const htmlWithPenData = `<meta data-pen-blocks="${encodedPenBlocks}" />${htmlContent}`;

	if (event?.clipboardData) {
		event.clipboardData.setData("text/plain", plainText);
		event.clipboardData.setData("text/html", htmlWithPenData);
		event.clipboardData.setData(
			"application/x-pen-blocks",
			penBlocksJson,
		);
		return;
	}

	navigator.clipboard
		.write([
			new ClipboardItem({
				"application/x-pen-blocks": new Blob([penBlocksJson], {
					type: "application/x-pen-blocks",
				}),
				"text/html": new Blob([htmlWithPenData], {
					type: "text/html",
				}),
				"text/plain": new Blob([plainText], {
					type: "text/plain",
				}),
			}),
		])
		.catch(() => {
			navigator.clipboard.writeText(plainText).catch(() => {});
		});
}

export function sliceDeltas(deltas: Delta[], from: number, to: number): Delta[] {
	const result: Delta[] = [];
	let offset = 0;

	for (const delta of deltas) {
		const text = delta.insert;
		const len = text.length;
		const segStart = offset;
		const segEnd = offset + len;

		if (segEnd <= from || segStart >= to) {
			offset += len;
			continue;
		}

		const sliceStart = Math.max(from - segStart, 0);
		const sliceEnd = Math.min(to - segStart, len);
		const sliced = text.slice(sliceStart, sliceEnd);

		if (sliced) {
			result.push({
				insert: sliced,
				...(delta.attributes ? { attributes: delta.attributes } : {}),
			});
		}
		offset += len;
	}

	return result;
}

export function serializeDeltasToFormat(
	deltas: Delta[],
	editor: Editor,
	format: "html" | "markdown",
): string {
	if (deltas.length === 0) return "";

	let result = "";
	for (const delta of deltas) {
		let text = delta.insert;
		if (text === "\u200B") continue;

		if (delta.attributes) {
			const ordered = sortDeltaAttributes(delta.attributes, editor.schema);
			for (const [mark, props] of Object.entries(ordered)) {
				const inlineSchema = editor.schema.resolveInline(mark);
				if (format === "html") {
					if (!inlineSchema?.serialize?.toHTML) continue;
					text = inlineSchema.serialize.toHTML(
						text,
						typeof props === "object"
							? (props as Record<string, unknown>)
							: {},
					);
				} else {
					if (!inlineSchema?.serialize?.toMarkdown) continue;
					text = inlineSchema.serialize.toMarkdown(
						text,
						typeof props === "object"
							? (props as Record<string, unknown>)
							: {},
					);
				}
			}
		}

		result += text;
	}

	return result;
}

export { buildTableChildren };

