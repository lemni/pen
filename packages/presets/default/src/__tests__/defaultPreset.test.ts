import { describe, expect, it } from "vitest";
import { defaultPreset } from "../index";

describe("@pen/preset-default", () => {
	it("returns the standard default extension stack", () => {
		const preset = defaultPreset();
		const result = preset.resolve({
			schema: {} as never,
			documentProfile: "structured",
		});

		expect(result.extensions?.map((extension) => extension.name)).toEqual([
			"document-ops",
			"delta-stream",
			"undo",
			"rich-text-shortcuts",
		]);
	});

	it("supports disabling individual default features", () => {
		const preset = defaultPreset({
			documentOps: false,
			deltaStream: false,
			undo: false,
			shortcuts: false,
		});
		const result = preset.resolve({
			schema: {} as never,
			documentProfile: "structured",
		});

		expect(result.extensions ?? []).toEqual([]);
	});
});
