import { useRef, useSyncExternalStore } from "react";
import type { Editor } from "@pen/types";

interface BlockModelSnapshot {
	exists: boolean;
	id: string;
	type: string | null;
	props: Readonly<Record<string, unknown>> | null;
	revision: number;
	tableRowCount: number;
	tableColumnCount: number;
}

export function useBlockModel(
	editor: Editor,
	blockId: string,
): BlockModelSnapshot {
	const snapshotRef = useRef<BlockModelSnapshot>(
		createMissingSnapshot(blockId),
	);

	return useSyncExternalStore(
		(callback) =>
			editor.onDocumentCommit((event) => {
				if (event.affectedBlocks.includes(blockId)) {
					callback();
				}
			}),
		() => {
			const nextSnapshot = getBlockModelSnapshot(editor, blockId);
			if (blockModelEqual(snapshotRef.current, nextSnapshot)) {
				return snapshotRef.current;
			}
			snapshotRef.current = nextSnapshot;
			return nextSnapshot;
		},
		() => createMissingSnapshot(blockId),
	);
}

function getBlockModelSnapshot(
	editor: Editor,
	blockId: string,
): BlockModelSnapshot {
	const block = editor.getBlock(blockId);
	if (!block) {
		return createMissingSnapshot(blockId);
	}

	return {
		exists: true,
		id: block.id,
		type: block.type,
		props: block.props,
		revision: editor.getBlockRevision(blockId),
		tableRowCount: block.tableRowCount(),
		tableColumnCount: block.tableColumnCount(),
	};
}

function createMissingSnapshot(blockId: string): BlockModelSnapshot {
	return {
		exists: false,
		id: blockId,
		type: null,
		props: null,
		revision: 0,
		tableRowCount: 0,
		tableColumnCount: 0,
	};
}

function blockModelEqual(
	a: BlockModelSnapshot,
	b: BlockModelSnapshot,
): boolean {
	return (
		a.exists === b.exists &&
		a.id === b.id &&
		a.type === b.type &&
		a.revision === b.revision &&
		a.tableRowCount === b.tableRowCount &&
		a.tableColumnCount === b.tableColumnCount &&
		shallowEqual(a.props, b.props)
	);
}

function shallowEqual(
	a: Readonly<Record<string, unknown>> | null,
	b: Readonly<Record<string, unknown>> | null,
): boolean {
	if (a === b) return true;
	if (!a || !b) return a === b;

	const keysA = Object.keys(a);
	const keysB = Object.keys(b);
	if (keysA.length !== keysB.length) return false;

	for (const key of keysA) {
		if (a[key] !== b[key]) {
			return false;
		}
	}

	return true;
}
