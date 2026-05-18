import type { Editor, Exporter, ExportOptions } from "@pen/types";
import { exportEditorToJson } from "./exporter";
import type {
	PenBlockJSON,
	PenDocumentJSON,
	PenInlineNodeSegmentJSON,
	PenInlineSegmentJSON,
} from "./types";

const ZERO_WIDTH_SPACE = "\u200B";
const DEFAULT_SEPARATOR = "\n";

export type PenTextExportExtraOptions = Record<string, unknown> & {
	excludeBlockTypes?: string[];
	includeBlockTypes?: string[];
	separator?: string;
	renderInlineNode?: (segment: PenInlineNodeSegmentJSON) => string;
};

export const textExporter: Exporter<string, PenTextExportExtraOptions> = {
	name: "text",
	mimeType: "text/plain",
	fileExtension: ".txt",

	export(
		editor: Editor,
		options?: ExportOptions<PenTextExportExtraOptions>,
	): string {
		return exportEditorToText(editor, options);
	},
};

export function exportEditorToText(
	editor: Editor,
	options?: ExportOptions<PenTextExportExtraOptions>,
): string {
	return exportPenDocumentToText(exportEditorToJson(editor), options?.extra);
}

export function exportPlainText(
	editor: Editor,
	options?: ExportOptions<PenTextExportExtraOptions>,
): string {
	return exportEditorToText(editor, options);
}

export function exportPenDocumentToText(
	document: PenDocumentJSON,
	options: PenTextExportExtraOptions = {},
): string {
	const separator = options.separator ?? DEFAULT_SEPARATOR;
	return document.blocks
		.flatMap((block) => renderBlockText(block, options))
		.join(separator);
}

function renderBlockText(
	block: PenBlockJSON,
	options: PenTextExportExtraOptions,
): string[] {
	if (options.excludeBlockTypes?.includes(block.type)) {
		return [];
	}
	if (
		options.includeBlockTypes &&
		!options.includeBlockTypes.includes(block.type)
	) {
		return [];
	}

	const ownText = renderInlineContentText(block, options);
	const databaseTexts = renderDatabaseText(block);
	const childTexts =
		block.children?.flatMap((child) => renderBlockText(child, options)) ??
		[];

	return [ownText, ...databaseTexts, ...childTexts].filter(
		(text) => text.length > 0,
	);
}

function renderInlineContentText(
	block: PenBlockJSON,
	options: PenTextExportExtraOptions,
): string {
	if (block.content?.segments?.length) {
		return block.content.segments
			.map((segment) => renderInlineSegmentText(segment, options))
			.join("")
			.replaceAll(ZERO_WIDTH_SPACE, "");
	}

	return (block.content?.text ?? "").replaceAll(ZERO_WIDTH_SPACE, "");
}

function renderInlineSegmentText(
	segment: PenInlineSegmentJSON,
	options: PenTextExportExtraOptions,
): string {
	if (segment.type === "text") {
		return segment.text.replaceAll(ZERO_WIDTH_SPACE, "");
	}

	return options.renderInlineNode?.(segment) ?? "";
}

function renderDatabaseText(block: PenBlockJSON): string[] {
	if (!block.database) {
		return [];
	}

	const columnIds = block.database.columns.map((column) => column.id);
	const title = block.database.title?.trim();
	const rows = block.database.rows
		.map((row) =>
			columnIds
				.map((columnId) => row.values[columnId])
				.filter((value): value is string => Boolean(value?.trim()))
				.join("\t"),
		)
		.filter((rowText) => rowText.length > 0);

	return [title, ...rows].filter((text): text is string => Boolean(text));
}
