import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import {
	assertDocumentRoots,
	createDeterministicYDocFixture,
	encodeFixtureUpdate,
	normalizeDocumentForSnapshot,
	runCRDTStateVectorContract,
	runExportContract,
	runHeadlessEditorContract,
} from "../index";

describe("deterministic fixture helpers", () => {
	it("generates stable updates and normalized snapshots", () => {
		const first = createDeterministicYDocFixture();
		const second = createDeterministicYDocFixture();

		expect(first.updateBase64).toBe(second.updateBase64);
		expect(first.stateVectorBase64).toBe(second.stateVectorBase64);
		expect(first.snapshot).toEqual(second.snapshot);
		expect(encodeFixtureUpdate(first.ydoc)).toBe(first.updateBase64);
	});

	it("normalizes map keys for snapshots", () => {
		const ydoc = new Y.Doc();
		const metadata = ydoc.getMap("metadata");
		metadata.set("z", 1);
		metadata.set("a", 2);

		expect(
			Object.keys(
				normalizeDocumentForSnapshot(ydoc, [
					{ name: "metadata", type: "map" },
				]).roots.metadata as Record<string, unknown>,
			),
		).toEqual(["a", "z"]);
	});

	it("throws useful diagnostics for invalid fixture roots", () => {
		const ydoc = new Y.Doc();
		ydoc.getMap("metadata");

		expect(() =>
			assertDocumentRoots(ydoc, [{ name: "metadata", type: "array" }]),
		).toThrow('root "metadata" must be array');
	});
});

describe("contract helpers", () => {
	it("runs the CRDT state-vector contract", () => {
		expect(runCRDTStateVectorContract()).toMatchObject({
			emptySatisfied: false,
			syncedSatisfied: true,
		});
	});

	it("runs the headless editor contract", () => {
		expect(runHeadlessEditorContract().blockCount).toBeGreaterThan(0);
	});

	it("runs the export contract", () => {
		expect(runExportContract()).toMatchObject({
			text: "Deterministic fixture\nStable body text",
		});
	});
});
