import type { Editor, ToolDefinition, Position } from "@pen/types";
import { assertToolCanUseBlockType } from "../utils/blockTypePolicy";

export function insertBlockTool(editor: Editor): ToolDefinition {
  return {
    name: "insert_block",
    description: "Insert a new block at the specified position.",
    inputSchema: {
      type: "object",
      required: ["position", "blockType"],
      properties: {
        position: {},
        blockType: { type: "string" },
        props: { type: "object" },
        content: { type: "string" },
      },
    },
    handler: async (input: unknown) => {
      const opts = input as {
        position: Position;
        blockType: string;
        props?: Record<string, unknown>;
        content?: string;
      };
      assertToolCanUseBlockType(editor, opts.blockType);
      const blockId = crypto.randomUUID();

      editor.apply(
        [
          {
            type: "insert-block",
            blockId,
            blockType: opts.blockType,
            props: opts.props ?? {},
            position: opts.position,
          },
        ],
        { origin: "ai" },
      );

      if (opts.content) {
        editor.apply(
          [
            {
              type: "insert-text",
              blockId,
              offset: 0,
              text: opts.content,
            },
          ],
          { origin: "ai" },
        );
      }

      return { blockId };
    },
  };
}
