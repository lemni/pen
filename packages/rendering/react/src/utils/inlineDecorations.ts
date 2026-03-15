import type { InlineDecoration } from "@pen/types";

const INLINE_DECORATION_ATTRIBUTE_KEY = "__penInlineDecoration";

interface TextDelta {
	insert: string;
	attributes?: Readonly<Record<string, unknown>>;
}

export function applyInlineDecorationsToDeltas(
	deltas: readonly TextDelta[],
	decorations: readonly InlineDecoration[],
): TextDelta[] {
	if (deltas.length === 0 || decorations.length === 0) {
		return [...deltas];
	}

	const normalizedDecorations = decorations
		.filter((decoration) => decoration.to > decoration.from)
		.sort((left, right) =>
			left.from === right.from ? left.to - right.to : left.from - right.from,
		);
	if (normalizedDecorations.length === 0) {
		return [...deltas];
	}

	const result: TextDelta[] = [];
	let offset = 0;

	for (const delta of deltas) {
		const text = delta.insert;
		const textLength = text.length;
		if (textLength === 0) {
			continue;
		}

		const segmentStart = offset;
		const segmentEnd = offset + textLength;
		const boundaries = new Set<number>([segmentStart, segmentEnd]);

		for (const decoration of normalizedDecorations) {
			if (decoration.to <= segmentStart || decoration.from >= segmentEnd) {
				continue;
			}
			boundaries.add(Math.max(decoration.from, segmentStart));
			boundaries.add(Math.min(decoration.to, segmentEnd));
		}

		const sortedBoundaries = [...boundaries].sort((left, right) => left - right);
		for (let index = 0; index < sortedBoundaries.length - 1; index += 1) {
			const from = sortedBoundaries[index];
			const to = sortedBoundaries[index + 1];
			if (to <= from) {
				continue;
			}

			const slice = text.slice(from - segmentStart, to - segmentStart);
			if (!slice) {
				continue;
			}

			const decorationAttributes = mergeDecorationAttributes(
				normalizedDecorations,
				from,
				to,
			);
			const attributes = mergeDeltaAttributes(delta.attributes, decorationAttributes);
			appendDelta(result, {
				insert: slice,
				...(attributes ? { attributes } : {}),
			});
		}

		offset = segmentEnd;
	}

	return result;
}

export { INLINE_DECORATION_ATTRIBUTE_KEY };

function mergeDecorationAttributes(
	decorations: readonly InlineDecoration[],
	from: number,
	to: number,
): Record<string, unknown> | null {
	let mergedAttributes: Record<string, unknown> | null = null;

	for (const decoration of decorations) {
		if (decoration.from > from || decoration.to < to) {
			continue;
		}
		mergedAttributes = {
			...(mergedAttributes ?? {}),
			...decoration.attributes,
		};
	}

	return mergedAttributes;
}

function mergeDeltaAttributes(
	baseAttributes: Readonly<Record<string, unknown>> | undefined,
	decorationAttributes: Record<string, unknown> | null,
): Record<string, unknown> | undefined {
	if (!baseAttributes && !decorationAttributes) {
		return undefined;
	}
	if (!decorationAttributes) {
		return { ...baseAttributes };
	}

	return {
		...(baseAttributes ?? {}),
		[INLINE_DECORATION_ATTRIBUTE_KEY]: decorationAttributes,
	};
}

function appendDelta(target: TextDelta[], nextDelta: TextDelta): void {
	const previousDelta = target[target.length - 1];
	if (
		previousDelta &&
		attributesEqual(previousDelta.attributes, nextDelta.attributes)
	) {
		previousDelta.insert += nextDelta.insert;
		return;
	}
	target.push(nextDelta);
}

function attributesEqual(
	left: Readonly<Record<string, unknown>> | undefined,
	right: Readonly<Record<string, unknown>> | undefined,
): boolean {
	if (left === right) {
		return true;
	}
	if (!left || !right) {
		return left === right;
	}

	const leftKeys = Object.keys(left);
	const rightKeys = Object.keys(right);
	if (leftKeys.length !== rightKeys.length) {
		return false;
	}

	for (const key of leftKeys) {
		if (left[key] !== right[key]) {
			return false;
		}
	}

	return true;
}
