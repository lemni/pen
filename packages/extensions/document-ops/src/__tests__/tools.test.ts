import { describe, expect, it, vi } from "vitest";
import { defaultSchema } from "@pen/schema-default";
import type { ApplyOptions, DocumentOp, Editor } from "@pen/types";
import { listBlockTypesTool } from "../tools/listBlockTypes";
import { insertBlockTool } from "../tools/insertBlock";
import { writeDocumentTool } from "../tools/writeDocument";
import { ToolContextImpl } from "../toolContext";

function createFakeEditor(documentProfile: Editor["documentProfile"]): Editor {
  return {
    documentProfile,
    schema: defaultSchema,
    apply: vi.fn<(ops: DocumentOp[], options?: ApplyOptions) => void>(),
  } as unknown as Editor;
}

describe("@pen/document-ops tools", () => {
  it("filters hidden and flow-disallowed block types from list_block_types", async () => {
    const structuredEditor = createFakeEditor("structured");
    const flowEditor = createFakeEditor("flow");

    const structuredTypes = (await listBlockTypesTool(structuredEditor).handler(
      {},
      {} as never,
    )) as Array<{ type: string }>;
    const flowTypes = (await listBlockTypesTool(flowEditor).handler(
      {},
      {} as never,
    )) as Array<{ type: string }>;

    expect(structuredTypes.map((entry) => entry.type)).toContain("database");
    expect(structuredTypes.map((entry) => entry.type)).not.toContain("subdocument");
    expect(flowTypes.map((entry) => entry.type)).not.toContain("database");
    expect(flowTypes.map((entry) => entry.type)).not.toContain("subdocument");
  });

  it("rejects inserting flow-disallowed block types in flow documents", async () => {
    const editor = createFakeEditor("flow");

    await expect(
      insertBlockTool(editor).handler(
        {
          position: "last",
          blockType: "database",
        },
        {} as never,
      ),
    ).rejects.toThrow('Block type "database" is not available in flow documents.');

    expect(editor.apply).not.toHaveBeenCalled();
  });

  it("rejects hidden block types in structured documents before applying", async () => {
    const editor = createFakeEditor("structured");

    await expect(
      insertBlockTool(editor).handler(
        {
          position: "last",
          blockType: "subdocument",
        },
        {} as never,
      ),
    ).rejects.toThrow(
      'Block type "subdocument" is not available in structured documents.',
    );

    expect(editor.apply).not.toHaveBeenCalled();
  });

  it("rejects hidden and flow-disallowed block types in write_document", async () => {
    const flowEditor = createFakeEditor("flow");

    await expect(
      writeDocumentTool(flowEditor).handler(
        {
          blocks: [{ blockType: "database", content: "Rows" }],
        },
        {} as never,
      ),
    ).rejects.toThrow('Block type "database" is not available in flow documents.');

    expect(flowEditor.apply).not.toHaveBeenCalled();
  });

  it("validates all blocks before write_document mutates the document", async () => {
    const flowEditor = createFakeEditor("flow");

    await expect(
      writeDocumentTool(flowEditor).handler(
        {
          blocks: [
            { blockType: "paragraph", content: "Allowed" },
            { blockType: "database", content: "Blocked" },
          ],
        },
        {} as never,
      ),
    ).rejects.toThrow('Block type "database" is not available in flow documents.');

    expect(flowEditor.apply).not.toHaveBeenCalled();
  });

  it("guards ToolContext block insertion with the same policy", () => {
    const editor = createFakeEditor("flow");
    const emit = vi.fn();
    const context = new ToolContextImpl(editor, "doc-1", emit);

    expect(() =>
      context.insertBlock("database", {}, "last"),
    ).toThrow('Block type "database" is not available in flow documents.');

    expect(emit).not.toHaveBeenCalled();
    expect(editor.apply).not.toHaveBeenCalled();
  });
});
