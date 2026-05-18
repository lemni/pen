import { defineBlock } from "@pen/types";

export const paragraph = defineBlock("paragraph", {
	content: "inline",
	fieldEditor: "richtext",
	placeholder: "Type ⌘I for AI Agent, or / for commands",
	display: {
		title: "Paragraph",
		description: "Plain text paragraph",
		group: "basic",
		aliases: ["p", "text"],
	},
	serialize: {
		toMarkdown: (block) => block.content ?? "",
		toHTML: (block) => `<p>${block.content ?? ""}</p>`,
	},
});
