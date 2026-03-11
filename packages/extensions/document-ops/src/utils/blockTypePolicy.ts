import {
  shouldExposeBlockInTooling,
  type BlockSchema,
  type Editor,
} from "@pen/types";

export function getAvailableToolBlockSchemas(editor: Editor): BlockSchema[] {
  return editor.schema
    .allBlocks()
    .filter((schema) => shouldExposeBlockInTooling(editor.documentProfile, schema));
}

export function assertToolCanUseBlockType(
  editor: Editor,
  blockType: string,
): BlockSchema {
  const schema = editor.schema.resolve(blockType);
  if (!schema) {
    throw new Error(`Unknown block type: "${blockType}"`);
  }

  if (!shouldExposeBlockInTooling(editor.documentProfile, schema)) {
    throw new Error(
      `Block type "${blockType}" is not available in ${editor.documentProfile} documents.`,
    );
  }

  return schema;
}
