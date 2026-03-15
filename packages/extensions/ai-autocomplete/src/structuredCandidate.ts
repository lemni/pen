import type {
	DocumentOp,
	Editor,
	InlineCompletionPreviewBlock,
} from "@pen/types";
import {
	blocksToOps,
	normalizePendingBlocksForImport,
	parseMarkdownToBlocks,
	type PendingBlock,
} from "@pen/content-ops";

export interface AutocompleteStructuredCandidate {
	rawText: string;
	inlineText: string;
	appendedBlocks: readonly PendingBlock[];
	previewBlocks: readonly InlineCompletionPreviewBlock[];
}

export function createAutocompleteStructuredCandidate(
	editor: Editor,
	text: string,
	options?: {
		activeBlockType?: string | null;
		continuationDepth?: number;
	},
): AutocompleteStructuredCandidate {
	const structuredSuggestion = parseStructuredSuggestion(editor, text, options);
	if (!structuredSuggestion) {
		return {
			rawText: text,
			inlineText: text,
			appendedBlocks: [],
			previewBlocks: [],
		};
	}
	return {
		rawText: text,
		inlineText: structuredSuggestion.inlineText,
		appendedBlocks: structuredSuggestion.blocks,
		previewBlocks: structuredSuggestion.blocks.map((block, index) => ({
			id: `preview-${index}`,
			text: getPendingBlockPreviewText(block),
			blockType: block.type,
			props: block.props,
		})),
	};
}

export function materializeStructuredCandidateAcceptance(options: {
	blockId: string;
	offset: number;
	candidate: AutocompleteStructuredCandidate;
}): {
	ops: DocumentOp[];
	selection: { blockId: string; offset: number };
} {
	const { blockId, candidate, offset } = options;
	if (candidate.appendedBlocks.length === 0) {
		return {
			ops: [{
				type: "insert-text",
				blockId,
				offset,
				text: candidate.inlineText,
			}],
			selection: {
				blockId,
				offset: offset + candidate.inlineText.length,
			},
		};
	}

	const ops: DocumentOp[] = [];
	if (candidate.inlineText.length > 0) {
		ops.push({
			type: "insert-text",
			blockId,
			offset,
			text: candidate.inlineText,
		});
	}
	const blockOps = blocksToOps([...candidate.appendedBlocks], {
		position: { after: blockId },
	});
	ops.push(...blockOps);
	return {
		ops,
		selection: resolveSuggestionSelection(blockOps, {
			blockId,
			offset: offset + candidate.inlineText.length,
		}),
	};
}

function parseStructuredSuggestion(
	editor: Editor,
	text: string,
	options?: {
		activeBlockType?: string | null;
		continuationDepth?: number;
	},
): {
	inlineText: string;
	blocks: PendingBlock[];
} | null {
	const normalizedText = text.replace(/\r/g, "");
	const splitIndex = findStructuredSuggestionBoundary(normalizedText);
	if (splitIndex >= 0) {
		const inlineText = normalizedText.slice(0, splitIndex);
		const markdownTail = normalizedText.slice(splitIndex).replace(/^\n+/, "");
		if (markdownTail.trim().length > 0) {
			const parsedBlocks = parseMarkdownToBlocks(markdownTail, editor);
			const normalizedBlocks = normalizePendingBlocksForImport(
				parsedBlocks,
				editor.documentProfile,
				editor.schema,
			).blocks;
			if (normalizedBlocks.length > 0) {
				return {
					inlineText,
					blocks: normalizedBlocks,
				};
			}
		}
	}

	if (isProseBlockType(options?.activeBlockType) && normalizedText.includes("\n")) {
		const proseStructuredSuggestion = parseProseLineStructuredSuggestion(normalizedText);
		if (proseStructuredSuggestion) {
			return proseStructuredSuggestion;
		}
	}

	if (isProseBlockType(options?.activeBlockType)) {
		const implicitMultiParagraphSuggestion =
			parseImplicitMultiParagraphSuggestion(normalizedText, options?.continuationDepth ?? 0);
		if (implicitMultiParagraphSuggestion) {
			return implicitMultiParagraphSuggestion;
		}
	}
	return null;
}

