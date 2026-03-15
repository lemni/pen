import type {
	CRDTUndoStackItem,
	Extension,
	FieldEditor,
	HistoryAppliedEvent,
	OpOrigin,
	SelectionState,
} from "@pen/types";
import {
	defineExtension,
	FIELD_EDITOR_SLOT_KEY,
	UNDO_HISTORY_RESTORE_SLOT_KEY,
} from "@pen/types";
import { UndoManagerImpl } from "./undoManager";

export interface UndoExtensionOptions {
	groupTimeout?: number;
	trackedOrigins?: OpOrigin[];
}

/**
 * ## Yjs event ordering (confirmed from Yjs v13.6.29 source)
 *
 * ### User edits:
 *   When `captureTimeout > 0`, Yjs merges transactions within the timeout:
 *   - First transaction → new StackItem → emits "stack-item-added"
 *   - Subsequent transactions within captureTimeout → merged into existing
 *     StackItem → emits "stack-item-updated" (same item reference)
 *   - After idle timer fires → Pen calls stopCapturing() → next transaction
 *     starts a new StackItem
 *
 *   This gives us "undo by phrase" grouping driven by Yjs's captureTimeout
 *   (matching the spec's groupTimeout, default 400ms). Pen's idle timer
 *   adds additional boundaries at explicit points (paste, block switch, etc.)
 *   via stopCapturing().
 *
 * ### During undo():
 *   1. transact() reverses CRDT changes
 *   2. afterTransactionHandler → new StackItem pushed to redoStack
 *      → emits "stack-item-added" (kind="redo")
 *   3. popStackItem completes → emits "stack-item-popped" (kind="undo")
 *
 * ### During redo(): same pattern, stacks swapped.
 * All events fire synchronously within undo()/redo().
 *
 * ## Cursor metadata strategy
 *
 * Each StackItem carries two cursor snapshots in Yjs's built-in meta map:
 *
 *   - CURSOR_BEFORE: cursor state BEFORE the edit group
 *   - CURSOR_AFTER:  cursor state AFTER the edit group
 *
 * ### User edits:
 *   - `stack-item-added`: CURSOR_BEFORE captured synchronously (selection
 *     hasn't moved yet — Yjs fires this inside transact()). A microtask is
 *     scheduled to capture CURSOR_AFTER once the selection settles.
 *   - `stack-item-updated`: Yjs merged another transaction into the same
 *     group. We schedule a fresh microtask to overwrite CURSOR_AFTER with
 *     the latest cursor position. The CURSOR_BEFORE from the original
 *     `stack-item-added` is preserved (it represents the start of the group).
 *
 * ### Undo/redo cycles:
 *   `stack-item-added` fires first (new reverse item), then `stack-item-popped`.
 *   We stash the new item reference in `pendingReverseItem`. When
 *   `stack-item-popped` fires, we copy the popped item's metadata onto
 *   the reverse item (before→before, after→after).
 *
 *   `manager._isHistoryOperation` (set by UndoManagerImpl around undo/redo)
 *   tells us which branch to take — no microtask races, no parallel stacks.
 *
 * ### On stack-item-popped, we restore:
 *   - undo → CURSOR_BEFORE (cursor position before the edit was made)
 *   - redo → CURSOR_AFTER  (cursor position after the edit was made)
 *
 * ### Selection restore ordering:
 *   We restore the logical editor selection first, then emit a dedicated
 *   `historyApplied` editor event. The field-editor layer uses that event only
 *   to resync selection/caret state without coupling history lifecycle to the
 *   generic selectionChange path.
 */
