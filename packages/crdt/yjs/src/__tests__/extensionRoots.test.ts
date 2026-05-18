import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import { ensureExtensionRoot, readExtensionRoot } from "../extensionRoots";

describe("extensionRoots", () => {
	it("initializes a namespaced root with version and shape", () => {
		const doc = new Y.Doc();

		const root = ensureExtensionRoot({
			doc,
			namespace: "example.tags",
			version: 1,
			shape: {
				title: "text",
				tags: "array",
				settings: "map",
				ready: "value",
			},
		});

		expect(root.map.get("version")).toBe(1);
		expect(root.map.get("title")).toBeInstanceOf(Y.Text);
		expect(root.map.get("tags")).toBeInstanceOf(Y.Array);
		expect(root.map.get("settings")).toBeInstanceOf(Y.Map);
		expect(root.map.get("ready")).toBeNull();
	});

	it("is idempotent and reads existing roots", () => {
		const doc = new Y.Doc();
		const first = ensureExtensionRoot({
			doc,
			namespace: "example.tags",
			version: 1,
		});
		const second = ensureExtensionRoot({
			doc,
			namespace: "example.tags",
			version: 1,
		});

		expect(second.map).toBe(first.map);
		expect(readExtensionRoot({ doc, namespace: "example.tags" })).toEqual({
			namespace: "example.tags",
			version: 1,
			map: first.map,
		});
	});

	it("fails safely on version or shape mismatches", () => {
		const doc = new Y.Doc();
		ensureExtensionRoot({
			doc,
			namespace: "example.tags",
			version: 1,
			shape: { tags: "array" },
		});

		expect(() =>
			ensureExtensionRoot({
				doc,
				namespace: "example.tags",
				version: 2,
			}),
		).toThrow("version mismatch");

		expect(() =>
			ensureExtensionRoot({
				doc,
				namespace: "example.tags",
				version: 1,
				shape: { tags: "map" },
			}),
		).toThrow('field "tags" exists but is not map');
	});
});
