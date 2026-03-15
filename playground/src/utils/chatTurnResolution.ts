export function collectNewlyResolvedTurnIds(input: {
	currentResolvedTurnIds: readonly string[];
	previousPendingChangeCounts: ReadonlyMap<string, number>;
	nextPendingChangeCounts: ReadonlyMap<string, number>;
}): readonly string[] {
	const { currentResolvedTurnIds, previousPendingChangeCounts, nextPendingChangeCounts } =
		input;
	const nextResolvedTurnIds = new Set(currentResolvedTurnIds);

	for (const [turnId, pendingChangeCount] of nextPendingChangeCounts) {
		const previousPendingChangeCount = previousPendingChangeCounts.get(turnId);
		if (
			previousPendingChangeCount != null &&
			previousPendingChangeCount > 0 &&
			pendingChangeCount === 0
		) {
			nextResolvedTurnIds.add(turnId);
		}
	}

	return [...nextResolvedTurnIds];
}
