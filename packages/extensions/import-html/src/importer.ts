import type {
  PendingBlock,
} from "@pen/core";
import type {
  Editor,
  ImportResult,
  Importer,
  ImportOptions,
} from "@pen/types";
import {
  blocksToOps,
  createImportResult,
  normalizePendingBlocksForImport,
  reportPendingBlockImportViolations,
} from "@pen/core";
import { sanitizeHTML } from "./sanitize";
import { parseHTML } from "./domAdapter";
import { domToBlocks } from "./domToBlocks";

function parseRawHtmlToBlocks(
  input: string,
  editor: Editor,
): PendingBlock[] {
  const sanitized = sanitizeHTML(input);
  const dom = parseHTML(sanitized);
  return domToBlocks(dom, editor.schema);
}

function normalizeHtmlToBlocks(
  input: string,
  editor: Editor,
): {
  blocks: PendingBlock[];
  result: ImportResult;
} {
  const parsedBlocks = parseRawHtmlToBlocks(input, editor);
  const normalized = normalizePendingBlocksForImport(
    parsedBlocks,
    editor.documentProfile,
    editor.schema,
  );
  reportPendingBlockImportViolations(
    editor,
    normalized.violations,
    "import-html:parse",
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

export function parseHtmlToBlocks(
  input: string,
  editor: Editor,
): PendingBlock[] {
  return parseRawHtmlToBlocks(input, editor);
}

export const htmlImporter: Importer<string, PendingBlock[]> = {
  name: "html",
  mimeType: "text/html",
  parse(input: string, editor: Editor): PendingBlock[] {
    return parseHtmlToBlocks(input, editor);
  },

  async import(
    input: string,
    editor: Editor,
    options?: ImportOptions,
  ): Promise<ImportResult> {
    const { blocks, result } = normalizeHtmlToBlocks(input, editor);
    if (blocks.length === 0) return result;

    const ops = blocksToOps(blocks, options);
    editor.apply(ops, {
      origin: "import",
      ...(options?.undoGroup === false ? {} : { undoGroup: true }),
    });
    return result;
  },
};
