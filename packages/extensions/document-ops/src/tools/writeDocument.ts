import type { Editor, ToolDefinition, Position } from "@pen/types";
import { assertToolCanUseBlockType } from "../utils/blockTypePolicy";

export function writeDocumentTool(editor: Editor): ToolDefinition {
  return {
    name: "write_document",
    description:
      "Write or replace content in the document using blocks.",
    inputSchema: {
      type: "object",
      required: ["blocks"],
      properties: {
        blocks: {
          type: "array",
          items: {
            type: "object",
            properties: {
              blockType: { type: "string" },
              content: { type: "string" },
              props: { type: "object" },
            },
          },
        },
        position: {},
      },
    },
    handler: async (input: unknown) => {
      const opts = input as {
        blocks: Array<{
          blockType: string;
          content?: string;
          props?: Record<string, unknown>;
        }>;
        position?: Position;
      };

      const insertedIds: string[] = [];
      let position = opts.position ?? ("last" as const);
      const ops: Parameters<Editor["apply"]>[0] = [];

      for (const block of opts.blocks) {
        assertToolCanUseBlockType(editor, block.blockType);
      }

      for (const block of opts.blocks) {
        const blockId = crypto.randomUUID();
        ops.push({
          type: "insert-block",
          blockId,
          blockType: block.blockType,
          props: block.props ?? {},
          position,
        });

        if (block.content) {
          ops.push({
            type: "insert-text",
            blockId,
            offset: 0,
            text: block.content,
          });
        }

        insertedIds.push(blockId);
        position = { after: blockId };
      }

      if (ops.length > 0) {
        editor.apply(ops, { origin: "ai" });
      }

      return { blockIds: insertedIds };
    },
  };
}