export function undoExtension(options?: UndoExtensionOptions): Extension {
	let manager: UndoManagerImpl | null = null;
	let unsubscribeStackItemAdded: (() => void) | null = null;
	let unsubscribeStackItemUpdated: (() => void) | null = null;
	let unsubscribeStackItemPopped: (() => void) | null = null;
	let historyRestoreRequestId = 0;
	const trackedOrigins = new Set<OpOrigin>(
		options?.trackedOrigins ?? DEFAULT_TRACKED_ORIGINS,
	);

	return defineExtension({
		name: "undo",

		activateClient: async (ctx) => {
			const { adapter, crdtDoc } = ctx.editor.internals;

			const crdtUndo = adapter.createUndoManager(crdtDoc, {
				trackedOrigins: [...trackedOrigins],
				captureTimeout: options?.groupTimeout ?? 400,
			});

			let pendingReverseItem: CRDTUndoStackItem | null = null;
			let afterCaptureVersion = 0;

			function scheduleCursorAfterCapture(stackItem: CRDTUndoStackItem) {
				const version = ++afterCaptureVersion;
				queueMicrotask(() => {
					if (afterCaptureVersion !== version) return;
					stackItem.setMeta(CURSOR_AFTER_KEY, captureCursor(ctx.editor));
				});
			}

			unsubscribeStackItemAdded =
				crdtUndo.onStackItemAdded?.((stackItem) => {
					if (manager?._isHistoryOperation) {
						pendingReverseItem = stackItem;
					} else {
						pendingReverseItem = null;
						stackItem.setMeta(
							CURSOR_BEFORE_KEY,
							captureCursor(ctx.editor),
						);
						scheduleCursorAfterCapture(stackItem);
					}
				}) ?? null;

			unsubscribeStackItemUpdated =
				crdtUndo.onStackItemUpdated?.((stackItem) => {
					if (!manager?._isHistoryOperation) {
						scheduleCursorAfterCapture(stackItem);
					}
				}) ?? null;

			unsubscribeStackItemPopped =
				crdtUndo.onStackItemPopped?.((stackItem, kind) => {
					const poppedMeta = readCursorMeta(stackItem);

					if (pendingReverseItem) {
						pendingReverseItem.setMeta(
							CURSOR_BEFORE_KEY,
							poppedMeta.before,
						);
						pendingReverseItem.setMeta(
							CURSOR_AFTER_KEY,
							poppedMeta.after,
						);
						pendingReverseItem = null;
					}

					const cursor =
						kind === "undo" ? poppedMeta.before : poppedMeta.after;
					ctx.editor.internals.setSlot(
						UNDO_HISTORY_RESTORE_SLOT_KEY,
						true,
					);
					try {
						if (cursor) {
							restoreSelection(ctx.editor, cursor.selection);
						}

						const historyApplied: HistoryAppliedEvent = {
							kind,
							selection: ctx.editor.selection,
							focusBlockId:
								cursor?.focusBlockId ?? captureFocusBlockId(ctx.editor),
							requestId: ++historyRestoreRequestId,
						};
						ctx.editor.internals.emit("historyApplied", historyApplied);
					} finally {
						ctx.editor.internals.setSlot(
							UNDO_HISTORY_RESTORE_SLOT_KEY,
							false,
						);
					}
				}) ?? null;

			manager = new UndoManagerImpl(crdtUndo, trackedOrigins);
			if (options?.groupTimeout !== undefined) {
				manager.setGroupTimeout(options.groupTimeout);
			}

			ctx.editor.internals.setSlot("undo:manager", manager);
		},

		deactivateClient: async () => {
			unsubscribeStackItemAdded?.();
			unsubscribeStackItemAdded = null;
			unsubscribeStackItemUpdated?.();
			unsubscribeStackItemUpdated = null;
			unsubscribeStackItemPopped?.();
			unsubscribeStackItemPopped = null;
			manager?.destroy();
			manager = null;
		},

		observe: (events) => {
			if (!manager) return;

			for (const event of events) {
				if (manager.hasTrackedOrigin(event.origin)) {
					manager.resetIdleTimer();
				}
			}

			manager._notifyListeners();
		},
	});
}

// ── Constants ────────────────────────────────────────────────

const DEFAULT_TRACKED_ORIGINS: OpOrigin[] = [
	"user",
	"ai",
	"import",
];
const CURSOR_BEFORE_KEY = "pen:cursor-before";
const CURSOR_AFTER_KEY = "pen:cursor-after";

// ── Cursor snapshot types ────────────────────────────────────

interface CursorSnapshot {
	selection: StoredSelection;
	focusBlockId: string | null;
}

interface CursorMeta {
	before: CursorSnapshot | null;
	after: CursorSnapshot | null;
}

type StoredSelection =
	| {
		type: "text";
		anchor: { blockId: string; offset: number };
		focus: { blockId: string; offset: number };
	}
	| {
		type: "block";
		blockIds: string[];
	}
	| {
		type: "app";
		appId: string;
	}
	| {
		type: "cell";
		blockId: string;
		anchor: { row: number; col: number };
		head: { row: number; col: number };
	}
	| null;

// ── Capture / Restore ────────────────────────────────────────

function captureCursor(editor: {
	selection: SelectionState;
	internals: { getSlot<T>(key: string): T | undefined };
}): CursorSnapshot {
	return {
		selection: captureSelection(editor.selection),
		focusBlockId: captureFocusBlockId(editor),
	};
}

function captureSelection(selection: SelectionState): StoredSelection {
	if (!selection) return null;
	switch (selection.type) {
		case "text":
			return {
				type: "text",
				anchor: { ...selection.anchor },
				focus: { ...selection.focus },
			};
		case "block":
			return { type: "block", blockIds: [...selection.blockIds] };
		case "app":
			return { type: "app", appId: selection.appId };
		case "cell":
			return {
				type: "cell",
				blockId: selection.blockId,
				anchor: { ...selection.anchor },
				head: { ...selection.head },
			};
	}
	return null;
}

function captureFocusBlockId(editor: {
	selection: SelectionState;
	internals: { getSlot<T>(key: string): T | undefined };
}): string | null {
	const fe =
		editor.internals.getSlot<FieldEditor>(FIELD_EDITOR_SLOT_KEY) ?? null;
	if (fe?.focusBlockId) return fe.focusBlockId;

	const sel = editor.selection;
	if (!sel) return null;
	if (sel.type === "text") return sel.focus.blockId;
	if (sel.type === "block") return sel.blockIds[0] ?? null;
	if (sel.type === "cell") return sel.blockId;
	return null;
}

function restoreSelection(
	editor: {
		setSelection(selection: SelectionState): void;
		selectBlocks(blockIds: string[]): void;
		selectTextRange(
			anchor: { blockId: string; offset: number },
			focus: { blockId: string; offset: number },
		): void;
	},
	selection: StoredSelection | undefined,
): void {
	if (selection == null) {
		editor.setSelection(null);
		return;
	}
	if (selection.type === "text") {
		editor.selectTextRange(selection.anchor, selection.focus);
		return;
	}
	if (selection.type === "block") {
		editor.selectBlocks(selection.blockIds);
		return;
	}
	editor.setSelection(selection);
}

function readCursorMeta(stackItem: {
	getMeta<T>(key: string): T | undefined;
}): CursorMeta {
	return {
		before: stackItem.getMeta<CursorSnapshot>(CURSOR_BEFORE_KEY) ?? null,
		after: stackItem.getMeta<CursorSnapshot>(CURSOR_AFTER_KEY) ?? null,
	};
}
