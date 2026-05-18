import type {
	CRDTUndoManager,
	CRDTUndoStackItem,
	OpOrigin,
	UndoManagerOptions,
} from "@pen/types";
import { HISTORY_ORIGIN_TAG } from "@pen/types";
import * as Y from "yjs";

import type { YjsCRDTDocument } from "./document";

export function createYjsUndoManager(
	doc: YjsCRDTDocument,
	options?: UndoManagerOptions,
): CRDTUndoManager {
	const { blockOrder, blocks } = doc.penDocument;
	const trackedOrigins = new Set<OpOrigin>(
		options?.trackedOrigins ?? ["user", "ai"],
	);

	const undoManager = new Y.UndoManager([blockOrder, blocks], {
		trackedOrigins,
		captureTimeout: options?.captureTimeout ?? 0,
		doc: doc.ydoc,
	});

	(undoManager as unknown as Record<string, unknown>)[HISTORY_ORIGIN_TAG] =
		true;

	const wrapStackItem = (stackItem: {
		meta: Map<string, unknown>;
	}): CRDTUndoStackItem => ({
		getMeta<T>(key: string): T | undefined {
			return stackItem.meta.get(key) as T | undefined;
		},
		setMeta(key: string, value: unknown): void {
			stackItem.meta.set(key, value);
		},
	});

	return {
		addTrackedOrigin(origin) {
			undoManager.addTrackedOrigin(origin);
		},
		removeTrackedOrigin(origin) {
			undoManager.removeTrackedOrigin(origin);
		},
		undo() {
			if (undoManager.undoStack.length === 0) return false;
			undoManager.undo();
			return true;
		},
		redo() {
			if (undoManager.redoStack.length === 0) return false;
			undoManager.redo();
			return true;
		},
		canUndo() {
			return undoManager.undoStack.length > 0;
		},
		canRedo() {
			return undoManager.redoStack.length > 0;
		},
		stopCapturing() {
			undoManager.stopCapturing();
		},
		setCaptureTimeout(ms) {
			(
				undoManager as Y.UndoManager & { captureTimeout?: number }
			).captureTimeout = ms;
		},
		onStackItemAdded(callback) {
			const handler = (event: {
				stackItem: { meta: Map<string, unknown> };
				type: "undo" | "redo";
			}) => {
				callback(wrapStackItem(event.stackItem), event.type);
			};

			undoManager.on("stack-item-added", handler);
			return () => {
				undoManager.off("stack-item-added", handler);
			};
		},
		onStackItemUpdated(callback) {
			const handler = (event: {
				stackItem: { meta: Map<string, unknown> };
				type: "undo" | "redo";
			}) => {
				callback(wrapStackItem(event.stackItem), event.type);
			};

			undoManager.on("stack-item-updated", handler);
			return () => {
				undoManager.off("stack-item-updated", handler);
			};
		},
		onStackItemPopped(callback) {
			const handler = (event: {
				stackItem: { meta: Map<string, unknown> };
				type: "undo" | "redo";
			}) => {
				callback(wrapStackItem(event.stackItem), event.type);
			};

			undoManager.on("stack-item-popped", handler);
			return () => {
				undoManager.off("stack-item-popped", handler);
			};
		},
	};
}
