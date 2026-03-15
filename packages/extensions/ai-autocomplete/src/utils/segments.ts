import {
	FIRST_SEGMENT_TARGET_CHARS,
	FOLLOW_UP_SEGMENT_TARGET_CHARS,
} from "../constants";

export function buildCompletionSegments(text: string): readonly string[] {
	const tokens = text.match(/\S+\s*|\s+/g) ?? [text];
	if (tokens.length === 0) {
		return [text];
	}

	const segments: string[] = [];
	let current = "";
	let targetChars = FIRST_SEGMENT_TARGET_CHARS;

	for (const token of tokens) {
		const hasNewline = token.includes("\n");
		if (hasNewline && current) {
			segments.push(current);
			current = "";
			targetChars = FOLLOW_UP_SEGMENT_TARGET_CHARS;
		}

		if (!hasNewline && current && current.length + token.length > targetChars) {
			segments.push(current);
			current = "";
			targetChars = FOLLOW_UP_SEGMENT_TARGET_CHARS;
		}

		current += token;

		if (hasNewline || current.length >= targetChars) {
			segments.push(current);
			current = "";
			targetChars = FOLLOW_UP_SEGMENT_TARGET_CHARS;
		}
	}

	if (current) {
		segments.push(current);
	}

	return segments.length > 0 ? segments : [text];
}
