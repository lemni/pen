import { describe, it, expect } from "vitest";
import {
  blocksToOps,
  createEditor,
  type PendingBlock,
} from "@pen/core";
import type { DocumentOp } from "@pen/types";
import { markdownExporter } from "../exporter";

type InsertTableCellTextOp = Extract<DocumentOp, { type: "insert-table-cell-text" }>;
type FormatTableCellTextOp = Extract<DocumentOp, { type: "format-table-cell-text" }>;
type UpdateTableColumnsOp = Extract<DocumentOp, { type: "update-table-columns" }>;
type DatabaseInsertRowOp = Extract<DocumentOp, { type: "database-insert-row" }>;
type InsertBlockOp = Extract<DocumentOp, { type: "insert-block" }>;

const noDefaultExtensionsPreset = {
  resolve() {
    return { extensions: [] };
  },
};

function editorWithBlocks(ops: Parameters<ReturnType<typeof createEditor>["apply"]>[0]) {
  const editor = createEditor({
    preset: noDefaultExtensionsPreset,
  });
  editor.apply(ops);
  return editor;
}

function editorWithTable(
  insertOp: Parameters<ReturnType<typeof createEditor>["apply"]>[0][0],
  cellOps: Parameters<ReturnType<typeof createEditor>["apply"]>[0],
) {
  const editor = createEditor({
    preset: noDefaultExtensionsPreset,
  });
  editor.apply([insertOp]);
  if (cellOps.length > 0) {
    editor.apply(cellOps);
  }
  return editor;
}

function createFlowEditorFromSeededDocument(
  seed: (editor: ReturnType<typeof createEditor>) => void,
) {
  const seedEditor = createEditor({
    preset: noDefaultExtensionsPreset,
  });
  seed(seedEditor);

  const document = seedEditor.internals.crdtDoc;
  seedEditor.internals.adapter.setDocumentProfile?.(document, "flow");

  const editor = createEditor({
    document,
    preset: noDefaultExtensionsPreset,
  });
  seedEditor.destroy();
  return editor;
}

