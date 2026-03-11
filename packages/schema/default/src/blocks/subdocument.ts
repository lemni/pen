import { defineBlock, prop } from "@pen/types";

export const subdocument = defineBlock("subdocument", {
  props: {
    title: prop.string().default("Subdocument").describe("Nested document title"),
    subdocumentGuid: prop
      .string()
      .optional()
      .describe("Stable Yjs guid for the nested subdocument"),
  },
  content: "subdocument",
  fieldEditor: "none",
  authoring: {
    flowCapability: "flow-delegated",
    selectionRole: "delegated",
  },
  display: {
    title: "Subdocument",
    description: "Nested Pen editor backed by a Yjs subdocument",
    group: "advanced",
    aliases: ["subdoc", "nested document"],
    hidden: true,
  },
  serialize: {
    toMarkdown: (block) =>
      `<!-- pen-subdocument:${String(block.props.subdocumentGuid ?? "")} -->`,
    toHTML: (block) =>
      `<div data-pen-subdocument="${String(block.props.subdocumentGuid ?? "")}"></div>`,
  },
});
