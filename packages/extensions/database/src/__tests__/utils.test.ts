import { describe, expect, it } from "vitest";
import { isCellInSelection } from "../utils";
import type { CellSelection } from "@pen/types";

function sel(anchorRow: number, anchorCol: number, headRow: number, headCol: number): CellSelection {
	return {
		type: "cell",
		blockId: "block-1",
		anchor: { row: anchorRow, col: anchorCol },
		head: { row: headRow, col: headCol },
	};
}

describe("isCellInSelection", () => {
	it("single cell selection matches only that cell", () => {
		const s = sel(1, 2, 1, 2);
		expect(isCellInSelection(s, 1, 2)).toBe(true);
		expect(isCellInSelection(s, 0, 2)).toBe(false);
		expect(isCellInSelection(s, 1, 1)).toBe(false);
	});

	it("rectangular selection includes all cells in range", () => {
		const s = sel(0, 0, 2, 2);
		expect(isCellInSelection(s, 0, 0)).toBe(true);
		expect(isCellInSelection(s, 1, 1)).toBe(true);
		expect(isCellInSelection(s, 2, 2)).toBe(true);
		expect(isCellInSelection(s, 3, 0)).toBe(false);
		expect(isCellInSelection(s, 0, 3)).toBe(false);
	});

	it("works when anchor > head (inverted selection)", () => {
		const s = sel(2, 2, 0, 0);
		expect(isCellInSelection(s, 0, 0)).toBe(true);
		expect(isCellInSelection(s, 1, 1)).toBe(true);
		expect(isCellInSelection(s, 2, 2)).toBe(true);
	});

	it("works with single-row multi-column selection", () => {
		const s = sel(1, 0, 1, 3);
		expect(isCellInSelection(s, 1, 0)).toBe(true);
		expect(isCellInSelection(s, 1, 3)).toBe(true);
		expect(isCellInSelection(s, 0, 0)).toBe(false);
		expect(isCellInSelection(s, 2, 0)).toBe(false);
	});
});
