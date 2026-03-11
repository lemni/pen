import type {
  ImportResult,
  Importer,
  ImportOptions,
  Editor,
  PendingBlock,
} from "@pen/core";
import {
  blocksToOps,
  createImportResult,
  normalizePendingBlocksForImport,
  reportPendingBlockImportViolations,
} from "@pen/core";
import { fromMarkdown } from "mdast-util-from-markdown";
import { gfm } from "micromark-extension-gfm";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { astToBlocks } from "./astToBlocks";
import type { MdastRoot } from "./types";

function parseRawMarkdownToBlocks(
  input: string,
  editor: Editor,
): PendingBlock[] {
  const tree = fromMarkdown(input, {
    extensions: [gfm()],
    mdastExtensions: [gfmFromMarkdown()],
  });

  return astToBlocks(tree as MdastRoot, editor.schema);
}

function normalizeMarkdownToBlocks(
  input: string,
  editor: Editor,
): {
  blocks: PendingBlock[];
  result: ImportResult;
} {
  const parsedBlocks = parseRawMarkdownToBlocks(input, editor);
  const normalized = normalizePendingBlocksForImport(
    parsedBlocks,
    editor.documentProfile,
    editor.schema,
  );
  reportPendingBlockImportViolations(
    editor,
    normalized.violations,
    "import-markdown:parse",
  );
  return {
    blocks: normalized.blocks,
    result: createImportResult(
      parsedBlocks.length,
      normalized.blocks.length,
      normalized.violations,
    ),
  };
}

export function parseMarkdownToBlocks(
  input: string,
  editor: Editor,
): PendingBlock[] {
  return parseRawMarkdownToBlocks(input, editor);
}

export const markdownImporter: Importer<string, PendingBlock[]> = {
  name: "markdown",
  mimeType: "text/markdown",
  parse(input: string, editor: Editor): PendingBlock[] {
    return parseMarkdownToBlocks(input, editor);
  },

  import(input: string, editor: Editor, options?: ImportOptions): ImportResult {
    const { blocks, result } = normalizeMarkdownToBlocks(input, editor);
    if (blocks.length === 0) return result;

    const ops = blocksToOps(blocks, options);

    editor.apply(ops, {
      origin: "import",
      ...(options?.undoGroup === false ? {} : { undoGroup: true }),
    });
    return result;
  },
};
