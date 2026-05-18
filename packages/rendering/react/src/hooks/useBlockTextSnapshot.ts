import { useRef, useSyncExternalStore } from "react";
import type { Editor } from "@pen/types";

interface BlockTextDelta {
	insert: string | Record<string, unknown>;
	attributes?: Readonly<Record<string, unknown>>;
}

interface BlockTextSnapshot {
	exists: boolean;
	text: string;
	deltas: readonly BlockTextDelta[];
}

const EMPTY_DELTAS: readonly BlockTextDelta[] = [];

const SSR_SNAPSHOT: BlockTextSnapshot = {
	exists: false,
	text: "",
	deltas: EMPTY_DELTAS,
};

export function useBlockTextSnapshot(
	editor: Editor,
	blockId: string,
): BlockTextSnapshot {
	const snapshotRef = useRef<BlockTextSnapshot>(createMissingSnapshot());

	return useSyncExternalStore(
		(callback) =>
			editor.onDocumentCommit((event) => {
				if (event.affectedBlocks.includes(blockId)) {
					callback();
				}
			}),
		() => {
			const nextSnapshot = getBlockTextSnapshot(editor, blockId);
			if (blockTextSnapshotEqual(snapshotRef.current, nextSnapshot)) {
				return snapshotRef.current;
			}
			snapshotRef.current = nextSnapshot;
			return nextSnapshot;
		},
		() => SSR_SNAPSHOT,
	);
}

function getBlockTextSnapshot(
	editor: Editor,
	blockId: string,
): BlockTextSnapshot {
	const block = editor.getBlock(blockId);
	if (!block) {
		return createMissingSnapshot();
	}

	return {
		exists: true,
		text: block.textContent(),
		deltas: block.inlineDeltas().map((delta) => ({
			insert:
				typeof delta.insert === "string"
					? delta.insert
					: { type: delta.insert.type, ...delta.insert.props },
			...(delta.attributes ? { attributes: delta.attributes } : {}),
		})),
	};
}

function createMissingSnapshot(): BlockTextSnapshot {
	return {
		exists: false,
		text: "",
		deltas: EMPTY_DELTAS,
	};
}

function blockTextSnapshotEqual(
	left: BlockTextSnapshot,
	right: BlockTextSnapshot,
): boolean {
	if (left.exists !== right.exists || left.text !== right.text) {
		return false;
	}
	if (left.deltas.length !== right.deltas.length) {
		return false;
	}
	for (let i = 0; i < left.deltas.length; i++) {
		if (!blockTextDeltaEqual(left.deltas[i], right.deltas[i])) {
			return false;
		}
	}
	return true;
}

function blockTextDeltaEqual(
	left: BlockTextDelta,
	right: BlockTextDelta,
): boolean {
	if (!blockTextDeltaInsertEqual(left.insert, right.insert)) {
		return false;
	}
	return shallowEqualAttributes(left.attributes, right.attributes);
}

function blockTextDeltaInsertEqual(
	left: string | Record<string, unknown>,
	right: string | Record<string, unknown>,
): boolean {
	if (typeof left === "string" || typeof right === "string") {
		return left === right;
	}

	return shallowEqualAttributes(left, right);
}

function shallowEqualAttributes(
	left: Readonly<Record<string, unknown>> | undefined,
	right: Readonly<Record<string, unknown>> | undefined,
): boolean {
	if (left === right) return true;
	if (!left || !right) return left === right;

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
