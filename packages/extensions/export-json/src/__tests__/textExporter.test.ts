import { describe, expect, it } from "vitest";
import { exportPenDocumentToText } from "../textExporter";
import type { PenDocumentJSON } from "../types";

describe("exportPenDocumentToText", () => {
	it("exports nested block text in document order", () => {
		const document: PenDocumentJSON = {
			version: 1,
			blocks: [
				{
					id: "one",
					type: "paragraph",
					props: {},
					content: { text: "One" },
					children: [
						{
							id: "child",
							type: "paragraph",
							props: {},
							content: { text: "Child" },
						},
					],
				},
				{
					id: "two",
					type: "paragraph",
					props: {},
					content: { text: "Two" },
				},
			],
		};

		expect(exportPenDocumentToText(document)).toBe("One\nChild\nTwo");
	});

	it("supports host-owned block exclusion and inline node rendering", () => {
		const document: PenDocumentJSON = {
			version: 1,
			blocks: [
				{
					id: "body",
					type: "paragraph",
					props: {},
					content: {
						text: "Hello ",
						segments: [
							{ type: "text", text: "Hello " },
							{
								type: "node",
								nodeType: "mention",
								props: { label: "Ada" },
							},
						],
					},
				},
				{
					id: "quote",
					type: "emailQuote",
					props: {},
					content: { text: "Quoted" },
				},
			],
		};

		expect(
			exportPenDocumentToText(document, {
				excludeBlockTypes: ["emailQuote"],
				renderInlineNode(segment) {
					const label = segment.props?.label;
					return segment.nodeType === "mention" &&
						typeof label === "string"
						? `@${label}`
						: "";
				},
			}),
		).toBe("Hello @Ada");
	});

	it("exports database block text in stable column order", () => {
		const document: PenDocumentJSON = {
			version: 1,
			blocks: [
				{
					id: "db",
					type: "database",
					props: {},
					database: {
						title: "Tasks",
						columns: [
							{ id: "name", type: "text", title: "Name" },
							{ id: "owner", type: "text", title: "Owner" },
						],
						rows: [
							{
								id: "one",
								values: { name: "Plan", owner: "Ada" },
							},
							{
								id: "two",
								values: { name: "Ship", owner: "Grace" },
							},
						],
					},
				},
			],
		};

		expect(exportPenDocumentToText(document)).toBe(
			"Tasks\nPlan\tAda\nShip\tGrace",
		);
	});
});