describe("@pen/export-markdown", () => {
  it("exports a heading as markdown", () => {
    const editor = editorWithBlocks([
      {
        type: "insert-block",
        blockId: "b1",
        blockType: "heading",
        props: { level: 1 },
        position: "last",
      },
      { type: "insert-text", blockId: "b1", offset: 0, text: "Hello" },
    ]);

    const md = markdownExporter.export(editor);
    expect(md).toContain("# Hello");
    editor.destroy();
  });

  it("exports a paragraph as plain text", () => {
    const editor = editorWithBlocks([
      {
        type: "insert-block",
        blockId: "b1",
        blockType: "paragraph",
        props: {},
        position: "last",
      },
      { type: "insert-text", blockId: "b1", offset: 0, text: "Hello world" },
    ]);

    const md = markdownExporter.export(editor);
    expect(md).toContain("Hello world");
    editor.destroy();
  });

  it("exports multiple blocks separated by double newlines", () => {
    const editor = editorWithBlocks([
      {
        type: "insert-block",
        blockId: "b1",
        blockType: "heading",
        props: { level: 2 },
        position: "last",
      },
      { type: "insert-text", blockId: "b1", offset: 0, text: "Title" },
      {
        type: "insert-block",
        blockId: "b2",
        blockType: "paragraph",
        props: {},
        position: "last",
      },
      { type: "insert-text", blockId: "b2", offset: 0, text: "Body" },
    ]);

    const md = markdownExporter.export(editor);
    expect(md).toContain("## Title");
    expect(md).toContain("Body");
    editor.destroy();
  });

  it("exports numbered list items with their visible sequence values", () => {
    const editor = editorWithBlocks([
      {
        type: "insert-block",
        blockId: "b1",
        blockType: "numberedListItem",
        props: { start: 3 },
        position: "last",
      },
      { type: "insert-text", blockId: "b1", offset: 0, text: "Third" },
      {
        type: "insert-block",
        blockId: "b2",
        blockType: "numberedListItem",
        props: {},
        position: "last",
      },
      { type: "insert-text", blockId: "b2", offset: 0, text: "Fourth" },
    ]);

    const md = markdownExporter.export(editor);
    expect(md).toContain("3. Third\n4. Fourth");
    editor.destroy();
  });

  it("exports bold inline marks", () => {
    const editor = editorWithBlocks([
      {
        type: "insert-block",
        blockId: "b1",
        blockType: "paragraph",
        props: {},
        position: "last",
      },
      {
        type: "insert-text",
        blockId: "b1",
        offset: 0,
        text: "hello world",
      },
      {
        type: "format-text",
        blockId: "b1",
        offset: 0,
        length: 5,
        marks: { bold: true },
      },
    ]);

    const md = markdownExporter.export(editor);
    expect(md).toContain("**hello**");
    expect(md).toContain(" world");
    editor.destroy();
  });

  it("exports nested layout children via documentState.allBlocks()", () => {
    const editor = editorWithBlocks([
      {
        type: "insert-block",
        blockId: "toggle-1",
        blockType: "toggle",
        props: {},
        position: "last",
      },
      {
        type: "insert-block",
        blockId: "child-1",
        blockType: "paragraph",
        props: {},
        position: { parent: "toggle-1", index: 0 },
      },
      {
        type: "insert-text",
        blockId: "child-1",
        offset: 0,
        text: "Nested child",
      },
    ]);

    const md = markdownExporter.export(editor);
    expect(md).toContain("Nested child");
    editor.destroy();
  });

  it("has correct metadata", () => {
    expect(markdownExporter.name).toBe("markdown");
    expect(markdownExporter.mimeType).toBe("text/markdown");
    expect(markdownExporter.fileExtension).toBe(".md");
  });

  it("maps generic export options to resolved view mode and range export", () => {
    const editor = editorWithBlocks([
      {
        type: "insert-block",
        blockId: "b1",
        blockType: "paragraph",
        props: {},
        position: "last",
      },
      { type: "insert-text", blockId: "b1", offset: 0, text: "Keep" },
      {
        type: "insert-text",
        blockId: "b1",
        offset: 4,
        text: " draft",
      },
      {
        type: "format-text",
        blockId: "b1",
        offset: 4,
        length: 6,
        marks: {
          suggestion: {
            action: "delete",
          },
        },
      },
      {
        type: "insert-block",
        blockId: "b2",
        blockType: "paragraph",
        props: {},
        position: "last",
      },
      { type: "insert-text", blockId: "b2", offset: 0, text: "Tail" },
    ]);

    const md = markdownExporter.export(editor, {
      includeSuggestions: false,
      extra: {
        range: {
          startBlockId: "b1",
          endBlockId: "b1",
        },
      },
    });

    expect(md).toBe("Keep");
    editor.destroy();
  });

  it("exports a table block as a GFM pipe table", () => {
    const editor = editorWithTable(
      {
        type: "insert-block",
        blockId: "t1",
        blockType: "table",
        props: { hasHeaderRow: true },
        position: "last",
      },
      [
        {
          type: "insert-table-cell-text",
          blockId: "t1",
          row: 0,
          col: 0,
          offset: 0,
          text: "Name",
        } as InsertTableCellTextOp,
        {
          type: "insert-table-cell-text",
          blockId: "t1",
          row: 0,
          col: 1,
          offset: 0,
          text: "Age",
        } as InsertTableCellTextOp,
        {
          type: "insert-table-cell-text",
          blockId: "t1",
          row: 1,
          col: 0,
          offset: 0,
          text: "Alice",
        } as InsertTableCellTextOp,
        {
          type: "insert-table-cell-text",
          blockId: "t1",
          row: 1,
          col: 1,
          offset: 0,
          text: "30",
        } as InsertTableCellTextOp,
      ],
    );

    const md = markdownExporter.export(editor);
    expect(md).toContain("| Name | Age |");
    expect(md).toContain("| --- | --- |");
    expect(md).toContain("| Alice | 30 |");
    editor.destroy();
  });

  it("exports a table with pipe characters escaped", () => {
    const editor = editorWithTable(
      {
        type: "insert-block",
        blockId: "t1",
        blockType: "table",
        props: { hasHeaderRow: false },
        position: "last",
      },
      [
        {
          type: "insert-table-cell-text",
          blockId: "t1",
          row: 0,
          col: 0,
          offset: 0,
          text: "a|b",
        } as InsertTableCellTextOp,
      ],
    );

    const md = markdownExporter.export(editor);
    expect(md).toContain("<table>");
    expect(md).toContain("a|b");
    expect(md).not.toContain("| --- |");
    editor.destroy();
  });

  it("preserves inline formatting inside table cells", () => {
    const editor = editorWithTable(
      {
        type: "insert-block",
        blockId: "t2",
        blockType: "table",
        props: { hasHeaderRow: true },
        position: "last",
      },
      [
        {
          type: "insert-table-cell-text",
          blockId: "t2",
          row: 0,
          col: 0,
          offset: 0,
          text: "Name",
        } as InsertTableCellTextOp,
        {
          type: "format-table-cell-text",
          blockId: "t2",
          row: 0,
          col: 0,
          offset: 0,
          length: 4,
          marks: { bold: true },
        } as FormatTableCellTextOp,
      ],
    );

    const md = markdownExporter.export(editor);
    expect(md).toContain("**Name**");
    editor.destroy();
  });

  it("preserves seeded structured and hidden blocks when exporting flow documents", () => {
    const editor = createFlowEditorFromSeededDocument((seedEditor) => {
      seedEditor.apply([
        {
          type: "insert-block",
          blockId: "db1",
          blockType: "database",
          props: {},
          position: "last",
        },
        {
          type: "update-table-columns",
          blockId: "db1",
          columns: [{ id: "name", title: "Name", type: "text" }],
        } as UpdateTableColumnsOp,
        {
          type: "database-insert-row",
          blockId: "db1",
          rowId: "row-1",
          values: { name: "Alice" },
        } as DatabaseInsertRowOp,
        {
          type: "insert-block",
          blockId: "sub-1",
          blockType: "subdocument",
          props: { subdocumentGuid: "nested-guid" },
          position: "last",
        },
      ]);
    });

    const md = markdownExporter.export(editor);

    expect(editor.documentProfile).toBe("flow");
    expect(md).toContain("<!-- pen-database:");
    expect(md).toContain("| Alice |");
    expect(md).toContain("<!-- pen-subdocument:");

    editor.destroy();
  });
});

