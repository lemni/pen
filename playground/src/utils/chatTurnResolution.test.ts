import { describe, expect, it } from "vitest";
import { collectNewlyResolvedTurnIds } from "./chatTurnResolution";

describe("collectNewlyResolvedTurnIds", () => {
	it("marks turns resolved when their pending changes reach zero", () => {
		expect(
			collectNewlyResolvedTurnIds({
				currentResolvedTurnIds: [],
				previousPendingChangeCounts: new Map([
					["turn-1", 1],
					["turn-2", 2],
				]),
				nextPendingChangeCounts: new Map([
					["turn-1", 0],
					["turn-2", 1],
				]),
			}),
		).toEqual(["turn-1"]);
	});

	it("preserves already resolved turns", () => {
		expect(
			collectNewlyResolvedTurnIds({
				currentResolvedTurnIds: ["turn-1"],
				previousPendingChangeCounts: new Map([["turn-2", 1]]),
				nextPendingChangeCounts: new Map([["turn-2", 0]]),
			}),
		).toEqual(["turn-1", "turn-2"]);
	});

	it("does not resolve turns that never had pending changes", () => {
		expect(
			collectNewlyResolvedTurnIds({
				currentResolvedTurnIds: [],
				previousPendingChangeCounts: new Map(),
				nextPendingChangeCounts: new Map([["turn-1", 0]]),
			}),
		).toEqual([]);
	});
});
