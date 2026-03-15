import { useRef, useSyncExternalStore } from "react";
import type { Editor, OpOrigin } from "@pen/types";

interface BlockCommitState {
	revision: number;
	origin: OpOrigin | null;
	commitId: number;
}

export function useBlockCommitState(
	editor: Editor,
	blockId: string,
): BlockCommitState {
	const snapshotRef = useRef<BlockCommitState>({
		revision: editor.getBlockRevision(blockId),
		origin: null,
		commitId: 0,
	});

	return useSyncExternalStore(
		(callback) =>
			editor.onDocumentCommit((event) => {
				if (!event.affectedBlocks.includes(blockId)) {
					return;
				}
				snapshotRef.current = {
					revision: event.blockRevisions[blockId] ?? editor.getBlockRevision(blockId),
					origin: event.origin,
					commitId: event.commitId,
				};
				callback();
			}),
		() => {
			const revision = editor.getBlockRevision(blockId);
			if (snapshotRef.current.revision !== revision) {
				snapshotRef.current = {
					revision,
					origin: null,
					commitId: snapshotRef.current.commitId,
				};
			}
			return snapshotRef.current;
		},
		() => ({
			revision: 0,
			origin: null,
			commitId: 0,
		}),
	);
}