describe("table markdown round-trip", () => {
  it("import → editor → export produces equivalent markdown", () => {
    const inputBlocks: PendingBlock[] = [
      {
        type: "table",
        props: { hasHeaderRow: true, hasHeaderColumn: false },
        children: [
          {
            type: "__table_row",
            props: { _rowIndex: 0 },
            children: [
              { type: "__table_cell", props: {}, content: "Name" },
              { type: "__table_cell", props: {}, content: "Value" },
            ],
          },
          {
            type: "__table_row",
            props: { _rowIndex: 1 },
            children: [
              { type: "__table_cell", props: {}, content: "foo" },
              { type: "__table_cell", props: {}, content: "42" },
            ],
          },
        ],
      },
    ];

    const ops = blocksToOps(inputBlocks);
    const editor = createEditor({
      preset: noDefaultExtensionsPreset,
    });
    editor.apply(ops);

    const tableBlockId = (ops[0] as InsertBlockOp).blockId;
    const cell00 = editor.getBlock(tableBlockId)?.tableCell(0, 0);
    const cell01 = editor.getBlock(tableBlockId)?.tableCell(0, 1);
    const cell10 = editor.getBlock(tableBlockId)?.tableCell(1, 0);
    const cell11 = editor.getBlock(tableBlockId)?.tableCell(1, 1);
    expect(cell00?.textContent()).toBe("Name");
    expect(cell01?.textContent()).toBe("Value");
    expect(cell10?.textContent()).toBe("foo");
    expect(cell11?.textContent()).toBe("42");

    const md = markdownExporter.export(editor);
    expect(md).toContain("| Name | Value |");
    expect(md).toContain("| --- | --- |");
    expect(md).toContain("| foo | 42 |");

    editor.destroy();
  });

  it("round-trips a 2-column table through import and export", () => {
    const inputBlocks: PendingBlock[] = [
      {
        type: "table",
        props: { hasHeaderRow: true, hasHeaderColumn: false },
        children: [
          {
            type: "__table_row",
            props: { _rowIndex: 0 },
            children: [
              { type: "__table_cell", props: {}, content: "X" },
              { type: "__table_cell", props: {}, content: "Y" },
            ],
          },
          {
            type: "__table_row",
            props: { _rowIndex: 1 },
            children: [
              { type: "__table_cell", props: {}, content: "10" },
              { type: "__table_cell", props: {}, content: "20" },
            ],
          },
        ],
      },
    ];

    const ops = blocksToOps(inputBlocks);
    const editor = createEditor({
      preset: noDefaultExtensionsPreset,
    });
    editor.apply(ops);

    const block = editor.getBlock((ops[0] as InsertBlockOp).blockId);
    expect(block?.tableRowCount()).toBe(2);
    expect(block?.tableColumnCount()).toBe(2);

    const md = markdownExporter.export(editor);
    expect(md).toContain("| X | Y |");
    expect(md).toContain("| --- | --- |");
    expect(md).toContain("| 10 | 20 |");

    editor.destroy();
  });
});
