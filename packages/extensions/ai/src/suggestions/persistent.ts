import type {
	BlockHandle,
	Editor,
	Position,
} from "@pen/types";
import type {
	BlockSuggestionMeta,
	PersistentSuggestion,
} from "../types";

type DeltaFragment = {
	insert: string | object;
	attributes?: Record<string, unknown>;
};

interface YTextLike {
	toDelta(): DeltaFragment[];
}

export function readSuggestionsFromBlock(
	editor: Editor,
	blockId: string,
): PersistentSuggestion[] {
	const ytext = getYText(editor, blockId);
	if (!ytext) return [];

	const suggestions: PersistentSuggestion[] = [];
	let offset = 0;

	for (const delta of ytext.toDelta()) {
		const length = typeof delta.insert === "string" ? delta.insert.length : 1;
		const suggestion = asSuggestion(delta.attributes?.suggestion);
		if (suggestion) {
			suggestions.push({
				id: suggestion.id,
				action: suggestion.action,
				author: suggestion.author,
				authorType: suggestion.authorType,
				createdAt: suggestion.createdAt,
				model: suggestion.model,
				sessionId: suggestion.sessionId,
				blockId,
				offset,
				length,
			});
		}
		offset += length;
	}

	return suggestions;
}

export function readAllSuggestions(editor: Editor): PersistentSuggestion[] {
	const suggestions: PersistentSuggestion[] = [];
	for (const block of editor.documentState.allBlocks()) {
		const blockSuggestion = readBlockSuggestionMeta(block);
		if (blockSuggestion) {
			suggestions.push({
				id: blockSuggestion.id,
				action: blockSuggestion.action === "delete-block" ? "delete" : "insert",
				author: blockSuggestion.author,
				authorType: blockSuggestion.authorType,
				createdAt: blockSuggestion.createdAt,
				model: blockSuggestion.model,
				sessionId: blockSuggestion.sessionId,
				blockId: block.id,
				offset: 0,
				length: 0,
			});
		}
		suggestions.push(...readSuggestionsFromBlock(editor, block.id));
	}
	return suggestions;
}

export function readBlockSuggestionMeta(
	block: BlockHandle | null,
): BlockSuggestionMeta | null {
	if (!block) return null;
	const meta = block.meta("suggestion");
	if (!meta) return null;
	if (
		typeof meta.id !== "string" ||
		typeof meta.action !== "string" ||
		typeof meta.author !== "string" ||
		typeof meta.authorType !== "string" ||
		typeof meta.createdAt !== "number"
	) {
		return null;
	}

	const action = meta.action;
	if (
		action !== "insert-block" &&
		action !== "delete-block" &&
		action !== "move-block" &&
		action !== "convert-block"
	) {
		return null;
	}

	return {
		id: meta.id,
		action,
		author: meta.author,
		authorType: meta.authorType === "ai" ? "ai" : "user",
		createdAt: meta.createdAt,
		model: typeof meta.model === "string" ? meta.model : undefined,
		sessionId: typeof meta.sessionId === "string" ? meta.sessionId : undefined,
		previousState: readPreviousState(meta.previousState),
	};
}

export function createSuggestionMark(
	action: "insert" | "delete",
	author: string,
	authorType: "user" | "ai",
	model?: string,
	sessionId?: string,
): Record<string, unknown> {
	return {
		suggestion: {
			id: crypto.randomUUID(),
			action,
			author,
			authorType,
			createdAt: Date.now(),
			model,
			sessionId,
		},
	};
}

function readPreviousState(
	value: unknown,
): BlockSuggestionMeta["previousState"] | undefined {
	if (!value || typeof value !== "object") {
		return undefined;
	}
	const record = value as Record<string, unknown>;
	return {
		type: typeof record.type === "string" ? record.type : undefined,
		position: isPosition(record.position) ? record.position : undefined,
		props:
			record.props && typeof record.props === "object"
				? { ...(record.props as Record<string, unknown>) }
				: undefined,
	};
}

function isPosition(value: unknown): value is Position {
	if (value === "first" || value === "last") return true;
	if (!value || typeof value !== "object") return false;
	const record = value as Record<string, unknown>;
	return (
		typeof record.before === "string" ||
		typeof record.after === "string" ||
		(typeof record.parent === "string" && typeof record.index === "number")
	);
}

function asSuggestion(
	value: unknown,
): {
	id: string;
	action: "insert" | "delete";
	author: string;
	authorType: "user" | "ai";
	createdAt: number;
	model?: string;
	sessionId?: string;
} | null {
	if (!value || typeof value !== "object") return null;
	const record = value as Record<string, unknown>;
	const action = record.action;
	const authorType = record.authorType;
	if (
		typeof record.id !== "string" ||
		(action !== "insert" && action !== "delete") ||
		typeof record.author !== "string" ||
		(authorType !== "user" && authorType !== "ai") ||
		typeof record.createdAt !== "number"
	) {
		return null;
	}
	return {
		id: record.id,
		action,
		author: record.author,
		authorType,
		createdAt: record.createdAt,
		model: typeof record.model === "string" ? record.model : undefined,
		sessionId:
			typeof record.sessionId === "string" ? record.sessionId : undefined,
	};
}

function getYText(editor: Editor, blockId: string): YTextLike | null {
	try {
		return (editor.internals.getBlockText(blockId) as YTextLike | null) ?? null;
	} catch {
		return null;
	}
}
