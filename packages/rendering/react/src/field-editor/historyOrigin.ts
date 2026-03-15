import { HISTORY_ORIGIN_TAG } from "@pen/types";

/**
 * Detects whether a raw CRDT transaction origin is from the undo manager.
 *
 * Uses the stable `HISTORY_ORIGIN_TAG` property instead of checking
 * `constructor.name`, which breaks under minification.
 */
export function isHistoryTransactionOrigin(origin: unknown): boolean {
	if (origin == null || typeof origin !== "object") return false;
	return (origin as Record<string, unknown>)[HISTORY_ORIGIN_TAG] === true;
}
