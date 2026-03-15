import { useRef, useSyncExternalStore } from "react";
import type { Editor, TableCellHandle } from "@pen/types";

interface CellTextDelta {
	insert: string;
	attributes?: Readonly<Record<string, unknown>>;
}

interface CellTextSnapshot {
	exists: boolean;
	text: string;
	deltas: readonly CellTextDelta[];
}

const EMPTY_DELTAS: readonly CellTextDelta[] = [];

const SSR_SNAPSHOT: CellTextSnapshot = {
	exists: false,
	text: "",
	deltas: EMPTY_DELTAS,
};

export function useCellTextSnapshot(
	editor: Editor,
	tableBlockId: string,
	row: number,
	col: number,
): CellTextSnapshot {
	const snapshotRef = useRef<CellTextSnapshot>(createMissingSnapshot());

	return useSyncExternalStore(
		(callback) =>
			editor.onDocumentCommit((event) => {
				if (event.affectedBlocks.includes(tableBlockId)) {
					callback();
				}
			}),
		() => {
			const nextSnapshot = getCellTextSnapshot(
				editor,
				tableBlockId,
				row,
				col,
			);
			if (cellSnapshotEqual(snapshotRef.current, nextSnapshot)) {
				return snapshotRef.current;
			}
			snapshotRef.current = nextSnapshot;
			return nextSnapshot;
		},
		() => SSR_SNAPSHOT,
	);
}

function getCellTextSnapshot(
	editor: Editor,
	tableBlockId: string,
	row: number,
	col: number,
): CellTextSnapshot {
	const block = editor.getBlock(tableBlockId);
	if (!block) return createMissingSnapshot();

	const cell: TableCellHandle | null = block.tableCell(row, col);
	if (!cell) return createMissingSnapshot();

	return {
		exists: true,
		text: cell.textContent(),
		deltas: cell.textDeltas(),
	};
}

function createMissingSnapshot(): CellTextSnapshot {
	return { exists: false, text: "", deltas: EMPTY_DELTAS };
}

function cellSnapshotEqual(
	left: CellTextSnapshot,
	right: CellTextSnapshot,
): boolean {
	if (left.exists !== right.exists || left.text !== right.text) return false;
	if (left.deltas.length !== right.deltas.length) return false;
	for (let i = 0; i < left.deltas.length; i++) {
		const l = left.deltas[i];
		const r = right.deltas[i];
		if (l.insert !== r.insert) return false;
		if (!shallowEqualAttrs(l.attributes, r.attributes)) return false;
	}
	return true;
}

function shallowEqualAttrs(
	left: Readonly<Record<string, unknown>> | undefined,
	right: Readonly<Record<string, unknown>> | undefined,
): boolean {
	if (left === right) return true;
	if (!left || !right) return left === right;
	const lk = Object.keys(left);
	const rk = Object.keys(right);
	if (lk.length !== rk.length) return false;
	for (const key of lk) {
		if (left[key] !== right[key]) return false;
	}
	return true;
}