function findStructuredSuggestionBoundary(text: string): number {
	const blankLineMatch = /\n{2,}/.exec(text);
	const markdownLineMatch = /\n(?=(?:#{1,6}\s|>\s|[-*+]\s|\d+[.)]\s|\[[ xX]\]\s|```))/.exec(
		text,
	);
	const blankLineIndex = blankLineMatch?.index ?? -1;
	const markdownLineIndex = markdownLineMatch?.index ?? -1;
	if (blankLineIndex === -1) {
		return markdownLineIndex;
	}
	if (markdownLineIndex === -1) {
		return blankLineIndex;
	}
	return Math.min(blankLineIndex, markdownLineIndex);
}

function resolveSuggestionSelection(
	ops: readonly DocumentOp[],
	fallback: { blockId: string; offset: number },
): { blockId: string; offset: number } {
	let selection = fallback;
	for (const op of ops) {
		if (op.type === "insert-block") {
			selection = {
				blockId: op.blockId,
				offset: 0,
			};
			continue;
		}
		if (op.type === "insert-text") {
			selection = {
				blockId: op.blockId,
				offset: op.offset + op.text.length,
			};
		}
	}
	return selection;
}

function getPendingBlockPreviewText(block: PendingBlock): string {
	const ownContent = block.content?.trim() ?? "";
	if (ownContent.length > 0) {
		return ownContent;
	}
	return (block.children ?? [])
		.map((child) => getPendingBlockPreviewText(child))
		.filter((textPart) => textPart.length > 0)
		.join(" ");
}

function parseProseLineStructuredSuggestion(text: string): {
	inlineText: string;
	blocks: PendingBlock[];
} | null {
	const lines = text.split("\n");
	if (lines.length <= 1) {
		return null;
	}
	const [inlineText, ...tailLines] = lines;
	const paragraphLines = tailLines
		.map((line) => line.trim())
		.filter((line) => line.length > 0);
	if (paragraphLines.length === 0) {
		return null;
	}
	return {
		inlineText,
		blocks: paragraphLines.map((line) => ({
			type: "paragraph",
			props: {},
			content: line,
		})),
	};
}

function isProseBlockType(blockType: string | null | undefined): boolean {
	return (
		blockType === "paragraph" ||
		blockType === "heading" ||
		blockType === "blockquote" ||
		blockType === "callout"
	);
}

function parseImplicitMultiParagraphSuggestion(
	text: string,
	continuationDepth: number,
): {
	inlineText: string;
	blocks: PendingBlock[];
} | null {
	if (continuationDepth < 1 || text.includes("\n")) {
		return null;
	}
	const thresholds = resolveImplicitParagraphThresholds(continuationDepth);
	if (text.trim().length < thresholds.minChars) {
		return null;
	}
	const sentenceRanges = splitIntoSentenceRanges(text);
	if (sentenceRanges.length < 2) {
		return null;
	}
	const splitIndex = findImplicitParagraphSplitIndex(text, sentenceRanges, thresholds);
	if (splitIndex < 0) {
		return null;
	}
	const inlineText = text.slice(0, splitIndex).replace(/\s+$/, "");
	const remainingText = text.slice(splitIndex).trim();
	if (inlineText.length === 0 || remainingText.length < thresholds.minRemainderChars) {
		return null;
	}
	const paragraphContents = buildImplicitParagraphContents(remainingText, thresholds);
	if (paragraphContents.length === 0) {
		return null;
	}
	return {
		inlineText,
		blocks: paragraphContents.map((content) => ({
			type: "paragraph",
			props: {},
			content,
		})),
	};
}

function splitIntoSentenceRanges(text: string): Array<{ start: number; end: number }> {
	const ranges: Array<{ start: number; end: number }> = [];
	const boundaryPattern = /[.!?]["')\]]*\s+(?=(?:["'([{]*[A-Z]))/g;
	let start = 0;
	let match: RegExpExecArray | null;
	while ((match = boundaryPattern.exec(text)) != null) {
		const end = match.index + match[0].length;
		ranges.push({ start, end });
		start = end;
	}
	if (start < text.length) {
		ranges.push({ start, end: text.length });
	}
	return ranges.filter((range) => text.slice(range.start, range.end).trim().length > 0);
}

function findImplicitParagraphSplitIndex(
	text: string,
	sentenceRanges: ReadonlyArray<{ start: number; end: number }>,
	thresholds: {
		inlineTargetChars: number;
		minRemainderChars: number;
	},
): number {
	for (const range of sentenceRanges) {
		const candidateIndex = range.end;
		const inlineLength = text.slice(0, candidateIndex).trimEnd().length;
		const remainderLength = text.slice(candidateIndex).trim().length;
		if (
			inlineLength >= thresholds.inlineTargetChars &&
			remainderLength >= thresholds.minRemainderChars
		) {
			return candidateIndex;
		}
	}
	for (const range of sentenceRanges) {
		const candidateIndex = range.end;
		if (text.slice(candidateIndex).trim().length >= thresholds.minRemainderChars) {
			return candidateIndex;
		}
	}
	return -1;
}

function buildImplicitParagraphContents(
	text: string,
	thresholds: {
		paragraphTargetChars: number;
	},
): string[] {
	const sentenceRanges = splitIntoSentenceRanges(text);
	if (sentenceRanges.length === 0) {
		return [];
	}
	const paragraphs: string[] = [];
	let currentStart = sentenceRanges[0]!.start;
	for (let index = 0; index < sentenceRanges.length; index += 1) {
		const range = sentenceRanges[index]!;
		const currentText = text.slice(currentStart, range.end).trim();
		const remainingSentenceCount = sentenceRanges.length - index - 1;
		if (
			currentText.length >= thresholds.paragraphTargetChars &&
			remainingSentenceCount > 0
		) {
			paragraphs.push(currentText);
			currentStart = range.end;
		}
	}
	const trailingText = text.slice(currentStart).trim();
	if (trailingText.length > 0) {
		paragraphs.push(trailingText);
	}
	return paragraphs.filter((paragraph) => paragraph.length > 0);
}

function resolveImplicitParagraphThresholds(continuationDepth: number): {
	minChars: number;
	inlineTargetChars: number;
	paragraphTargetChars: number;
	minRemainderChars: number;
} {
	if (continuationDepth <= 2) {
		return {
			minChars: 96,
			inlineTargetChars: 64,
			paragraphTargetChars: 96,
			minRemainderChars: 28,
		};
	}
	return {
		minChars: 140,
		inlineTargetChars: 96,
		paragraphTargetChars: 140,
		minRemainderChars: 40,
	};
}
