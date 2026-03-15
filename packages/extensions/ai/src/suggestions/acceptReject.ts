import type { DocumentOp, Editor } from "@pen/types";
import {
	readAllSuggestions,
	readBlockSuggestionMeta,
	readSuggestionsFromBlock,
} from "./persistent";
import { SUGGESTION_RESOLUTION_ORIGIN } from "./suggestMode";

const RESOLUTION_ORIGIN = SUGGESTION_RESOLUTION_ORIGIN;
type SuggestionResolution = "accept" | "reject";

export function acceptSuggestion(editor: Editor, suggestionId: string): boolean {
	return acceptSuggestions(editor, [suggestionId]);
}

export function rejectSuggestion(editor: Editor, suggestionId: string): boolean {
	return rejectSuggestions(editor, [suggestionId]);
}

export function acceptSuggestions(
	editor: Editor,
	suggestionIds: readonly string[],
): boolean {
	return resolveSuggestions(editor, suggestionIds, "accept");
}

export function rejectSuggestions(
	editor: Editor,
	suggestionIds: readonly string[],
): boolean {
	return resolveSuggestions(editor, suggestionIds, "reject");
}

export function acceptAllSuggestions(editor: Editor): void {
	resolveSuggestions(editor, getAllSuggestionIds(editor), "accept");
}

export function rejectAllSuggestions(editor: Editor): void {
	resolveSuggestions(editor, getAllSuggestionIds(editor), "reject");
}

function resolveSuggestions(
	editor: Editor,
	suggestionIds: readonly string[],
	resolution: SuggestionResolution,
): boolean {
	const ops = buildResolutionOps(editor, suggestionIds, resolution);
	if (ops.length === 0) {
		return false;
	}
	editor.apply(ops, { origin: RESOLUTION_ORIGIN, undoGroup: true });
	return true;
}

function buildResolutionOps(
	editor: Editor,
	suggestionIds: readonly string[],
	resolution: SuggestionResolution,
): DocumentOp[] {
	const remainingIds = new Set(suggestionIds);
	if (remainingIds.size === 0) {
		return [];
	}

	const ops: DocumentOp[] = [];
	for (const block of editor.documentState.allBlocks()) {
		const blockSuggestion = readBlockSuggestionMeta(block);
		const blockOps = buildBlockSuggestionResolutionOps(
			block.id,
			blockSuggestion,
			remainingIds,
			resolution,
		);
		if (blockOps.length > 0) {
			ops.push(...blockOps);
		}
		const deletesBlock = blockOps.some((op) => op.type === "delete-block");
		if (deletesBlock) {
			continue;
		}

		const matches = readSuggestionsFromBlock(editor, block.id)
			.filter((item) => remainingIds.has(item.id))
			.sort((left, right) => right.offset - left.offset);
		if (matches.length === 0) {
			continue;
		}

		for (const suggestion of matches) {
			remainingIds.delete(suggestion.id);
			if (resolution === "accept") {
				if (suggestion.action === "insert") {
					ops.push({
						type: "format-text",
						blockId: block.id,
						offset: suggestion.offset,
						length: suggestion.length,
						marks: { suggestion: null },
					});
					continue;
				}
				ops.push({
					type: "delete-text",
					blockId: block.id,
					offset: suggestion.offset,
					length: suggestion.length,
				});
				continue;
			}

			if (suggestion.action === "insert") {
				ops.push({
					type: "delete-text",
					blockId: block.id,
					offset: suggestion.offset,
					length: suggestion.length,
				});
				continue;
			}
			ops.push({
				type: "format-text",
				blockId: block.id,
				offset: suggestion.offset,
				length: suggestion.length,
				marks: { suggestion: null },
			});
		}
	}

	return ops;
}

function buildBlockSuggestionResolutionOps(
	blockId: string,
	blockSuggestion: ReturnType<typeof readBlockSuggestionMeta>,
	remainingIds: Set<string>,
	resolution: SuggestionResolution,
): DocumentOp[] {
	if (!blockSuggestion || !remainingIds.has(blockSuggestion.id)) {
		return [];
	}
	remainingIds.delete(blockSuggestion.id);

	if (resolution === "accept") {
		switch (blockSuggestion.action) {
			case "insert-block":
			case "move-block":
			case "convert-block":
				return [{
					type: "set-meta",
					blockId,
					namespace: "suggestion",
					data: null,
				}];
			case "delete-block":
				return [{ type: "delete-block", blockId }];
		}
	}

	switch (blockSuggestion.action) {
		case "insert-block":
			return [{ type: "delete-block", blockId }];
		case "delete-block":
			return [{
				type: "set-meta",
				blockId,
				namespace: "suggestion",
				data: null,
			}];
		case "move-block":
			return blockSuggestion.previousState?.position
				? [
						{
							type: "move-block",
							blockId,
							position: blockSuggestion.previousState.position,
						},
						{
							type: "set-meta",
							blockId,
							namespace: "suggestion",
							data: null,
						},
				  ]
				: [{
						type: "set-meta",
						blockId,
						namespace: "suggestion",
						data: null,
				  }];
		case "convert-block":
			return blockSuggestion.previousState?.type
				? [
						{
							type: "convert-block",
							blockId,
							newType: blockSuggestion.previousState.type,
							newProps: blockSuggestion.previousState.props ?? {},
						},
						{
							type: "set-meta",
							blockId,
							namespace: "suggestion",
							data: null,
						},
				  ]
				: [{
						type: "set-meta",
						blockId,
						namespace: "suggestion",
						data: null,
				  }];
	}
}

function getAllSuggestionIds(editor: Editor): string[] {
	const ids = new Set<string>();
	for (const suggestion of readAllSuggestions(editor)) {
		ids.add(suggestion.id);
	}
	for (const block of editor.documentState.allBlocks()) {
		const meta = readBlockSuggestionMeta(block);
		if (meta?.id) {
			ids.add(meta.id);
		}
	}
	return [...ids];
}
