import type { InlineSchema, PropSchema } from "./types/schema";
import { prop, resolveSchema } from "./prop";

function resolveProps(
	props: Record<string, unknown>,
): Record<string, PropSchema> {
	const resolved: Record<string, PropSchema> = {};
	for (const [key, value] of Object.entries(props)) {
		resolved[key] = resolveSchema(value);
	}
	return resolved;
}

export const suggestion: InlineSchema = {
	type: "suggestion",
	propSchema: resolveProps({
		id: prop.string().default("").describe("Unique suggestion identifier"),
		action: prop
			.enum(["insert", "delete"])
			.default("insert")
			.describe("Whether marked text was inserted or deleted"),
		author: prop.string().default("").describe("Author identifier"),
		authorType: prop
			.enum(["user", "ai"])
			.default("user")
			.describe("Whether the author is a human or AI"),
		createdAt: prop.number().default(0).describe("Unix timestamp"),
		model: prop.string().optional().describe("AI model identifier"),
	}),
	kind: "mark",
	system: true,
	expand: "none",
	serialize: {
		toMarkdown: (text, props) =>
			props?.action === "delete" ? `{--${text}--}` : `{++${text}++}`,
		toHTML: (text, props) =>
			props?.action === "delete"
				? `<del data-suggestion-id="${props?.id ?? ""}">${text}</del>`
				: `<ins data-suggestion-id="${props?.id ?? ""}">${text}</ins>`,
	},
	aiDescription: "Track changes suggestion mark (system)",
};
