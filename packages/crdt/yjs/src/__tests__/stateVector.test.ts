import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import {
	compareYjsStateVectorBase64,
	compareYjsStateVectors,
	encodeYjsStateVector,
	encodeYjsStateVectorBase64,
	isYjsStateVectorBase64Satisfied,
	isYjsStateVectorSatisfied,
} from "../stateVector";

describe("stateVector", () => {
	it("treats an absent required vector as satisfied", () => {
		const doc = new Y.Doc();

		expect(isYjsStateVectorSatisfied(encodeYjsStateVector(doc))).toBe(true);
	});

	it("satisfies identical state vectors", () => {
		const doc = new Y.Doc();
		doc.getText("body").insert(0, "Hello");
		const stateVector = encodeYjsStateVector(doc);

		expect(compareYjsStateVectors(stateVector, stateVector)).toEqual({
			satisfied: true,
			missingClients: [],
		});
	});

	it("satisfies when the current vector has higher clocks", () => {
		const doc = new Y.Doc();
		const text = doc.getText("body");
		text.insert(0, "A");
		const required = encodeYjsStateVector(doc);

		text.insert(1, "B");
		const current = encodeYjsStateVector(doc);

		expect(isYjsStateVectorSatisfied(current, required)).toBe(true);
	});

	it("reports missing client clocks", () => {
		const doc = new Y.Doc();
		const text = doc.getText("body");
		text.insert(0, "A");
		const current = encodeYjsStateVector(doc);

		text.insert(1, "B");
		const required = encodeYjsStateVector(doc);

		const result = compareYjsStateVectors(current, required);
		expect(result.satisfied).toBe(false);
		expect(result.missingClients).toHaveLength(1);
		expect(result.missingClients[0]?.currentClock).toBeLessThan(
			result.missingClients[0]?.requiredClock ?? 0,
		);
	});

	it("ignores extra current clients", () => {
		const requiredDoc = new Y.Doc();
		requiredDoc.getText("body").insert(0, "Required");
		const requiredUpdate = Y.encodeStateAsUpdate(requiredDoc);
		const required = encodeYjsStateVector(requiredDoc);

		const currentDoc = new Y.Doc();
		Y.applyUpdate(currentDoc, requiredUpdate);
		currentDoc.getText("local").insert(0, "Extra");

		expect(
			isYjsStateVectorSatisfied(
				encodeYjsStateVector(currentDoc),
				required,
			),
		).toBe(true);
	});

	it("round-trips base64 state vectors", () => {
		const doc = new Y.Doc();
		doc.getText("body").insert(0, "Hello");
		const stateVector = encodeYjsStateVectorBase64(doc);

		expect(isYjsStateVectorBase64Satisfied(stateVector, stateVector)).toBe(
			true,
		);
	});

	it("fails closed for malformed state vectors", () => {
		const doc = new Y.Doc();
		doc.getText("body").insert(0, "Hello");

		const result = compareYjsStateVectorBase64(
			"not-a-state-vector",
			encodeYjsStateVectorBase64(doc),
		);

		expect(result.satisfied).toBe(false);
		expect(result.error).toBeTruthy();
	});
});
