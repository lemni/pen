import type { Editor } from "@pen/types";
import { UNDO_HISTORY_RESTORE_SLOT_KEY } from "@pen/types";

export const HISTORY_RESTORING_SELECTION_SLOT_KEY =
	UNDO_HISTORY_RESTORE_SLOT_KEY;

/**
 * Coordinates the period where history restores the logical selection and the
 * field editor still needs to finish DOM reconciliation before it can safely
 * accept browser-driven selection updates again.
 */
export class HistorySelectionCoordinator {
	private pendingProjectionRequestId: number | null = null;
	private readonly editor: Pick<Editor, "internals">;

	constructor(editor: Pick<Editor, "internals">) {
		this.editor = editor;
	}

	shouldSuppressSelectionSync(): boolean {
		return (
			this.isLogicalSelectionRestoreInProgress() ||
			this.pendingProjectionRequestId !== null
		);
	}

	beginDeferredProjection(requestId: number): void {
		this.pendingProjectionRequestId = requestId;
	}

	getPendingProjectionRequestId(): number | null {
		return this.pendingProjectionRequestId;
	}

	completeDeferredProjection(requestId: number | null): void {
		if (requestId === null) return;
		if (this.pendingProjectionRequestId !== requestId) return;
		this.pendingProjectionRequestId = null;
	}

	cancelDeferredProjection(): void {
		this.pendingProjectionRequestId = null;
	}

	reset(): void {
		this.pendingProjectionRequestId = null;
	}

	private isLogicalSelectionRestoreInProgress(): boolean {
		return (
			this.editor.internals.getSlot<boolean>(
				HISTORY_RESTORING_SELECTION_SLOT_KEY,
			) === true
		);
	}
}
